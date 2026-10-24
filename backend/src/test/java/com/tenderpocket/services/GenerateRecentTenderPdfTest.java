package com.tenderpocket.services;

import java.io.*;
import java.lang.reflect.Field;
import java.nio.file.*;
import java.util.*;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.rendering.PDFRenderer;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Executes the full technical compliance sheet PDF generation pipeline
 * for the most recent eligible tenders using live Azure GPT (gpt-5-nano) extraction.
 * Validates the resulting A4 portrait PDF deliverable against all compliance and layout criteria.
 */
public class GenerateRecentTenderPdfTest {

    @Test
    void generateAndValidateFinalPdfForRecentTenders() throws Exception {
        System.out.println("================================================================================");
        System.out.println("🚀 [START] PDF Compliance Sheet Pipeline Execution with Azure gpt-5-nano");
        System.out.println("================================================================================");

        // 1. Load existing .env configuration without exposing secrets
        File envFile = new File("../.env");
        if (!envFile.exists()) envFile = new File(".env");
        assumeTrue(envFile.exists(), ".env configuration file must exist");

        Properties envProps = new Properties();
        try (BufferedReader reader = new BufferedReader(new FileReader(envFile))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (!line.isEmpty() && !line.startsWith("#") && line.contains("=")) {
                    int eq = line.indexOf('=');
                    String key = line.substring(0, eq).trim();
                    String val = line.substring(eq + 1).trim();
                    envProps.put(key, val);
                }
            }
        }

        String apiKey = envProps.getProperty("AZURE_OPENAI_API_KEY");
        String endpoint = envProps.getProperty("AZURE_OPENAI_ENDPOINT");
        assumeTrue(apiKey != null && !apiKey.isBlank(), "AZURE_OPENAI_API_KEY must be in .env");
        assumeTrue(endpoint != null && !endpoint.isBlank(), "AZURE_OPENAI_ENDPOINT must be in .env");

        // 2. Setup AISpecificationIntelligenceService with configured Azure credentials
        AISpecificationIntelligenceService aiService = new AISpecificationIntelligenceService();
        Field keyField = AISpecificationIntelligenceService.class.getDeclaredField("azureOpenAiApiKey");
        keyField.setAccessible(true);
        keyField.set(aiService, apiKey);

        Field endpointField = AISpecificationIntelligenceService.class.getDeclaredField("azureOpenAiEndpoint");
        endpointField.setAccessible(true);
        endpointField.set(aiService, endpoint);

        // 3. Setup DocumentGeneratorService with AISpecificationIntelligenceService
        DocumentGeneratorService docGen = new DocumentGeneratorService();
        Field aiField = DocumentGeneratorService.class.getDeclaredField("aiSpecificationIntelligenceService");
        aiField.setAccessible(true);
        aiField.set(docGen, aiService);

        // Common company metadata
        Map<String, String> commonData = new HashMap<>();
        commonData.put("companyName", "Mark Enterprises");
        commonData.put("companyAddress", "Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India");
        commonData.put("companyEmail", "info@markenworld.com");
        commonData.put("companyWebsite", "www.markenworld.com");
        commonData.put("companyContact", "09175559646 / 090111 04332");
        commonData.put("signatoryName", "Shreedhar Shingare");
        commonData.put("signatoryDesignation", "Authorized Signatory (Tender manager)");
        commonData.put("signatoryAddress", "Nashik Maharashtra.");
        commonData.put("offeredMake", "MarkEn");
        commonData.put("offeredModel", "-");
        commonData.put("date", "21/10/2026");

        // Two most recent eligible tenders
        List<String> tenderIds = List.of("10063555", "9994867");

        Map<String, Map<String, String>> tenderMeta = new HashMap<>();

        Map<String, String> meta1 = new HashMap<>(commonData);
        meta1.put("bidNumber", "GEM/2026/B/8185335");
        meta1.put("productDescription", "Desk and Bench Set for Classroom/Training Area,Steel Almirah / Cabinets (V4)");
        meta1.put("productName", "Desk and Bench Set for Classroom/Training Area,Steel Almirah / Cabinets (V4)");
        meta1.put("qty", "103");
        meta1.put("recipientName", "Science & Technology Department Bihar");
        meta1.put("recipientAddress", "Walipur, Bihar");
        meta1.put("subject", "Technical Compliance Data Sheet - Desk and Bench Set for Classroom/Training Area,Steel Almirah / Cabinets (V4)");
        tenderMeta.put("10063555", meta1);

