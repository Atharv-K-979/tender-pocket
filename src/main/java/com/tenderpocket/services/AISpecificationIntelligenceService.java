package com.tenderpocket.services;

import org.springframework.stereotype.Service;
import java.util.*;
import java.util.regex.*;

@Service
public class AISpecificationIntelligenceService {

    /**
     * AI Intelligence Engine for processing raw OCR/Text from Tender Documents 
     * and synthesizing structured 5-column technical compliance clauses.
     */
    public List<String[]> processOcrAndSynthesizeClauses(String rawOcrText, Map<String, String> data) {
        List<String[]> clauses = new ArrayList<>();
        if (rawOcrText == null) rawOcrText = "";

        // 1. Normalize OCR text (clean linebreaks, remove header noise)
        String cleanText = normalizeOcrText(rawOcrText);

        // 2. Perform Named Entity Recognition & Parameter Extraction
        Map<String, String> entities = extractEntities(cleanText, data);

        // Update offeredModel in data map if extracted by AI Engine
        if (entities.containsKey("model") && data != null) {
            data.put("offeredModel", entities.get("model"));
        }

        // 3. Extract Structured Conditions & Specific Technical Parameters
        List<String> noteConditions = extractNoteConditions(cleanText);
        List<String> keyParams = extractKeyParameters(cleanText);

        // 4. Synthesize Technical Specifications
        String jobTitle = entities.getOrDefault("jobTitle", 
                (data != null && data.get("productDescription") != null) ? data.get("productDescription") : "Item Specification & Technical Parameters");
        String qtyRemark = entities.containsKey("qty") ? "Qty: " + entities.get("qty") : "-";

        // Single Tech Specification Entry Consolidation
        if (entities.containsKey("partNo") || entities.containsKey("model") || cleanText.contains("Repair of") || cleanText.contains("Tech Specification")) {
            StringBuilder specDetail = new StringBuilder();
            specDetail.append(jobTitle);
            if (entities.containsKey("partNo")) {
                specDetail.append(" | Part No: ").append(entities.get("partNo"));
            }
            if (entities.containsKey("model")) {
                specDetail.append(" | Model: ").append(entities.get("model"));
            }
            if (entities.containsKey("power")) {
                specDetail.append(" | Power: ").append(entities.get("power"));
            }

            clauses.add(new String[]{
                "1.1",
                escapeHtml(specDetail.toString()),
                "Comply",
                "No Deviation",
                qtyRemark
            });

            // Add Note Brief items matching input document
            int noteSr = 1;
            if (!noteConditions.isEmpty()) {
                for (String condition : noteConditions) {
                    clauses.add(new String[]{"2." + (noteSr++), escapeHtml(condition), "Comply", "No Deviation", "-"});
                }
            } else {
                clauses.add(new String[]{"2.1", "Delivered/repaired stores should be as per OEM pattern.", "Comply", "No Deviation", "-"});
                clauses.add(new String[]{"2.2", "Damage / Unserviceable items will not be accepted.", "Comply", "No Deviation", "-"});
                clauses.add(new String[]{"2.3", "Tampered MRP and Expiry date product will not be accepted.", "Comply", "No Deviation", "-"});
            }

            return clauses;
        }

        // Multi-entry synthesis if multiple distinct specifications found
        clauses.add(new String[]{"1.1", "Job / Item Specification: " + escapeHtml(jobTitle), "Comply", "No Deviation", qtyRemark});

        if (entities.containsKey("partNo")) {
            clauses.add(new String[]{"1.2", "Equipment & Part Number Specification: " + escapeHtml(entities.getOrDefault("eqpt", "Equipment")) + " - Part No: " + escapeHtml(entities.get("partNo")), "Comply", "No Deviation", "-"});
        }

        if (entities.containsKey("model")) {
            clauses.add(new String[]{"1.3", "Offered Model & Hardware Configuration: " + escapeHtml(entities.get("model")), "Comply", "No Deviation", "-"});
        }

        if (entities.containsKey("power")) {
            clauses.add(new String[]{"1.4", "Power Supply & Electrical Rating: " + escapeHtml(entities.get("power")), "Comply", "No Deviation", "-"});
        }

        // Add specific key technical parameters extracted from OCR
        int paramSr = 5;
        for (String param : keyParams) {
            clauses.add(new String[]{"1." + (paramSr++), escapeHtml(param), "Comply", "No Deviation", "-"});
        }

        // Synthesize Section 2.0: Delivery, Inspection & OEM Compliance Terms
        int noteSr = 1;
        if (!noteConditions.isEmpty()) {
            for (String condition : noteConditions) {
                clauses.add(new String[]{"2." + (noteSr++), escapeHtml(condition), "Comply", "No Deviation", "-"});
            }
        } else {
            clauses.add(new String[]{"2.1", "Delivered/repaired stores should be as per OEM pattern and quality standards.", "Comply", "No Deviation", "-"});
            clauses.add(new String[]{"2.2", "Damage / Unserviceable items will not be accepted upon inspection.", "Comply", "No Deviation", "-"});
            clauses.add(new String[]{"2.3", "Tampered MRP and Expiry date product will not be accepted.", "Comply", "No Deviation", "-"});
        }

        // Synthesize Section 3.0: Standards & Quality Assurance
        clauses.add(new String[]{"3.1", "Standards & Quality Certification: Equipment offering conforms to ISO / BIS / CE quality standards.", "Comply", "No Deviation", "-"});

        // If clauses are sparse, enrich with Category-Aware AI Intelligence
        if (clauses.size() < 4) {
            enrichWithCategoryIntelligence(clauses, jobTitle, data);
        }

        return clauses;
    }

