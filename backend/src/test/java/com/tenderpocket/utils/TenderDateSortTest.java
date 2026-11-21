package com.tenderpocket.utils;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class TenderDateSortTest {

    @Test
    void readsEveryStoredDateShape() {
        long iso = TenderDateSort.key("2026-11-18 12:39:00");
        assertEquals(iso, TenderDateSort.key("2026-11-18T12:39:00"));
        assertEquals(iso, TenderDateSort.key("Wed Nov 18 12:39:00 IST 2026"));
        assertEquals(iso, TenderDateSort.key("2026-11-18T07:09:00Z"));
        assertEquals(iso, TenderDateSort.key("2026-11-18T12:39:00+05:30"));
        assertEquals(iso, TenderDateSort.key("Wed Nov 18 07:09:00 GMT 2026"));

        long day = TenderDateSort.key("2026-10-08");
        assertEquals(day, TenderDateSort.key("8 Oct 2026"));
        assertEquals(day, TenderDateSort.key("08-10-2026"));
        assertEquals(day, TenderDateSort.key("08/10/2026"));
        assertEquals(day, TenderDateSort.key("8 October 2026"));
    }

    @Test
    void ordersByRealTimeNotByText() {
        // As text, "Wed ..." sorts after "Sun ..." and after every ISO date.
        assertTrue(TenderDateSort.key("Sun Nov 22 09:00:00 IST 2026") > TenderDateSort.key("Wed Nov 18 09:00:00 IST 2026"));
        assertTrue(TenderDateSort.key("2026-11-19") > TenderDateSort.key("Wed Nov 18 09:00:00 IST 2026"));
        assertTrue(TenderDateSort.key("2026-11-18 10:00:00") > TenderDateSort.key("2026-11-18 09:59:59"));
    }

    @Test
    void unknownValuesSortFirst() {
        assertEquals(TenderDateSort.UNKNOWN, TenderDateSort.key(null));
        assertEquals(TenderDateSort.UNKNOWN, TenderDateSort.key(""));
        assertEquals(TenderDateSort.UNKNOWN, TenderDateSort.key("N/A"));
        assertEquals(TenderDateSort.UNKNOWN, TenderDateSort.key("soon"));
        assertEquals(TenderDateSort.UNKNOWN, TenderDateSort.key("2026-02-31"));
        assertTrue(TenderDateSort.key("2000-01-01") > TenderDateSort.UNKNOWN);
    }
}
