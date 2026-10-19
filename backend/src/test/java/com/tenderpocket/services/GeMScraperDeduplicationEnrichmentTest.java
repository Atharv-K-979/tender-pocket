package com.tenderpocket.services;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.lang.reflect.Method;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class GeMScraperDeduplicationEnrichmentTest {

    @Mock
    private TenderRepository tenderRepository;

    @InjectMocks
    private GeMScraperService geMScraperService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(geMScraperService, "tenderRepository", tenderRepository);
        ReflectionTestUtils.setField(geMScraperService, "uploadDir", "target/test-documents");
    }

    @Test
    @DisplayName("Existing tender from Tender247 with provisional Non GeM is enriched with authoritative GeM classification by GeM scraper")
    void testExistingTenderEnrichedByGeMScraper() throws Exception {
        // Pre-existing tender created by Tender247 email
        Tender existing = new Tender();
        existing.setId("100575724");
        existing.setRefNo("GEM/2026/B/7570015");
        existing.setSourceId("100575724");
        existing.setSource("Tender247");
        existing.setTenderType("Non GeM"); // Incorrect classification from earlier
        existing.setCurrentStage("NEW");
        existing.setStatus("Issued");
        existing.setOriginalUrl("https://www.tender247.com/auth/tender/100575724");
        existing.setDocumentUrl("existing/doc.pdf"); // already has doc

        ObjectNode docNode = objectMapper.createObjectNode();
        docNode.put("b_id", "7458129");
        docNode.put("b_bid_number", "GEM/2026/B/7570015");
        docNode.put("b_category_name", "HVAC Maintenance");
        docNode.put("ba_official_details_deptName", "AIIMS Raipur");
        docNode.put("b_total_quantity", "1");
        docNode.put("final_start_date_sort", "2026-05-21T10:00:00");
        docNode.put("final_end_date_sort", "2026-06-12T15:00:00");

        Method enrichMethod = GeMScraperService.class.getDeclaredMethod("enrichExistingRecordFromGeM",
                Tender.class, String.class, String.class, String.class, com.fasterxml.jackson.databind.JsonNode.class);
        enrichMethod.setAccessible(true);

        enrichMethod.invoke(geMScraperService, existing, "GEM/2026/B/7570015", "GEM/2026/B/7570015",
                "https://bidplus.gem.gov.in/showbidDocument/7458129", docNode);

        // Assert tender identity and stage preserved
        assertEquals("100575724", existing.getId());
        assertEquals("NEW", existing.getCurrentStage());
        assertEquals("Issued", existing.getStatus());

        // Assert authoritative GeM classification and official GeM URL updated
        assertEquals("GeM", existing.getTenderType());
        assertEquals("GEM/2026/B/7570015", existing.getRefNo());
        assertEquals("https://bidplus.gem.gov.in/showbidDocument/7458129", existing.getOriginalUrl());
        assertEquals("AIIMS Raipur", existing.getAuthority());
        assertEquals("2026-05-21", existing.getPublishDate());
    }

    @Test
    @DisplayName("isLegitimateGeMMatch rejects coincidental numeric ID collision from Tender247 namespace")
    void testIsLegitimateGeMMatchRejectsIdCollisionFromT247() throws Exception {
        Tender existingT247 = new Tender();
        existingT247.setId("7458129"); // Coincidentally same numeric ID
        existingT247.setSource("Tender247");
        existingT247.setRefNo("T247-REF-XYZ");

        Method matchMethod = GeMScraperService.class.getDeclaredMethod("isLegitimateGeMMatch",
                Tender.class, String.class, String.class);
        matchMethod.setAccessible(true);

        // When GeM scraper encounters b_id = 7458129 for bid GEM/2026/B/9999999
        boolean isMatch = (boolean) matchMethod.invoke(geMScraperService, existingT247, "7458129", "GEM/2026/B/9999999");
        assertFalse(isMatch, "GeM scraper must never match an unrelated Tender247 tender merely because numeric IDs are equal");
    }

    @Test
    @DisplayName("isLegitimateGeMMatch accepts cross-source match when official GeM bid number matches")
    void testIsLegitimateGeMMatchAcceptsMatchingBidNo() throws Exception {
        Tender existingT247 = new Tender();
        existingT247.setId("100575724");
        existingT247.setSource("Tender247");
        existingT247.setRefNo("GEM/2026/B/7570015");

        Method matchMethod = GeMScraperService.class.getDeclaredMethod("isLegitimateGeMMatch",
                Tender.class, String.class, String.class);
        matchMethod.setAccessible(true);

        boolean isMatch = (boolean) matchMethod.invoke(geMScraperService, existingT247, "7458129", "GEM/2026/B/7570015");
        assertTrue(isMatch, "Should accept cross-source match when official GeM bid number matches reliably");
    }

    @Test
    @DisplayName("isLegitimateGeMMatch accepts existing GeM record with same GeM bId")
    void testIsLegitimateGeMMatchAcceptsSameGeMNamespaceId() throws Exception {
        Tender existingGeM = new Tender();
        existingGeM.setId("7458129");
        existingGeM.setSource("GeM");
        existingGeM.setRefNo("GEM/2026/B/7570015");

        Method matchMethod = GeMScraperService.class.getDeclaredMethod("isLegitimateGeMMatch",
                Tender.class, String.class, String.class);
        matchMethod.setAccessible(true);

        boolean isMatch = (boolean) matchMethod.invoke(geMScraperService, existingGeM, "7458129", "GEM/2026/B/7570015");
        assertTrue(isMatch, "Should accept existing GeM tender within same GeM source namespace");
    }

    @Test
    @DisplayName("Placeholder reference number (N/A) does not overwrite existing valid refNo in GeM enrichment")
    void testPlaceholderRefNoDoesNotOverwriteValidRefNoInGeM() throws Exception {
        Tender existing = new Tender();
        existing.setId("100575724");
        existing.setRefNo("GEM/2026/B/7570015");

        ObjectNode docNode = objectMapper.createObjectNode();
        docNode.put("b_id", "7458129");
        docNode.put("b_bid_number", "N/A");

        Method enrichMethod = GeMScraperService.class.getDeclaredMethod("enrichExistingRecordFromGeM",
                Tender.class, String.class, String.class, String.class, com.fasterxml.jackson.databind.JsonNode.class);
        enrichMethod.setAccessible(true);

        enrichMethod.invoke(geMScraperService, existing, "N/A", "N/A", "https://bidplus.gem.gov.in/showbidDocument/7458129", docNode);

        assertEquals("GEM/2026/B/7570015", existing.getRefNo(), "Placeholder N/A must not overwrite existing official refNo");
    }

    @Test
    @DisplayName("Numeric ID collision does not cause PDF metadata to be written to unrelated Tender247 record")
    void testNumericIdCollisionDoesNotTargetUnrelatedRecordForPdf() throws Exception {
        // Unrelated Tender247 record with ID "7458129"
        Tender existingT247 = new Tender();
        existingT247.setId("7458129");
        existingT247.setSource("Tender247");
        existingT247.setRefNo("T247-REF-XYZ");
        existingT247.setDocumentUrl(null);

        // New GeM record with collision-prefixed ID "gem-7458129"
        Tender newGeM = new Tender();
        newGeM.setId("gem-7458129");
        newGeM.setSource("GeM");
        newGeM.setRefNo("GEM/2026/B/9999999");
        newGeM.setDocumentUrl(null);

        when(tenderRepository.findById("gem-7458129")).thenReturn(Optional.of(newGeM));

        // Mock RestTemplate so downloadFile returns mock PDF bytes
        org.springframework.web.client.RestTemplate mockRest = mock(org.springframework.web.client.RestTemplate.class);
        when(mockRest.getForObject(anyString(), eq(byte[].class))).thenReturn("%PDF-1.4 mock pdf".getBytes());
        ReflectionTestUtils.setField(geMScraperService, "restTemplate", mockRest);

        ObjectNode docNode = objectMapper.createObjectNode();
        docNode.put("b_id", "7458129");

        Method pdfMethod = GeMScraperService.class.getDeclaredMethod("downloadAndParseGemPdf",
                String.class, String.class, String.class, com.fasterxml.jackson.databind.JsonNode.class);
        pdfMethod.setAccessible(true);

        // Invoke downloadAndParseGemPdf with the collision-prefixed ID "gem-7458129"
        pdfMethod.invoke(geMScraperService, "gem-7458129", "https://bidplus.gem.gov.in/showbidDocument/7458129", "GEM/2026/B/9999999", docNode);

        // Verify that findById was called for "gem-7458129", NOT "7458129"
        verify(tenderRepository, atLeastOnce()).findById("gem-7458129");
        verify(tenderRepository, never()).findById("7458129");

        // Verify newGeM has documentUrl updated while existingT247 is untouched
        assertEquals("/documents/gem-7458129/Bid_Document_gem-7458129.pdf", newGeM.getDocumentUrl());
        assertNull(existingT247.getDocumentUrl(), "Unrelated Tender247 record must remain untouched");
    }
}
