package com.tenderpocket.utils;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.*;

class TenderClassifierTest {

    @Test
    @DisplayName("Host extraction correctly extracts canonical lowercase hostname and ignores query params")
    void testExtractHost() {
        assertEquals("eprocure.gov.in", TenderClassifier.extractHost("https://eprocure.gov.in/eprocure/app"));
        assertEquals("bidplus.gem.gov.in", TenderClassifier.extractHost("https://bidplus.gem.gov.in/showbidDocument/7570015"));
        assertEquals("tender247.com", TenderClassifier.extractHost("https://tender247.com/search?keyword=eprocure.gov.in"));
        assertEquals("eprocure.gov.in.attacker.com", TenderClassifier.extractHost("https://eprocure.gov.in.attacker.com/fake"));
        assertEquals("gem.gov.in", TenderClassifier.extractHost("gem.gov.in"));
        assertNull(TenderClassifier.extractHost(null));
        assertNull(TenderClassifier.extractHost(""));
        assertNull(TenderClassifier.extractHost("   "));
    }

    @Test
    @DisplayName("isOfficialGemDomain strictly validates host boundaries and rejects query substrings and deceptive hosts")
    void testIsOfficialGemDomainStrictValidation() {
        assertTrue(TenderClassifier.isOfficialGemDomain("https://gem.gov.in"));
        assertTrue(TenderClassifier.isOfficialGemDomain("https://bidplus.gem.gov.in/showbidDocument/123"));
        assertTrue(TenderClassifier.isOfficialGemDomain("gem.gov.in"));
        assertTrue(TenderClassifier.isOfficialGemDomain("bidplus.gem.gov.in"));

        // Negative: query substring on third-party aggregator
        assertFalse(TenderClassifier.isOfficialGemDomain("https://www.tender247.com/search?q=gem.gov.in"));
        assertFalse(TenderClassifier.isOfficialGemDomain("https://r.tenders.bidsnrfp.com/tr/cl/gem.gov.in"));

        // Negative: deceptive host
        assertFalse(TenderClassifier.isOfficialGemDomain("https://gem.gov.in.attacker.com"));
        assertFalse(TenderClassifier.isOfficialGemDomain("https://fake-gem.gov.in"));
        assertFalse(TenderClassifier.isOfficialGemDomain(null));
    }

    @Test
    @DisplayName("isVerifiedNonGemDomain strictly validates host boundaries and rejects query substrings and deceptive hosts")
    void testIsVerifiedNonGemDomainStrictValidation() {
        assertTrue(TenderClassifier.isVerifiedNonGemDomain("https://eprocure.gov.in/eprocure/app"));
        assertTrue(TenderClassifier.isVerifiedNonGemDomain("https://etenders.gov.in"));
        assertTrue(TenderClassifier.isVerifiedNonGemDomain("https://mahatenders.gov.in"));
        assertTrue(TenderClassifier.isVerifiedNonGemDomain("https://tenderwizard.com/users"));
        assertTrue(TenderClassifier.isVerifiedNonGemDomain("https://subdomain.eprocure.gov.in/app"));

        // GeM is excluded
        assertFalse(TenderClassifier.isVerifiedNonGemDomain("https://bidplus.gem.gov.in"));
        assertFalse(TenderClassifier.isVerifiedNonGemDomain("https://gem.gov.in"));

        // Negative: query substring on third-party aggregator
        assertFalse(TenderClassifier.isVerifiedNonGemDomain("https://www.tender247.com/search?keyword=eprocure.gov.in"));

        // Negative: deceptive host
        assertFalse(TenderClassifier.isVerifiedNonGemDomain("https://eprocure.gov.in.attacker.com"));
        assertFalse(TenderClassifier.isVerifiedNonGemDomain(null));
    }

    @ParameterizedTest
    @ValueSource(strings = {"N/A", "NA", "na", "n/a", "null", "NULL", "-", "--", "TBD", "None", "", "   "})
    @DisplayName("isPlaceholderRefNo detects all common placeholder reference values")
    void testPlaceholderRefNoDetection(String placeholder) {
        assertTrue(TenderClassifier.isPlaceholderRefNo(placeholder));
        assertFalse(TenderClassifier.isValidGemBidNumber(placeholder));
    }

