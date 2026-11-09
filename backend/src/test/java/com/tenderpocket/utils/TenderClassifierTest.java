package com.tenderpocket.utils;

import com.tenderpocket.models.Tender;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.*;

class TenderClassifierTest {

    @ParameterizedTest
    @ValueSource(strings = {
            "GEM/2026/B/7570015",
            "GEM/2025/R/6859576",
            "GEM_2026_B_12345",
            "gem/2026/b/7570015",
            "GeM Bid 7570015",
            "Ref: GEM/2026/B/8260101 (corrigendum)",
            "GEM"
    })
    @DisplayName("Organization Tender ID containing the word GEM is GeM")
    void testRefNoWithGemIsGem(String refNo) {
        assertEquals("GeM", TenderClassifier.classify(refNo));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {
            "   ",
            "N/A",
            "2026_AIIMS_812345_1",
            "KMSCL/2026/EQP/0193",
            "TNMSC/EQ/2026-27/045",
            "MANAGEMENT/2026/01",
            "GEMINI-2026-77"
    })
    @DisplayName("Missing Organization Tender ID, or one without the word GEM, is Non GeM")
    void testRefNoWithoutGemIsNonGem(String refNo) {
        assertEquals("Non GeM", TenderClassifier.classify(refNo));
    }

    @Test
    @DisplayName("Tender type follows ref_no only; T247 ID, links and title play no part")
    void testTenderTypeFollowsRefNoOnly() {
        // Both IDs present and ref_no has GEM -> GeM
        Tender both = new Tender();
        both.setSourceId("48213309");
        both.setOriginalUrl("https://www.tender247.com/tender/48213309");
        both.setRefNo("GEM/2026/B/8260101");
        assertEquals("GeM", both.getTenderType());

        // ref_no empty, T247 ID present, GeM link and GeM number in title -> still Non GeM
        Tender t247Only = new Tender();
        t247Only.setSourceId("48213301");
        t247Only.setOriginalUrl("https://bidplus.gem.gov.in/showbidDocument/123");
        t247Only.setTitle("Supply of beds (GEM/2026/B/7439555)");
        t247Only.setRefNo(null);
        assertEquals("Non GeM", t247Only.getTenderType());
    }

    @Test
    @DisplayName("A tender type set by hand is replaced from ref_no before the tender is saved")
    void testManualTenderTypeIsReplacedOnSave() {
        Tender t = new Tender();
        t.setRefNo("2026_AIIMS_812345_1");
        t.setTenderType("GeM");
        t.applyTenderType(); // runs on @PrePersist / @PreUpdate
        assertEquals("Non GeM", t.getTenderType());

        t.setTenderType("Unverified");
        t.setRefNo("GEM/2026/B/8260101");
        t.applyTenderType();
        assertEquals("GeM", t.getTenderType());
    }

    @ParameterizedTest
    @ValueSource(strings = {"N/A", "NA", "null", "-", "--", "TBD", "None", "", "   "})
    @DisplayName("Placeholder ref numbers are recognised")
    void testPlaceholderRefNos(String placeholder) {
        assertTrue(TenderClassifier.isPlaceholderRefNo(placeholder));
        assertFalse(TenderClassifier.isValidGemBidNumber(placeholder));
    }

    @Test
    @DisplayName("Real ref numbers are not placeholders")
    void testRealRefNosAreNotPlaceholders() {
        assertFalse(TenderClassifier.isPlaceholderRefNo("GEM/2026/B/7570015"));
        assertFalse(TenderClassifier.isPlaceholderRefNo("2024_IMSRP_810792_2"));
        assertFalse(TenderClassifier.isPlaceholderRefNo("T247-REF-001"));
    }

    @Test
    @DisplayName("GeM bid number is extracted from text")
    void testExtractGemBidNumber() {
        String title = "Corrigendum: Supply of Deep Freezer (GEM/2026/B/7439555) for hospital";
        assertEquals("GEM/2026/B/7439555", TenderClassifier.extractGemBidNumber(title));
        assertEquals("GEM/2026/B/12345", TenderClassifier.extractGemBidNumber("GEM_2026_B_12345"));
        assertNull(TenderClassifier.extractGemBidNumber("No bid number here", null));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "GEM/2026/B/7570015",
            "gem/2026/b/7570015",
            "GEM/2025/R/123456",
            "GEM_2026_B_99999"
    })
    @DisplayName("Recognizes valid GeM bid number formats")
    void testRecognizesValidGemBidFormats(String bid) {
        assertTrue(TenderClassifier.isValidGemBidNumber(bid));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "GEM",
            "GEM123",
            "T247 ID: 100575724",
            "2024_IMSRP_810792_2",
            "",
            "   ",
            "N/A",
            "null"
    })
    @DisplayName("Rejects non-GeM or placeholder bid numbers")
    void testRejectsInvalidGemBidFormats(String bid) {
        assertFalse(TenderClassifier.isValidGemBidNumber(bid));
    }
}
