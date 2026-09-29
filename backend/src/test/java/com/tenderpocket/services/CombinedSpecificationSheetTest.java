package com.tenderpocket.services;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CombinedSpecificationSheetTest {
    private List<SpecificationSheetContent.Product> products() {
        return List.of(
                new SpecificationSheetContent.Product("Pump Alpha", "7", List.of(
                        new SpecificationSheetContent.Row("3", "Performance", true, "PDF p. 1"),
                        new SpecificationSheetContent.Row("3.10", "Capacity 100 litres.", false, "PDF p. 1"),
                        new SpecificationSheetContent.Row("", "Warranty five years.", false, "PDF p. 2")), List.of("Review only")),
                new SpecificationSheetContent.Product("Pump Beta", "8", List.of(
                        new SpecificationSheetContent.Row("12.4", "Capacity 60 litres.", false, "PDF p. 3"),
                        new SpecificationSheetContent.Row("12.5", "Supply a certificate.", false, "PDF p. 3")), List.of()));
    }

    @Test void numberingStartsAtOneForEveryObjectAndDoesNotUseSourceClauses() {
        var products = products();
        var combined = SpecificationSheetContent.combined(products);
        assertEquals(List.of("", "1", "2", "", "1", "2"),
                combined.rows().stream().map(SpecificationSheetContent.Row::reference).toList());
        assertEquals("3.10", products.get(0).rows().get(1).reference());
        assertEquals("", products.get(0).rows().get(2).reference());
        assertEquals(4, combined.clauseCount());
        assertTrue(combined.clarifications().isEmpty());
    }

    @Test void modelOnlyHeadingsIncludeSourceProductNamesInAllFormats() throws Exception {
        var products = List.of(new SpecificationSheetContent.Product("MT64HM4DVE", "1", List.of(
                new SpecificationSheetContent.Row("1.1",
                        "REFRIGERATION COMPRESSOR MODEL NO: MT64HM4DVE, 380-400V, 50HZ",
                        false, "PDF p. 1"),
                new SpecificationSheetContent.Row("3", "Delivery within 60 days.", false, "PDF p. 2")), List.of()));
        String expected = "REFRIGERATION COMPRESSOR - MT64HM4DVE";
        assertEquals(expected, SpecificationSheetContent.combined(products).rows().get(0).wording());
        var generator = new DocumentGeneratorService();
        byte[] pdf = generator.generateCombinedSheetPdf(Map.of("companyName", "Test Company"), products);
        byte[] docx = generator.generateCombinedSheetDocx(Map.of(), products);
        byte[] xlsx = generator.generateCombinedSheetXlsx(Map.of(), products);
        Path output = Path.of("target", "product-name-heading-tests");
        Files.createDirectories(output);
        Files.write(output.resolve("named-heading.pdf"), pdf);
        try (PDDocument document = PDDocument.load(pdf)) {
            var stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            assertTrue(stripper.getText(document).replaceAll("\\s+", " ").contains(expected));
            javax.imageio.ImageIO.write(new org.apache.pdfbox.rendering.PDFRenderer(document)
                    .renderImageWithDPI(0, 95), "png", output.resolve("named-heading.png").toFile());
        }
        try (var document = new XWPFDocument(new ByteArrayInputStream(docx));
             var workbook = WorkbookFactory.create(new ByteArrayInputStream(xlsx))) {
            var table = document.getTables().get(0);
            assertEquals(expected, table.getRow(1).getCell(0).getText());
            assertEquals("1", table.getRow(2).getCell(0).getText());
            assertEquals("2", table.getRow(3).getCell(0).getText());
            assertEquals(expected, workbook.getSheetAt(0).getRow(3).getCell(0).getStringCellValue());
        }
        assertEquals("MT64HM4DVE", products.get(0).name(), "Do not mutate caller content");
    }

    @Test void onlyProductHeadingsAppearInEveryCombinedFormat() throws Exception {
        List<String[]> input = new java.util.ArrayList<>();
        for (String product : List.of("Pump Alpha", "Pump Beta")) {
            input.add(new String[]{"3.10", "Capacity 100 litres.", "", "", "", product, "-", "PDF p. 1",
                    "requirement", "1", "ITEM DESCRIPTION", ""});
            input.add(new String[]{"7", " item\u00a0 DESCRIPTION: ", "", "", "", product, "-", "PDF p. 2",
                    "heading", "", "", ""});
            input.add(new String[]{"3.11", "Delivery within 60 days.", "", "", "", product, "-", "PDF p. 2",
                    "requirement", "2", "Item Description", ""});
            input.add(new String[]{"3.12", "Item description must include the serial plate.", "", "", "",
                    product, "-", "PDF p. 3", "requirement", "", "Inspection", ""});
        }
        var products = SpecificationSheetContent.from(input);
        var combined = SpecificationSheetContent.combined(products);
        assertEquals(List.of("", "1", "2", "3", "", "1", "2", "3"),
                combined.rows().stream().map(SpecificationSheetContent.Row::reference).toList());
        assertEquals(6, combined.clauseCount());
        assertEquals(0, combined.rows().stream()
                .filter(row -> row.heading() && row.wording().equals("ITEM DESCRIPTION")).count());
        assertEquals(0, combined.rows().stream()
                .filter(row -> row.heading() && row.wording().equals("Inspection")).count());
        assertEquals(List.of("Pump Alpha", "Pump Beta"), combined.rows().stream()
                .filter(SpecificationSheetContent.Row::heading).map(SpecificationSheetContent.Row::wording).toList());
        assertTrue(products.stream().allMatch(product -> product.rows().stream()
                .filter(SpecificationSheetContent.Row::heading).count() == 4),
                "Source headings and provenance must remain intact for other workflows");

        var generator = new DocumentGeneratorService();
        try (PDDocument document = PDDocument.load(generator.generateCombinedSheetPdf(Map.of(), products))) {
            var stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            String text = stripper.getText(document).replaceAll("\\s+", " ");
            assertEquals(0, text.split("ITEM DESCRIPTION", -1).length - 1);
            assertFalse(text.contains("Inspection"));
            assertEquals(2, text.split("Delivery within", -1).length - 1);
            assertEquals(2, text.split("Item description must include", -1).length - 1);
        }
        try (var document = new XWPFDocument(new ByteArrayInputStream(
                generator.generateCombinedSheetDocx(Map.of(), products)));
             var workbook = WorkbookFactory.create(new ByteArrayInputStream(
                     generator.generateCombinedSheetXlsx(Map.of(), products)))) {
            var table = document.getTables().get(0);
            var sheet = workbook.getSheetAt(0);
            assertEquals(combined.rows().size() + 1, table.getRows().size());
            assertEquals(combined.rows().size() + 3, sheet.getPhysicalNumberOfRows());
            for (int i = 0; i < combined.rows().size(); i++) {
                var expected = combined.rows().get(i);
                var wordRow = table.getRow(i + 1);
                var excelRow = sheet.getRow(i + 3);
                assertEquals(expected.heading() ? 1 : 5, wordRow.getTableCells().size());
                int column = expected.heading() ? 0 : 1;
                assertEquals(expected.wording(), wordRow.getCell(column).getText());
                assertEquals(expected.wording(), excelRow.getCell(column).getStringCellValue());
                if (!expected.heading()) {
                    assertEquals(expected.reference(), wordRow.getCell(0).getText());
                    assertEquals(expected.reference(), excelRow.getCell(0).getStringCellValue());
                    for (int c = 2; c < 5; c++) {
                        assertEquals("", wordRow.getCell(c).getText());
                        assertEquals("", excelRow.getCell(c).getStringCellValue());
                    }
                }
            }
        }
    }

    @Test void allFormatsUseOneTableWithMergedBoldObjectHeadingsAndIdenticalRows() throws Exception {
        var products = products();
        var generator = new DocumentGeneratorService();
        var data = Map.of("companyName", "Test Company", "companyAddress", "Test Address");
        var expected = SpecificationSheetContent.combined(products).rows();
        String html = SpecificationSheetRenderer.html(data, products, null, null, true);
        assertEquals(1, html.split("<table class=\"sheet\">", -1).length - 1);
        assertTrue(html.contains("<td colspan=\"5\">Pump Beta</td>"));
        assertFalse(html.contains("class=\"next\""));
        assertFalse(html.contains("3.10"));

        byte[] pdf = generator.generateCombinedSheetPdf(data, products);
        byte[] docx = generator.generateCombinedSheetDocx(data, products);
        byte[] xlsx = generator.generateCombinedSheetXlsx(data, products);
        Path output = Path.of("target", "combined-sheet-tests");
        Files.createDirectories(output);
        Files.write(output.resolve("combined.pdf"), pdf);
        Files.write(output.resolve("combined.docx"), docx);
        Files.write(output.resolve("combined.xlsx"), xlsx);
        try (PDDocument document = PDDocument.load(pdf)) {
            assertEquals(1, document.getNumberOfPages());
            var stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            String text = stripper.getText(document).replaceAll("\\s+", " ");
            for (var row : expected) assertTrue(text.contains(row.wording()), text);
            assertFalse(text.contains("Source Clarifications"));
            assertFalse(text.contains("3.10"));
            javax.imageio.ImageIO.write(new org.apache.pdfbox.rendering.PDFRenderer(document)
                    .renderImageWithDPI(0, 110), "png", output.resolve("combined.png").toFile());
        }
        try (var document = new XWPFDocument(new ByteArrayInputStream(docx))) {
            assertEquals(1, document.getTables().size());
            var table = document.getTables().get(0);
            assertTrue(table.getRow(0).isRepeatHeader());
            assertEquals(expected.size() + 1, table.getRows().size());
            for (int i = 0; i < expected.size(); i++) {
                var row = table.getRow(i + 1);
                if (expected.get(i).heading()) {
                    assertEquals(1, row.getTableCells().size());
                    assertEquals(expected.get(i).wording(), row.getCell(0).getText());
                    assertTrue(row.getCell(0).getParagraphs().get(0).getRuns().stream().allMatch(run -> run.isBold()));
                } else {
                    assertEquals(5, row.getTableCells().size());
                    assertEquals(expected.get(i).reference(), row.getCell(0).getText());
                    assertEquals(expected.get(i).wording(), row.getCell(1).getText());
                    for (int c = 2; c < 5; c++) assertEquals("", row.getCell(c).getText());
                }
            }
        }
        try (var workbook = WorkbookFactory.create(new ByteArrayInputStream(xlsx))) {
            assertEquals(1, workbook.getNumberOfSheets());
            var sheet = workbook.getSheetAt(0);
            assertEquals(2, sheet.getRepeatingRows().getFirstRow());
            for (int i = 0; i < expected.size(); i++) {
                var row = sheet.getRow(i + 3);
                if (expected.get(i).heading()) {
                    assertEquals(expected.get(i).wording(), row.getCell(0).getStringCellValue());
                    assertTrue(workbook.getFontAt(row.getCell(0).getCellStyle().getFontIndex()).getBold());
                    int index = i + 3;
                    assertTrue(sheet.getMergedRegions().stream().anyMatch(region ->
                            region.getFirstRow() == index && region.getFirstColumn() == 0 && region.getLastColumn() == 4));
                } else {
                    assertEquals(expected.get(i).reference(), row.getCell(0).getStringCellValue());
                    assertEquals(expected.get(i).wording(), row.getCell(1).getStringCellValue());
                    for (int c = 2; c < 5; c++) assertEquals("", row.getCell(c).getStringCellValue());
                }
            }
        }
    }

    @Test void combinedPaginationPreservesEverySpecificationAndRepeatsHeaders() throws Exception {
        var products = new java.util.ArrayList<SpecificationSheetContent.Product>();
        for (String name : List.of("Pump Alpha", "Pump Beta")) {
            var rows = new java.util.ArrayList<SpecificationSheetContent.Row>();
            for (int i = 1; i <= 40; i++) {
                rows.add(new SpecificationSheetContent.Row("3." + i,
                        name + " requirement " + i + ": Capacity 100 litres, temperature +2 C to +8 C, "
                                + "voltage 230 V. Preserve every specified accessory and condition.",
                        false, "PDF p. 1"));
            }
            products.add(new SpecificationSheetContent.Product(name, "1", List.copyOf(rows), List.of()));
        }
        var generator = new DocumentGeneratorService();
        byte[] pdf = generator.generateCombinedSheetPdf(Map.of("companyName", "Test Company"), products);
        Path directory = Path.of("target", "combined-sheet-tests");
        Files.createDirectories(directory);
        Files.write(directory.resolve("combined-long.pdf"), pdf);
        try (PDDocument document = PDDocument.load(pdf)) {
            assertTrue(document.getNumberOfPages() > 1);
            var stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            String all = stripper.getText(document).replaceAll("\\s+", " ");
            for (var product : products) {
                for (int i = 1; i <= 40; i++) assertTrue(all.contains(product.name() + " requirement " + i + ":"), all);
            }
            for (int page = 1; page <= document.getNumberOfPages(); page++) {
                stripper.setStartPage(page); stripper.setEndPage(page);
                String text = stripper.getText(document).replaceAll("\\s+", " ");
                assertTrue(text.contains("Sr. No."), "Missing repeated header on page " + page);
                assertTrue(text.contains("requirement"), "Blank trailing page " + page);
                javax.imageio.ImageIO.write(new org.apache.pdfbox.rendering.PDFRenderer(document)
                        .renderImageWithDPI(page - 1, 85), "png", directory.resolve("long-" + page + ".png").toFile());
            }
        }
    }
}
