package com.tenderpocket.services;

import com.tenderpocket.config.ComplianceProgressUiInjectionFilter;
import java.io.*;
import java.lang.reflect.Method;
import java.nio.file.*;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.usermodel.*;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import static org.junit.jupiter.api.Assertions.*;

class SpecificationSheetOutputTest {
    private String[] row(String number, String text, String type, String page) {
        return new String[]{number, text, "", "", "", "Arbitrary Pump 40 L", "-", page,
                type, "3", "Technical Specifications", "7"};
    }

    @Test
    void pdfOmitsReviewAppendixWithoutDiscardingNotesOrChangingDocx() throws Exception {
        String note = "REVIEW_ONLY_SENTINEL: verify this reading against the source.";
        String[] source = row("3.10", "Capacity shall be 100 litres.", "requirement", "PDF p. 1");
        source[6] = note;
        var product = SpecificationSheetContent.from(Collections.singletonList(source)).get(0);
        assertTrue(product.clarifications().stream().anyMatch(text -> text.contains(note)));
        var generator = new DocumentGeneratorService();
        try (PDDocument pdf = PDDocument.load(generator.generateProductSheetPdf(Map.of(), product))) {
            String text = new PDFTextStripper().getText(pdf);
            assertTrue(text.contains("Capacity"));
            assertFalse(text.contains("Source Clarifications"));
            assertFalse(text.contains("REVIEW_ONLY_SENTINEL"));
        }
        try (XWPFDocument docx = new XWPFDocument(new ByteArrayInputStream(
                generator.generateProductSheetDocx(Map.of(), product)))) {
            String text = String.join("\n", docx.getParagraphs().stream().map(XWPFParagraph::getText).toList());
            assertTrue(text.contains("Source Clarifications"), "Only PDF output was requested to change");
            assertTrue(text.contains(note));
        }
    }

    @Test
    void contentPreservesSectionsContinuationsAndConflicts() {
        List<String[]> input = List.of(
                row("3.10", "Power input: 220-240V", "requirement", "PDF p. 1"),
                row("3.10", "at 50 Hz.", "continuation", "PDF p. 2"),
                row("3.10", "Power input: 220-240V at 50 Hz.", "requirement", "PDF p. 8"),
                row("3.11", "Capacity: 40 litres.", "requirement", "PDF p. 2"),
                row("3.11", "Capacity: 50 litres.", "requirement", "PDF p. 9"));
        var product = SpecificationSheetContent.from(input).get(0);
        assertEquals("7", product.schedule());
        assertEquals(3, product.clauseCount());
        assertTrue(product.rows().get(0).heading());
        assertEquals("3.10", product.rows().get(1).reference());
        assertEquals("Power input: 220-240V at 50 Hz.", product.rows().get(1).wording());
        assertTrue(product.rows().get(1).sources().contains("PDF p. 8"));
        assertEquals(1, product.clarifications().size());
        assertTrue(product.fileStem(1).startsWith("7_Technical_Data_Sheet_"));
    }

    @Test
    void blankReferencesReceiveStableDisplayNumbersWithoutChangingSourceReferences() {
        List<String[]> input = List.of(
                row("", "General requirements", "heading", "PDF p. 1"),
                row("3.10", "Power input: 220-240V", "requirement", "PDF p. 1"),
                row("", "Ingress protection shall be IP54.", "requirement", "PDF p. 2"));

        var rows = SpecificationSheetContent.from(input).get(0).rows();

        assertEquals("1", rows.get(0).reference());
        assertEquals("3.10", rows.stream().filter(row -> row.wording().startsWith("Power input"))
                .findFirst().orElseThrow().reference());
        for (int i = 0; i < rows.size(); i++) {
            assertFalse(rows.get(i).reference().isBlank());
            if (rows.get(i).wording().startsWith("Ingress protection")) {
                assertEquals(String.valueOf(i + 1), rows.get(i).reference());
            }
        }
    }