        Map<String, String> meta2 = new HashMap<>(commonData);
        meta2.put("bidNumber", "GEM/2026/B/8125416");
        meta2.put("productDescription", "Household Refrigerators marked to IS 17550 (V2)");
        meta2.put("productName", "Household Refrigerators marked to IS 17550 (V2)");
        meta2.put("qty", "02");
        meta2.put("recipientName", "Central Armed Police Forces");
        meta2.put("recipientAddress", "N/A, N/A");
        meta2.put("subject", "Technical Compliance Data Sheet - Household Refrigerators marked to IS 17550 (V2)");
        tenderMeta.put("9994867", meta2);

        Path reviewDir = Path.of("target", "review");
        Files.createDirectories(reviewDir);

        for (String tid : tenderIds) {
            System.out.println("\n--------------------------------------------------------------------------------");
            System.out.println("⚡ [PROCESSING] Tender ID: " + tid);
            System.out.println("--------------------------------------------------------------------------------");

            File pdfFile = new File("public/documents/" + tid + "/Bid_Document_" + tid + ".pdf");
            if (!pdfFile.exists()) {
                pdfFile = new File("backend/public/documents/" + tid + "/Bid_Document_" + tid + ".pdf");
            }
            assumeTrue(pdfFile.exists(), "Source PDF must exist: " + pdfFile.getAbsolutePath());
            byte[] pdfBytes = Files.readAllBytes(pdfFile.toPath());
            System.out.println("[INFO] Source PDF loaded: " + pdfFile.getAbsolutePath() + " (" + pdfBytes.length + " bytes)");

            Map<String, String> data = tenderMeta.get(tid);
            ComplianceConversionMetrics metrics = new ComplianceConversionMetrics("0.05", "0.005", "0.40", "83.5", "2026-10-21");

            // 1. Run live Azure AI extraction with gpt-5-nano
            List<String[]> extractedClauses = docGen.parseSpecificationClauses(
                    pdfBytes, pdfFile.getName(), data,
                    (stage, message, percent, completed, total, clauses) -> {
                        System.out.println("[PROGRESS] [" + stage + "] " + message + " (" + percent + "%)");
                    },
                    metrics
            );

            assertNotNull(extractedClauses, "Extracted clauses must not be null for tender " + tid);
            assertFalse(extractedClauses.isEmpty(), "Extracted clauses must not be empty for tender " + tid);
            System.out.println("[SUCCESS] Extracted " + extractedClauses.size() + " validated compliance rows for tender " + tid);

            // Verify Azure model usage
            Map<String, Object> snapshot = metrics.snapshot();
            System.out.println("[METRICS] Azure API Calls: " + snapshot.get("apiAttempts")
                    + ", Prompt Tokens: " + snapshot.get("promptTokens")
                    + ", Completion Tokens: " + snapshot.get("completionTokens")
                    + ", Cost: $" + snapshot.get("costUsd"));

            // 2. Build product sheets
            List<SpecificationSheetContent.Product> sheets = SpecificationSheetContent.fromSourceRequirements(extractedClauses)
                    .stream().filter(p -> p.clauseCount() > 0).toList();
            assertFalse(sheets.isEmpty(), "Products list must not be empty for tender " + tid);
            System.out.println("[SUCCESS] Grouped into " + sheets.size() + " product sheet(s): "
                    + sheets.stream().map(SpecificationSheetContent.Product::name).toList());

            // Verify evidence-based compliance: Row offeredSpecification must be empty because no manufacturer datasheet was supplied
            int rowCount = 0;
            for (var sheet : sheets) {
                for (var r : sheet.rows()) {
                    if (!r.heading()) {
                        rowCount++;
                        assertEquals("", r.offeredSpecification(),
                                "Offered specification must be blank without manufacturer datasheet evidence (Clause " + r.reference() + ")");
                        assertEquals("", r.compliance(),
                                "Compliance must be blank without manufacturer datasheet evidence (Clause " + r.reference() + ")");
                        assertEquals("", r.deviations(),
                                "Deviations must be blank without manufacturer datasheet evidence (Clause " + r.reference() + ")");
                    }
                }
            }
            assertTrue(rowCount > 0, "Must have checked at least one data row");
            System.out.println("[VERIFIED] All " + rowCount + " rows correctly have blank Column 4 (no fabricated specifications).");

            // 3. Generate combined PDF using the application renderer
            byte[] pdfResultBytes = docGen.generateCombinedSheetPdf(data, sheets);
            assertNotNull(pdfResultBytes, "Generated PDF bytes must not be null");
            assertTrue(pdfResultBytes.length > 0, "Generated PDF bytes must not be empty");

            // Save PDF to public/documents/{id}/Combined_Technical_Data_Sheet.pdf
            File outDir = new File("public/documents/" + tid);
            if (!outDir.exists()) outDir.mkdirs();
            File destPdfFile = new File(outDir, "Combined_Technical_Data_Sheet.pdf");
            Files.write(destPdfFile.toPath(), pdfResultBytes);
            System.out.println("[SAVED] Output PDF written to: " + destPdfFile.getAbsolutePath() + " (" + pdfResultBytes.length + " bytes)");

            // Also ensure backend/public/documents/{id}/ has the file if running from root
            File backendOutDir = new File("backend/public/documents/" + tid);
            if (backendOutDir.exists() && !backendOutDir.equals(outDir)) {
                Files.write(new File(backendOutDir, "Combined_Technical_Data_Sheet.pdf").toPath(), pdfResultBytes);
            }

            // 4. Comprehensive validation of the generated PDF
            try (PDDocument doc = PDDocument.load(pdfResultBytes)) {
                int pageCount = doc.getNumberOfPages();
                System.out.println("[VALIDATION] Total pages: " + pageCount);
                assertTrue(pageCount >= 1, "PDF must have at least 1 page");

                // Check page geometry (A4 portrait = 595.28 × 841.89 points)
                for (int p = 0; p < pageCount; p++) {
                    PDPage page = doc.getPage(p);
                    float w = page.getMediaBox().getWidth();
                    float h = page.getMediaBox().getHeight();
                    System.out.printf("[VALIDATION] Page %d: %.2f × %.2f pts%n", p + 1, w, h);
                    assertTrue(Math.abs(w - 595.28f) < 2.0f, "Page " + (p + 1) + " width must be A4 (595.28 pt): " + w);
                    assertTrue(Math.abs(h - 841.89f) < 2.0f, "Page " + (p + 1) + " height must be A4 (841.89 pt): " + h);
                    assertTrue(h > w, "Page " + (p + 1) + " orientation must be portrait");
                }

                // Text extraction and content assertions
                PDFTextStripper stripper = new PDFTextStripper();
                stripper.setSortByPosition(true);
                String fullText = stripper.getText(doc).replaceAll("\\s+", " ");

                assertTrue(fullText.contains("TECHNICAL COMPLIANCE DATA SHEET"), "Must contain main document title");
                assertTrue(fullText.contains("Mark Enterprises") || fullText.contains("MARK ENTERPRISES"), "Must contain company branding");
                assertTrue(fullText.contains("info@markenworld.com"), "Must contain contact email");
                assertTrue(fullText.contains("Sr.") && fullText.contains("no."), "Must contain Sr. no. column header");
                assertTrue(fullText.contains("Technical Specification"), "Must contain Technical Specification header");
                assertTrue(fullText.contains("Compliance"), "Must contain Compliance header");
                assertTrue(fullText.contains("Offered Specification"), "Must contain Offered Specification header");
                assertTrue(fullText.contains("Deviations"), "Must contain Deviations header");
                assertTrue(fullText.contains("Authorized Signatory"), "Must contain Authorized Signatory block");
                assertTrue(fullText.contains("Shreedhar Shingare"), "Must contain signatory name");

                // Render pages to PNG for visual inspection
                PDFRenderer renderer = new PDFRenderer(doc);
                for (int p = 0; p < pageCount; p++) {
                    var img = renderer.renderImageWithDPI(p, 150);
                    File pngFile = reviewDir.resolve("tender-" + tid + "-page-" + (p + 1) + ".png").toFile();
                    ImageIO.write(img, "PNG", pngFile);
                    System.out.println("[RENDERED] Page " + (p + 1) + " saved to: " + pngFile.getAbsolutePath());
                }
            }

            System.out.println("✅ [COMPLETED] Tender " + tid + " PDF successfully generated and verified!");
        }
    }
}
