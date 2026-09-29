package com.tenderpocket.services;

import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SpecificationTableCoverageTest {
    @Test void copiedParameterValuesDoNotNeedInventedFieldNamePrefixes() {
        String source = "[SOURCE_PAGE pdf=\"5\"]\nITEM SPECIFICATION\n"
                + "3 Delivery Period 60 Days from the Date of Issue of the Contract\n"
                + "5 FOR O. F. Varangaon\n6 Remark 1. Item to be supplied strictly as per specification.\n[/SOURCE_PAGE]";
        List<String[]> rows = new ArrayList<>();
        for (String wording : List.of("60 Days from the Date of Issue of the Contract", "O. F. Varangaon",
                "1. Item to be supplied strictly as per specification.")) {
            rows.add(new String[]{"", wording, "", "", "", "Pump", "-", "PDF p. 5",
                    "requirement", "", "", ""});
        }
        assertTrue(SpecificationTableCoverage.missing(rows, source).isEmpty());
    }

    @Test void imageRecoveryCarriesReferencesAndChecksButNotCorruptedOcrSentences() {
        String context = DocumentGeneratorService.imageTranscriptionContext(
                "[SOURCE_PAGE pdf=\"5\" printed=\"4\"]\nITEM SPECIFICATION\nOCR_ERROR_SENTENCE\n[/SOURCE_PAGE]",
                List.of("PDF p. 5: Delivery Period"));
        assertTrue(context.contains("[SOURCE_PAGE pdf=\"5\" printed=\"4\"]"));
        assertTrue(context.contains("PDF p. 5: Delivery Period"));
        assertTrue(context.contains("bottom rows"));
        assertFalse(context.contains("OCR_ERROR_SENTENCE"));
    }

    @Test void bareFieldLabelsAndMissingModelParametersAreNotCompleteRequirements() {
        String context = "[SOURCE_PAGE pdf=\"3\"]\nITEM SPECIFICATION\n"
                + "COMPRESSOR MODEL SZ148-4VAM, VOLTS 380-400, 50HZ, R134A, POE 160SZ\n"
                + "Offer Validity 180 days\nFOR Factory site\n[/SOURCE_PAGE]";
        var row = new String[]{"1", "COMPRESSOR MODEL SQ148-4VAM, 380-400, 50HZ", "", "", "",
                "Compressor", "-", "PDF p. 3", "requirement", "", "Item Description", ""};
        var field = row.clone(); field[1] = "FOR"; field[10] = "FOR";
        var missing = SpecificationTableCoverage.missing(List.of(row, field), context);
        assertTrue(missing.contains("PDF p. 3: FOR"));
        assertTrue(missing.stream().anyMatch(value -> value.contains("SZ148-4VAM")
                && value.contains("R134A") && value.contains("160SZ")));
        row[1] = "COMPRESSOR MODEL SZ148-4VAM, VOLTS 380-400, 50HZ, R134A, POE 160SZ";
        field[1] = "Factory site";
        assertTrue(SpecificationTableCoverage.missing(List.of(row, field), context).isEmpty());
    }

    @Test void onlyFieldsSeenInThatSourceTableAreRequested() {
        String context = "[SOURCE_PAGE pdf=\"5\"]\nITEM SPECIFICATION\nItem Description\n"
                + "3 Delivery Period: 60 days\n4 Inspection: at destination\n5 FOR: Sample site\n"
                + "6 Remark: comply with specification\n[/SOURCE_PAGE]";
        var row = new String[]{"1", "Pump", "", "", "", "Pump ZX10", "-", "PDF p. 5",
                "requirement", "", "ITEM DESCRIPTION", ""};
        assertTrue(SpecificationTableCoverage.hinted(Collections.singletonList(row)));
        assertEquals(List.of("PDF p. 5: Delivery Period", "PDF p. 5: Inspection",
                "PDF p. 5: FOR", "PDF p. 5: Remark"),
                SpecificationTableCoverage.missing(Collections.singletonList(row), context));
        row[10] = "Delivery Period";
        assertEquals(3, SpecificationTableCoverage.missing(Collections.singletonList(row), context).size());
        row[7] = "PDF p. 4";
        assertEquals(4, SpecificationTableCoverage.missing(Collections.singletonList(row), context).size(),
                "An identical requirement on another product page is not coverage");
        assertTrue(SpecificationTableCoverage.missing(List.of(),
                "[SOURCE_PAGE pdf=\"1\"]\nGeneral discussion of inspection.\n[/SOURCE_PAGE]").isEmpty());
    }
}
