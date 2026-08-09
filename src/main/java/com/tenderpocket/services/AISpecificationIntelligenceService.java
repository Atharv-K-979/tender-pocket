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

        // Name the equipment once, before any chunk is read, so every chunk labels its clauses the same way.
        List<String> components = discoverComponents(rawOcrText);
        System.out.println("[AISpecificationIntelligence] Document split into " + chunks.size()
                + " chunk(s); " + components.size() + " item(s) of equipment identified"
                + (components.isEmpty() ? " (chunks will name their own)." : ": " + String.join(", ", components)));

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
     * Breaks at an equipment heading where one is available, so a chunk covers whole items and the model
     * can still see which equipment the clauses belong to. Oversized sections fall back to a line boundary.
     */
    private List<String> splitIntoChunks(String text) {
        List<String> chunks = new ArrayList<>();
        StringBuilder current = new StringBuilder();

        for (String line : text.split("\n")) {
            boolean startsSection = SECTION_HEADING.matcher(line).matches();
            boolean wouldOverflow = current.length() + line.length() + 1 > maxCharsPerChunk;

            // A heading only earns a break once the chunk holds enough to be worth sending on its own,
            // otherwise consecutive headings produce a chunk each.
            if (current.length() > 0 && (wouldOverflow || (startsSection && current.length() > maxCharsPerChunk / 4))) {
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
            {"gemini-3.6-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash", "gemini-2.0-flash-lite"};

    /**
     * Asks once for the equipment the document specifies, so every chunk can be told to label its clauses
     * with the same names. Each chunk is read on its own, so left to itself it names the same item
     * differently -- "Deep Freezer - DF (Large)" in one and "DF Large" in the next -- and grouping then
     * files one piece of equipment under two schedules. Returns empty when unavailable, which leaves the
     * chunks naming the equipment themselves and the fuzzy matcher to reconcile what it can.
     */
    private List<String> discoverComponents(String text) {
        String apiKey = getEffectiveApiKey();
        if (apiKey == null || apiKey.trim().isEmpty() || text == null || text.trim().isEmpty()) {
            return Collections.emptyList();
        }

        String prompt = "List the distinct pieces of equipment for which this tender document gives technical specifications.\n"
                + "Use the name the document titles each item with, and keep size or rating variants separate, for example \"ILR Large\" and \"ILR Small\".\n"
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

    /** One POST to a named model. Returns the response body on success, or null so the caller tries the next. */
    private String postOnce(String modelName, String apiKey, String jsonPayload) {
        try {
            URL url = new URL("https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + apiKey);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("x-goog-api-key", apiKey);
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
        return null;
    }

    private List<String[]> callGenerativeLlmAi(String rawOcrText, byte[] fileBytes, Map<String, String> data) {
        return callGenerativeLlmAi(rawOcrText, fileBytes, data, Collections.emptyList());
    }

    private List<String[]> callGenerativeLlmAi(String rawOcrText, byte[] fileBytes, Map<String, String> data, List<String> components) {
        String apiKey = getEffectiveApiKey();
        if (apiKey == null || apiKey.trim().isEmpty()) {
            apiKey = System.getenv("OPENAI_API_KEY");
        }
        String ollamaHost = System.getenv("OLLAMA_HOST");

        System.out.println("[AISpecificationIntelligence] callGenerativeLlmAi starting... apiKey length: " + (apiKey != null ? apiKey.length() : 0) + ", fileBytes length: " + (fileBytes != null ? fileBytes.length : 0));

        if ((apiKey == null || apiKey.isEmpty()) && (ollamaHost == null || ollamaHost.isEmpty())) {
            System.out.println("[AISpecificationIntelligence] No API Key or Ollama Host configured.");
            return null;
        }

        String systemPrompt = "You are an expert Tender Technical Specification Intelligence AI. Given a tender document (PDF or image), extract EVERY SINGLE ITEM CLAUSE AND SUB-CLAUSE as individual detailed rows.\n"
                + "RULES:\n"
                + "1. Accommodate Part numbers, Model numbers, and Quantities directly inside the 'specification' column text (e.g. '[Description] (Lakeshore Model/Part No: X, Quantity: Y)'). Set 'remarks' column to '-'.\n"
                + "2. ALWAYS INCLUDE Warranty, Maintenance, AMC/CMC terms, and Essential Equipment Requirements listed in the tender specification table. DO NOT extract administrative Vendor Qualification Criteria or OEM Authorization letters.\n"
                + "3. Reuse the document's own clause numbering (for example 3.4, 5.1) as srNo. Number sequentially only when the source has none.\n"
                + (components == null || components.isEmpty()
                        ? "4. Set productCategory/component to the equipment that clause belongs to (e.g., 'ILR Large', 'ILR Small', 'DF Large', 'WIC 40 CuM', 'Voltage Stabilizer', etc.).\n"
                        : "4. Set productCategory/component to exactly one of these names, copied character for character: "
                                + String.join(" | ", components)
                                + ". Pick the one the clause describes. Do not invent, abbreviate or reword a name.\n")
                + "5. Return ONLY a JSON array of objects with keys: srNo, specification, compliance, deviation, remarks, productCategory.";

        // Model Fallback Order to bypass free tier rate limits (429) & model deprecations (404)
        String[] modelChain = new String[]{"gemini-3.6-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash", "gemini-2.0-flash-lite"};

        if (apiKey != null && !apiKey.isEmpty()) {
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

            for (String modelName : modelChain) {
                try {
                    String endpointUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + apiKey;
                    System.out.println("[AISpecificationIntelligence] Attempting Gemini Model: " + modelName);

                    URL url = new URL(endpointUrl);
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("x-goog-api-key", apiKey);
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(180000);

                    try (OutputStream os = conn.getOutputStream()) {
                        byte[] input = jsonPayload.getBytes(StandardCharsets.UTF_8);
                        os.write(input, 0, input.length);
                    }

                    int responseCode = conn.getResponseCode();
                    System.out.println("[AISpecificationIntelligence] Model " + modelName + " HTTP Response Code: " + responseCode);
                    if (responseCode == 200) {
                        try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                            StringBuilder response = new StringBuilder();
                            String responseLine;
                            while ((responseLine = br.readLine()) != null) {
                                response.append(responseLine.trim());
                            }
                            List<String[]> clauses = parseLlmJsonResponse(response.toString(), data);
                            if (clauses != null && !clauses.isEmpty()) {
                                return clauses;
                            }
                        }
                    } else {
                        try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8))) {
                            StringBuilder errorRes = new StringBuilder();
                            String errLine;
                            while ((errLine = br.readLine()) != null) {
                                errorRes.append(errLine.trim());
                            }
                            System.err.println("[AISpecificationIntelligence] Model " + modelName + " HTTP " + responseCode + " Error: " + errorRes.toString());
                        }
                    }
                } catch (Exception e) {
                    System.err.println("[AISpecificationIntelligence] Exception with model " + modelName + ": " + e.getMessage());
                }
            }
        } else if (ollamaHost != null && !ollamaHost.isEmpty()) {
            try {
                String endpointUrl = ollamaHost + "/api/generate";
                String jsonPayload = "{\"model\":\"llama3\",\"prompt\":\"" + escapeJson(systemPrompt + "\n\nRAW OCR TEXT:\n" + rawOcrText) + "\",\"stream\":false}";
                URL url = new URL(endpointUrl);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);

                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = jsonPayload.getBytes(StandardCharsets.UTF_8);
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
                            clauses.add(new String[]{srNo, escapeHtml(spec.trim()), comp, dev, rem, cat});
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
