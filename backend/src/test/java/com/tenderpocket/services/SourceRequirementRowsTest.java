package com.tenderpocket.services;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SourceRequirementRowsTest {
    private String[] row(String reference, String wording, String product, String page, String type) {
        return new String[]{reference, wording, "", "", "", product, "-", page,
                type, "1", "Goods/Services Required", ""};
    }

    @Test void independentOccurrencesAndMultilineClausesRemainSeparateAndVerbatimInEveryFormat() throws Exception {
        String original = "REFRIGERATION COMPRESSOR, MODEL No:- MT64HM4DVE,\n"
                + "VOLTS:- 380-400V, 50 Hz; MAKE:- DANFOSS / EMERSON / BITZER.\n"
                + "Deliver within 60 days; inspect on receipt.";
        List<String[]> input = List.of(
                row("1", original, "Compressor MT64HM4DVE", "PDF p. 1", "requirement"),
                row("2", "Search String Used in the GeM Availability Report", "Compressor MT64HM4DVE",
                        "PDF p. 1", "heading"),
                row("1", original, "Compressor MT64HM4DVE", "PDF p. 2", "requirement"),
                row("1", original.replace("380-400V", "220-240V"), "Compressor MT64HM4DVE",
                        "PDF p. 3", "requirement"),
                row("", "Capacity: 60 litres. Voltage: 230 V.", "Pump Beta", "PDF p. 4", "requirement"));
        var products = SpecificationSheetContent.fromSourceRequirements(input);
        assertEquals(2, products.size());
        assertEquals(3, products.get(0).clauseCount());
        assertEquals(List.of(original, original, original.replace("380-400V", "220-240V")),
                products.get(0).rows().stream().map(SpecificationSheetContent.Row::wording).toList());
        assertEquals(List.of("PDF p. 1", "PDF p. 2", "PDF p. 3"),
                products.get(0).rows().stream().map(SpecificationSheetContent.Row::sources).toList());
        assertEquals(original, input.get(0)[1], "Do not mutate source data");
        var expected = SpecificationSheetContent.combined(products).rows();
        assertEquals(List.of("", "1", "2", "3", "", "1"),
                expected.stream().map(SpecificationSheetContent.Row::reference).toList());
        var generator = new DocumentGeneratorService();
        var data = Map.of("companyName", "Test Company");
        byte[] pdf = generator.generateCombinedSheetPdf(data, products);
        byte[] word = generator.generateCombinedSheetDocx(data, products);
        byte[] excel = generator.generateCombinedSheetXlsx(data, products);
        Path output = Path.of("target", "source-requirement-tests");
        Files.createDirectories(output);
        Files.write(output.resolve("source-rows.pdf"), pdf);
        Files.write(output.resolve("source-rows.docx"), word);
        Files.write(output.resolve("source-rows.xlsx"), excel);
        try (var doc = new XWPFDocument(new ByteArrayInputStream(word));
             var workbook = WorkbookFactory.create(new ByteArrayInputStream(excel))) {
            assertEquals(1, doc.getTables().size());
            assertEquals(1, workbook.getNumberOfSheets());
            var table = doc.getTables().get(0);
            assertEquals(expected.size() + 1, table.getRows().size());
            for (int i = 0; i < expected.size(); i++) {
                var row = expected.get(i);
                var wordRow = table.getRow(i + 1);
                var excelRow = workbook.getSheetAt(0).getRow(i + 3);
                int textColumn = row.heading() ? 0 : 1;
                assertEquals(row.wording(), wordRow.getCell(textColumn).getText());
                assertEquals(row.wording(), excelRow.getCell(textColumn).getStringCellValue());
                if (!row.heading()) {
                    assertEquals(row.reference(), wordRow.getCell(0).getText());
                    assertEquals(row.reference(), excelRow.getCell(0).getStringCellValue());
                    for (int c = 2; c < 5; c++) {
                        assertEquals("", wordRow.getCell(c).getText());
                        assertEquals("", excelRow.getCell(c).getStringCellValue());
                    }
                }
            }
        }
        try (var doc = PDDocument.load(pdf)) {
            var stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            String text = stripper.getText(doc).replaceAll("\\s+", " ");
            assertEquals(2, text.split(java.util.regex.Pattern.quote(original.replaceAll("\\s+", " ")), -1).length - 1);
            assertFalse(text.contains("Goods/Services Required"));
            assertFalse(text.contains("Search String Used"));
            assertTrue(text.contains("220-240V"));
            javax.imageio.ImageIO.write(new org.apache.pdfbox.rendering.PDFRenderer(doc)
                    .renderImageWithDPI(0, 100), "png", output.resolve("source-rows.png").toFile());
        }
    }

    @Test void actualContinuationRetainsTextButDifferentClausesAreNotJoined() {
        var input = List.of(
                row("3.10", "Power: 220-240V", "Pump", "PDF p. 1", "requirement"),
                row("3.10", "at 50 Hz; alarm required.", "Pump", "PDF p. 2", "continuation"),
                row("3.11", "Include sensor.", "Pump", "PDF p. 2", "requirement"),
                row("3.10", "A different source occurrence.", "Pump", "PDF p. 3", "continuation"));
        var product = SpecificationSheetContent.fromSourceRequirements(input).get(0);
        assertEquals(3, product.clauseCount());
        assertEquals("Power: 220-240V\nat 50 Hz; alarm required.", product.rows().get(0).wording());
        assertEquals("Include sensor.", product.rows().get(1).wording());
        assertEquals("A different source occurrence.", product.rows().get(2).wording());
        assertEquals("PDF p. 1; PDF p. 2", product.rows().get(0).sources());
    }
}
