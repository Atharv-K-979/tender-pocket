package com.tenderpocket.services;

import org.springframework.stereotype.Service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.*;

@Service
public class AISpecificationIntelligenceService {

    private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
            new com.fasterxml.jackson.databind.ObjectMapper();

    @org.springframework.beans.factory.annotation.Value("${gemini.api.key:}")
    private String geminiApiKey;

    public List<String[]> processOcrAndSynthesizeClauses(String rawOcrText, Map<String, String> data) {
        return processOcrAndSynthesizeClauses(rawOcrText, null, data);
    }

    /**
     * AI Intelligence Engine for processing raw OCR/Text or File Bytes from Tender Documents 
     * and synthesizing structured 5-column technical compliance clauses.
     */
    public List<String[]> processOcrAndSynthesizeClauses(String rawOcrText, byte[] fileBytes, Map<String, String> data) {
        if (rawOcrText == null) rawOcrText = "";

        // 1. Attempt Generative Vision/LLM AI Call if API Key or Ollama Host is configured
        List<String[]> llmClauses = extractAcrossChunks(rawOcrText, fileBytes, data);
        if (llmClauses != null && !llmClauses.isEmpty()) {
            System.out.println("[AISpecificationIntelligence] Successfully generated " + llmClauses.size() + " technical clauses using Generative AI Vision LLM Model.");
            return llmClauses;
        }

        // 2. Local OCR Fallback Guard: Reject unverified OCR text on scanned/handwritten documents
        System.out.println("[AISpecificationIntelligence] Gemini Vision AI unconfigured or offline. Rejecting unverified OCR scan.");
        return Collections.emptyList();
    }

