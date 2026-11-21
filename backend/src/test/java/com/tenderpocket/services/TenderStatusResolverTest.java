package com.tenderpocket.services;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TenderStatusResolverTest {

    private static final String TODAY = "2026-11-19";

    private static String status(String stored, String dueDate) {
        return TenderStatusResolver.resolve(stored, dueDate, "2026-11-01T10:00:00", null, null, "executive", TODAY);
    }

    @Test
    void isoDueDatesWorkAsBefore() {
        assertEquals("Missed Deadline", status("Participating", "2026-11-18 17:00:00"));
        assertEquals("Participating", status("Participating", "2026-11-19 17:00:00")); // due today
        assertEquals("Participating", status("Participating", "2026-12-13T17:00:00"));
        assertEquals("Missed Opportunity", status("Not Participating", "2026-11-01"));
    }

    @Test
    void dueDatesInOtherShapesAreReadAsDates() {
        assertEquals("Participating", status("Participating", "13 Dec 2026"));   // was Missed Deadline
        assertEquals("Missed Deadline", status("Participating", "25 Oct 2026")); // was Participating
        assertEquals("Missed Deadline", status("Participating", "18 Nov 2026"));
        assertEquals("Participating", status("Participating", "19 Nov 2026"));  // due today
        assertEquals("Participating", status("Participating", "13-12-2026"));
        assertEquals("Missed Deadline", status("Participating", "05-11-2026"));
        assertEquals("Participating", status("Participating", "Sun Dec 13 17:00:00 IST 2026"));
    }

    @Test
    void unreadableDueDatesKeepTheOldComparison() {
        assertEquals("Participating", status("Participating", "next week"));
    }
}
