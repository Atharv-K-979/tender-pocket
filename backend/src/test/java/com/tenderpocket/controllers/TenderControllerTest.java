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
        body.put("source_id", "GEM/2026/B/9999");
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
        assertEquals("GeM", tender1.getTenderType());
        assertEquals("GeM", tender1.getSource());
        assertEquals("GEM/2026/B/9999", tender1.getSourceId());
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
                {"Admin", "admin"},
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
    }

    @Test
    void testIncompleteDateRejected() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("opening_date", "2026-");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
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
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("opening_date", "2026-02-30");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals(false, respBody.get("success"));
        assertEquals("Enter a valid date.", respBody.get("error"));
    }

    @Test
    void testValidDateAccepted() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("opening_date", "2026-10-26");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("2026-10-26", tender1.getOpeningDate());
    }

    @Test
    void testNonNumericFeeRejected() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("document_fee_raw", "maha");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
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
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("document_fee_raw", "-500");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals("Fee cannot be negative.", respBody.get("error"));
    }

    @Test
    void testValidFeeAccepted() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("document_fee_raw", "₹ 750.50");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("₹ 750.50", tender1.getDocumentFeeRaw());
        assertEquals(750.50, tender1.getDocumentFee());
    }

    @Test
    void testNegativeQuantityRejected() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("bid_qty", -5);

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals("Quantity cannot be negative.", respBody.get("error"));
    }

    @Test
    void testDecimalQuantityRejected() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("bid_qty", "10.5");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals("Quantity must be an integer.", respBody.get("error"));
    }

    @Test
    void testInvalidUrlRejected() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("original_url", "not-a-valid-url");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertTrue(respBody.get("error").toString().contains("Enter a valid URL"));
    }

    // --- Tightened Numeric Amount Parsing Tests ---

    @Test
    void testMalformedCommaGroupingRejected() {
        authenticate("admin", "Admin");

        // "12,34" has invalid grouping (not 3 digits at end)
        Map<String, Object> body1 = new HashMap<>();
        body1.put("document_fee_raw", "12,34");
        ResponseEntity<?> resp1 = tenderController.updateTender("Admin", "admin", "T1", body1);
        assertEquals(HttpStatus.BAD_REQUEST, resp1.getStatusCode());

        // "1,,2" has consecutive commas
        Map<String, Object> body2 = new HashMap<>();
        body2.put("estimated_cost_raw", "1,,2");
        ResponseEntity<?> resp2 = tenderController.updateTender("Admin", "admin", "T1", body2);
        assertEquals(HttpStatus.BAD_REQUEST, resp2.getStatusCode());

        // "1,2,3,4" has single-digit comma groups
        Map<String, Object> body3 = new HashMap<>();
        body3.put("document_fee_raw", "1,2,3,4");
        ResponseEntity<?> resp3 = tenderController.updateTender("Admin", "admin", "T1", body3);
        assertEquals(HttpStatus.BAD_REQUEST, resp3.getStatusCode());

        // Trailing comma
        Map<String, Object> body4 = new HashMap<>();
        body4.put("document_fee_raw", "500,");
        ResponseEntity<?> resp4 = tenderController.updateTender("Admin", "admin", "T1", body4);
        assertEquals(HttpStatus.BAD_REQUEST, resp4.getStatusCode());
    }

    @Test
    void testMultipleDecimalPointsRejected() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("document_fee_raw", "1.2.3");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        Map<?, ?> respBody = (Map<?, ?>) response.getBody();
        assertNotNull(respBody);
        assertEquals("Enter a valid numeric fee.", respBody.get("error"));
    }

    @Test
    void testLegitimateCurrencyFormattedAmountsAccepted() {
        authenticate("admin", "Admin");

        // Indian format with lakhs
        Map<String, Object> body1 = new HashMap<>();
        body1.put("estimated_cost_raw", "₹ 12,34,567.89");
        ResponseEntity<?> resp1 = tenderController.updateTender("Admin", "admin", "T1", body1);
        assertEquals(HttpStatus.OK, resp1.getStatusCode());
        assertEquals(1234567.89, tender1.getEstimatedCost(), 0.001);

        // Western format with millions
        Map<String, Object> body2 = new HashMap<>();
        body2.put("estimated_cost_raw", "$ 1,234,567.89");
        ResponseEntity<?> resp2 = tenderController.updateTender("Admin", "admin", "T1", body2);
        assertEquals(HttpStatus.OK, resp2.getStatusCode());
        assertEquals(1234567.89, tender1.getEstimatedCost(), 0.001);

        // Rs prefix with Indian format
        Map<String, Object> body3 = new HashMap<>();
        body3.put("document_fee_raw", "Rs. 1,500.50");
        ResponseEntity<?> resp3 = tenderController.updateTender("Admin", "admin", "T1", body3);
        assertEquals(HttpStatus.OK, resp3.getStatusCode());
        assertEquals(1500.50, tender1.getDocumentFee(), 0.001);
    }

    // --- Date Validation Alignment Tests ---

    @Test
    void testLegacyPermittedScrapedDateFormatAccepted() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("due_date", "8 Oct 2026");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("8 Oct 2026", tender1.getDueDate());
    }

    @Test
    void testImpossibleLegacyDateRejected() {
        authenticate("admin", "Admin");
        Map<String, Object> body = new HashMap<>();
        body.put("due_date", "30 Feb 2026");

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
    }

    @Test
    void testDateTimeFormatsAccepted() {
        authenticate("admin", "Admin");

        // YYYY-MM-DD HH:mm:ss
        Map<String, Object> body1 = new HashMap<>();
        body1.put("due_date", "2026-10-25 15:30:00");
        ResponseEntity<?> resp1 = tenderController.updateTender("Admin", "admin", "T1", body1);
        assertEquals(HttpStatus.OK, resp1.getStatusCode());
        assertEquals("2026-10-25 15:30:00", tender1.getDueDate());

        // YYYY-MM-DDTHH:mm
        Map<String, Object> body2 = new HashMap<>();
        body2.put("due_date", "2026-10-25T15:30");
        ResponseEntity<?> resp2 = tenderController.updateTender("Admin", "admin", "T1", body2);
        assertEquals(HttpStatus.OK, resp2.getStatusCode());
        assertEquals("2026-10-25T15:30", tender1.getDueDate());
    }

    @Test
    void testNoPermittedOnlyForPreBidDate() {
        authenticate("admin", "Admin");

        // "No" on pre_bid_date is allowed
        Map<String, Object> body1 = new HashMap<>();
        body1.put("pre_bid_date", "No");
        ResponseEntity<?> resp1 = tenderController.updateTender("Admin", "admin", "T1", body1);
        assertEquals(HttpStatus.OK, resp1.getStatusCode());
        assertEquals("No", tender1.getPreBidDate());

        // "No" on opening_date is NOT allowed
        Map<String, Object> body2 = new HashMap<>();
        body2.put("opening_date", "No");
        ResponseEntity<?> resp2 = tenderController.updateTender("Admin", "admin", "T1", body2);
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
        String[] roles = {"Admin", "MIS Team", "Tender Executive", "Clearance Team", "TPC Pricing Team"};
        String[] users = {"admin", "misteam", "exec1", "clearance", "tpc"};

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
    }

    @Test
    void testInvalidRequestDoesNotPartiallyMutateTender() {
        authenticate("admin", "Admin");
        tender1.setAuthority("Original Authority");
        tender1.setDocumentFeeRaw("1000");
        tender1.setDocumentFee(1000.0);
        tender1.setOpeningDate("2026-10-20");

        // Payload has a valid authority, but an invalid date
        Map<String, Object> body = new HashMap<>();
        body.put("authority", "Mutated Authority");
        body.put("opening_date", "2026-02-31"); // impossible date

        ResponseEntity<?> response = tenderController.updateTender("Admin", "admin", "T1", body);
        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());

        // Verify tender fields were NOT mutated
        assertEquals("Original Authority", tender1.getAuthority());
        assertEquals("2026-10-20", tender1.getOpeningDate());
        assertEquals(1000.0, tender1.getDocumentFee());
    }
}