    private String normalizeOcrText(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("[\\r\\t]", "\n")
                  .replaceAll("\n{3,}", "\n\n")
                  .trim();
    }

    private Map<String, String> extractEntities(String text, Map<String, String> data) {
        Map<String, String> entities = new HashMap<>();

        // Part Number Extraction
        Matcher mPart = Pattern.compile("(?:Part|P/N|Ref)\\s*No[-:]?\\s*([A-Za-z0-9\\.\\-]+)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mPart.find()) {
            entities.put("partNo", mPart.group(1).trim());
        }

        // Model Extraction
        Matcher mModel = Pattern.compile("Model\\s*[-–:]?\\s*([A-Za-z0-9\\s]{2,20}?)(?=\\s+(?:Power|Qty|Ser|Part|\\n)|$)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mModel.find()) {
            String model = mModel.group(1).trim();
            if (!model.equalsIgnoreCase("No") && model.length() >= 2) {
                entities.put("model", model);
            }
        }

        // Power Supply Extraction
        Matcher mPower = Pattern.compile("(?:Power|Voltage)\\s*[-–:]?\\s*([A-Za-z0-9\\.\\-\\sHz\\/]+?)(?=\\n|Note|Ser|$)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mPower.find()) {
            entities.put("power", mPower.group(1).trim());
        }

        // Quantity Extraction
        Matcher mQty = Pattern.compile("(?:Qty|Quantity)\\s*[-–:]?\\s*(\\d+\\s*(?:Job|Nos|Set|Pcs|Unit)?)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mQty.find()) {
            entities.put("qty", mQty.group(1).trim());
        }

        // Job / Equipment Name Extraction
        Matcher mJob = Pattern.compile("(Repair\\s+of\\s+[^\\n\\r]+|Firewall\\s*\\([^\\)]+\\)|[A-Z0-9\\s]{4,40} Machine)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (mJob.find()) {
            entities.put("jobTitle", mJob.group(1).trim());
        }

        return entities;
    }

    private List<String> extractNoteConditions(String text) {
        List<String> conditions = new ArrayList<>();

        // Match numbered brief notes e.g., "1. Delivered/repaired stores..."
        Matcher mNotes = Pattern.compile("(?:Note\\s*Brief|Notes)?[-:]?\\s*(\\d+)\\.\\s*([^\\d\\n\\r]+?)(?=\\d+\\.|\\n[A-Z]|\\n\\d|$)", Pattern.CASE_INSENSITIVE).matcher(text);
        while (mNotes.find()) {
            String cond = mNotes.group(2).trim();
            if (cond.length() > 5 && !cond.toLowerCase().contains("technical specification") && !cond.toLowerCase().contains("wksp")) {
                conditions.add(cond);
            }
        }

        return conditions;
    }

    private List<String> extractKeyParameters(String text) {
        List<String> params = new ArrayList<>();
        
        // Find specific numeric specs e.g., "+2°C to +8°C", "20 hrs holdover", "80-130 liters"
        Matcher mSpecs = Pattern.compile("(?:maintain[s]?\\s+temperatures[^\\n]+|holdover\\s+time[^\\n]+|storage\\s+capacity[^\\n]+|microprocessor[^\\n]+)", Pattern.CASE_INSENSITIVE).matcher(text);
        while (mSpecs.find() && params.size() < 4) {
            String spec = mSpecs.group(0).trim();
            if (spec.length() > 10) {
                params.add(spec);
            }
        }

        return params;
    }

    private void enrichWithCategoryIntelligence(List<String[]> clauses, String jobTitle, Map<String, String> data) {
        String titleLower = jobTitle.toLowerCase();
        
        if (titleLower.contains("firewall") || titleLower.contains("anex") || titleLower.contains("usg")) {
            clauses.add(new String[]{"1.2", "Network & Security Specification: Enterprise Next-Gen Firewall with Unified Threat Management (UTM).", "Comply", "No Deviation", "-"});
            clauses.add(new String[]{"1.3", "Throughput & Capacity: High-speed gigabit packet inspection with zero-downtime failover.", "Comply", "No Deviation", "-"});
        } else if (titleLower.contains("refrigerator") || titleLower.contains("cold") || titleLower.contains("freezer")) {
            clauses.add(new String[]{"1.2", "Temperature Range: Maintained at +2°C to +8°C with minimum 8 hrs holdover time.", "Comply", "No Deviation", "-"});
            clauses.add(new String[]{"1.3", "Construction: Corrosion resistant grade 304 stainless steel interior.", "Comply", "No Deviation", "-"});
        } else if (titleLower.contains("bed") || titleLower.contains("couch") || titleLower.contains("trolley")) {
            clauses.add(new String[]{"1.2", "Mechanical Structure: Ergonomic heavy-duty tubular steel frame with epoxy powder coating.", "Comply", "No Deviation", "-"});
        } else {
            clauses.add(new String[]{"1.2", "Technical Performance: High-precision operational performance meeting tender requirements.", "Comply", "No Deviation", "-"});
        }
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
