package com.tenderpocket.services;

import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SpecificationProductLabelsTest {
    private String[] row(String product, String page) {
        return new String[]{"1", "Requirement retained unchanged", "", "", "", product, "-", page,
                "requirement", "", "", ""};
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
        List<String[]> result = org.springframework.test.util.ReflectionTestUtils.invokeMethod(
                new AISpecificationIntelligenceService(), "complianceRequirementsOnly",
                List.of(delivery, inspection, validity, unlabeled));
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
}