    @Test
    void rendererNeverLeavesSerialNumberBlankForLegacyContent() throws Exception {
        var product = new SpecificationSheetContent.Product("Pump", "1", List.of(
                new SpecificationSheetContent.Row("", "Warranty shall be five years.", false, "PDF p. 2")),
                List.of());

        String html = SpecificationSheetRenderer.html(Map.of(), List.of(product), null, null);
        assertTrue(html.contains("<td class=\"reference\">1</td>"));

        try (XWPFDocument document = new XWPFDocument(new ByteArrayInputStream(
                SpecificationSheetRenderer.docx(Map.of(), List.of(product), null, null)))) {
            assertEquals("1", document.getTables().get(0).getRow(1).getCell(0).getText());
        }

        try (var workbook = WorkbookFactory.create(new ByteArrayInputStream(
                SpecificationSheetRenderer.xlsx(Map.of(), List.of(product))))) {
            var sheet = workbook.getSheetAt(0);
            assertEquals("Sr. no.", sheet.getRow(5).getCell(0).getStringCellValue());
            assertEquals("1", sheet.getRow(6).getCell(0).getStringCellValue());
            assertEquals("Warranty shall be five years.", sheet.getRow(6).getCell(1).getStringCellValue());
            for (int column = 2; column < 5; column++) {
                assertEquals("", sheet.getRow(6).getCell(column).getStringCellValue());
            }
        }
    }

