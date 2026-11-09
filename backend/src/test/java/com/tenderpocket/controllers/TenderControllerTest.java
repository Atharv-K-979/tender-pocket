package com.tenderpocket.controllers;

import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import com.tenderpocket.config.WorkflowPermissions;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

public class TenderControllerTest {

    @Mock
    private TenderRepository tenderRepository;

    @Mock
    private com.tenderpocket.repositories.ActivityLogRepository activityLogRepository;

    @Mock
    private com.tenderpocket.repositories.StatusHistoryRepository statusHistoryRepository;

    @Mock
    private com.tenderpocket.repositories.TenderApprovalRepository approvalRepository;

    @InjectMocks
    private TenderController tenderController;

    private Tender tender1;
    private Tender tender2;
    private Tender tender3;
    private Tender tender4;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        SecurityContextHolder.clearContext();

        tender1 = new Tender();
        tender1.setId("T1");
        tender1.setRefNo("REF1");
        tender1.setTitle("Tender One");
        tender1.setAuthority("Authority A");
        tender1.setEstimatedCost(100000.0);
        tender1.setEstimatedCostRaw("100000");
        tender1.setMisExecutive("exec1");
        tender1.setAssignedMisMemberSpec("spec1");
        tender1.setCurrentStage("SPEC_CLEARANCE");
        tender1.setScrapedAt("2026-10-01T10:00:00Z");
        tender1.setDueDate("2026-10-10 17:00:00");
        tender1.setTpcPurchasePrice(50000.0);

        tender2 = new Tender();
        tender2.setId("T2");
        tender2.setRefNo("REF2");
        tender2.setTitle("Tender Two");
        tender2.setAuthority("Authority B");
        tender2.setEstimatedCost(500000.0);
        tender2.setEstimatedCostRaw("500000");
        tender2.setMisExecutive("exec2");
        tender2.setAssignedMisMemberSpec("spec2");
        tender2.setCurrentStage("TPC_PRICING");
        tender2.setScrapedAt("2026-10-02T10:00:00Z");
        tender2.setDueDate("2026-10-15 17:00:00");
        tender2.setTpcPurchasePrice(0.0);

        tender3 = new Tender();
        tender3.setId("T3");
        tender3.setRefNo("REF3");
        tender3.setTitle("Tender Three");
        tender3.setAuthority("Authority C");
        tender3.setEstimatedCost(200000.0);
        tender3.setEstimatedCostRaw("200000");
        tender3.setMisExecutive(null);
        tender3.setAssignedMisMemberSpec(null);
        tender3.setCurrentStage("NEW");
        tender3.setScrapedAt("2026-09-30T10:00:00Z");
        tender3.setDueDate("2026-10-02 17:00:00");
        tender3.setTpcPurchasePrice(null);

        tender4 = new Tender();
        tender4.setId("T4");
        tender4.setRefNo("REF4");
        tender4.setTitle("Tender Four");
        tender4.setAuthority("Authority D");
        tender4.setEstimatedCost(300000.0);
        tender4.setEstimatedCostRaw("300000");
        tender4.setMisExecutive(null);
        tender4.setAssignedMisMemberSpec(null);
        tender4.setCurrentStage("REJECTED_TPC");
        tender4.setStatus("Rejected");
        tender4.setScrapedAt("2026-10-03T10:00:00Z");
        tender4.setDueDate("2026-10-20 17:00:00");
        tender4.setTpcPurchasePrice(0.0);

