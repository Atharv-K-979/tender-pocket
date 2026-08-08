package com.tenderpocket.services;

import org.springframework.stereotype.Service;
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
        List<String[]> llmClauses = callGenerativeLlmAi(rawOcrText, fileBytes, data);
        if (llmClauses != null && !llmClauses.isEmpty()) {
            System.out.println("[AISpecificationIntelligence] Successfully generated technical clauses using Generative AI Vision LLM Model.");
            return llmClauses;
        }

        // 2. Dynamic Heuristic Extraction Engine
        System.out.println("[AISpecificationIntelligence] LLM API unconfigured/offline. Using Dynamic Heuristic Extraction Engine.");
        return processLocalHeuristicExtraction(rawOcrText, data);
    }

    private List<String[]> callGenerativeLlmAi(String rawOcrText, byte[] fileBytes, Map<String, String> data) {
        String apiKey = (geminiApiKey != null && !geminiApiKey.trim().isEmpty()) ? geminiApiKey : System.getenv("GEMINI_API_KEY");
        if (apiKey == null || apiKey.trim().isEmpty()) {
            apiKey = System.getenv("OPENAI_API_KEY");
        }
        String ollamaHost = System.getenv("OLLAMA_HOST");

        if ((apiKey == null || apiKey.isEmpty()) && (ollamaHost == null || ollamaHost.isEmpty())) {
            return null;
        }

        try {
            String systemPrompt = "You are an expert Tender Technical Specification analyst. From the supplied tender document, extract the technical specification clauses for the goods being procured.\n"
                    + "Rules:\n"
                    + "- Reuse the document's own clause numbering (for example 3.4, 5.1) as srNo. Number sequentially only when the source has none.\n"
                    + "- Keep every clause as its own separate item. Never merge two clauses into one entry, and never put a section heading in srNo.\n"
                    + "- A tender often specifies several pieces of equipment. Set component to the equipment that clause belongs to, taken from its annexure or section heading, for example 'Ice-lined Refrigerator (ILR)', 'Cold Room' or 'Voltage Stabilizer'. Use the same wording for every clause of the same equipment.\n"
                    + "- Return technical specification clauses only: measurable parameters, construction, performance, electrical ratings, standards and testing. Exclude commercial and contractual matter such as bid forms, declarations, letterheads, instructions to bidders, signature blocks, payment and delivery terms, and blank compliance tables.\n"
                    + "- Ignore repeated page headers and footers, table column headings, and OCR noise.\n"
                    + "- Set compliance to 'Comply' and deviation to 'No Deviation' unless the document states otherwise. Put an offered or measured value in remarks when the document gives one, otherwise '-'.\n"
                    + "- If the document holds no technical specifications, return [].\n"
                    + "Return ONLY a JSON array of objects with keys: srNo, specification, compliance, deviation, remarks, component.";
            
            String jsonPayload = "";
            String endpointUrl = "";

            if (apiKey != null && !apiKey.isEmpty()) {
                endpointUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + apiKey;
                
                if (fileBytes != null && fileBytes.length > 0) {
                    String base64Data = Base64.getEncoder().encodeToString(fileBytes);
                    String mimeType = detectMimeType(fileBytes);
                    jsonPayload = "{\"contents\":[{\"parts\":[{\"text\":\"" + escapeJson(systemPrompt) + "\"},{\"inlineData\":{\"mimeType\":\"" + mimeType + "\",\"data\":\"" + base64Data + "\"}}]}]}";
                } else {
                    jsonPayload = "{\"contents\":[{\"parts\":[{\"text\":\"" + escapeJson(systemPrompt + "\n\nRAW OCR TEXT:\n" + rawOcrText) + "\"}]}]}";
                }
            } else if (ollamaHost != null && !ollamaHost.isEmpty()) {
                endpointUrl = ollamaHost + "/api/generate";
                jsonPayload = "{\"model\":\"llama3\",\"prompt\":\"" + escapeJson(systemPrompt + "\n\nRAW OCR TEXT:\n" + rawOcrText) + "\",\"stream\":false}";
            }

            URL url = new URL(endpointUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(15000);

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
                    return parseLlmJsonResponse(response.toString(), data);
                }
            } else {
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8))) {
                    StringBuilder errorRes = new StringBuilder();
                    String errLine;
                    while ((errLine = br.readLine()) != null) {
                        errorRes.append(errLine.trim());
                    }
                    System.err.println("[AISpecificationIntelligence] Gemini API HTTP " + responseCode + " Error Response: " + errorRes.toString());
                }
            }
        } catch (Exception e) {
            System.err.println("[AISpecificationIntelligence] LLM API Call Exception: " + e.getMessage());
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
            // The provider wraps the model's answer in an envelope. Gemini nests it under
            // candidates[].content.parts[].text and Ollama under "response"; in both cases the
            // clause JSON arrives as an escaped string, so it has to be unwrapped before parsing.
            String modelText = extractModelText(jsonResponse);
            if (modelText == null || modelText.trim().isEmpty()) {
                return clauses;
            }

            com.fasterxml.jackson.databind.JsonNode array = readClauseArray(modelText);
            if (array == null || !array.isArray()) {
                return clauses;
            }

            for (com.fasterxml.jackson.databind.JsonNode node : array) {
                String spec = text(node, "specification");
                if (spec.isEmpty()) {
                    continue;
                }

                String srNo = text(node, "srNo");
                String comp = text(node, "compliance");
                String dev = text(node, "deviation");
                String rem = text(node, "remarks");

                // A sixth column carries the equipment this clause describes, so the generator can put
                // each piece of equipment on its own page instead of running them together in one table.
                clauses.add(new String[]{
                    srNo.isEmpty() ? String.valueOf(clauses.size() + 1) : srNo,
                    escapeHtml(spec),
                    comp.isEmpty() ? "Comply" : comp,
                    dev.isEmpty() ? "No Deviation" : dev,
                    rem.isEmpty() ? "-" : rem,
                    escapeHtml(text(node, "component"))
                });

                // Carry the model designation the AI read off the document into the output header.
                String model = text(node, "model");
                if (!model.isEmpty() && data != null) {
                    data.put("offeredModel", model);
                }
            }
        } catch (Exception e) {
            System.err.println("[AISpecificationIntelligence] Failed to parse LLM JSON response: " + e.getMessage());
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
                    "Comply",
                    "No Deviation",
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
                "Comply",
                "No Deviation",
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