    @Test
    void compactItemScheduleMakesOneShortSheetInAllThreeFormats() throws Exception {
        var generator = new DocumentGeneratorService();
        String context = "[SOURCE_PAGE pdf=\"1\"]\nTECHNICAL SPECIFICATION OF ITEMS\n"
                + "Ser No Specification A/U Qty Remarks\n[/SOURCE_PAGE]";
        List<String[]> extracted = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            extracted.add(new String[]{String.valueOf(i), "Item " + i + " A/U: Nos; Qty: 0" + i,
                    "", "", "", "Item " + i, "-", "PDF p. 1", "requirement", "", "", ""});
        }
        List<String[]> grouped = generator.groupCompactItemSchedule(extracted, context);
        assertEquals("Item 1", extracted.get(0)[5], "Grouping must not change validated source rows");
        var products = SpecificationSheetContent.from(grouped);
        assertEquals(1, products.size());
        var product = products.get(0);
        assertEquals("Technical Specification of Items", product.name());
        assertEquals(7, product.clauseCount());
        byte[] pdf = generator.generateProductSheetPdf(Map.of(), product);
        try (PDDocument document = PDDocument.load(pdf)) {
            assertTrue(document.getNumberOfPages() <= 2,
                    "A seven-row schedule should stay short; got " + document.getNumberOfPages());
            String text = new PDFTextStripper().getText(document);
            for (int i = 1; i <= 7; i++) {
                assertTrue(java.util.regex.Pattern.compile("(?m)^" + i + "\\s+Item\\b[^\\r\\n]*\\b0" + i + "\\s*$")
                        .matcher(text).find(), "Missing item " + i + " or its quantity from: " + text);
            }
        }
        try (XWPFDocument document = new XWPFDocument(new ByteArrayInputStream(
                generator.generateProductSheetDocx(Map.of(), product)))) {
            var table = document.getTables().get(0);
            assertEquals(8, table.getRows().size());
            for (int i = 1; i <= 7; i++) {
                assertEquals(String.valueOf(i), table.getRow(i).getCell(0).getText());
                assertTrue(table.getRow(i).getCell(1).getText().contains("Qty: 0" + i));
                assertEquals("", table.getRow(i).getCell(2).getText());
            }
        }
        try (var workbook = WorkbookFactory.create(new ByteArrayInputStream(
                generator.generateProductSheetXlsx(Map.of(), product)))) {
            assertEquals(1, workbook.getNumberOfSheets());
            var sheet = workbook.getSheetAt(0);
            for (int i = 1; i <= 7; i++) {
                assertEquals(String.valueOf(i), sheet.getRow(i + 5).getCell(0).getStringCellValue());
                assertTrue(sheet.getRow(i + 5).getCell(1).getStringCellValue().contains("Qty: 0" + i));
            }
        }
    }

    @Test
    void compactGroupingRequiresTableEvidenceAndDoesNotMergeDetailedVariants() {
        var generator = new DocumentGeneratorService();
        List<String[]> scanned = List.of(
                new String[]{"1", "Ice Tray A/U: Nos; Qty: 06", "", "", "", "Ice Tray",
                        "-", "PDF p. 1", "requirement", "", "Technical Specification of Items", ""},
                new String[]{"2", "DC Fan A/U: Nos; Qty: 06", "", "", "", "DC Fan",
                        "-", "PDF p. 1", "requirement", "", "Technical Specification of Items", ""});
        assertEquals(1, SpecificationSheetContent.from(generator.groupCompactItemSchedule(
                scanned, "[SOURCE_PAGE pdf=\"1\"]\n[/SOURCE_PAGE]")).size(),
                "Scanned tables can identify the compact schedule through validated row headings");
        List<String[]> detailed = List.of(
                new String[]{"3.10", "Capacity 100 litres", "", "", "", "ILR Large",
                        "-", "PDF p. 1", "requirement", "3", "Technical Specifications", ""},
                new String[]{"3.11", "Capacity 60 litres", "", "", "", "ILR Small",
                        "-", "PDF p. 1", "requirement", "3", "Technical Specifications", ""});
        String tableHeader = "TECHNICAL SPECIFICATION OF ITEMS\nSer No Specification A/U Qty Remarks";
        assertEquals(2, SpecificationSheetContent.from(generator.groupCompactItemSchedule(
                detailed, tableHeader)).size(), "Original detailed product sections stay separate");
        List<String[]> withoutTableTitle = scanned.stream().map(row -> {
            String[] copy = row.clone();
            copy[10] = "";
            return copy;
        }).toList();
        assertEquals(2, SpecificationSheetContent.from(generator.groupCompactItemSchedule(
                withoutTableTitle, "A different document without a compact table")).size());
    }

    @Test
    void usageMetricsCalculateInrWithoutDoubleBillingReasoningTokens() {
        var metrics = new ComplianceConversionMetrics("0.20", "0.02", "1.25", "80", "2026-09-13");
        metrics.recordApiAttempt(125, true, "{\"usage\":{\"input_tokens\":1000,"
                + "\"input_tokens_details\":{\"cached_tokens\":200},\"output_tokens\":100,"
                + "\"output_tokens_details\":{\"reasoning_tokens\":40},\"total_tokens\":1100}}");
        metrics.incrementValidationRetries();
        metrics.setDocumentCounts(11, 3);
        metrics.setResultCounts(2, 25);
        metrics.finish();

        Map<String, Object> snapshot = metrics.snapshot();
        Map<?, ?> tokens = (Map<?, ?>) snapshot.get("tokens");
        assertEquals(1000L, tokens.get("input"));
        assertEquals(200L, tokens.get("cachedInput"));
        assertEquals(40L, tokens.get("reasoning"));
        assertEquals(new BigDecimal("0.0231"), snapshot.get("estimatedCostInr"));
        assertEquals("INR", snapshot.get("currency"));
    }

    @Test
    void missingExchangeConfigurationNeverFabricatesAnInrCost() {
        var metrics = new ComplianceConversionMetrics("0.20", "0.02", "1.25", "", "");
        metrics.recordUsage("{\"usage\":{\"input_tokens\":10,\"output_tokens\":2,\"total_tokens\":12}}");
        Map<String, Object> snapshot = metrics.snapshot();
        assertNull(snapshot.get("estimatedCostInr"));
        assertFalse(((List<?>) snapshot.get("warnings")).isEmpty());
    }

    @Test
    void successfulEmptyAndTruncatedResponsesAreDistinct() throws Exception {
        var ai = new AISpecificationIntelligenceService();
        Method parse = AISpecificationIntelligenceService.class.getDeclaredMethod(
                "parseLlmJsonResponse", String.class, Map.class);
        parse.setAccessible(true);
        List<String[]> complete = (List<String[]>) parse.invoke(ai,
                "{\"rows\":[],\"noApplicableRequirements\":true}", Map.of());
        assertTrue(AISpecificationIntelligenceService.isCompletedEmpty(complete));
        for (String response : List.of("[]", "{\"rows\":[],\"noApplicableRequirements\":false}",
                "{\"status\":\"incomplete\",\"output_text\":\"{\\\"rows\\\":[],\\\"noApplicableRequirements\\\":true}\"}")) {
            assertFalse(AISpecificationIntelligenceService.isCompletedEmpty(
                    (List<String[]>) parse.invoke(ai, response, Map.of())));
        }
    }

    @Test
    void progressTracksNewJobsAndProductDownloads() {
        var progress = new ComplianceProgressService();
        progress.start("1", "first.pdf");
        Object first = progress.snapshot("1").get("jobId");
        List<Map<String, Object>> products = List.of(Map.of("productName", "Pump", "scheduleNumber", "1",
                "clauseCount", 3, "pdfDownloadUrl", "/documents/1/1.pdf", "docxDownloadUrl", "/documents/1/1.docx",
                "xlsxDownloadUrl", "/documents/1/1.xlsx"));
        progress.completeProducts("1", 3, products);
        assertEquals(products, progress.snapshot("1").get("products"));
        assertEquals("/documents/1/1.pdf", progress.snapshot("1").get("pdfDownloadUrl"));
        assertEquals("/documents/1/1.xlsx", progress.snapshot("1").get("xlsxDownloadUrl"));
        progress.start("1", "second.pdf");
        assertNotEquals(first, progress.snapshot("1").get("jobId"));
        assertEquals(List.of(), progress.snapshot("1").get("products"));
    }

    @Test
    void progressScriptIsInjectedOnceOnEveryEntryRouteOnly() throws Exception {
        for (String path : List.of("/", "/index.html", "/tenders/123")) {
            var request = new MockHttpServletRequest("GET", path);
            var response = new MockHttpServletResponse();
            new ComplianceProgressUiInjectionFilter().doFilter(request, response, (req, res) -> {
                res.setContentType("text/html");
                res.getWriter().write("<html><body>App</body></html>");
            });
            String html = response.getContentAsString();
            assertEquals(1, html.split("compliance-progress.js", -1).length - 1, path);
            assertTrue(html.contains("?v="));
        }
        var response = new MockHttpServletResponse();
        new ComplianceProgressUiInjectionFilter().doFilter(
                new MockHttpServletRequest("GET", "/api/tenders"), response, (req, res) -> {
                    res.setContentType("application/json"); res.getWriter().write("{\"ok\":true}");
                });
        assertEquals("{\"ok\":true}", response.getContentAsString());
    }

    @Test
    void bothFormatsRepeatHeadersAndRetainEveryRequirement() throws Exception {
        List<String[]> rows = new ArrayList<>();
        for (int i = 1; i <= 75; i++) rows.add(row("3." + i,
                "Requirement " + i + ": Capacity 180-250 litres, temperature +2\u00b0C to +8\u00b0C, "
                        + "voltage 172 volts. Preserve all conditions and provide a valid test certificate.",
                "requirement", "PDF p. " + (i / 10 + 1)));
        var product = SpecificationSheetContent.from(rows).get(0);
        Map<String, String> company = Map.of("companyName", "MARK ENTERPRISES", "companyAddress",
                "Shed No. 1, Plot No. 93/2, MIDC Satpur, Nashik", "companyEmail", "info@markenworld.com",
                "companyWebsite", "www.markenworld.com", "companyContact", "09175559646");
        var generator = new DocumentGeneratorService();
        byte[] pdf = generator.generateProductSheetPdf(company, product);
        byte[] docx = generator.generateProductSheetDocx(company, product);
        Path output = Path.of("target", "specification-sheet-tests");
        Files.createDirectories(output);
        Files.write(output.resolve("layout.pdf"), pdf);
        Files.write(output.resolve("layout.docx"), docx);
        try (PDDocument document = PDDocument.load(pdf)) {
            assertTrue(document.getNumberOfPages() > 1);
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            String all = stripper.getText(document).replaceAll("\\s+", " ");
            for (int i = 1; i <= 75; i++) assertTrue(all.contains("Requirement " + i + ":"), "PDF requirement " + i);
            for (int page = 1; page <= document.getNumberOfPages(); page++) {
                stripper.setStartPage(page); stripper.setEndPage(page);
                String text = stripper.getText(document);
                assertTrue(text.replaceAll("\\s+", "").contains("MARKENTERPRISES"), "Letterhead page " + page);
                // PDFBox may split the table header "Sr. no." across lines; check for "Sr." as a proxy
                assertTrue(text.replaceAll("\\s+", "").contains("Sr."), "Table header page " + page);
                assertTrue(text.contains("Requirement"), "No empty trailing page");
            }
        }
        try (XWPFDocument document = new XWPFDocument(new ByteArrayInputStream(docx))) {
            XWPFTable table = document.getTables().get(0);
            assertEquals(77, table.getRows().size());
            for (int i = 1; i < table.getRows().size(); i++) {
                for (int col = 2; col < 5; col++) assertEquals("", table.getRow(i).getCell(col).getText());
            }
            for (int i = 1; i <= 75; i++) assertTrue(table.getText().contains("Requirement " + i + ":"));
            assertTrue(table.getRow(0).isRepeatHeader());
        }
    }

    @Test
    void missingComplianceEvidenceLeavesColumnsBlankAndDoesNotFabricateValues() throws Exception {
        var row = new SpecificationSheetContent.Row("1.1", "Tender requirement text.", false, "PDF p. 1");
        var product = new SpecificationSheetContent.Product("Test Device", "1", List.of(row), List.of());
        var data = Map.of("companyName", "Test Company", "offeredMake", "MarkEn", "offeredModel", "MD-01");

        // HTML check
        String html = SpecificationSheetRenderer.html(data, List.of(product), null, null);
        assertTrue(html.contains("<td class=\"compliance-cell\"></td>"), "Compliance cell must be empty when evidence missing");
        assertTrue(html.contains("<td class=\"deviations-cell\"></td>"), "Deviations cell must be empty when evidence missing");
        // Col 4 should NOT contain duplicate tender requirement text
        assertEquals(1, html.split("Tender requirement text\\.", -1).length - 1,
                "Tender requirement must NOT be copied into offered specification column");

        // DOCX check
        byte[] docx = SpecificationSheetRenderer.docx(data, List.of(product), null, null);
        try (XWPFDocument document = new XWPFDocument(new ByteArrayInputStream(docx))) {
            var tableRow = document.getTables().get(0).getRow(1);
            assertEquals("1.1", tableRow.getCell(0).getText());
            assertEquals("Tender requirement text.", tableRow.getCell(1).getText());
            assertEquals("", tableRow.getCell(2).getText(), "Col 2 (Compliance) must be blank");
            assertEquals("", tableRow.getCell(3).getText(), "Col 3 (Offered Spec) must be blank");
            assertEquals("", tableRow.getCell(4).getText(), "Col 4 (Deviations) must be blank");
        }

        // XLSX check
        byte[] xlsx = SpecificationSheetRenderer.xlsx(data, List.of(product));
        try (var workbook = WorkbookFactory.create(new ByteArrayInputStream(xlsx))) {
            var sheetRow = workbook.getSheetAt(0).getRow(6);
            assertEquals("1.1", sheetRow.getCell(0).getStringCellValue());
            assertEquals("Tender requirement text.", sheetRow.getCell(1).getStringCellValue());
            assertEquals("", sheetRow.getCell(2).getStringCellValue(), "XLSX Col 2 (Compliance) must be blank");
            assertEquals("", sheetRow.getCell(3).getStringCellValue(), "XLSX Col 3 (Offered Spec) must be blank");
            assertEquals("", sheetRow.getCell(4).getStringCellValue(), "XLSX Col 4 (Deviations) must be blank");
        }
    }

    @Test
    void providedComplianceEvidenceIsFaithfullyRenderedInAllFormats() throws Exception {
        var row = new SpecificationSheetContent.Row("1.1", "Tender requires 300L capacity.", false, "PDF p. 1",
                "Yes", "Model MBBR-04 provides 350L capacity.", "No Deviation");
        var product = new SpecificationSheetContent.Product("Blood Bag Refrigerator", "1", List.of(row), List.of());
        var data = Map.of("companyName", "Mark Enterprises", "offeredMake", "MarkEn", "offeredModel", "MBBR-04");

        // HTML check
        String html = SpecificationSheetRenderer.html(data, List.of(product), null, null);
        assertTrue(html.contains("<td class=\"compliance-cell\">Yes</td>"));
        assertTrue(html.contains("Model MBBR-04 provides 350L capacity."));
        assertTrue(html.contains("<td class=\"deviations-cell\">No Deviation</td>"));

        // DOCX check
        byte[] docx = SpecificationSheetRenderer.docx(data, List.of(product), null, null);
        try (XWPFDocument document = new XWPFDocument(new ByteArrayInputStream(docx))) {
            var tableRow = document.getTables().get(0).getRow(1);
            assertEquals("1.1", tableRow.getCell(0).getText());
            assertEquals("Tender requires 300L capacity.", tableRow.getCell(1).getText());
            assertEquals("Yes", tableRow.getCell(2).getText());
            assertEquals("Model MBBR-04 provides 350L capacity.", tableRow.getCell(3).getText());
            assertEquals("No Deviation", tableRow.getCell(4).getText());
        }

        // XLSX check
        byte[] xlsx = SpecificationSheetRenderer.xlsx(data, List.of(product));
        try (var workbook = WorkbookFactory.create(new ByteArrayInputStream(xlsx))) {
            var sheetRow = workbook.getSheetAt(0).getRow(6);
            assertEquals("1.1", sheetRow.getCell(0).getStringCellValue());
            assertEquals("Tender requires 300L capacity.", sheetRow.getCell(1).getStringCellValue());
            assertEquals("Yes", sheetRow.getCell(2).getStringCellValue());
            assertEquals("Model MBBR-04 provides 350L capacity.", sheetRow.getCell(3).getStringCellValue());
            assertEquals("No Deviation", sheetRow.getCell(4).getStringCellValue());
        }
    }
}