    private String getEffectiveApiKey() {
        if (geminiApiKey != null && !geminiApiKey.trim().isEmpty()) {
            return geminiApiKey.trim();
        }
        String envKey = System.getenv("GEMINI_API_KEY");
        if (envKey != null && !envKey.trim().isEmpty()) {
            return envKey.trim();
        }
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("application.properties")) {
            if (is != null) {
                Properties props = new Properties();
                props.load(is);
                String propKey = props.getProperty("gemini.api.key");
                if (propKey != null && !propKey.trim().isEmpty()) {
                    return propKey.trim();
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** The model stops writing at this many output tokens, which is what actually bounds a chunk. */
    private static final int MAX_OUTPUT_TOKENS = 8192;

    /**
     * How much document text goes into one request. The binding limit is what the model has to write
     * back, not what it reads: a clause costs around 117 characters of JSON, so the 78-page tender that
     * lost its last schedule was asking for roughly 14,800 output tokens against a ceiling of 8,192.
     * This default keeps a chunk's answer near half the ceiling, which works out at about five requests
     * for that document rather than twenty-three. Raise it to spend fewer requests per document, lower
     * it if answers start truncating. Set techspec.chunk-chars to override.
     */
    @org.springframework.beans.factory.annotation.Value("${techspec.chunk-chars:40000}")
    private int maxCharsPerChunk = 40000;

    /** Opens a new equipment section, so a chunk boundary here keeps each item's clauses together. */
    private static final Pattern SECTION_HEADING = Pattern.compile(
            "(?i)^\\s*(annexure\\b|appendix\\b|schedule\\s+\\w+\\b|technical\\s+specifications?\\s+(for|of)\\b|specifications?\\s+for\\b).*");

    /**
     * Splits a long document across several requests. Asking for every clause in one answer made the model
     * run short towards the end: on a 78-page upload the last and largest schedule came back with clauses
     * missing while the earlier eleven were complete. Each chunk is small enough to answer in full.
     */
    private List<String[]> extractAcrossChunks(String rawOcrText, byte[] fileBytes, Map<String, String> data) {
        if (rawOcrText.length() <= maxCharsPerChunk) {
            return callGenerativeLlmAi(rawOcrText, fileBytes, data);
        }

        List<String> chunks = splitIntoChunks(rawOcrText);

        // Name the equipment once, before any chunk is read, so every chunk labels its clauses the same
        // way. The document's own section headings lead and the model fills in what has no heading, so
        // an item the model overlooks is still quoted for.
        List<String> declared = headingsDeclaringProducts(rawOcrText);
        List<String> suggested = discoverComponents(rawOcrText);
        List<String> components = mergeComponents(declared, suggested);

        System.out.println("[AISpecificationIntelligence] Document split into " + chunks.size()
                + " chunk(s); " + declared.size() + " declared by heading, " + suggested.size()
                + " named by the model, " + components.size() + " item(s) to extract"
                + (components.isEmpty() ? " (chunks will name their own)." : ": " + String.join(", ", components)));

        if (!components.isEmpty()) {
            return extractPerComponent(rawOcrText, components, data);
        }

        LinkedHashMap<String, String[]> merged = new LinkedHashMap<>();
        for (int i = 0; i < chunks.size(); i++) {
            // Text only. Extraction has already run OCR over the scanned pages, so the chunk text carries
            // what the page images would have, and the whole file is not re-sent with every chunk.
            List<String[]> part = callGenerativeLlmAi(chunks.get(i), null, data, components);
            if (part == null || part.isEmpty()) {
                System.out.println("[AISpecificationIntelligence] Chunk " + (i + 1) + "/" + chunks.size() + " returned no clauses.");
                continue;
            }
            for (String[] clause : part) {
                merged.putIfAbsent(clauseKey(clause), clause);
            }
            System.out.println("[AISpecificationIntelligence] Chunk " + (i + 1) + "/" + chunks.size()
                    + " returned " + part.size() + " clause(s); " + merged.size() + " unique so far.");
        }

        return new ArrayList<>(merged.values());
    }

    /**
     * Reads the document once per piece of equipment rather than once per chunk. A chunk holding several
     * items had the model settle on the dominant one: the last upload gave 38 clauses to ILR Small and 11
     * to ILR Large, whose specification is the same size, and left DF Large with a single clause. Asking
     * for one item at a time removes the competition, and keeps each answer small enough to finish.
     */
    private List<String[]> extractPerComponent(String rawOcrText, List<String> components, Map<String, String> data) {
        LinkedHashMap<String, String[]> merged = new LinkedHashMap<>();
        List<Section> sections = sliceIntoSections(rawOcrText);

        List<String> empty = new ArrayList<>();

        for (int i = 0; i < components.size(); i++) {
            String component = components.get(i);
            String scope = sectionsFor(sections, component, rawOcrText);

            List<String[]> part = callGenerativeLlmAi(scope, null, data, components, component);

            // Nothing found in the section picked for it: the heading match may have been wrong, so look
            // again across the whole document before accepting that the tender says nothing about it.
            if ((part == null || part.isEmpty()) && scope.length() < rawOcrText.length()) {
                System.out.println("[AISpecificationIntelligence] " + component
                        + ": nothing in its section, re-reading the whole document.");
                part = callGenerativeLlmAi(rawOcrText, null, data, components, component);
            }

            int found = part == null ? 0 : part.size();
            if (found == 0) {
                empty.add(component);
            } else {
                for (String[] clause : part) {
                    // The answer is for this item, so file it here whatever name came back. Left to the
                    // model the name drifts, and grouping then splits one item across two schedules.
                    if (clause.length > 5) {
                        clause[5] = component;
                    }
                    merged.putIfAbsent(clauseKey(clause), clause);
                }
            }
            System.out.println("[AISpecificationIntelligence] " + (i + 1) + "/" + components.size()
                    + " " + component + ": " + found + " clause(s) from " + scope.length() + " chars.");
        }

        // A schedule the buyer expects and cannot find reads as an unanswered requirement, so say plainly
        // which items came back with nothing rather than letting them go quietly missing from the sheet.
        if (!empty.isEmpty()) {
            System.out.println("[AISpecificationIntelligence] No clauses found for " + empty.size()
                    + " item(s) the document declares: " + String.join(", ", empty));
        }
        System.out.println("[AISpecificationIntelligence] " + (components.size() - empty.size()) + "/"
                + components.size() + " item(s) produced clauses; " + merged.size() + " unique clause(s) in total.");

        return new ArrayList<>(merged.values());
    }

    /** One equipment section: the heading that opens it and the text up to the next heading. */
    private static final class Section {
        final String heading;
        final StringBuilder body = new StringBuilder();

        Section(String heading) {
            this.heading = heading;
        }
    }

    /**
     * Cuts the document at its equipment headings. Matching an item against whole chunks did not narrow
     * anything: a chunk runs to twenty thousand characters and mentions most of the equipment in passing,
     * so nearly every item ended up reading the whole document again. A section runs from its heading to
     * the next one, which is the part that actually specifies that item.
     */
    private List<Section> sliceIntoSections(String text) {
        List<Section> sections = new ArrayList<>();
        Section current = new Section("");

        for (String line : text.split("\n")) {
            if (SECTION_HEADING.matcher(line).matches()) {
                if (current.body.length() > 0) {
                    sections.add(current);
                }
                current = new Section(line.trim());
            }
            current.body.append(line).append("\n");
        }
        if (current.body.length() > 0) {
            sections.add(current);
        }
        return sections;
    }

    /**
     * The sections specifying this equipment. A heading naming the item is the strong signal; where none
     * does, the item's terms are counted through the body instead, and failing both the whole document is
     * read rather than returning nothing for it.
     */
    private String sectionsFor(List<Section> sections, String component, String wholeDocument) {
        List<String> terms = new ArrayList<>();
        for (String word : component.toLowerCase().split("[^a-z0-9]+")) {
            // Single letters and bare digits appear everywhere and would match every section.
            if (word.length() > 1) {
                terms.add(word);
            }
        }
        if (terms.isEmpty()) {
            return wholeDocument;
        }

        int[] headingScore = new int[sections.size()];
        int[] bodyScore = new int[sections.size()];
        int bestHeading = 0;
        int bestBody = 0;
        for (int i = 0; i < sections.size(); i++) {
            String heading = sections.get(i).heading.toLowerCase();
            String body = sections.get(i).body.toString().toLowerCase();
            for (String term : terms) {
                if (heading.contains(term)) {
                    headingScore[i]++;
                }
                if (body.contains(term)) {
                    bodyScore[i]++;
                }
            }
            bestHeading = Math.max(bestHeading, headingScore[i]);
            bestBody = Math.max(bestBody, bodyScore[i]);
        }

        StringBuilder scope = new StringBuilder();
        // A heading match is decisive, so only sections matching it as strongly are read. Falling back to
        // the body needs every term present, or a passing mention would pull the section in.
        boolean byHeading = bestHeading > 0;
        for (int i = 0; i < sections.size(); i++) {
            boolean take = byHeading ? headingScore[i] == bestHeading : bodyScore[i] == terms.size();
            if (take) {
                scope.append(sections.get(i).body);
            }
        }

        return scope.length() > 0 ? scope.toString() : wholeDocument;
    }

    /** A line opening a numbered clause, such as "3.4. Door: ..." — the only safe place to end a chunk. */
    private static final Pattern CLAUSE_START = Pattern.compile("^\\s*\\d{1,2}(\\.\\d{1,3})*\\.?\\s+\\S.*");

    /** Ceiling before a chunk is cut regardless, for a section that runs on without a clause boundary. */
    private static final double HARD_LIMIT_FACTOR = 1.5;

    /**
     * Breaks only where a new clause or equipment heading begins. A clause runs over several lines, so
     * ending a chunk at any line lands mid-sentence: on the last upload four of seven boundaries cut a
     * clause in two, leaving 33 rows opening mid-sentence and 55 ending unfinished. Neither half was a
     * whole clause, and the stray number a half-sentence began with became its clause number.
     */
    private List<String> splitIntoChunks(String text) {
        List<String> chunks = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        int hardLimit = (int) (maxCharsPerChunk * HARD_LIMIT_FACTOR);

        for (String line : text.split("\n")) {
            boolean startsSection = SECTION_HEADING.matcher(line).matches();
            boolean startsClause = CLAUSE_START.matcher(line).matches();
            boolean over = current.length() + line.length() + 1 > maxCharsPerChunk;

            // Once past the target size, wait for a clause or heading to come round before breaking. The
            // hard limit is the release valve for a run of text that never offers one.
            boolean canBreak = startsSection || startsClause;
            boolean mustBreak = current.length() + line.length() + 1 > hardLimit;

            // A heading earns an early break once the chunk is worth sending on its own, otherwise a run
            // of consecutive headings produces a chunk each.
            boolean headingBreak = startsSection && current.length() > maxCharsPerChunk / 4;

            if (current.length() > 0 && ((over && canBreak) || mustBreak || headingBreak)) {
                chunks.add(current.toString());
                current.setLength(0);
            }
            current.append(line).append("\n");
        }

        if (current.length() > 0) {
            chunks.add(current.toString());
        }
        return chunks;
    }

    /**
     * Keeps a clause number only when it reads like one. Where a clause arrives without its own number the
     * model reaches for the first figure in the sentence, and the last upload filed rows under a capacity
     * ("0.3" from 0.3 Liters), a date ("01.7.2003"), a standard ("17547"), a year ("2025") and a voltage
     * ("415"). An empty number is honest; a capacity presented as a clause number is not.
     */
    static String cleanClauseNumber(String raw) {
        if (raw == null) {
            return "";
        }
        String value = raw.trim().replaceAll("\\.$", "");
        if (!value.matches("\\d{1,2}(\\.\\d{1,3})*")) {
            return "";
        }

        String[] segments = value.split("\\.");
        // Clause numbering starts at one and climbs slowly. A year, a standard number or a measurement
        // shows up as a segment far past where any tender's numbering reaches.
        for (int i = 0; i < segments.length; i++) {
            int segment;
            try {
                segment = Integer.parseInt(segments[i]);
            } catch (NumberFormatException e) {
                return "";
            }
            if (segment > (i == 0 ? 30 : 50)) {
                return "";
            }
        }
        // A leading zero marks a date or a capacity: "0.3" is 0.3 litres, "01.7.2003" is a date.
        if (segments[0].startsWith("0")) {
            return "";
        }
        return value;
    }

    /** Two clauses are the same clause when they carry the same number under the same equipment. */
    private String clauseKey(String[] clause) {
        String component = clause.length > 5 && clause[5] != null ? clause[5].trim() : "";
        String normalizedComp = DocumentGeneratorService.normalizeCategoryName(component).toLowerCase();
        String srNo = clause.length > 0 && clause[0] != null ? clause[0].trim() : "";
        String spec = clause.length > 1 && clause[1] != null ? clause[1].trim() : "";
        return normalizedComp + "|" + (srNo.isEmpty() ? spec : srNo);
    }

    /** Model fallback order, shared so naming the equipment survives a rate limit the same way extraction does. */
    private static final String[] MODEL_CHAIN =
            {"gemini-flash-latest", "gemini-1.5-flash", "gemini-1.5-pro"};

    /**
     * Asks once for the equipment the document specifies, so every chunk can be told to label its clauses
     * with the same names. Each chunk is read on its own, so left to itself it names the same item
     * differently -- "Deep Freezer - DF (Large)" in one and "DF Large" in the next -- and grouping then
     * files one piece of equipment under two schedules. Returns empty when unavailable, which leaves the
     * chunks naming the equipment themselves and the fuzzy matcher to reconcile what it can.
     */
    /**
     * A heading declaring that a specification section follows, such as "Technical Specifications for
     * Deep Freezer - DF (Small)" or "ANNEXURE-1: Diesel Generating Set". The tender writes one per item.
     */
    private static final Pattern PRODUCT_HEADING = Pattern.compile(
            // A tender qualifies the word differently per section -- "Technical Specifications for",
            // "Equipment Specifications for", "Detailed Specification for" -- so a couple of leading
            // words are allowed. They must be capitalised, as must "Specification" itself, which is what
            // separates a heading from a citation mid-sentence: "as per the BIS published Specification
            // for Water Packs" names a standard being referenced, not an item to quote for.
            "^\\s*(?:[A-Z][A-Za-z]*\\s+){0,2}Specifications?\\s+(?:for|of)\\s+(.{3,80}?)\\s*$"
                    + "|(?i)^\\s*annexure\\s*[-–—]?\\s*[0-9ivx]*\\s*[:.]\\s*(.{3,80}?)\\s*$");

    /** A heading naming its item in quotes, as in: Equipment Specifications for "Freeze Marker" for ... */
    private static final Pattern QUOTED_NAME = Pattern.compile("[\"“”']([^\"“”']{3,60})[\"“”']");

    /** Trailing words that mean the heading wrapped mid-phrase rather than ending on the item's name. */
    private static final Pattern DANGLING_TAIL = Pattern.compile("(?i)[\\s,–—-]+(and|or|the|of|for|with|to|in|a|an|as|per)$");

    /**
     * The equipment the document itself declares a section for. The model's list is what it chose to
     * mention, and on the last run it named eight items where the document has sections for twelve,
     * dropping ILR (Small) and DF (Small) as though the Large variants covered them. A heading is not a
     * judgement call: where the tender writes "Technical Specifications for X", X is an item to quote for.
     */
    private List<String> headingsDeclaringProducts(String text) {
        java.util.LinkedHashSet<String> found = new java.util.LinkedHashSet<>();

        for (String line : text.split("\n")) {
            Matcher matcher = PRODUCT_HEADING.matcher(line.trim());
            if (!matcher.matches()) {
                continue;
            }
            String name = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
            if (name == null) {
                continue;
            }

            // Where the heading quotes its item, the quotes are the name and the rest describes what it
            // is for: Equipment Specifications for "Freeze Marker" for transportation of freeze ...
            Matcher quoted = QUOTED_NAME.matcher(name);
            if (quoted.find()) {
                name = quoted.group(1);
            }

            // A heading broken across lines leaves a conjunction hanging; trim it back to the name.
            name = DANGLING_TAIL.matcher(name.trim()).replaceAll("").trim();
            name = name.replaceAll("[\\s:.;,-]+$", "").trim();

            // Product names carry a capital. Prose swept up by the pattern, such as "high efficiency and
            // low", does not, and would otherwise be quoted for as though it were a piece of equipment.
            boolean named = false;
            for (String word : name.split("\\s+")) {
                if (!word.isEmpty() && Character.isUpperCase(word.charAt(0))) {
                    named = true;
                    break;
                }
            }

            if (named && name.length() >= 3) {
                found.add(name);
            }
        }
        return new ArrayList<>(found);
    }

    /**
     * Combines what the document declares with what the model noticed. The headings lead, being the
     * tender's own words, and a model entry is added only when no heading already covers it: "ILR Large"
     * and "Ice-lined Refrigerator - ILR (Large)" are one item, and listing both would quote for it twice.
     */
    private List<String> mergeComponents(List<String> fromHeadings, List<String> fromModel) {
        List<String> merged = new ArrayList<>(fromHeadings);

        for (String candidate : fromModel) {
            boolean alreadyCovered = false;
            for (String existing : merged) {
                if (sameEquipment(existing, candidate)) {
                    alreadyCovered = true;
                    break;
                }
            }
            if (!alreadyCovered) {
                merged.add(candidate);
            }
        }
        return merged;
    }

    /** Two names describe one item when either's significant words are all contained in the other's. */
    private boolean sameEquipment(String left, String right) {
        Set<String> leftWords = significantWords(left);
        Set<String> rightWords = significantWords(right);
        if (leftWords.isEmpty() || rightWords.isEmpty()) {
            return false;
        }
        return leftWords.containsAll(rightWords) || rightWords.containsAll(leftWords);
    }

    private Set<String> significantWords(String name) {
        Set<String> words = new java.util.LinkedHashSet<>();
        for (String word : name.toLowerCase().split("[^a-z0-9]+")) {
            // Single characters carry no meaning on their own and match everything.
            if (word.length() > 1) {
                words.add(word);
            }
        }
        return words;
    }

    private List<String> discoverComponents(String text) {
        String apiKey = getEffectiveApiKey();
        if (apiKey == null || apiKey.trim().isEmpty() || text == null || text.trim().isEmpty()) {
            return Collections.emptyList();
        }

        String prompt = "List the distinct pieces of equipment for which this tender document gives technical specifications.\n"
                + "Use the name the document titles each item with, and keep size or rating variants separate, for example \"ILR Large\" and \"ILR Small\".\n"
                + "A variant is its own item and must never be merged into another: ILR (Large) and ILR (Small) are two\n"
                + "items, as are a 150-280V and a 100-280V stabiliser, and a walk-in cooler and a walk-in freezer.\n"
                + "Name each item exactly once. Ignore bid forms, declarations and general conditions.\n"
                + "Return ONLY a JSON array of strings. Return [] if the document specifies no equipment.\n\n"
                + "DOCUMENT TEXT:\n" + text;

        String payload = "{\"contents\":[{\"parts\":[{\"text\":\"" + escapeJson(prompt) + "\"}]}]}";

        for (String modelName : MODEL_CHAIN) {
            String response = postOnce(modelName, apiKey, payload);
            if (response == null) {
                continue;
            }
            try {
                JsonNode array = readClauseArray(extractModelText(response));
                if (array != null && array.isArray() && array.size() > 0) {
                    List<String> components = new ArrayList<>();
                    for (JsonNode node : array) {
                        String name = node.isTextual() ? node.asText().trim() : text(node, "name");
                        if (!name.isEmpty()) {
                            components.add(name);
                        }
                    }
                    if (!components.isEmpty()) {
                        return components;
                    }
                }
            } catch (Exception e) {
                System.err.println("[AISpecificationIntelligence] Could not read the equipment list: " + e.getMessage());
            }
        }
        return Collections.emptyList();
    }

    /** Key cooldown tracker: Maps rate-limited API keys to their cooldown expiry timestamp (12 hours) */
    private static final java.util.concurrent.ConcurrentHashMap<String, Long> RATE_LIMITED_KEYS = new java.util.concurrent.ConcurrentHashMap<>();

    private List<String> getAllApiKeys() {
        List<String> rawKeys = new ArrayList<>();
        if (geminiApiKey != null && !geminiApiKey.trim().isEmpty()) {
            rawKeys.addAll(Arrays.asList(geminiApiKey.split(",")));
        }
        String envKey = System.getenv("GEMINI_API_KEY");
        if (envKey != null && !envKey.trim().isEmpty()) {
            rawKeys.addAll(Arrays.asList(envKey.split(",")));
        }
        try (InputStream is = getClass().getClassLoader().getResourceAsStream("application.properties")) {
            if (is != null) {
                Properties props = new Properties();
                props.load(is);
                String propKey = props.getProperty("gemini.api.key");
                if (propKey != null && !propKey.trim().isEmpty()) {
                    rawKeys.addAll(Arrays.asList(propKey.split(",")));
                }
            }
        } catch (Exception ignored) {}

        List<String> cleanKeys = new ArrayList<>();
        for (String k : rawKeys) {
            if (k != null && !k.trim().isEmpty()) {
                String clean = k.trim();
                if (!cleanKeys.contains(clean)) {
                    cleanKeys.add(clean);
                }
            }
        }
        return cleanKeys;
    }

    private void markKeyRateLimited(String key) {
        if (key != null && !key.trim().isEmpty()) {
            long cooldownUntil = System.currentTimeMillis() + (12 * 3600 * 1000L);
            RATE_LIMITED_KEYS.put(key.trim(), cooldownUntil);
            String masked = key.length() > 8 ? key.substring(0, 4) + "..." + key.substring(key.length() - 4) : "***";
            System.out.println("[AISpecificationIntelligence] Key [" + masked + "] hit HTTP 429 Quota Limit. Cooldown 12h. Rotating to next API key in pool...");
        }
    }

    /** One POST to a named model. Returns the response body on success, or null so the caller tries the next. */
    private String postOnce(String modelName, String apiKey, String jsonPayload) {
        List<String> keys = getAllApiKeys();
        if (keys.isEmpty() && apiKey != null && !apiKey.trim().isEmpty()) {
            keys.add(apiKey.trim());
        }

        long now = System.currentTimeMillis();
        for (String currentKey : keys) {
            Long cooldown = RATE_LIMITED_KEYS.get(currentKey);
            if (cooldown != null && now < cooldown) {
                continue; // Skip key currently in rate-limit cooldown
            }
            try {
                URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + currentKey);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("x-goog-api-key", currentKey);
                conn.setDoOutput(true);
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(180000);

                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = jsonPayload.getBytes(StandardCharsets.UTF_8);
                    os.write(input, 0, input.length);
                }

                int responseCode = conn.getResponseCode();
                if (responseCode == 200) {
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                        StringBuilder response = new StringBuilder();
                        String responseLine;
                        while ((responseLine = br.readLine()) != null) {
                            response.append(responseLine.trim());
                        }
                        return response.toString();
                    }
                }

                if (responseCode == 429) {
                    markKeyRateLimited(currentKey);
                    continue; // Key 429 -> Rotate to next key in key pool!
                }

                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8))) {
                    StringBuilder errorRes = new StringBuilder();
                    String errLine;
                    while ((errLine = br.readLine()) != null) {
                        errorRes.append(errLine.trim());
                    }
                    System.err.println("[AISpecificationIntelligence] Model " + modelName + " HTTP " + responseCode + " Error: " + errorRes);
                }
            } catch (Exception e) {
                System.err.println("[AISpecificationIntelligence] Exception with model " + modelName + ": " + e.getMessage());
            }
        }
        return null;
    }

    private List<String[]> callGenerativeLlmAi(String rawOcrText, byte[] fileBytes, Map<String, String> data) {
        return callGenerativeLlmAi(rawOcrText, fileBytes, data, Collections.emptyList());
    }

    private List<String[]> callGenerativeLlmAi(String rawOcrText, byte[] fileBytes, Map<String, String> data, List<String> components) {
        return callGenerativeLlmAi(rawOcrText, fileBytes, data, components, null);
    }

    /**
     * How the request is told to label a clause. Reading one item at a time is the point of the
     * per-item pass, so the whole answer belongs to that item and there is nothing to choose between.
     */
    private String componentRule(List<String> components, String targetComponent) {
        if (targetComponent != null && !targetComponent.trim().isEmpty()) {
            return "4. Extract ONLY the clauses specifying \"" + targetComponent + "\", and set productCategory to \""
                    + targetComponent + "\" on every row. The text also covers other equipment: ignore those clauses "
                    + "entirely. Return every clause for \"" + targetComponent + "\", including warranty and "
                    + "maintenance terms. Return [] if this text specifies nothing for it.\n";
        }
        if (components == null || components.isEmpty()) {
            return "4. Set productCategory/component to the equipment that clause belongs to (e.g., 'ILR Large', 'ILR Small', 'DF Large', 'WIC 40 CuM', 'Voltage Stabilizer', etc.).\n";
        }
        return "4. Set productCategory/component to exactly one of these names, copied character for character: "
                + String.join(" | ", components)
                + ". Pick the one the clause describes. Do not invent, abbreviate or reword a name.\n";
    }

    private List<String[]> callGenerativeLlmAi(String rawOcrText, byte[] fileBytes, Map<String, String> data,
                                               List<String> components, String targetComponent) {
        String apiKey = getEffectiveApiKey();
        String ollamaHost = System.getenv("OLLAMA_HOST");

        String systemPrompt = "You are an expert Tender Technical Specification Intelligence AI. Given a tender document (PDF or image), extract EVERY SINGLE ITEM CLAUSE AND SUB-CLAUSE as individual detailed rows.\n"
                + "RULES:\n"
                + "1. Accommodate Part numbers, Model numbers, and Quantities directly inside the 'specification' column text (e.g. '[Description] (Lakeshore Model/Part No: X, Quantity: Y)'). Set 'remarks' column to '-'.\n"
                + "2. ALWAYS INCLUDE Warranty, Maintenance, AMC/CMC terms, and Essential Equipment Requirements listed in the tender specification table. DO NOT extract administrative Vendor Qualification Criteria or OEM Authorization letters.\n"
                + "3. Reuse the document's own clause numbering (for example 3.4, 5.1) as srNo. Number sequentially only when the source has none.\n"
                + componentRule(components, targetComponent)
                + "5. Return ONLY a JSON array of objects with keys: srNo, specification, compliance, deviation, remarks, productCategory.";

        String fullPrompt = systemPrompt;
        if (rawOcrText != null && rawOcrText.trim().length() > 20) {
            fullPrompt += "\n\nEXTRACTED DOCUMENT TEXT:\n" + rawOcrText;
        }
        String jsonPayload = "";
        if (fileBytes != null && fileBytes.length > 0) {
            String base64Data = Base64.getEncoder().encodeToString(fileBytes);
            String mimeType = detectMimeType(fileBytes);
            jsonPayload = "{\"contents\":[{\"parts\":[{\"text\":\"" + escapeJson(fullPrompt) + "\"},{\"inlineData\":{\"mimeType\":\"" + mimeType + "\",\"data\":\"" + base64Data + "\"}}]}]}";
        } else {
            jsonPayload = "{\"contents\":[{\"parts\":[{\"text\":\"" + escapeJson(fullPrompt) + "\"}]}]}";
        }

        for (String modelName : MODEL_CHAIN) {
            System.out.println("[AISpecificationIntelligence] Attempting Gemini Model: " + modelName);
            String response = postOnce(modelName, apiKey, jsonPayload);
            if (response != null && !response.trim().isEmpty()) {
                List<String[]> clauses = parseLlmJsonResponse(response, data);
                if (clauses != null && !clauses.isEmpty()) {
                    return clauses;
                }
            }
        }
        if (ollamaHost != null && !ollamaHost.isEmpty()) {
            try {
                String endpointUrl = ollamaHost + "/api/generate";
                String ollamaPayload = "{\"model\":\"llama3\",\"prompt\":\"" + escapeJson(systemPrompt + "\n\nRAW OCR TEXT:\n" + rawOcrText) + "\",\"stream\":false}";
                URL url = new URL(endpointUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);

                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = ollamaPayload.getBytes(StandardCharsets.UTF_8);
                    os.write(input, 0, input.length);
                }

                if (conn.getResponseCode() == 200) {
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                        StringBuilder response = new StringBuilder();
                        String responseLine;
                        while ((responseLine = br.readLine()) != null) {
                            response.append(responseLine.trim());
                        }
                        return parseLlmJsonResponse(response.toString(), data);
                    }
                }
            } catch (Exception e) {
                System.err.println("[AISpecificationIntelligence] Ollama Call Exception: " + e.getMessage());
            }
        }

        return null;
    }

    private String detectMimeType(byte[] bytes) {
        if (bytes == null || bytes.length < 4) return "application/pdf";
        if (bytes[0] == (byte) '%' && bytes[1] == (byte) 'P' && bytes[2] == (byte) 'D' && bytes[3] == (byte) 'F') {
            return "application/pdf";
        }
        if (bytes[0] == (byte) 0x89 && bytes[1] == (byte) 0x50 && bytes[2] == (byte) 0x4E && bytes[3] == (byte) 0x47) {
            return "image/png";
        }
        if (bytes[0] == (byte) 0xFF && bytes[1] == (byte) 0xD8) {
            return "image/jpeg";
        }
        return "application/pdf";
    }

    private List<String[]> parseLlmJsonResponse(String jsonResponse, Map<String, String> data) {
        List<String[]> clauses = new ArrayList<>();
        try {
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(jsonResponse);

            String textContent = jsonResponse;
            if (root.has("candidates") && root.get("candidates").isArray() && root.get("candidates").size() > 0) {
                JsonNode candidate = root.get("candidates").get(0);
                if (candidate.has("content") && candidate.get("content").has("parts") && candidate.get("content").get("parts").isArray()) {
                    JsonNode part = candidate.get("content").get("parts").get(0);
                    if (part.has("text")) {
                        textContent = part.get("text").asText();
                    }
                }
            }

            int startIdx = textContent.indexOf("[");
            int endIdx = textContent.lastIndexOf("]");
            if (startIdx != -1 && endIdx != -1 && endIdx > startIdx) {
                String jsonArrayStr = textContent.substring(startIdx, endIdx + 1);
                JsonNode arrayNode = mapper.readTree(jsonArrayStr);

                if (arrayNode.isArray()) {
                    int counter = 1;
                    for (JsonNode node : arrayNode) {
                        String srNo = node.has("srNo") ? node.get("srNo").asText() : String.valueOf(counter);
                        String spec = node.has("specification") ? node.get("specification").asText() : (node.has("item") ? node.get("item").asText() : "");
                        String comp = node.has("compliance") ? node.get("compliance").asText() : "Comply";
                        String dev = node.has("deviation") ? node.get("deviation").asText() : "No Deviation";
                        String rem = node.has("remarks") ? node.get("remarks").asText() : "-";
                        String cat = node.has("productCategory") ? node.get("productCategory").asText() : (node.has("component") ? node.get("component").asText() : (node.has("category") ? node.get("category").asText() : ""));

                        if (node.has("model") && !node.get("model").asText().isEmpty() && data != null && (!data.containsKey("offeredModel") || "-".equals(data.get("offeredModel")))) {
                            data.put("offeredModel", node.get("model").asText());
                        }

                        if (spec != null && !spec.trim().isEmpty()) {
                            clauses.add(new String[]{cleanClauseNumber(srNo), escapeHtml(spec.trim()), comp, dev, rem, cat});
                            counter++;
                        }
                    }
                }
            }
            System.out.println("[AISpecificationIntelligence] parseLlmJsonResponse successfully extracted " + clauses.size() + " clauses.");
        } catch (Exception e) {
            System.err.println("[AISpecificationIntelligence] Failed to parse LLM JSON response: " + e.getMessage());
            e.printStackTrace();
        }
        return clauses;
    }

    /**
     * Pulls the model's raw answer out of the provider envelope. Returns the original body when
     * it is already the bare answer, so a plain JSON array keeps working.
     */
    private String extractModelText(String jsonResponse) {
        try {
            com.fasterxml.jackson.databind.JsonNode root = JSON.readTree(jsonResponse);

            com.fasterxml.jackson.databind.JsonNode geminiText =
                    root.path("candidates").path(0).path("content").path("parts").path(0).path("text");
            if (geminiText.isTextual()) {
                return geminiText.asText();
            }

            com.fasterxml.jackson.databind.JsonNode ollamaText = root.path("response");
            if (ollamaText.isTextual()) {
                return ollamaText.asText();
            }

            if (root.isArray()) {
                return jsonResponse;
            }
        } catch (Exception e) {
            System.err.println("[AISpecificationIntelligence] Envelope parse failed: " + e.getMessage());
        }
        return jsonResponse;
    }

    /**
     * Reads the clause array out of the model's answer, tolerating the ```json fences and the
     * surrounding prose that LLMs commonly add around structured output.
     */
    private com.fasterxml.jackson.databind.JsonNode readClauseArray(String modelText) {
        String cleaned = modelText.replaceAll("(?s)```(?:json)?", "").trim();

        try {
            return JSON.readTree(cleaned);
        } catch (Exception ignored) {
            // Not bare JSON — fall through and pull the array out of the surrounding prose.
        }

        int start = cleaned.indexOf('[');
        int end = cleaned.lastIndexOf(']');
        if (start >= 0 && end > start) {
            try {
                return JSON.readTree(cleaned.substring(start, end + 1));
            } catch (Exception e) {
                System.err.println("[AISpecificationIntelligence] Clause array parse failed: " + e.getMessage());
            }
        }
        return null;
    }

    private String text(com.fasterxml.jackson.databind.JsonNode node, String field) {
        com.fasterxml.jackson.databind.JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? "" : value.asText().trim();
    }

    private List<String[]> processLocalHeuristicExtraction(String rawOcrText, Map<String, String> data) {
        List<String[]> clauses = new ArrayList<>();
        String cleanText = normalizeOcrText(rawOcrText);

        // 1. Extract valid technical item lines from OCR text
        List<String> items = extractLinesFromOcr(cleanText);

        if (!items.isEmpty()) {
            int sr = 1;
            for (String item : items) {
                clauses.add(new String[]{
                    "1." + (sr++),
                    escapeHtml(item),
                    "",
                    "",
                    "-"
                });
            }
            return clauses;
        }

        // 2. Extract specific entity matches (Part No, Model, Power, Job Title) from OCR text
        Map<String, String> entities = extractEntities(cleanText, data);
        if (!entities.isEmpty() && (entities.containsKey("partNo") || entities.containsKey("model") || entities.containsKey("power") || entities.containsKey("jobTitle"))) {
            String jobTitle = entities.containsKey("jobTitle") ? entities.get("jobTitle") : "Technical Specification";
            String partNo = entities.get("partNo");
            String model = entities.get("model");
            String power = entities.get("power");

            if (model != null && !model.isEmpty() && data != null) {
                data.put("offeredModel", model);
            }

            StringBuilder specDetail = new StringBuilder();
            specDetail.append(jobTitle);
            if (partNo != null && !partNo.isEmpty()) specDetail.append(" | Part No: ").append(partNo);
            if (model != null && !model.isEmpty()) specDetail.append(" | Model: ").append(model);
            if (power != null && !power.isEmpty()) specDetail.append(" | Power: ").append(power);

            clauses.add(new String[]{
                "1.1",
                escapeHtml(specDetail.toString()),
                "",
                "",
                "-"
            });
            return clauses;
        }

        // 3. Document is unreadable or contains no valid technical clauses
        System.out.println("[AISpecificationIntelligence] Document text is unreadable or contains no valid technical clauses.");
        return Collections.emptyList();
    }

    private List<String> extractLinesFromOcr(String text) {
        List<String> items = new ArrayList<>();
        if (text == null || text.trim().isEmpty()) return items;

        String[] lines = text.split("\n");
        for (String line : lines) {
            String trimmed = line.trim();
            if (isValidTechnicalLine(trimmed)) {
                items.add(trimmed);
            }
            if (items.size() >= 10) break;
        }
        return items;
    }

    private boolean isValidTechnicalLine(String line) {
        if (line == null || line.length() < 6) return false;
        String lower = line.toLowerCase();

        if (lower.contains("technical specification") || lower.contains("schedule no") ||
            lower.contains("declaration") || lower.contains("make:") || lower.contains("page ") ||
            lower.contains("dated") || lower.contains("case no") || lower.contains("estimating resolution")) {
            return false;
        }

        // Reject any line that contains garbled OCR pseudo-words
        String[] words = lower.split("[^a-z0-9]+");
        for (String w : words) {
            if (w.length() >= 3 && isGarbledOcrWord(w)) {
                return false; // Immediately reject line with OCR noise/garbled words
            }
        }

        // Strictly check that line contains at least one recognized technical or equipment keyword
        boolean containsTechKeyword = lower.contains("repair") || lower.contains("firewall") || lower.contains("machine") ||
                                       lower.contains("vials") || lower.contains("kit") || lower.contains("pipette") ||
                                       lower.contains("strips") || lower.contains("tube") || lower.contains("chair") ||
                                       lower.contains("analyzer") || lower.contains("clean") || lower.contains("equipment") ||
                                       lower.contains("monitor") || lower.contains("power") || lower.contains("voltage") ||
                                       lower.contains("part") || lower.contains("model") || lower.contains("spec") ||
                                       lower.contains("device") || lower.contains("unit") || lower.contains("table") ||
                                       lower.contains("bed") || lower.contains("pump") || lower.contains("filter") ||
                                       lower.contains("valve") || lower.contains("cable") || lower.contains("sensor") ||
                                       lower.contains("probe") || lower.contains("tile") || lower.contains("lyse") ||
                                       lower.contains("dil") || lower.contains("edta") || lower.contains("sodium") ||
                                       lower.contains("crp") || lower.contains("esr") || lower.contains("hb") ||
                                       lower.contains("bilirubin") || lower.contains("erba") || lower.contains("elite");

        if (!containsTechKeyword) {
            return false;
        }

        int letters = 0;
        for (char c : line.toCharArray()) {
            if (Character.isLetter(c)) letters++;
        }
        double ratio = (double) letters / line.length();
        return ratio >= 0.70;
    }

    private boolean isGarbledOcrWord(String w) {
        if (w == null) return false;
        String l = w.toLowerCase();
        if (l.equals("heit") || l.equals("pispactle") || l.equals("eirdepere") || l.equals("prokyy") ||
            l.equals("helydl") || l.equals("pete") || l.equals("ps60") || l.equals("esha") ||
            l.equals("cote") || l.equals("ager") || l.equals("elsie") || l.equals("hele") ||
            l.equals("guaslble") || l.equals("aner") || l.equals("e8h") || l.equals("glen") ||
            l.equals("oss") || l.equals("alo") || l.equals("caen") || l.equals("yad") ||
            l.equals("rab") || l.equals("babe") || l.equals("lye") || l.equals("saver") ||
            l.equals("hs") || l.equals("sem") || l.equals("ene") || l.equals("rad") || l.equals("ee") ||
            l.equals("deg") || l.equals("see")) {
            return true;
        }
        return false;
    }

    private String normalizeOcrText(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("[\\r\\t]", "\n")
                  .replaceAll("\n{3,}", "\n\n")
                  .trim();
    }

    private Map<String, String> extractEntities(String text, Map<String, String> data) {
        Map<String, String> entities = new HashMap<>();

        Matcher mPart = Pattern.compile("(?:Part|P/N|Ref)\\s*No[-–—:]?\\s*([A-Za-z0-9\\.\\-]+)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mPart.find()) {
            entities.put("partNo", mPart.group(1).trim());
        }

        Matcher mModel = Pattern.compile("Model\\s*[-–—:]?\\s*([A-Za-z0-9\\s]{2,20}?)(?=\\s+(?:Power|Qty|Ser|Part|\\n)|$)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mModel.find()) {
            String model = mModel.group(1).trim();
            if (!model.equalsIgnoreCase("No") && model.length() >= 2) {
                entities.put("model", model);
            }
        }

        Matcher mPower = Pattern.compile("(?:Power|Voltage)\\s*[-–—:]?\\s*([A-Za-z0-9\\.\\-\\sHz\\/]+?)(?=\\n|Note|Ser|$)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mPower.find()) {
            entities.put("power", mPower.group(1).trim());
        }

        Matcher mQty = Pattern.compile("(?:Qty|Quantity)\\s*[-–—:]?\\s*(\\d+\\s*(?:Job|Nos|Set|Pcs|Unit)?)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mQty.find()) {
            entities.put("qty", mQty.group(1).trim());
        }

        Matcher mJob = Pattern.compile("(Repair\\s+of\\s+[^\\n\\r]+|Firewall\\s*\\([^\\)]+\\)|[A-Z0-9\\s]{4,40} Machine)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mJob.find()) {
            entities.put("jobTitle", cleanJobTitle(mJob.group(1)));
        }

        return entities;
    }

    private String cleanJobTitle(String rawTitle) {
        if (rawTitle == null) return "";

        String clean = rawTitle.replaceAll("(?i)\\b\\d{2,}\\s+are\\s+[a-z]{3,10}\\b", "")
                               .replaceAll("(?i)\\bModel\\s*[-–—:]?\\s*[A-Za-z0-9\\s]{2,15}", "")
                               .replaceAll("(?i)\\bPart\\s*No[-–—:]?\\s*[A-Za-z0-9\\.\\-]+\\b", "")
                               .replaceAll("(?i)\\bPower\\s*[-–—:]?\\s*[A-Za-z0-9\\.\\-\\sHz\\/]+\\b", "")
                               .replaceAll("(?i)\\bJob\\s*\\d*\\b", "")
                               .replaceAll("(?i)\\bEqpt\\b", "")
                               .replaceAll("(?i)\\bTech\\s*Specification\\b", "")
                               .replaceAll("[|\\\\/]+", " ")
                               .replaceAll("\\s+", " ")
                               .trim();

        if (!clean.isEmpty() && !clean.toLowerCase().startsWith("repair of") && clean.toLowerCase().contains("firewall")) {
            clean = "Repair of " + clean;
        }
        return clean;
    }

    private String escapeJson(String input) {
        if (input == null) return "";
        return input.replace("\\", "\\\\")
                    .replace("\"", "\\\"")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r");
    }

    private String escapeHtml(String input) {
        if (input == null) return "";
        String s = input.replace("&amp;", "&")
                        .replace("&lt;", "<")
                        .replace("&gt;", ">")
                        .replace("&quot;", "\"")
                        .replace("&apos;", "'");
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }
}
