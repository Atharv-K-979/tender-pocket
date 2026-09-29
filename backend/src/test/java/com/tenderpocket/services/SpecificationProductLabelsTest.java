package com.tenderpocket.services;

import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SpecificationProductLabelsTest {
    @Test void sourceModelHintsRequireExplicitCompleteAlphanumericModelFields() {
        String source = "REFRIGERATION COMPRESSOR, MODEL NO:- MT64HM4DVE, VOLTS:- 380-400 V\n"
                + "MODEL:- KCE 444 HAG , CAPACITY 3/8 HP\n"
                + "MODEL NO:- $Z148-4V AM, VOLTS 380-400\n"
                + "MODEL NO:- SZ148-4V AM, VOLTS 380-400\n"
                + "MODEL No.: QV 295P\nMODEL NO:- QV295P, 220V\n"
                + "MODEL NAME: Pump\nSKU: ABC100";
        assertEquals(List.of("MT64HM4DVE", "KCE444HAG", "SZ148-4VAM", "QV295P"),
                SpecificationProductLabels.sourceModelCodes(source));
        assertEquals(List.of("MT64HM4DVE"), SpecificationProductLabels.sourceModelCodes(
                "MODEL NO:-\nITEM MT64HM4DVE VOLTS:- 380-400V"));
    }

    private String[] row(String product, String page) {
        return new String[]{"1", "Requirement retained unchanged", "", "", "", product, "-", page,
                "requirement", "", "", ""};
    }

    @Test void modelCodesGetTheirOwnSourceProductNameAcrossAllRows() {
        var first = row("MT64HM4DVE", "PDF p. 1");
        first[1] = "REFRIGERATION COMPRESSOR MODEL NO.: MT64HM4DVE VOLTS:- 380-400V, 50HZ";
        var delivery = row("MT64HM4DVE - Delivery Period", "PDF p. 2");
        var second = row("SZ148-4VAM", "PDF p. 3");
        second[1] = "REFRIGERATION COMPRESSOR, MODEL NO:- SZ148-4VAM, VOLTS: 380-400";
        var result = SpecificationProductLabels.normalize(List.of(first, delivery, second));
        assertEquals(List.of("REFRIGERATION COMPRESSOR - MT64HM4DVE",
                "REFRIGERATION COMPRESSOR - MT64HM4DVE", "REFRIGERATION COMPRESSOR - SZ148-4VAM"),
                result.stream().map(row -> row[5]).toList());
        assertEquals(first[1], result.get(0)[1]);
        assertEquals("MT64HM4DVE", first[5]);
        assertEquals("PDF p. 2", result.get(1)[7]);
    }

    @Test void sourceModelMatchingToleratesSpacingButNotDifferentModelsOrAmbiguousNames() {
        assertEquals("Refrigeration Compressor - QV295P", SpecificationProductLabels.displayName("QV295P",
                List.of("Refrigeration Compressor, Model No: QV 295P, 220/240 V")));
        assertEquals("Pump - KCE 444 HAG", SpecificationProductLabels.displayName("KCE 444 HAG",
                List.of("Pump MODEL: KCE444HAG, 50 Hz")));
        assertEquals("REFRIGERATION COMPRESSOR - KCE444HAG", SpecificationProductLabels.displayName("KCE444HAG",
                List.of("REFRIGERATION COMPRESSOR TYPE:- HERMETICALLY SEALED MODEL:- KCE 444 HAG, 50 Hz")));
        assertEquals("REFRIGERATION COMPRESSOR - SZ148-4VAM", SpecificationProductLabels.displayName("SZ148-4VAM",
                List.of("ITEM DESCRIPTION: REFRIGERATION COMPRESSOR MODEL SZ148-4VAM, 50 Hz")));
        for (String wrongModel : List.of("ZX100", "ZX10-2", "ZX10.5", "ZX10/20", "ZX10A")) {
            assertEquals("ZX10", SpecificationProductLabels.displayName("ZX10",
                    List.of("Pump MODEL NO: " + wrongModel + ", 230V")));
        }
        assertEquals("ZX10", SpecificationProductLabels.displayName("ZX10",
                List.of("Pump MODEL ZX10, 230V", "Motor MODEL ZX10, 230V")));
        assertEquals("ZX10", SpecificationProductLabels.displayName("ZX10", List.of("Capacity 100 litres")));
        assertEquals("Pump ZX10", SpecificationProductLabels.displayName("Pump ZX10",
                List.of("Pump MODEL ZX10, 230V")));
        assertEquals("ZX10", SpecificationProductLabels.displayName("ZX10",
                List.of("ITEM DESCRIPTION MODEL ZX10, 230V")));
    }

    @Test void sectionsStayWithTheirModelWithoutChangingRequirementsOrProvenance() {
        List<String[]> input = List.of(
                row("Compressor (ZX10)", "PDF p. 2"),
                row("Compressor (ZX10) - Delivery Period", "PDF p. 2"),
                row("Compressor (ZX10) - (Page 2 entry)", "PDF p. 2"),
                row("Compressor (Model Y 20)", "PDF p. 3"),
                row("Compressor (Inspection)", "PDF p. 3"),
                row("Compressor (Y20) - Remark", "PDF p. 3"));
        var result = SpecificationProductLabels.normalize(input);
        assertEquals(List.of("Compressor (ZX10)", "Compressor (ZX10)", "Compressor (ZX10)",
                "Compressor (Model Y 20)", "Compressor (Model Y 20)", "Compressor (Model Y 20)"),
                result.stream().map(row -> row[5]).toList());
        for (int i = 0; i < result.size(); i++) {
            assertEquals(input.get(i)[1], result.get(i)[1]);
            assertEquals(input.get(i)[7], result.get(i)[7]);
        }
        assertEquals("Compressor (Inspection)", input.get(4)[5]);
    }

    @Test void ambiguousSamePageModelsAndDifferentRatingsAreNeverCollapsed() {
        List<String[]> input = List.of(row("Pump (1.5 HP)", "PDF p. 1"),
                row("Pump (15 HP)", "PDF p. 1"), row("Pump (Inspection)", "PDF p. 1"),
                row("Pump (100-280V)", "PDF p. 2"), row("Pump (100280V)", "PDF p. 2"),
                row("Pump (Inspection)", "PDF p. 9"), row("Pump (ZX1)", "PDF p. 4"),
                row("Pump (ZX10)", "PDF p. 4"));
        var result = SpecificationProductLabels.normalize(input);
        assertEquals("Pump", result.get(2)[5]);
        assertEquals("Pump", result.get(5)[5]);
        for (int i : new int[]{0, 1, 3, 4, 6, 7}) assertEquals(input.get(i)[5], result.get(i)[5]);
    }

    @Test void offerValidityIsExcludedButProductDeliveryAndInspectionRemain() {
        var delivery = row("Pump (ZX10) - Delivery Period", "PDF p. 2");
        var inspection = row("Pump (ZX10) - Inspection", "PDF p. 2");
        var validity = row("Pump (ZX10) - Offer Validity", "PDF p. 2");
        var unlabeled = row("Pump ZX10", "PDF p. 2");
        unlabeled[1] = "ZX10: Offer Validity 180 Days from Bid Submission End Date";
        var bareValue = row("Pump ZX10", "PDF p. 2");
        bareValue[1] = "180 Days from Bid Submission End Date";
        List<String[]> result = org.springframework.test.util.ReflectionTestUtils.invokeMethod(
                new AISpecificationIntelligenceService(), "complianceRequirementsOnly",
                List.of(delivery, inspection, validity, unlabeled, bareValue));
        assertNotNull(result);
        assertEquals(List.of(delivery[5], inspection[5]), result.stream().map(row -> row[5]).toList());
    }

    @Test void genericItemDescriptionCanUseOnlyTheUniqueModelOnItsPage() {
        var input = List.of(row("Compressor Model ZX10", "PDF p. 2"),
                row("ITEM DESCRIPTION", "PDF p. 2"), row("Compressor Model Y20", "PDF p. 3"),
                row("ITEM DESCRIPTION", "PDF p. 1"));
        var result = SpecificationProductLabels.normalize(input);
        assertEquals("Compressor Model ZX10", result.get(1)[5]);
        assertEquals("ITEM DESCRIPTION", result.get(3)[5], "No page evidence means no guessed model");
    }

    @Test void portalReportIdsAndAdministrativeUndertakingsDoNotBecomeProductRequirements() {
        var report = row("Pump", "PDF p. 1"); report[1] = "GEM/GARPTS/1234 report identifier";
        var form = row("Pump", "PDF p. 1");
        form[1] = "5.0) Undertaking:\nI understand that the creation of a custom bid/BoQ is an exceptional process.";
        var requirement = row("Pump", "PDF p. 1");
        requirement[1] = "A test report shall document the specified operating temperature.";
        List<String[]> result = org.springframework.test.util.ReflectionTestUtils.invokeMethod(
                new AISpecificationIntelligenceService(), "complianceRequirementsOnly", List.of(report, form, requirement));
        assertEquals(1, result.size());
        assertEquals(requirement[1], result.get(0)[1]);
    }

    @Test void standaloneTableFieldLabelsFollowTheOnlyModelOnTheirOwnPage() {
        var input = List.of(row("Compressor Model ZX10", "PDF p. 2"),
                row("Delivery Period", "PDF p. 2"), row("Inspection", "PDF p. 2"),
                row("Compressor Model Y20", "PDF p. 3"), row("FOR", "PDF p. 3"),
                row("Remark", "PDF p. 2; PDF p. 3"));
        var result = SpecificationProductLabels.normalize(input);
        assertEquals("Compressor Model ZX10", result.get(1)[5]);
        assertEquals("Compressor Model ZX10", result.get(2)[5]);
        assertEquals("Compressor Model Y20", result.get(4)[5]);
        assertEquals("Remark", result.get(5)[5], "Never guess for an ambiguous shared page reference");
    }

    @Test void codeOnlyLabelUsesAnUnambiguousNamedVersionOfTheSameModel() {
        var rows = SpecificationProductLabels.normalize(List.of(
                row("Refrigeration Compressor KCE 444 HAG", "PDF p. 1"),
                row("KCE444HAG", "PDF p. 5"),
                row("Motor ZX100", "PDF p. 6"),
                row("ZX10", "PDF p. 6")));
        assertEquals("Refrigeration Compressor KCE 444 HAG", rows.get(1)[5]);
        assertEquals("ZX10", rows.get(3)[5]);
    }

    @Test void explicitItemDescriptionCorrectsAMisfiledModelWithoutRewritingRequirements() {
        var first = row("Compressor ZX10", "PDF p. 1");
        first[1] = "Compressor MODEL NO: ZX10, 230V";
        var misfiled = row("ZX10", "PDF p. 1");
        misfiled[1] = "Compressor MODEL NO: Y20, 400V";
        var delivery = row("Compressor Y20 - Delivery Period", "PDF p. 2");
        var accessory = row("Accessory A5", "PDF p. 3");
        accessory[1] = "Compatible with compressor MODEL Y20, 400V";
        var result = SpecificationProductLabels.normalize(List.of(first, misfiled, delivery, accessory));
        assertEquals("Compressor - Y20", result.get(1)[5]);
        assertEquals("Compressor - Y20", result.get(2)[5]);
        assertEquals(misfiled[1], result.get(1)[1]);
        assertEquals("Accessory A5", result.get(3)[5]);
    }
}
