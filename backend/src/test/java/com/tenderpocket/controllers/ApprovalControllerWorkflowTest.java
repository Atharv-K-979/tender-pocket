package com.tenderpocket.controllers;

import com.tenderpocket.models.*;
import com.tenderpocket.repositories.*;
import org.junit.jupiter.api.AfterEach;
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

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

public class ApprovalControllerWorkflowTest {

    @Mock
    private TenderRepository tenderRepository;

    @Mock
    private TenderApprovalRepository approvalRepository;

    @Mock
    private TenderCommentRepository commentRepository;

    /** Row locks taken by the approve actions; a mock does nothing here. */
    @Mock
    private jakarta.persistence.EntityManager entityManager;

    @InjectMocks
    private ApprovalController approvalController;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        SecurityContextHolder.clearContext();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private void authenticate(String username, String role) {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        username, null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase(Locale.ROOT).replace(' ', '_')))
                )
        );
    }

    @Test
    void testMisPricingApprovalUpdatesTenderPriceAndAdvancesStage() {
        authenticate("misteam", "MIS Team");

        Tender tender = new Tender();
        tender.setId("T-MIS-1");
        tender.setCurrentStage("MIS_PRICING");
        tender.setSpecVerificationStatus("Approved");
        tender.setTpcPurchasePrice(100000.0);
        tender.setMisFinalPrice(null);

        TenderApprovalRequest request = new TenderApprovalRequest("T-MIS-1", TenderWorkflowStage.MIS_PRICING, "tpc", "misteam", "PENDING");
        request.setId(10L);

        when(approvalRepository.findById(10L)).thenReturn(Optional.of(request));
        when(tenderRepository.findById("T-MIS-1")).thenReturn(Optional.of(tender));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-MIS-1"), any())).thenReturn(List.of(request));

        Map<String, Object> body = Map.of(
                "action", "APPROVED",
                "comment", "MIS pricing reviewed and finalized",
                "misFinalPrice", 135000.0
        );

        ResponseEntity<?> response = approvalController.reviewApproval(10L, body);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals(135000.0, tender.getMisFinalPrice(), "Tender mis_final_price must be updated from review body");
        assertEquals("BID_DOC_PENDING", tender.getCurrentStage(), "Stage must advance to BID_DOC_PENDING");
        assertEquals("APPROVED", request.getStatus());
        assertEquals(135000.0, request.getMisFinalPrice());
        verify(tenderRepository).save(tender);
        verify(approvalRepository).save(request);
    }

    @Test
    void testTpcPricingApprovalUpdatesTenderPriceAndCreatesMisRequest() {
        authenticate("tpc", "TPC Pricing Team");

        Tender tender = new Tender();
        tender.setId("T-TPC-1");
        tender.setCurrentStage("TPC_PRICING");
        tender.setSpecVerificationStatus("Approved");
        tender.setTpcPurchasePrice(null);

        TenderApprovalRequest request = new TenderApprovalRequest("T-TPC-1", TenderWorkflowStage.TPC_PRICING, "clearance", "tpc", "PENDING");
        request.setId(20L);

        when(approvalRepository.findById(20L)).thenReturn(Optional.of(request));
        when(tenderRepository.findById("T-TPC-1")).thenReturn(Optional.of(tender));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-TPC-1"), eq(TenderWorkflowStage.TPC_PRICING))).thenReturn(List.of(request));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-TPC-1"), eq(TenderWorkflowStage.MIS_PRICING))).thenReturn(Collections.emptyList());

        Map<String, Object> body = Map.of(
                "action", "APPROVED",
                "comment", "TPC price obtained from vendor",
                "tpcPurchasePrice", 95000.0
        );

        ResponseEntity<?> response = approvalController.reviewApproval(20L, body);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals(95000.0, tender.getTpcPurchasePrice(), "Tender tpc_purchase_price must be updated from review body");
        assertEquals("MIS_PRICING", tender.getCurrentStage(), "Stage must advance to MIS_PRICING");
        assertEquals("APPROVED", request.getStatus());
        assertEquals(95000.0, request.getTpcPurchasePrice());
        verify(tenderRepository).save(tender);
        // Verify forward MIS_PRICING request is created carrying TPC price
        verify(approvalRepository).save(argThat(r ->
                r.getStage() == TenderWorkflowStage.MIS_PRICING
                        && "PENDING".equals(r.getStatus())
                        && Double.valueOf(95000.0).equals(r.getTpcPurchasePrice())
        ));
    }

    @Test
    void testSpecClearanceApprovalAdvancesToTpcPricingAndCreatesTpcRequest() {
        authenticate("clearance", "Clearance Team");

        Tender tender = new Tender();
        tender.setId("T-SPEC-1");
        tender.setCurrentStage("SPEC_CLEARANCE");
        tender.setSpecVerificationStatus("Pending");

        TenderApprovalRequest request = new TenderApprovalRequest("T-SPEC-1", TenderWorkflowStage.SPEC_CLEARANCE, "executive", "clearance", "PENDING");
        request.setId(30L);

        when(approvalRepository.findById(30L)).thenReturn(Optional.of(request));
        when(tenderRepository.findById("T-SPEC-1")).thenReturn(Optional.of(tender));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-SPEC-1"), eq(TenderWorkflowStage.SPEC_CLEARANCE))).thenReturn(List.of(request));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-SPEC-1"), eq(TenderWorkflowStage.TPC_PRICING))).thenReturn(Collections.emptyList());

        Map<String, Object> body = Map.of(
                "action", "APPROVED",
                "comment", "Specifications fully compliant and verified"
        );

        ResponseEntity<?> response = approvalController.reviewApproval(30L, body);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("Approved", tender.getSpecVerificationStatus());
        assertEquals("BID_DOCS_PREPARATION", tender.getCurrentStage());
        assertEquals("Pending", tender.getBrochureStatus(), "Clearance also asks the Brochure Team for the brochure, in parallel");
        assertEquals("APPROVED", request.getStatus());
        verify(tenderRepository).save(tender);
    }

    @Test
    void testSpecClearanceApprovalWithComplyWithDeviations() {
        authenticate("clearance", "Clearance Team");

        Tender tender = new Tender();
        tender.setId("T-SPEC-2");
        tender.setCurrentStage("SPEC_CLEARANCE");
        tender.setSpecVerificationStatus("Pending");

        TenderApprovalRequest request = new TenderApprovalRequest("T-SPEC-2", TenderWorkflowStage.SPEC_CLEARANCE, "executive", "clearance", "PENDING");
        request.setId(31L);

        when(approvalRepository.findById(31L)).thenReturn(Optional.of(request));
        when(tenderRepository.findById("T-SPEC-2")).thenReturn(Optional.of(tender));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-SPEC-2"), eq(TenderWorkflowStage.SPEC_CLEARANCE))).thenReturn(List.of(request));

        Map<String, Object> body = Map.of(
                "action", "APPROVED",
                "complianceType", "COMPLY WITH DEVIATIONS",
                "comment", "Accepted with deviations."
        );

        ResponseEntity<?> response = approvalController.reviewApproval(31L, body);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("Approved", tender.getSpecVerificationStatus());
        assertEquals("COMPLY WITH DEVIATIONS", tender.getSpecComplianceType());
        assertEquals("BID_DOCS_PREPARATION", tender.getCurrentStage());
        assertEquals("Pending", tender.getBrochureStatus(), "Clearance also asks the Brochure Team for the brochure, in parallel");
        assertEquals("APPROVED", request.getStatus());
        verify(tenderRepository).save(tender);
    }

    @Test
    void testDocVerificationApprovalWhenTenderAtTpcPricing() {
        authenticate("misteam", "MIS Team");

        Tender tender = new Tender();
        tender.setId("T-DOC-1");
        tender.setCurrentStage("TPC_PRICING");
        tender.setVerificationStatus("Pending");

        TenderApprovalRequest request = new TenderApprovalRequest("T-DOC-1", TenderWorkflowStage.DOC_VERIFICATION, "executive", "misteam", "PENDING");
        request.setId(40L);

        when(approvalRepository.findById(40L)).thenReturn(Optional.of(request));
        when(tenderRepository.findById("T-DOC-1")).thenReturn(Optional.of(tender));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-DOC-1"), eq(TenderWorkflowStage.DOC_VERIFICATION))).thenReturn(List.of(request));

        Map<String, Object> body = Map.of(
                "action", "APPROVED",
                "comment", "13613"
        );

        ResponseEntity<?> response = approvalController.reviewApproval(40L, body);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("Approved", tender.getVerificationStatus(), "Verification status must be Approved");
        assertEquals("TPC_PRICING", tender.getCurrentStage(), "Tender stage must remain TPC_PRICING while Track A is still pending");
        assertEquals("APPROVED", request.getStatus());
        verify(tenderRepository).save(tender);
        verify(approvalRepository).save(request);
    }

    @Test
    void testDocVerificationApprovalWhenTenderAtMisPricing() {
        authenticate("misteam", "MIS Team");

        Tender tender = new Tender();
        tender.setId("T-DOC-2");
        tender.setCurrentStage("MIS_PRICING");
        tender.setVerificationStatus("Pending");

        TenderApprovalRequest request = new TenderApprovalRequest("T-DOC-2", TenderWorkflowStage.DOC_VERIFICATION, "executive", "misteam", "PENDING");
        request.setId(41L);

        when(approvalRepository.findById(41L)).thenReturn(Optional.of(request));
        when(tenderRepository.findById("T-DOC-2")).thenReturn(Optional.of(tender));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-DOC-2"), eq(TenderWorkflowStage.DOC_VERIFICATION))).thenReturn(List.of(request));

        Map<String, Object> body = Map.of(
                "action", "APPROVED",
                "comment", "All documents audited and compliant"
        );

        ResponseEntity<?> response = approvalController.reviewApproval(41L, body);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("Approved", tender.getVerificationStatus());
        assertEquals("MIS_PRICING", tender.getCurrentStage());
        assertEquals("APPROVED", request.getStatus());
        verify(tenderRepository).save(tender);
    }

    @Test
    void testDocVerificationApprovalWhenPricingAlreadyApprovedAdvancesToSubmissionReady() {
        authenticate("misteam", "MIS Team");

        Tender tender = new Tender();
        tender.setId("T-DOC-3");
        tender.setCurrentStage("DUAL_TRACK");
        tender.setPricingStatus("Approved");
        tender.setMisFinalPrice(250000.0);
        tender.setVerificationStatus("Pending");

        TenderApprovalRequest request = new TenderApprovalRequest("T-DOC-3", TenderWorkflowStage.DOC_VERIFICATION, "executive", "misteam", "PENDING");
        request.setId(42L);

        when(approvalRepository.findById(42L)).thenReturn(Optional.of(request));
        when(tenderRepository.findById("T-DOC-3")).thenReturn(Optional.of(tender));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-DOC-3"), eq(TenderWorkflowStage.DOC_VERIFICATION))).thenReturn(List.of(request));

        Map<String, Object> body = Map.of(
                "action", "APPROVED",
                "comment", "All documents verified"
        );

        ResponseEntity<?> response = approvalController.reviewApproval(42L, body);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals("Approved", tender.getVerificationStatus());
        assertEquals("SUBMISSION_READY", tender.getCurrentStage());
        assertTrue(tender.getCanFinalSubmit());
        assertEquals("APPROVED", request.getStatus());
    }

    @Test
    void testCountsForMisTeamReflectsRolePendingRatherThanGlobalAdminPending() {
        authenticate("misteam", "MIS Team");

        // Global admin status counts (e.g. 80 pending across all teams in DB)
        when(approvalRepository.countByStatusForAdmin()).thenReturn(List.<Object[]>of(
                new Object[]{"PENDING", 80L},
                new Object[]{"APPROVED", 125L},
                new Object[]{"REJECTED", 1L},
                new Object[]{"CHANGES_REQUESTED", 1L}
        ));

        // MIS Team queue has 0 pending items
        when(approvalRepository.countByStageForMisTeam(eq("misteam"), eq("PENDING"), any()))
                .thenReturn(Collections.emptyList());

        // MIS Team queue has 80 history items
        when(approvalRepository.countByStageForMisTeam(eq("misteam"), eq("HISTORY"), any()))
                .thenReturn(List.<Object[]>of(
                        new Object[]{TenderWorkflowStage.PAYMENT_APPROVAL, 50L},
                        new Object[]{TenderWorkflowStage.MIS_PRICING, 30L}
                ));

        ResponseEntity<?> response = approvalController.getPendingCounts("PENDING");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertTrue((Boolean) body.get("success"));

        Map<?, ?> pendingCounts = (Map<?, ?>) body.get("pendingCounts");
        assertEquals(0L, pendingCounts.get("TOTAL"));

        Map<?, ?> historyCounts = (Map<?, ?>) body.get("historyCounts");
        assertEquals(80L, historyCounts.get("TOTAL"));

        Map<?, ?> statusCounts = (Map<?, ?>) body.get("statusCounts");
        // Crucial assertion: MIS Team must see 0 for PENDING, not global 80!
        assertEquals(0L, statusCounts.get("PENDING"), "Non-admin statusCounts.PENDING must reflect role queue (0), not global 80");
        assertEquals(80L, statusCounts.get("HISTORY"));
        assertEquals(80L, statusCounts.get("TOTAL"));
    }

    @Test
    void testCountsForAdminReflectsGlobalTotals() {
        authenticate("admin", "Admin");

        when(approvalRepository.countByStatusForAdmin()).thenReturn(List.<Object[]>of(
                new Object[]{"PENDING", 80L},
                new Object[]{"APPROVED", 125L},
                new Object[]{"REJECTED", 1L},
                new Object[]{"CHANGES_REQUESTED", 1L}
        ));

        when(approvalRepository.countByStageForAdmin(eq("PENDING"))).thenReturn(List.<Object[]>of(
                new Object[]{TenderWorkflowStage.SPEC_CLEARANCE, 50L},
                new Object[]{TenderWorkflowStage.TPC_PRICING, 30L}
        ));

        when(approvalRepository.countByStageForAdmin(eq("HISTORY"))).thenReturn(List.<Object[]>of(
                new Object[]{TenderWorkflowStage.PAYMENT_APPROVAL, 127L}
        ));

        ResponseEntity<?> response = approvalController.getPendingCounts("PENDING");
        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);

        Map<?, ?> statusCounts = (Map<?, ?>) body.get("statusCounts");
        assertEquals(80L, statusCounts.get("PENDING"), "Admin statusCounts.PENDING must reflect global total 80");
        assertEquals(127L, statusCounts.get("HISTORY"));
        assertEquals(207L, statusCounts.get("TOTAL"));
    }
}
