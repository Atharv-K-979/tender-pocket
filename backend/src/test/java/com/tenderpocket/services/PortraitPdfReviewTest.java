package com.tenderpocket.services;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.rendering.PDFRenderer;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Generates a deterministic sample PDF for visual review.
 * No Azure / external API calls made. Output written to target/review/.
 */
class PortraitPdfReviewTest {

    @Test
    void generateReviewPdf() throws Exception {
        // --- Deterministic test data matching the sample document ---
        Map<String, String> data = new LinkedHashMap<>();
        data.put("companyName",        "Mark Enterprises");
        data.put("companyAddress",     "Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik \u2013 422007, Maharashtra, India");
        data.put("companyEmail",       "info@markenworld.com");
        data.put("companyWebsite",     "www.markenworld.com");
        data.put("companyContact",     "09175559646 / 090111 04332");
        data.put("signatoryName",      "Shreedhar Shingare");
        data.put("signatoryDesignation", "Authorized Signatory (Tender manager)");
        data.put("signatoryAddress",   "Nashik Maharashtra.");
        data.put("recipientName",      "Deputy Director of Health Services, Health And Family Welfare Department");
        data.put("recipientAddress",   "Ezhil Nagar, Vengikkal, Thiruvanamalai\nDistrict-606601 Tamil Nadu");
        data.put("subject",            "Technical Compliance Data Sheet - Blood Bag Refrigerator");
        data.put("bidNumber",          "GEM/2026/B/8086862");
        data.put("date",               "26-09-2026");
        data.put("productName",        "Blood Bag Refrigerator");
        data.put("qty",                "02");
        data.put("offeredMake",        "MarkEn");
        data.put("offeredModel",       "MBBR-04");

        List<SpecificationSheetContent.Row> rows = new ArrayList<>();
        rows.add(row("1",  "Purpose : A refrigerator for storing whole blood or red cell packs in a blood bank."));
        rows.add(row("2",  "Capacity : Required for storing 300-400 blood bags of 450ml each"));
        rows.add(row("3",  "Durable construction: Single body structure with stainless steel interior and MS sheet powder coated exterior."));
        rows.add(row("4",  "Material: Ext. MS sheet, 18 swg CR sheet, powder coated after 7 tank process. Internal \u2013 22g Stainless steel sheet Mounting: On castor wheels Condensate evaporator : For automatic evaporation of condensate which collects in a tray provide at the rear of the cabinet (optional)"));
        rows.add(row("5",  "Temperature Range: +2\u00b0C to +8\u00b0C \u00b11\u00b0C (adjustable)"));
        rows.add(row("6",  "Door: Double door (or single door as per requirement) with magnetic gasket. Door should have lock & key arrangement."));
        rows.add(row("7",  "Refrigerant: CFC-free eco-friendly refrigerant. (e.g., R134a or equivalent)"));
        rows.add(row("8",  "Compressor: Hermetically sealed, energy-efficient compressor."));
        rows.add(row("9",  "Condenser: Forced air cooled condenser with fan motor."));
        rows.add(row("10", "Evaporator: Internal evaporator coil type for uniform cooling."));
        rows.add(row("11", "Shelves: Minimum 4 adjustable coated wire shelves."));
        rows.add(row("12", "Alarms: Audible and visual temperature alarm (high and low). Power failure alarm."));
        rows.add(row("13", "Display: Digital temperature display with resolution of 0.1\u00b0C."));
        rows.add(row("14", "Data logger: Integrated or external data logging facility for temperature recording."));
        rows.add(row("15", "Power supply: 230 V AC, 50 Hz, single phase."));
        rows.add(row("16", "Power consumption: Maximum 150 W."));
        rows.add(row("17", "Standards/Certifications: Should be certified by CDSCO/WHO/ISO 13485 or equivalent standards."));
        rows.add(row("18", "Warranty: 3 years comprehensive warranty with CMC options."));

        var product = new SpecificationSheetContent.Product(
                "Blood Bag Refrigerator", "1", List.copyOf(rows), List.of());

        // Generate using the renderer directly (no external calls)
        var generator = new DocumentGeneratorService();
        byte[] pdf  = generator.generateProductSheetPdf(data, product);
        byte[] docx = generator.generateProductSheetDocx(data, product);

        Path out = Path.of("target", "review");
        Files.createDirectories(out);
        Files.write(out.resolve("review.pdf"),  pdf);
        Files.write(out.resolve("review.docx"), docx);

        // --- Visual render all pages to PNG ---
        try (PDDocument doc = PDDocument.load(pdf)) {
            int pages = doc.getNumberOfPages();
            System.out.println("[REVIEW] Pages: " + pages);

            // 1. Page dimension check (A4 portrait = 595.28 × 841.89 pts)
            for (int i = 0; i < pages; i++) {
                PDPage page = doc.getPage(i);
                float w = page.getMediaBox().getWidth();
                float h = page.getMediaBox().getHeight();
                System.out.printf("[REVIEW] Page %d: %.1f × %.1f pts (expected ~595 × 842)%n", i+1, w, h);
                // Allow ±2pt for rounding
                assertTrue(Math.abs(w - 595.28f) < 2f, "Page " + (i+1) + " width not A4: " + w);
                assertTrue(Math.abs(h - 841.89f) < 2f, "Page " + (i+1) + " height not A4: " + h);
            }

            // 2. Extract full text
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            String allText = stripper.getText(doc).replaceAll("\\s+", " ");
            System.out.println("[REVIEW] Full text (collapsed): " + allText.substring(0, Math.min(600, allText.length())) + "...");

            // 3. Check company header on every page
            for (int p = 1; p <= pages; p++) {
                stripper.setStartPage(p); stripper.setEndPage(p);
                String pageText = stripper.getText(doc).replaceAll("\\s+", " ");
                assertTrue(pageText.contains("MARK ENTERPRISES"),  "Company name missing on page " + p);
                assertTrue(pageText.contains("markenworld.com"),   "Contact info missing on page " + p);
            }
            stripper.setStartPage(1); stripper.setEndPage(pages);

            // 4. Recipient block
            assertTrue(allText.contains("Deputy Director"), "Recipient name missing");
            assertTrue(allText.contains("Tamil Nadu"),       "Recipient address missing");

            // 5. Metadata
            assertTrue(allText.contains("Blood Bag Refrigerator"), "Product name missing");
            assertTrue(allText.contains("GEM/2026"),               "Bid number missing");
            assertTrue(allText.contains("MBBR-04"),                "Model missing");
            assertTrue(allText.contains("MarkEn"),                 "Make missing");

            // 6. Column headers (check doc title and headers)
            assertTrue(allText.contains("TECHNICAL COMPLIANCE DATA SHEET"), "Document title missing");
            assertTrue(allText.replaceAll("\\s+","").contains("Sr."),       "Sr. no. column missing");
            assertTrue(allText.contains("Compliance"),                      "Compliance column header missing");
            assertTrue(allText.contains("Yes"),                             "Compliance values missing");
            assertTrue(allText.contains("No Deviation"),                    "Deviations column missing");

            // 7. Signatory block
            assertTrue(allText.contains("Shreedhar Shingare"), "Signatory name missing");
            assertTrue(allText.contains("Nashik Maharashtra"), "Signatory address missing");
            assertTrue(allText.contains("Mark Enterprises"),   "Manufacturer declaration missing");

            // Render PNG pages
            PDFRenderer renderer = new PDFRenderer(doc);
            for (int i = 0; i < pages; i++) {
                ImageIO.write(renderer.renderImageWithDPI(i, 110), "png",
                        out.resolve("review-page-" + (i+1) + ".png").toFile());
                System.out.println("[REVIEW] Saved review-page-" + (i+1) + ".png");
            }
            System.out.println("[REVIEW] PDF path: " + out.toAbsolutePath().resolve("review.pdf"));
            System.out.println("[REVIEW] All assertions passed.");
        }
    }

    private static SpecificationSheetContent.Row row(String ref, String wording) {
        return new SpecificationSheetContent.Row(ref, wording, false, "test", "Yes", wording, "No Deviation");
    }
}
