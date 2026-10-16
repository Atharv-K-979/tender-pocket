package com.tenderpocket.controllers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tenderpocket.models.*;
import com.tenderpocket.repositories.TenderApprovalRepository;
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

import java.time.LocalDateTime;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

public class ApprovalControllerTest {

    @Mock
    private TenderApprovalRepository approvalRepository;

    @Mock
    private TenderRepository tenderRepository;

    @InjectMocks
    private ApprovalController approvalController;

    private Tender testTender;
    private TenderApprovalRequest specRequest;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        SecurityContextHolder.clearContext();

        testTender = new Tender();
        testTender.setId("T-100");
        testTender.setRefNo("REF-100");
        testTender.setTitle("High-Tech Equipment Tender");
        testTender.setAuthority("Railways Dept");
        testTender.setBidQty(75);
        testTender.setQuotedQty(70);
        testTender.setCurrentStage("SPEC_CLEARANCE");
        testTender.setSpecVerificationStatus("Pending");
        testTender.setDownloadedDocs("[\"Technical Specification Doc\"]");

        specRequest = new TenderApprovalRequest();
        specRequest.setId(1L);
        specRequest.setTenderId("T-100");
        specRequest.setStage(TenderWorkflowStage.SPEC_CLEARANCE);
        specRequest.setStatus("PENDING");
        specRequest.setRequestedBy("executive_1");
        specRequest.setAssignedTo("clearance_team");
        specRequest.setCreatedAt(LocalDateTime.now());
    }

    private void authenticate(String username, String role) {
        SimpleGrantedAuthority authority = new SimpleGrantedAuthority("ROLE_" + role.toUpperCase().replace(" ", "_"));
        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                username, null, Collections.singletonList(authority));
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    @Test
    void testApprovalSummaryDtoPopulatesQuantities() {
        ApprovalSummaryDto dto = new ApprovalSummaryDto(specRequest, testTender);

        assertEquals(75, dto.getTenderBidQty());
        assertEquals(70, dto.getTenderQuotedQty());
        assertEquals(75, dto.getBidQty());
        assertEquals(70, dto.getQuotedQty());
        assertEquals(75, dto.getTenderBidQtySnake());
        assertEquals(70, dto.getTenderQuotedQtySnake());
    }

    @Test
    void testApprovalSummaryDtoHandlesNullQuantities() {
        testTender.setBidQty(null);
        testTender.setQuotedQty(null);

        ApprovalSummaryDto dto = new ApprovalSummaryDto(specRequest, testTender);

        assertNull(dto.getTenderBidQty());
        assertNull(dto.getTenderQuotedQty());
        assertNull(dto.getBidQty());
        assertNull(dto.getQuotedQty());
    }

    @Test
    void testApprovalSummaryDtoSerializationKeys() throws Exception {
        ApprovalSummaryDto dto = new ApprovalSummaryDto(specRequest, testTender);

        ObjectMapper mapper = new ObjectMapper();
        mapper.findAndRegisterModules();
        String json = mapper.writeValueAsString(dto);
        JsonNode node = mapper.readTree(json);

        assertTrue(node.has("tenderBidQty"), "JSON must contain tenderBidQty");
        assertTrue(node.has("tender_bid_qty"), "JSON must contain tender_bid_qty");
        assertTrue(node.has("bid_qty"), "JSON must contain bid_qty");
        assertEquals(75, node.get("tenderBidQty").asInt());
        assertEquals(75, node.get("tender_bid_qty").asInt());

        assertTrue(node.has("tenderQuotedQty"), "JSON must contain tenderQuotedQty");
        assertTrue(node.has("tender_quoted_qty"), "JSON must contain tender_quoted_qty");
        assertTrue(node.has("quoted_qty"), "JSON must contain quoted_qty");
        assertEquals(70, node.get("tenderQuotedQty").asInt());
        assertEquals(70, node.get("tender_quoted_qty").asInt());
    }

    @Test
    void testGetPendingApprovalsReturnsQuantitiesForClearanceTeam() {
        authenticate("clearance_user", "Clearance Team");

        when(approvalRepository.findByAssignedToAndStageAndStatusOrderByCreatedAtDesc(
                eq("clearance_user"), eq(TenderWorkflowStage.SPEC_CLEARANCE), eq("PENDING")))
                .thenReturn(List.of(specRequest));

        when(tenderRepository.findAllById(anySet())).thenReturn(List.of(testTender));

        ResponseEntity<?> response = approvalController.getPendingApprovals(
                "SPEC_CLEARANCE", null, "PENDING", null, null);

        assertEquals(HttpStatus.OK, response.getStatusCode());

        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertTrue((Boolean) body.get("success"));

        List<?> list = (List<?>) body.get("approvals");
        assertEquals(1, list.size());

        ApprovalSummaryDto item = (ApprovalSummaryDto) list.get(0);
        assertEquals(75, item.getTenderBidQty(), "Clearance Team approval queue must receive Bid Quantity");
        assertEquals(70, item.getTenderQuotedQty(), "Clearance Team approval queue must receive Quoted Quantity");
    }

    @Test
    void testUnauthorizedRoleDeniedPendingApprovals() {
        authenticate("exec_user", "Tender Executive");

        ResponseEntity<?> response = approvalController.getPendingApprovals(
                "SPEC_CLEARANCE", null, "PENDING", null, null);

        assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertFalse((Boolean) body.get("success"));
        assertTrue(body.get("error").toString().contains("Access denied"));
    }
}