    @Test
    @DisplayName("isPlaceholderRefNo returns false for genuine reference numbers")
    void testPlaceholderRefNoFalseForRealIds() {
        assertFalse(TenderClassifier.isPlaceholderRefNo("GEM/2026/B/7570015"));
        assertFalse(TenderClassifier.isPlaceholderRefNo("2024_IMSRP_810792_2"));
        assertFalse(TenderClassifier.isPlaceholderRefNo("T247-REF-001"));
    }

    @Test
    @DisplayName("1. A non-GeM official portal URL with an old GeM bid number in title is classified as Non GeM")
    void testNonGemPortalWithOldGemBidInTitle() {
        String title = "AMC for Diagnostic Ultrasound System procured under GEM/2024/B/1049281";
        String result = TenderClassifier.classify("", "https://eprocure.gov.in/eprocure/app", null, title);
        assertEquals("Non GeM", result, "A historical GeM bid number appearing only in a title must not override a verified non-GeM originating portal.");
    }

    @Test
    @DisplayName("2. A valid GeM bid number with no conflicting evidence is classified as GeM")
    void testValidGemBidNumberNoConflict() {
        assertEquals("GeM", TenderClassifier.classify("GEM/2026/B/7570015", "https://example.com", null, "Sample Title"));
        assertEquals("GeM", TenderClassifier.classify("GEM/2025/R/6859576", "https://example.com", null, "Reverse Auction Bid"));
        assertEquals("GeM", TenderClassifier.classify("GEM_2026_B_12345", "https://example.com", null, "Underscore Bid"));
    }

    @Test
    @DisplayName("3. An authoritative GeM URL and conflicting authoritative non-GeM evidence yields Unverified")
    void testAuthoritativeConflictYieldsUnverified() {
        // GeM portal URL in original_url, but non-GeM portal in nameof_website
        String res1 = TenderClassifier.classify("", "https://bidplus.gem.gov.in/showbidDocument/7570015", "https://eprocure.gov.in", "Hospital Equipment");
        assertEquals("Unverified", res1, "Conflicting authoritative portal evidence must yield Unverified");

        // GeM bid in refNo, but verified non-GeM URL in original_url
        String res2 = TenderClassifier.classify("GEM/2026/B/7570015", "https://eprocure.gov.in/eprocure/app", null, "Hospital Equipment");
        assertEquals("Unverified", res2, "Conflicting authoritative refNo and portal URL must yield Unverified");

        // GeM portal URL, but CPPP format refNo
        String res3 = TenderClassifier.classify("2024_IMSRP_810792_2", "https://bidplus.gem.gov.in/showbidDocument/7570015", null, "AIIMS Tender");
        assertEquals("Unverified", res3, "GeM portal with CPPP bid number must yield Unverified");
    }

    @Test
    @DisplayName("4. Unknown or insufficient evidence yields Unverified")
    void testInsufficientEvidenceYieldsUnverified() {
        assertEquals("Unverified", TenderClassifier.classify("", "https://r.tenders.bidsnrfp.com/tr/cl/xyz", null, "Operation and maintenance of HVAC system"));
        assertEquals("Unverified", TenderClassifier.classify(null, "https://www.tender247.com/auth/tender/100575724", "", "Generic Hospital Bed Supply"));
        assertEquals("Unverified", TenderClassifier.classify("N/A", null, null, null));
        assertEquals("Unverified", TenderClassifier.classify(null, null, null, null));
    }

    @Test
    @DisplayName("GeM bid number embedded in title when no portal conflict is classified as GeM")
    void testGemBidNumberInTitleWithoutConflict() {
        String title = "Corrigendum: Supply of Deep Freezer (GEM/2026/B/7439555) for hospital";
        assertEquals("GeM", TenderClassifier.classify("", "https://r.tenders.bidsnrfp.com/tr/cl/xyz", null, title));
        assertEquals("GEM/2026/B/7439555", TenderClassifier.extractGemBidNumber(title));
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
