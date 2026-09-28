package com.tenderpocket.services;

import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SpecificationTableCoverageTest {
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