        when(tenderRepository.findAll()).thenReturn(List.of(tender1, tender2, tender3, tender4));
        when(tenderRepository.findByMisExecutive("exec1")).thenReturn(List.of(tender1));
        when(tenderRepository.findByMisExecutive("exec2")).thenReturn(List.of(tender2));
        when(tenderRepository.findById("T1")).thenReturn(Optional.of(tender1));
        when(tenderRepository.findById("T2")).thenReturn(Optional.of(tender2));
        when(tenderRepository.findById("T3")).thenReturn(Optional.of(tender3));
        when(tenderRepository.findById("T4")).thenReturn(Optional.of(tender4));
    }

    private void authenticate(String username, String role) {
        SimpleGrantedAuthority authority = new SimpleGrantedAuthority("ROLE_" + role.toUpperCase().replace(" ", "_"));
        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                username, null, Collections.singletonList(authority));
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    @Test
    void testAdminSeesAllTenders() {
        authenticate("admin", "Admin");

        ResponseEntity<?> response = tenderController.getTenders("Admin", "admin", null, null, null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) body.get("success"));
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(4, tenders.size());
    }

    @Test
    void testMisExecutiveSeesOnlyAssignedTenders() {
        authenticate("exec1", "MIS Executive");

        ResponseEntity<?> response = tenderController.getTenders("MIS Executive", "exec1", null, null, null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(1, tenders.size());
        assertEquals("T1", tenders.get(0).getId());
    }

    @Test
    void testTenderExecutiveSeesOnlyAssignedTenders() {
        authenticate("exec2", "Tender Executive");

        ResponseEntity<?> response = tenderController.getTenders("Tender Executive", "exec2", null, null, null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(1, tenders.size());
        assertEquals("T2", tenders.get(0).getId());
    }

    @Test
    void testClearanceTeamVisibility() {
        authenticate("spec1", "Clearance Team");

        ResponseEntity<?> response = tenderController.getTenders("Clearance Team", "spec1", null, null, null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(1, tenders.size());
        assertEquals("T1", tenders.get(0).getId());
    }

    @Test
    void testTpcVisibility() {
        authenticate("tpc_user", "TPC Pricing Team");

        ResponseEntity<?> response = tenderController.getTenders("TPC Pricing Team", "tpc_user", null, null, null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        // T1 (tpcPurchasePrice > 0), T2 (stage TPC_PRICING), T4 (stage REJECTED_TPC, purchasePrice 0 but stage REJECTED_TPC/Rejected)
        assertEquals(3, tenders.size());
    }

    @Test
    void testTpcStatusFiltering_Pending() {
        authenticate("tpc_user", "TPC Pricing Team");

        ResponseEntity<?> response = tenderController.getTenders("TPC Pricing Team", "tpc_user", null, "Pending", null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(1, tenders.size());
        assertEquals("T2", tenders.get(0).getId());
    }

    @Test
    void testTpcStatusFiltering_Approved() {
        authenticate("tpc_user", "TPC Pricing Team");

        ResponseEntity<?> response = tenderController.getTenders("TPC Pricing Team", "tpc_user", null, "Approved", null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(1, tenders.size());
        assertEquals("T1", tenders.get(0).getId());
    }

    @Test
    void testTpcStatusFiltering_Rejected() {
        authenticate("tpc_user", "TPC Pricing Team");

        ResponseEntity<?> response = tenderController.getTenders("TPC Pricing Team", "tpc_user", null, "Rejected", null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(1, tenders.size());
        assertEquals("T4", tenders.get(0).getId());
    }

    @Test
    void testMinMaxCostFiltering() {
        authenticate("admin", "Admin");

        ResponseEntity<?> response = tenderController.getTenders("Admin", "admin", null, null, null, null, null, 150000.0, 300000.0, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(2, tenders.size());
        assertTrue(tenders.stream().anyMatch(t -> "T3".equals(t.getId())));
        assertTrue(tenders.stream().anyMatch(t -> "T4".equals(t.getId())));
    }

    @Test
    void testMinCostOnlyFiltering() {
        authenticate("admin", "Admin");

        ResponseEntity<?> response = tenderController.getTenders("Admin", "admin", null, null, null, null, null, 250000.0, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(2, tenders.size());
        assertTrue(tenders.stream().anyMatch(t -> "T2".equals(t.getId())));
        assertTrue(tenders.stream().anyMatch(t -> "T4".equals(t.getId())));
    }

    @Test
    void testMaxCostOnlyFiltering() {
        authenticate("admin", "Admin");

        ResponseEntity<?> response = tenderController.getTenders("Admin", "admin", null, null, null, null, null, null, 200000.0, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals(2, tenders.size());
        assertTrue(tenders.stream().anyMatch(t -> "T1".equals(t.getId())));
        assertTrue(tenders.stream().anyMatch(t -> "T3".equals(t.getId())));
    }

    @Test
    void testSortByEstimatedCostAscAndDesc() {
        authenticate("admin", "Admin");

        // ASC
        ResponseEntity<?> responseAsc = tenderController.getTenders("Admin", "admin", null, null, null, null, null, null, null, "estimated_cost", "asc");
        assertEquals(HttpStatus.OK, responseAsc.getStatusCode());
        Map<?, ?> bodyAsc = (Map<?, ?>) responseAsc.getBody();
        List<Tender> tendersAsc = (List<Tender>) bodyAsc.get("tenders");
        assertEquals(4, tendersAsc.size());
        assertEquals("T1", tendersAsc.get(0).getId()); // 100,000
        assertEquals("T3", tendersAsc.get(1).getId()); // 200,000
        assertEquals("T4", tendersAsc.get(2).getId()); // 300,000
        assertEquals("T2", tendersAsc.get(3).getId()); // 500,000

        // DESC
        ResponseEntity<?> responseDesc = tenderController.getTenders("Admin", "admin", null, null, null, null, null, null, null, "estimated_cost", "desc");
        assertEquals(HttpStatus.OK, responseDesc.getStatusCode());
        Map<?, ?> bodyDesc = (Map<?, ?>) responseDesc.getBody();
        List<Tender> tendersDesc = (List<Tender>) bodyDesc.get("tenders");
        assertEquals(4, tendersDesc.size());
        assertEquals("T2", tendersDesc.get(0).getId()); // 500,000
        assertEquals("T4", tendersDesc.get(1).getId()); // 300,000
        assertEquals("T3", tendersDesc.get(2).getId()); // 200,000
        assertEquals("T1", tendersDesc.get(3).getId()); // 100,000
    }

    @Test
    void testSortByDueDateAscAndDesc() {
        authenticate("admin", "Admin");

        ResponseEntity<?> responseAsc = tenderController.getTenders("Admin", "admin", null, null, null, null, null, null, null, "due_date", "asc");
        assertEquals(HttpStatus.OK, responseAsc.getStatusCode());
        Map<?, ?> bodyAsc = (Map<?, ?>) responseAsc.getBody();
        List<Tender> tendersAsc = (List<Tender>) bodyAsc.get("tenders");
        assertEquals("T3", tendersAsc.get(0).getId()); // 2026-10-02

        ResponseEntity<?> responseDesc = tenderController.getTenders("Admin", "admin", null, null, null, null, null, null, null, "due_date", "desc");
        assertEquals(HttpStatus.OK, responseDesc.getStatusCode());
        Map<?, ?> bodyDesc = (Map<?, ?>) responseDesc.getBody();
        List<Tender> tendersDesc = (List<Tender>) bodyDesc.get("tenders");
        assertEquals("T4", tendersDesc.get(0).getId()); // 2026-10-20
    }

    @Test
    void testDefaultScrapedAtSorting() {
        authenticate("admin", "Admin");

        ResponseEntity<?> response = tenderController.getTenders("Admin", "admin", null, null, null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> tenders = (List<Tender>) body.get("tenders");
        assertEquals("T4", tenders.get(0).getId()); // 2026-10-03
        assertEquals("T2", tenders.get(1).getId()); // 2026-10-02
        assertEquals("T1", tenders.get(2).getId()); // 2026-10-01
        assertEquals("T3", tenders.get(3).getId()); // 2026-09-30
    }

    @Test
    void testPricingConfidentialityRedaction_NoJpaEntityMutation() {
        authenticate("exec1", "Tender Executive");

        ResponseEntity<?> response = tenderController.getTenders("Tender Executive", "exec1", null, null, null, null, null, null, null, "scraped_at", "desc");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        List<Tender> responseTenders = (List<Tender>) body.get("tenders");
        assertNull(responseTenders.get(0).getTpcPurchasePrice(), "Response copy must be redacted");

        // Verify managed entity in repository was NOT mutated
        assertEquals(50000.0, tender1.getTpcPurchasePrice(), "Managed JPA entity in repository must not be mutated");
    }

    @Test
    void testTenderDetailConfidentialityRedaction() {
        authenticate("exec1", "Tender Executive");

        ResponseEntity<?> response = tenderController.getTenderById("T1", "Tender Executive", "exec1");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        Tender detailTender = (Tender) body.get("tender");
        assertNotNull(detailTender);
        assertNull(detailTender.getTpcPurchasePrice(), "Tender detail response must redact tpcPurchasePrice");

        // Verify managed JPA entity is intact
        assertEquals(50000.0, tender1.getTpcPurchasePrice(), "Managed JPA entity must retain original tpcPurchasePrice");
    }

    @Test
    void testAllowedTpcTenderDetailAccess() {
        authenticate("tpc_user", "TPC Pricing Team");

        ResponseEntity<?> response = tenderController.getTenderById("T2", "TPC Pricing Team", "tpc_user");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) body.get("success"));
        Tender detailTender = (Tender) body.get("tender");
        assertEquals("T2", detailTender.getId());
    }

    @Test
    void testAdminTenderDetailAccess() {
        authenticate("admin", "Admin");

        ResponseEntity<?> response = tenderController.getTenderById("T1", "Admin", "admin");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) body.get("success"));
        Tender detailTender = (Tender) body.get("tender");
        assertEquals("T1", detailTender.getId());
        assertEquals(50000.0, detailTender.getTpcPurchasePrice(), "Admin role should see tpcPurchasePrice");
    }

    @Test
    void testClearanceTeamTenderDetailQuantitiesVisibility() {
        authenticate("spec1", "Clearance Team");
        tender1.setBidQty(50);
        tender1.setQuotedQty(45);

        ResponseEntity<?> response = tenderController.getTenderById("T1", "Clearance Team", "spec1");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) body.get("success"));
        Tender detailTender = (Tender) body.get("tender");
        assertNotNull(detailTender);
        assertEquals(50, detailTender.getBidQty(), "Clearance Team must see Bid Quantity");
        assertEquals(45, detailTender.getQuotedQty(), "Clearance Team must see Quoted Quantity");
        assertEquals(50, detailTender.getBidQtySnakeCase());
        assertEquals(45, detailTender.getQuotedQtySnakeCase());
        // Confidentiality check: TPC purchase price should still be hidden
        assertNull(detailTender.getTpcPurchasePrice(), "Clearance Team must not see confidential TPC purchase price");
    }

    @Test
    void testClearanceTeamTenderDetailNullQuantities() {
        authenticate("spec1", "Clearance Team");
        tender1.setBidQty(null);
        tender1.setQuotedQty(null);

        ResponseEntity<?> response = tenderController.getTenderById("T1", "Clearance Team", "spec1");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) body.get("success"));
        Tender detailTender = (Tender) body.get("tender");
        assertNotNull(detailTender);
        assertNull(detailTender.getBidQty(), "Null Bid Quantity must handle cleanly");
        assertNull(detailTender.getQuotedQty(), "Null Quoted Quantity must handle cleanly");
    }

    @Test
    void testTenderSerializationIncludesBothQuantityKeys() throws Exception {
        Tender t = new Tender();
        t.setId("T-QTY-1");
        t.setBidQty(120);
        t.setQuotedQty(110);

        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        String json = mapper.writeValueAsString(t);
        com.fasterxml.jackson.databind.JsonNode node = mapper.readTree(json);

        assertTrue(node.has("bidQty"), "Serialized JSON must have bidQty");
        assertTrue(node.has("bid_qty"), "Serialized JSON must have bid_qty");
        assertEquals(120, node.get("bidQty").asInt());
        assertEquals(120, node.get("bid_qty").asInt());

        assertTrue(node.has("quotedQty"), "Serialized JSON must have quotedQty");
        assertTrue(node.has("quoted_qty"), "Serialized JSON must have quoted_qty");
        assertEquals(110, node.get("quotedQty").asInt());
        assertEquals(110, node.get("quoted_qty").asInt());
    }

    @Test
    void testTenderSerializationIncludesBothTenderTypeKeys() throws Exception {
        Tender t = new Tender();
        t.setId("T-TYPE-1");
        t.setTenderType("GeM");

        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        String json = mapper.writeValueAsString(t);
        com.fasterxml.jackson.databind.JsonNode node = mapper.readTree(json);

        assertTrue(node.has("tenderType"), "Serialized JSON must have tenderType (camelCase)");
        assertTrue(node.has("tender_type"), "Serialized JSON must have tender_type (snake_case)");
        assertEquals("GeM", node.get("tenderType").asText());
        assertEquals("GeM", node.get("tender_type").asText());

        // Deserialization with camelCase
        Tender deserializedCamel = mapper.readValue("{\"tenderType\":\"Non GeM\"}", Tender.class);
        assertEquals("Non GeM", deserializedCamel.getTenderType());

        // Deserialization with snake_case
        Tender deserializedSnake = mapper.readValue("{\"tender_type\":\"Non GeM\"}", Tender.class);
        assertEquals("Non GeM", deserializedSnake.getTenderType());

        // Deserialization with both keys present
        Tender deserializedBoth = mapper.readValue("{\"tenderType\":\"GeM\",\"tender_type\":\"GeM\"}", Tender.class);
        assertEquals("GeM", deserializedBoth.getTenderType());
    }

    @Test
    void testPatchTenderTypeFollowsRefNoAndIgnoresTenderType() {
        authenticate("exec", "Executive");

        // Organization Tender ID with GEM -> GeM
        ResponseEntity<?> resGem = tenderController.updateTender("Executive", "exec", "T1", Map.of("ref_no", "GEM/2026/B/1234567"));
        assertEquals(HttpStatus.OK, resGem.getStatusCode());
        assertEquals("GeM", tender1.getTenderType());

        // tender_type sent by hand is ignored: the type still follows ref_no
        ResponseEntity<?> resManual = tenderController.updateTender("Executive", "exec", "T1", Map.of("tender_type", "Non GeM"));
        assertEquals(HttpStatus.OK, resManual.getStatusCode());
        tender1.applyTenderType(); // runs when the tender is saved
        assertEquals("GeM", tender1.getTenderType());

        // Organization Tender ID without GEM -> Non GeM
        ResponseEntity<?> resNonGem = tenderController.updateTender("Executive", "exec", "T1",
                Map.of("ref_no", "2026_AIIMS_812345_1", "tender_type", "GeM"));
        assertEquals(HttpStatus.OK, resNonGem.getStatusCode());
        tender1.applyTenderType();
        assertEquals("Non GeM", tender1.getTenderType());
    }

    @Test
    void testUnauthorizedTenderDetailAccess() {
        authenticate("exec1", "Tender Executive");

        ResponseEntity<?> response = tenderController.getTenderById("T2", "Tender Executive", "exec1");
        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertFalse((Boolean) body.get("success"));
        assertTrue(body.get("error").toString().contains("Access denied"));
    }

    @Test
    void testTenderStatsEndpoint() {
        authenticate("admin", "Admin");

        ResponseEntity<?> response = tenderController.getStats();
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) body.get("success"));
        assertNotNull(body.get("stats"));
    }

    @Test
    void testUpdateTenderStatusParticipatingWithoutVerificationStatus() {
        authenticate("misteam", "MIS Team");

        Map<String, Object> body = new HashMap<>();
        body.put("status", "Participating");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) respBody.get("success"));
        assertEquals("Participating", tender1.getStatus());
        verify(tenderRepository, atLeastOnce()).save(tender1);
    }

    @Test
    void testUpdateTenderSaveAssignmentAndQuantities() {
        authenticate("misteam", "MIS Team");

        Map<String, Object> body = new HashMap<>();
        body.put("mis_executive", "EXECUTIVE_1");
        body.put("bid_qty", 3);
        body.put("quoted_qty", 3);
        body.put("notes", "Assigned via MIS Team dashboard");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());

        assertEquals("EXECUTIVE_1", tender1.getMisExecutive());
        assertEquals(3, tender1.getBidQty());
        assertEquals(3, tender1.getQuotedQty());
        assertEquals("Assigned via MIS Team dashboard", tender1.getNotes());
        verify(tenderRepository, atLeastOnce()).save(tender1);
    }

    @Test
    void testAssignAndParticipateSavesAssigneeQuantitiesAndSetsParticipating() {
        authenticate("misteam", "MIS Team");

        Map<String, Object> body = new HashMap<>();
        body.put("status", "Participating");
        body.put("mis_executive", "exec_specialist");
        body.put("bid_qty", 25);
        body.put("quoted_qty", 20);

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T3", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) respBody.get("success"));
        assertEquals("Participating", tender3.getStatus());
        assertEquals("exec_specialist", tender3.getMisExecutive());
        assertEquals(25, tender3.getBidQty());
        assertEquals(20, tender3.getQuotedQty());
        assertEquals("SPEC_CLEARANCE", tender3.getCurrentStage());
        verify(tenderRepository, atLeastOnce()).save(tender3);
    }

    @Test
    void testParticipatingRejectedWhenAssigneeIsMissing() {
        authenticate("misteam", "MIS Team");

        // T3 has no misExecutive assigned
        assertNull(tender3.getMisExecutive());

        Map<String, Object> body = new HashMap<>();
        body.put("status", "Participating");
        body.put("bid_qty", 10);
        body.put("quoted_qty", 10);

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T3", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());

        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertFalse((Boolean) respBody.get("success"));
        assertTrue(respBody.get("error").toString().contains("Executive assignment is required to participate"));
        // Ensure tender status was NOT partially updated
        assertNotEquals("Participating", tender3.getStatus());
    }

    @Test
    void testParticipatingRejectedWhenQuantityIsInvalid() {
        authenticate("misteam", "MIS Team");

        // 1. Negative quantity rejected
        Map<String, Object> bodyNegative = new HashMap<>();
        bodyNegative.put("status", "Participating");
        bodyNegative.put("mis_executive", "exec_valid");
        bodyNegative.put("bid_qty", -5);

        ResponseEntity<?> respNegative = tenderController.updateTender("MIS Team", "misteam", "T3", bodyNegative);
        assertEquals(HttpStatus.BAD_REQUEST, respNegative.getStatusCode());
        Map<?, ?> respBodyNeg = (Map<?, ?>) respNegative.getBody();
        assertFalse((Boolean) respBodyNeg.get("success"));
        assertTrue(respBodyNeg.get("error").toString().contains("Quantity cannot be negative"));

        // 2. Decimal / non-integer quantity rejected
        Map<String, Object> bodyDecimal = new HashMap<>();
        bodyDecimal.put("status", "Participating");
        bodyDecimal.put("mis_executive", "exec_valid");
        bodyDecimal.put("quoted_qty", "12.75");

        ResponseEntity<?> respDecimal = tenderController.updateTender("MIS Team", "misteam", "T3", bodyDecimal);
        assertEquals(HttpStatus.BAD_REQUEST, respDecimal.getStatusCode());
        Map<?, ?> respBodyDec = (Map<?, ?>) respDecimal.getBody();
        assertFalse((Boolean) respBodyDec.get("success"));
        assertTrue(respBodyDec.get("error").toString().contains("Quantity must be an integer"));
    }

    @Test
    void testNotParticipatingSavesStatusWithoutAssigningExecutiveOrAdvancingStage() {
        authenticate("misteam", "MIS Team");

        assertNull(tender3.getMisExecutive());
        assertEquals("NEW", tender3.getCurrentStage());

        Map<String, Object> body = new HashMap<>();
        body.put("status", "Not Participating");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T3", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) respBody.get("success"));
        assertEquals("Not Participating", tender3.getStatus());
        assertNull(tender3.getMisExecutive());
        assertEquals("NEW", tender3.getCurrentStage());
    }

    @Test
    void testUnauthorizedRolesCannotPerformParticipationDecisionOrAssignment() {
        // Tender Executive cannot set Participating
        authenticate("exec1", "Tender Executive");
        Map<String, Object> bodyExec = new HashMap<>();
        bodyExec.put("status", "Participating");
        bodyExec.put("mis_executive", "exec1");

        ResponseEntity<?> respExec = tenderController.updateTender("Tender Executive", "exec1", "T3", bodyExec);
        assertEquals(HttpStatus.FORBIDDEN, respExec.getStatusCode());

        // Clearance Team cannot set Not Participating
        authenticate("spec1", "Clearance Team");
        Map<String, Object> bodySpec = new HashMap<>();
        bodySpec.put("status", "Not Participating");

        ResponseEntity<?> respSpec = tenderController.updateTender("Clearance Team", "spec1", "T3", bodySpec);
        assertEquals(HttpStatus.FORBIDDEN, respSpec.getStatusCode());
    }

    @Test
    void testUpdateTenderEmptyBodyDoesNotThrowNPE() {
        authenticate("misteam", "MIS Team");

        Map<String, Object> body = new HashMap<>();

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) respBody.get("success"));
    }

    @Test
    void testUpdateTenderRequiresBidDocsForVerificationApproval() {
        authenticate("misteam", "MIS Team");

        tender1.setWorkingPath(null);
        tender1.setDownloadedDocs(null);

        Map<String, Object> body = new HashMap<>();
        body.put("verification_status", "Approved");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());

        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertFalse((Boolean) respBody.get("success"));
        assertTrue(respBody.get("error").toString().contains("Generated bid documents are required"));
    }

    @Test
    void testUpdateTenderAcceptsGeneratedBidDocsWithoutWorkingPath() {
        authenticate("misteam", "MIS Team");

        tender1.setWorkingPath(null);
        tender1.setDownloadedDocs("[{\"filename\":\"Bid_Documents_T1.pdf\",\"name\":\"Generated Bid Documents (PDF)\"}]");

        Map<String, Object> body = new HashMap<>();
        body.put("verification_status", "Approved");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("Approved", tender1.getVerificationStatus());
    }

    @Test
    void testUpdateTenderSpecificationParametersByClearanceTeam() {
        authenticate("clearance", "Clearance Team");

        Map<String, Object> body = new HashMap<>();
        body.put("authority", "Updated Medical Health Authority");
        body.put("ref_no", "REF-SPEC-999");
        body.put("estimated_cost_raw", "₹ 7,50,000");
        body.put("emd_raw", "₹ 15,000");
        body.put("document_fee_raw", "₹ 500");
        body.put("tender_type", "GeM");
        body.put("source", "GeM");
        body.put("source_id", "48213377");
        body.put("location", "Nashik, MH");
        body.put("place", "Satpur");
        body.put("state", "Maharashtra");
        body.put("sector", "Healthcare");
        body.put("vertical_name", "Medical Equipment");
        body.put("publish_date", "2026-10-01");
        body.put("start_date", "2026-10-02");
        body.put("due_date", "2026-10-25");
        body.put("opening_date", "2026-10-26");
        body.put("pre_bid_date", "2026-10-15");
        body.put("time", "15:00:00");
        body.put("entry_date", "2026-10-01");
        body.put("bid_qty", "50");
        body.put("quoted_qty", "45");
        body.put("corrigendum_remark", "No");
        body.put("product_name_as_per_tender", "Suction Unit 50L");
        body.put("product_name_as_per_marken", "Marken Suction Unit 50L");
        body.put("title", "Supply and Installation of Medical Suction Units");
        body.put("original_url", "https://gem.gov.in/bid/9999");

        ResponseEntity<?> response = tenderController.updateTender("Clearance Team", "clearance", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());

        assertEquals("Updated Medical Health Authority", tender1.getAuthority());
        assertEquals("REF-SPEC-999", tender1.getRefNo());
        assertEquals("₹ 7,50,000", tender1.getEstimatedCostRaw());
        assertEquals(750000.0, tender1.getEstimatedCost());
        assertEquals("₹ 15,000", tender1.getEmdRaw());
        assertEquals(15000.0, tender1.getEmd());
        assertEquals("₹ 500", tender1.getDocumentFeeRaw());
        assertEquals(500.0, tender1.getDocumentFee());
        assertEquals("Non GeM", tender1.getTenderType(), "Tender type follows ref_no REF-SPEC-999, not the tender_type sent");
        assertEquals("GeM", tender1.getSource());
        assertEquals("48213377", tender1.getSourceId());
        assertEquals("Nashik, MH", tender1.getLocation());
        assertEquals("Satpur", tender1.getPlace());
        assertEquals("Maharashtra", tender1.getState());
        assertEquals("Healthcare", tender1.getSector());
        assertEquals("Medical Equipment", tender1.getVerticalName());
        assertEquals("2026-10-01", tender1.getPublishDate());
        assertEquals("2026-10-02", tender1.getStartDate());
        assertEquals("2026-10-25", tender1.getDueDate());
        assertEquals("2026-10-26", tender1.getOpeningDate());
        assertEquals("2026-10-15", tender1.getPreBidDate());
        assertEquals("15:00:00", tender1.getTime());
        assertEquals("2026-10-01", tender1.getEntryDate());
        assertEquals(50, tender1.getBidQty());
        assertEquals(45, tender1.getQuotedQty());
        assertEquals("No", tender1.getCorrigendumRemark());
        assertEquals("Suction Unit 50L", tender1.getProductNameAsPerTender());
        assertEquals("Marken Suction Unit 50L", tender1.getProductNameAsPerMarken());
        assertEquals("Supply and Installation of Medical Suction Units", tender1.getTitle());
        assertEquals("https://gem.gov.in/bid/9999", tender1.getOriginalUrl());

        verify(tenderRepository, atLeastOnce()).save(tender1);
    }

    @Test
    void testUpdateTenderSpecificationParametersByAllRoles() {
        for (String[] roleUser : new String[][]{
                {"Tender Executive", "executive"},
                {"Clearance Team", "clearance"},
                {"TPC Pricing Team", "tpc"},
                {"MIS Team", "misteam"}
        }) {
            String role = roleUser[0];
            String username = roleUser[1];
            authenticate(username, role);

            Map<String, Object> body = new HashMap<>();
            body.put("authority", "Authority Edited by " + role);
            body.put("bid_qty", 10);
            body.put("quoted_qty", 10);

            ResponseEntity<?> response = tenderController.updateTender(role, username, "T1", body);
            assertEquals(HttpStatus.OK, response.getStatusCode(), "Failed for role: " + role);
            assertEquals("Authority Edited by " + role, tender1.getAuthority());
            assertEquals(10, tender1.getBidQty());
        }

        // Admin has no edit permission for specifications (view only)
        authenticate("admin", "Admin");
        Map<String, Object> adminBody = new HashMap<>();
        adminBody.put("authority", "Authority Edited by Admin");
        ResponseEntity<?> adminResponse = tenderController.updateTender("Admin", "admin", "T1", adminBody);
        assertEquals(HttpStatus.FORBIDDEN, adminResponse.getStatusCode(), "Admin must be forbidden from editing specifications");
    }

    @Test
    void testIncompleteDateRejected() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("opening_date", "2026-");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals(false, respBody.get("success"));
        assertTrue(respBody.get("error").toString().contains("Enter a valid date."));
        Map<?, ?> errors = (Map<?, ?>) respBody.get("errors");
        assertNotNull(errors);
        assertEquals("Enter a valid date.", errors.get("opening_date"));
    }

    @Test
    void testImpossibleDateRejected() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("opening_date", "2026-02-30");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals(false, respBody.get("success"));
        assertEquals("Enter a valid date.", respBody.get("error"));
    }

    @Test
    void testValidDateAccepted() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("opening_date", "2026-10-26");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("2026-10-26", tender1.getOpeningDate());
    }

    @Test
    void testNonNumericFeeRejected() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("document_fee_raw", "maha");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals(false, respBody.get("success"));
        assertEquals("Enter a valid numeric fee.", respBody.get("error"));
        Map<?, ?> errors = (Map<?, ?>) respBody.get("errors");
        assertNotNull(errors);
        assertEquals("Enter a valid numeric fee.", errors.get("document_fee_raw"));
    }

    @Test
    void testNegativeFeeRejected() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("document_fee_raw", "-500");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals("Fee cannot be negative.", respBody.get("error"));
    }

    @Test
    void testValidFeeAccepted() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("document_fee_raw", "₹ 750.50");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("₹ 750.50", tender1.getDocumentFeeRaw());
        assertEquals(750.50, tender1.getDocumentFee());
    }

    @Test
    void testNegativeQuantityRejected() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("bid_qty", -5);

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals("Quantity cannot be negative.", respBody.get("error"));
    }

    @Test
    void testDecimalQuantityRejected() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("bid_qty", "10.5");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals("Quantity must be an integer.", respBody.get("error"));
    }

    @Test
    void testInvalidUrlRejected() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("original_url", "not-a-valid-url");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertTrue(respBody.get("error").toString().contains("Enter a valid URL"));
    }

    // --- Tightened Numeric Amount Parsing Tests ---

    @Test
    void testMalformedCommaGroupingRejected() {
        authenticate("misteam", "MIS Team");

        // "12,34" has invalid grouping (not 3 digits at end)
        Map<String, Object> body1 = new HashMap<>();
        body1.put("document_fee_raw", "12,34");
        ResponseEntity<?> resp1 = tenderController.updateTender("MIS Team", "misteam", "T1", body1);
        assertEquals(HttpStatus.BAD_REQUEST, resp1.getStatusCode());

        // "1,,2" has consecutive commas
        Map<String, Object> body2 = new HashMap<>();
        body2.put("estimated_cost_raw", "1,,2");
        ResponseEntity<?> resp2 = tenderController.updateTender("MIS Team", "misteam", "T1", body2);
        assertEquals(HttpStatus.BAD_REQUEST, resp2.getStatusCode());

        // "1,2,3,4" has single-digit comma groups
        Map<String, Object> body3 = new HashMap<>();
        body3.put("document_fee_raw", "1,2,3,4");
        ResponseEntity<?> resp3 = tenderController.updateTender("MIS Team", "misteam", "T1", body3);
        assertEquals(HttpStatus.BAD_REQUEST, resp3.getStatusCode());

        // Trailing comma
        Map<String, Object> body4 = new HashMap<>();
        body4.put("document_fee_raw", "500,");
        ResponseEntity<?> resp4 = tenderController.updateTender("MIS Team", "misteam", "T1", body4);
        assertEquals(HttpStatus.BAD_REQUEST, resp4.getStatusCode());
    }

    @Test
    void testMultipleDecimalPointsRejected() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("document_fee_raw", "1.2.3");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals("Enter a valid numeric fee.", respBody.get("error"));
    }

    @Test
    void testLegitimateCurrencyFormattedAmountsAccepted() {
        authenticate("misteam", "MIS Team");

        // Indian format with lakhs
        Map<String, Object> body1 = new HashMap<>();
        body1.put("estimated_cost_raw", "₹ 12,34,567.89");
        ResponseEntity<?> resp1 = tenderController.updateTender("MIS Team", "misteam", "T1", body1);
        assertEquals(HttpStatus.OK, resp1.getStatusCode());
        assertEquals(1234567.89, tender1.getEstimatedCost(), 0.001);

        // Western format with millions
        Map<String, Object> body2 = new HashMap<>();
        body2.put("estimated_cost_raw", "$ 1,234,567.89");
        ResponseEntity<?> resp2 = tenderController.updateTender("MIS Team", "misteam", "T1", body2);
        assertEquals(HttpStatus.OK, resp2.getStatusCode());
        assertEquals(1234567.89, tender1.getEstimatedCost(), 0.001);

        // Rs prefix with Indian format
        Map<String, Object> body3 = new HashMap<>();
        body3.put("document_fee_raw", "Rs. 1,500.50");
        ResponseEntity<?> resp3 = tenderController.updateTender("MIS Team", "misteam", "T1", body3);
        assertEquals(HttpStatus.OK, resp3.getStatusCode());
        assertEquals(1500.50, tender1.getDocumentFee(), 0.001);
    }

    // --- Date Validation Alignment Tests ---

    @Test
    void testLegacyPermittedScrapedDateFormatAccepted() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("due_date", "8 Oct 2026");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("8 Oct 2026", tender1.getDueDate());
    }

    @Test
    void testImpossibleLegacyDateRejected() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = new HashMap<>();
        body.put("due_date", "30 Feb 2026");

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
    }

    @Test
    void testDateTimeFormatsAccepted() {
        authenticate("misteam", "MIS Team");

        // YYYY-MM-DD HH:mm:ss
        Map<String, Object> body1 = new HashMap<>();
        body1.put("due_date", "2026-10-25 15:30:00");
        ResponseEntity<?> resp1 = tenderController.updateTender("MIS Team", "misteam", "T1", body1);
        assertEquals(HttpStatus.OK, resp1.getStatusCode());
        assertEquals("2026-10-25 15:30:00", tender1.getDueDate());

        // YYYY-MM-DDTHH:mm
        Map<String, Object> body2 = new HashMap<>();
        body2.put("due_date", "2026-10-25T15:30");
        ResponseEntity<?> resp2 = tenderController.updateTender("MIS Team", "misteam", "T1", body2);
        assertEquals(HttpStatus.OK, resp2.getStatusCode());
        assertEquals("2026-10-25T15:30", tender1.getDueDate());
    }

    @Test
    void testNoPermittedOnlyForPreBidDate() {
        authenticate("misteam", "MIS Team");

        // "No" on pre_bid_date is allowed
        Map<String, Object> body1 = new HashMap<>();
        body1.put("pre_bid_date", "No");
        ResponseEntity<?> resp1 = tenderController.updateTender("MIS Team", "misteam", "T1", body1);
        assertEquals(HttpStatus.OK, resp1.getStatusCode());
        assertEquals("No", tender1.getPreBidDate());

        // "No" on opening_date is NOT allowed
        Map<String, Object> body2 = new HashMap<>();
        body2.put("opening_date", "No");
        ResponseEntity<?> resp2 = tenderController.updateTender("MIS Team", "misteam", "T1", body2);
        assertEquals(HttpStatus.BAD_REQUEST, resp2.getStatusCode());
    }

    // --- Field-Level Authorization Tests for PATCH /api/tenders/{id} ---

    @Test
    void testUnauthorizedRoleCannotModifyTpcPurchasePrice() {
        authenticate("exec1", "Tender Executive");
        tender1.setTpcPurchasePrice(null);

        Map<String, Object> body = new HashMap<>();
        body.put("authority", "Valid Authority");
        body.put("tpc_purchase_price", 45000.0);

        ResponseEntity<?> response = tenderController.updateTender("Tender Executive", "exec1", "T1", body);
        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        assertNull(tender1.getTpcPurchasePrice());
        assertNotEquals("Valid Authority", tender1.getAuthority()); // Zero partial mutation
    }

    @Test
    void testUnauthorizedRoleCannotModifyTpcPurchasePriceCamelCase() {
        authenticate("clearance", "Clearance Team");
        tender1.setTpcPurchasePrice(null);

        Map<String, Object> body = new HashMap<>();
        body.put("tpcPurchasePrice", 55000.0);

        ResponseEntity<?> response = tenderController.updateTender("Clearance Team", "clearance", "T1", body);
        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        assertNull(tender1.getTpcPurchasePrice());
    }

    @Test
    void testTpcRoleCanModifyTpcPurchasePrice() {
        authenticate("tpc", "TPC Pricing Team");

        Map<String, Object> body = new HashMap<>();
        body.put("tpc_purchase_price", 48000.0);

        // When TPC updates via tender spec parameters, allowedPatch permits it
        boolean allowed = WorkflowPermissions.allowedPatch(body, tender1.getCurrentStage(), "TPC Pricing Team");
        assertTrue(allowed);
    }

    @Test
    void testUnauthorizedRoleCannotModifyWorkflowStatus() {
        authenticate("exec1", "Tender Executive");
        String originalStatus = tender1.getStatus();

        Map<String, Object> body = new HashMap<>();
        body.put("status", "Won");

        ResponseEntity<?> response = tenderController.updateTender("Tender Executive", "exec1", "T1", body);
        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        assertEquals(originalStatus, tender1.getStatus());
    }

    @Test
    void testUnauthorizedRoleCannotModifySpecVerificationStatus() {
        authenticate("exec1", "Tender Executive");

        Map<String, Object> body = new HashMap<>();
        body.put("spec_verification_status", "Approved");

        ResponseEntity<?> response = tenderController.updateTender("Tender Executive", "exec1", "T1", body);
        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
    }

    @Test
    void testUnauthorizedRoleCannotModifyPaymentStatus() {
        authenticate("clearance", "Clearance Team");

        Map<String, Object> body = new HashMap<>();
        body.put("payment_status", "Approved");

        ResponseEntity<?> response = tenderController.updateTender("Clearance Team", "clearance", "T1", body);
        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
    }

    @Test
    void testAllRolesCanEditApprovedSpecificationParameters() {
        String[] roles = {"MIS Team", "Tender Executive", "Clearance Team", "TPC Pricing Team"};
        String[] users = {"misteam", "exec1", "clearance", "tpc"};

        for (int i = 0; i < roles.length; i++) {
            authenticate(users[i], roles[i]);
            Map<String, Object> body = new HashMap<>();
            body.put("authority", "Authority updated by " + roles[i]);
            body.put("opening_date", "2026-10-26");
            body.put("document_fee_raw", "₹ 500");

            ResponseEntity<?> response = tenderController.updateTender(roles[i], users[i], "T1", body);
            assertEquals(HttpStatus.OK, response.getStatusCode(), "Role " + roles[i] + " should be permitted to edit specifications");
            assertEquals("Authority updated by " + roles[i], tender1.getAuthority());
            assertEquals("2026-10-26", tender1.getOpeningDate());
            assertEquals(500.0, tender1.getDocumentFee());
        }

        // Admin has no edit permission (view only)
        authenticate("admin", "Admin");
        Map<String, Object> adminBody = new HashMap<>();
        adminBody.put("authority", "Authority updated by Admin");
        ResponseEntity<?> adminResponse = tenderController.updateTender("Admin", "admin", "T1", adminBody);
        assertEquals(HttpStatus.FORBIDDEN, adminResponse.getStatusCode(), "Role Admin must not be permitted to edit specifications");
    }

    @Test
    void testTenderExecutiveCanAssignClearanceRepresentative() {
        authenticate("exec1", "Tender Executive");
        tender1.setAssignedMisMemberSpec(null);

        Map<String, Object> body = new HashMap<>();
        body.put("assigned_mis_member_spec", "clearance");

        ResponseEntity<?> response = tenderController.updateTender("Tender Executive", "exec1", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("clearance", tender1.getAssignedMisMemberSpec());
    }

    @Test
    void testInvalidRequestDoesNotPartiallyMutateTender() {
        authenticate("misteam", "MIS Team");
        tender1.setAuthority("Original Authority");
        tender1.setDocumentFeeRaw("1000");
        tender1.setDocumentFee(1000.0);
        tender1.setOpeningDate("2026-10-20");

        // Payload has a valid authority, but an invalid date
        Map<String, Object> body = new HashMap<>();
        body.put("authority", "Mutated Authority");
        body.put("opening_date", "2026-02-31"); // impossible date

        ResponseEntity<?> response = tenderController.updateTender("MIS Team", "misteam", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());

        // Verify tender fields were NOT mutated
        assertEquals("Original Authority", tender1.getAuthority());
        assertEquals("2026-10-20", tender1.getOpeningDate());
        assertEquals(1000.0, tender1.getDocumentFee());
    }

    // ---------------------------------------------------------------------------------------------
    // Adding a tender by hand (POST /api/tenders)
    // ---------------------------------------------------------------------------------------------

    private Map<String, Object> newTenderBody(String id, String title, String originalUrl) {
        Map<String, Object> body = new HashMap<>();
        body.put("id", id);
        body.put("title", title);
        body.put("original_url", originalUrl);
        return body;
    }

    private Tender savedTender() {
        org.mockito.ArgumentCaptor<Tender> captor = org.mockito.ArgumentCaptor.forClass(Tender.class);
        verify(tenderRepository).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void testCreateTenderClassifiesGemFromOfficialBidNo() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("NEW_T1", "Supply of Centrifuges", "https://example.com/details");
        body.put("ref_no", "GEM/2026/B/7570015");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());
        Tender saved = savedTender();
        assertEquals("GeM", saved.getTenderType(), "ref_no containing GEM must make the tender GeM");
        assertNull(saved.getSource(), "Ingestion source must not default to GeM when not supplied");
    }

    @Test
    void testCreateTenderClassifiesNonGemFromRefNoWithoutGem() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("NEW_T2", "Hospital Furniture Tender", "https://eprocure.gov.in/epublish/app?component=view");
        body.put("ref_no", "2026_AIIMS_810792_1");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());
        assertEquals("Non GeM", savedTender().getTenderType(), "ref_no without GEM must make the tender Non GeM");
    }

    @Test
    void testCreateTenderWithoutGemInRefNoIsNonGem() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("NEW_T3", "Procurement of General Items", "https://aggregator.example.com/tender/view?id=123");
        body.put("ref_no", "UNKNOWN_REF_999");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());
        assertEquals("Non GeM", savedTender().getTenderType(), "ref_no without GEM must make the tender Non GeM");
    }

    @Test
    void testCreateTenderPreservesExplicitIngestionSource() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("NEW_T4", "Specific Tender", "https://example.com/view");
        body.put("ref_no", "REF_123");
        body.put("source", "Tender247");
        body.put("source_id", "48213377");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());
        Tender saved = savedTender();
        assertEquals("Non GeM", saved.getTenderType(), "ref_no without GEM must make the tender Non GeM");
        assertEquals("Tender247", saved.getSource(), "Explicit source must be preserved");
    }

    @Test
    void testCreateTenderWithOnlyT247IdIsNonGem() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("48213301", "Supply of Hospital Beds", "https://www.tender247.com/tender/48213301");
        body.put("source_id", "48213301");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());
        assertEquals("Non GeM", savedTender().getTenderType(), "No ref_no and a T247 ID must make the tender Non GeM");
    }

    @Test
    void testCreateTenderIgnoresTenderTypeSentByOlderClients() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("NEW_T5", "Specific Tender", "https://example.com/view");
        body.put("ref_no", "2026_AIIMS_812345_1");
        body.put("tender_type", "GeM");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Sending tender_type must not cause an error");
        Tender saved = savedTender();
        saved.applyTenderType(); // runs when the tender is saved
        assertEquals("Non GeM", saved.getTenderType(), "tender_type sent by the client is ignored; ref_no decides");
    }

    @Test
    void testCreateTenderWithOnlyRequiredFieldsStartsNewAndUnassigned() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("  MANUAL-001  ", "  Supply of ECG Machines  ", "https://example.com/tender/1");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());

        Tender saved = savedTender();
        assertEquals("MANUAL-001", saved.getId(), "Tender ID must be trimmed");
        assertEquals("Supply of ECG Machines", saved.getTitle(), "Tender name must be trimmed");
        assertEquals("https://example.com/tender/1", saved.getOriginalUrl());
        assertEquals("Issued", saved.getStatus(), "A new tender is stored as Issued (shown as New)");
        assertEquals("NEW", saved.getCurrentStage());
        assertNull(saved.getMisExecutive(), "A new tender must start unassigned");
        assertNull(saved.getAssignedBy());
        assertEquals(java.time.LocalDate.now().toString(), saved.getEntryDate(), "Entry date defaults to today");
        assertNotNull(saved.getScrapedAt());
        assertEquals("", saved.getNotes());

        Map<?, ?> resp = (Map<?, ?>) response.getBody();
        assertEquals(true, resp.get("success"));
        assertNotNull(resp.get("tender"), "Response must include the created tender");
        verify(activityLogRepository).save(any());
    }

    @Test
    void testCreateTenderStoresOptionalDetails() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("MANUAL-002", "Supply of Ventilators", "https://example.com/tender/2");
        body.put("authority", "AIIMS Delhi");
        body.put("estimated_cost_raw", "₹ 5,00,000");
        body.put("emd_raw", "10000");
        body.put("document_fee_raw", "");
        body.put("due_date", "2026-12-15");
        body.put("time", "15:00");
        body.put("pre_bid_date", "No");
        body.put("bid_qty", 5);
        body.put("quoted_qty", "4");
        body.put("corrigendum_remark", "No");
        body.put("location", "New Delhi");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());

        Tender saved = savedTender();
        assertEquals("AIIMS Delhi", saved.getAuthority());
        assertEquals("₹ 5,00,000", saved.getEstimatedCostRaw(), "Raw amount text is kept for display");
        assertEquals(500000.0, saved.getEstimatedCost(), "Amount is parsed for sorting and analytics");
        assertEquals(10000.0, saved.getEmd());
        assertNull(saved.getDocumentFeeRaw(), "Blank optional fields are stored as empty");
        assertNull(saved.getDocumentFee());
        assertEquals("2026-12-15", saved.getDueDate());
        assertEquals("15:00", saved.getTime());
        assertEquals("No", saved.getPreBidDate());
        assertEquals(5, saved.getBidQty());
        assertEquals(4, saved.getQuotedQty());
        assertEquals("New Delhi", saved.getLocation());
    }

    @Test
    void testCreateTenderAllowedForAdmin() {
        authenticate("admin", "Admin");
        ResponseEntity<?> response = tenderController.createTender(newTenderBody("MANUAL-ADMIN", "Admin Tender", "https://example.com/tender/a"));
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());
        assertEquals("MANUAL-ADMIN", savedTender().getId());
    }

    @Test
    void testCreateTenderStoresBothTenderNumbers() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("48213377", "Supply of ECG Machines", "https://example.com/t");
        body.put("ref_no", "  2026_AIIMS_12345_1  ");
        body.put("source_id", " 48213377 ");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());
        Tender saved = savedTender();
        assertEquals("2026_AIIMS_12345_1", saved.getRefNo(), "Organization Tender ID is stored in ref_no");
        assertEquals("48213377", saved.getSourceId(), "T247 ID is stored in source_id");
        assertEquals("Tender247", saved.getSource(), "A T247 ID means the tender is on Tender247, so email sync can match it later");
    }

    @Test
    void testCreateTenderUsesT247IdAsTenderIdWhenTenderIdIsBlank() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("", "Supply of ECG Machines", "https://example.com/t");
        body.put("source_id", "48213377");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());
        Tender saved = savedTender();
        assertEquals("48213377", saved.getId());
        assertEquals("48213377", saved.getSourceId());
    }

    @Test
    void testCreateTenderKeepsExplicitSourceWithT247Id() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("MANUAL-010", "GeM tender seen on Tender247", "https://example.com/t");
        body.put("source", "GeM");
        body.put("source_id", "48213377");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response body: " + response.getBody());
        assertEquals("GeM", savedTender().getSource());
    }

    @Test
    void testCreateTenderRejectsNonNumericT247Id() {
        authenticate("misteam", "MIS Team");
        for (String bad : List.of("GEM/2026/B/1234567", "T247-123", "12 34")) {
            Map<String, Object> body = newTenderBody("MANUAL-011", "Tender", "https://example.com/t");
            body.put("source_id", bad);
            ResponseEntity<?> response = tenderController.createTender(body);
            assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode(), "T247 ID '" + bad + "' must be rejected");
            Map<?, ?> errors = (Map<?, ?>) ((Map<?, ?>) response.getBody()).get("errors");
            assertTrue(errors.containsKey("source_id"));
        }
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void testCreateTenderNormalisesGemBidNumberAndDropsPlaceholderRefNo() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("MANUAL-012", "Tender", "https://example.com/t");
        body.put("ref_no", "gem/2026/b/7570015");
        assertEquals(HttpStatus.OK, tenderController.createTender(body).getStatusCode());
        assertEquals("GEM/2026/B/7570015", savedTender().getRefNo(), "GeM bid number stored the way GeM sync stores it");

        reset(tenderRepository);
        Map<String, Object> body2 = newTenderBody("MANUAL-013", "Tender", "https://example.com/t");
        body2.put("ref_no", "N/A");
        assertEquals(HttpStatus.OK, tenderController.createTender(body2).getStatusCode());
        assertNull(savedTender().getRefNo(), "'N/A' means the Organization Tender ID is not known");
    }

    @Test
    void testCreateTenderRejectsDuplicateOrganizationTenderId() {
        authenticate("misteam", "MIS Team");
        when(tenderRepository.findFirstByRefNo("GEM/2026/B/7570015")).thenReturn(Optional.of(tender1));
        Map<String, Object> body = newTenderBody("MANUAL-014", "Tender", "https://example.com/t");
        body.put("ref_no", "GEM/2026/B/7570015");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        Map<?, ?> errors = (Map<?, ?>) ((Map<?, ?>) response.getBody()).get("errors");
        assertTrue(errors.containsKey("ref_no"));
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void testCreateTenderRejectsDuplicateT247Id() {
        authenticate("misteam", "MIS Team");
        when(tenderRepository.findFirstBySourceId("48213377")).thenReturn(Optional.of(tender1));
        Map<String, Object> body = newTenderBody("MANUAL-015", "Tender", "https://example.com/t");
        body.put("source_id", "48213377");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        Map<?, ?> errors = (Map<?, ?>) ((Map<?, ?>) response.getBody()).get("errors");
        assertTrue(errors.containsKey("source_id"));
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void testCreateTenderRejectsT247IdUsedAsIdOfOlderTender247Tender() {
        authenticate("misteam", "MIS Team");
        Tender older = new Tender();
        older.setId("48213377");
        older.setSource("Tender247");
        when(tenderRepository.findById("48213377")).thenReturn(Optional.of(older));
        Map<String, Object> body = newTenderBody("MANUAL-016", "Tender", "https://example.com/t");
        body.put("source_id", "48213377");

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void testCreateTenderOnlyAllowedForMisTeamAndAdmin() {
        Map<String, Object> body = newTenderBody("MANUAL-003", "Some Tender", "https://example.com/tender/3");
        for (String role : List.of("Executive", "Tender Executive", "Clearance Team", "TPC Pricing Team")) {
            authenticate("user", role);
            ResponseEntity<?> response = tenderController.createTender(body);
            assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode(), role + " must not be able to add tenders");
        }
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void testCreateTenderRequiresIdNameAndLink() {
        authenticate("misteam", "MIS Team");
        Map<String, Object> body = newTenderBody("   ", "", null);

        ResponseEntity<?> response = tenderController.createTender(body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> errors = (Map<?, ?>) ((Map<?, ?>) response.getBody()).get("errors");
        assertTrue(errors.containsKey("id"));
        assertTrue(errors.containsKey("title"));
        assertTrue(errors.containsKey("original_url"));
        verify(tenderRepository, never()).save(any());

        ResponseEntity<?> emptyBody = tenderController.createTender(null);
        assertEquals(HttpStatus.BAD_REQUEST, emptyBody.getStatusCode());
    }

    @Test
    void testCreateTenderRejectsIdThatWouldBreakPageLinks() {
        authenticate("misteam", "MIS Team");
        for (String badId : List.of("GEM/2026/B/123", "has space", "a?b", "a#b", "..", "%2F")) {
            ResponseEntity<?> response = tenderController.createTender(newTenderBody(badId, "Tender", "https://example.com/t"));
            assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode(), "ID '" + badId + "' must be rejected");
        }
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void testCreateTenderRejectsInvalidValues() {
        authenticate("misteam", "MIS Team");
        Map<String, Map<String, Object>> cases = new LinkedHashMap<>();
        cases.put("original_url", Map.of("original_url", "not a link"));
        cases.put("due_date", Map.of("due_date", "2026-02-31"));
        cases.put("time", Map.of("time", "25:00"));
        cases.put("estimated_cost_raw", Map.of("estimated_cost_raw", "-500"));
        cases.put("bid_qty", Map.of("bid_qty", "2.5"));
        cases.put("ref_no", Map.of("ref_no", "x".repeat(256)));

        for (Map.Entry<String, Map<String, Object>> c : cases.entrySet()) {
            Map<String, Object> body = newTenderBody("MANUAL-004", "Tender", "https://example.com/t");
            body.putAll(c.getValue());
            ResponseEntity<?> response = tenderController.createTender(body);
            assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode(), c.getKey() + " must be validated");
            Map<?, ?> errors = (Map<?, ?>) ((Map<?, ?>) response.getBody()).get("errors");
            assertTrue(errors.containsKey(c.getKey()), "Expected an error for " + c.getKey() + " but got " + errors);
        }
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void testCreateTenderRejectsAssignmentWorkflowAndPricingFields() {
        authenticate("misteam", "MIS Team");
        for (String field : List.of("mis_executive", "assigned_by", "status", "current_stage", "tpc_purchase_price",
                "mis_final_price", "payment_status", "spec_verification_status", "emd_receipt_doc_path", "scraped_at")) {
            Map<String, Object> body = newTenderBody("MANUAL-005", "Tender", "https://example.com/t");
            body.put(field, "x");
            ResponseEntity<?> response = tenderController.createTender(body);
            assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode(), field + " must not be settable on create");
        }
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void testCreateTenderRejectsDuplicateId() {
        authenticate("misteam", "MIS Team");
        when(tenderRepository.existsById("T1")).thenReturn(true);

        ResponseEntity<?> response = tenderController.createTender(newTenderBody("T1", "Duplicate", "https://example.com/t"));
        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void testAdminOnlyHasPermissionToProvideTpcPrice() {
        authenticate("admin", "Admin");

        // 1. Admin providing TPC purchase price -> 200 OK
        Map<String, Object> tpcBody = new HashMap<>();
        tpcBody.put("tpc_purchase_price", 125000.0);
        ResponseEntity<?> tpcResponse = tenderController.updateTender("Admin", "admin", "T1", tpcBody);
        assertEquals(HttpStatus.OK, tpcResponse.getStatusCode());
        assertEquals(125000.0, tender1.getTpcPurchasePrice());

        // 2. Admin providing camelCase tpcPurchasePrice -> 200 OK
        Map<String, Object> tpcCamelBody = new HashMap<>();
        tpcCamelBody.put("tpcPurchasePrice", 130000.0);
        ResponseEntity<?> tpcCamelResponse = tenderController.updateTender("Admin", "admin", "T1", tpcCamelBody);
        assertEquals(HttpStatus.OK, tpcCamelResponse.getStatusCode());
        assertEquals(130000.0, tender1.getTpcPurchasePrice());

        // 3. Admin attempting any other edit -> 403 FORBIDDEN
        // Authority
        Map<String, Object> authorityBody = new HashMap<>();
        authorityBody.put("authority", "Admin Modified Authority");
        assertEquals(HttpStatus.FORBIDDEN, tenderController.updateTender("Admin", "admin", "T1", authorityBody).getStatusCode());

        // Notes
        Map<String, Object> notesBody = new HashMap<>();
        notesBody.put("notes", "Admin notes");
        assertEquals(HttpStatus.FORBIDDEN, tenderController.updateTender("Admin", "admin", "T1", notesBody).getStatusCode());

        // Dates
        Map<String, Object> datesBody = new HashMap<>();
        datesBody.put("opening_date", "2026-10-28");
        assertEquals(HttpStatus.FORBIDDEN, tenderController.updateTender("Admin", "admin", "T1", datesBody).getStatusCode());

        // MIS Price
        Map<String, Object> misPriceBody = new HashMap<>();
        misPriceBody.put("mis_final_price", 150000.0);
        assertEquals(HttpStatus.FORBIDDEN, tenderController.updateTender("Admin", "admin", "T1", misPriceBody).getStatusCode());

        // Status
        Map<String, Object> statusBody = new HashMap<>();
        statusBody.put("status", "Won");
        assertEquals(HttpStatus.FORBIDDEN, tenderController.updateTender("Admin", "admin", "T1", statusBody).getStatusCode());

        // Delete tender -> 403 FORBIDDEN
        assertEquals(HttpStatus.FORBIDDEN, tenderController.deleteTender("Admin", "admin", "T1").getStatusCode());
    }

    // ---------------------------------------------------------------------------------------------
    // T247 ID on the edit page
    // ---------------------------------------------------------------------------------------------

    @Test
    void testUpdateTenderRejectsNonNumericT247Id() {
        authenticate("clearance", "Clearance Team");
        Map<String, Object> body = new HashMap<>();
        body.put("source_id", "GEM/2026/B/9999");

        ResponseEntity<?> response = tenderController.updateTender("Clearance Team", "clearance", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> errors = (Map<?, ?>) ((Map<?, ?>) response.getBody()).get("errors");
        assertTrue(errors.containsKey("source_id"));
        assertNull(tender1.getSourceId());
    }

    @Test
    void testUpdateTenderAllowsUnchangedOldSourceIdAndClearing() {
        authenticate("clearance", "Clearance Team");
        tender1.setSourceId("GEM/2026/B/1111");

        // The edit form always sends source_id: an unchanged old value must not block other edits
        Map<String, Object> body = new HashMap<>();
        body.put("source_id", "GEM/2026/B/1111");
        body.put("place", "Pune");
        assertEquals(HttpStatus.OK, tenderController.updateTender("Clearance Team", "clearance", "T1", body).getStatusCode());
        assertEquals("Pune", tender1.getPlace());

        // Clearing it is allowed
        Map<String, Object> clear = new HashMap<>();
        clear.put("source_id", "");
        assertEquals(HttpStatus.OK, tenderController.updateTender("Clearance Team", "clearance", "T1", clear).getStatusCode());
    }
}
