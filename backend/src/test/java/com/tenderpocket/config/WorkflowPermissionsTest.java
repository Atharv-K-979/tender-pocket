package com.tenderpocket.config;

import com.fasterxml.jackson.databind.*;
import com.tenderpocket.controllers.*;
import com.tenderpocket.models.*;
import com.tenderpocket.repositories.*;
import java.util.*;
import java.util.stream.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
import org.springframework.http.*;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static com.tenderpocket.config.WorkflowPermissions.Action.*;

class WorkflowPermissionsTest {
    private static final String[] ACTION_NAMES = {"viewTenders", "uploadSpecs", "approveSpecs", "setTpcPrice",
            "viewTpcPrice", "setMisPrice", "generateBids", "reviewBids", "recordPayment",
            "recordSubmission", "recordOutcome", "manageUsers", "viewAudit"};

    static Stream<Arguments> matrix() throws Exception {
        JsonNode matrix = new ObjectMapper().readTree(
                WorkflowPermissionsTest.class.getResourceAsStream("/workflow-permissions.json"));
        List<Arguments> cases = new ArrayList<>();
        matrix.fields().forEachRemaining(entry -> {
            Set<String> granted = new HashSet<>();
            entry.getValue().forEach(node -> granted.add(node.asText()));
            for (int i = 0; i < ACTION_NAMES.length; i++) {
                cases.add(Arguments.of(entry.getKey(), WorkflowPermissions.Action.values()[i], granted.contains(ACTION_NAMES[i])));
            }
        });
        return cases.stream();
    }

    @ParameterizedTest @MethodSource("matrix")
    void matchesReadme(String role, WorkflowPermissions.Action action, boolean expected) {
        assertEquals(expected, WorkflowPermissions.allowed(role, action));
        authenticate(role);
        assertEquals(expected, WorkflowPermissions.allowed(action));
    }

    @AfterEach void cleanup() { SecurityContextHolder.clearContext(); }

    private static void authenticate(String role) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                "verified-user", null, List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase(Locale.ROOT).replace(' ', '_')))));
    }

    @Test void aliasesDoNotTurnLegacyExecutivesIntoMisReviewers() {
        assertTrue(WorkflowPermissions.allowed("MIS Executive", GENERATE_BIDS));
        assertFalse(WorkflowPermissions.allowed("MIS Executive", REVIEW_BIDS));
        assertTrue(WorkflowPermissions.allowed("Specification Team", APPROVE_SPEC));
        assertTrue(WorkflowPermissions.allowed("TPC Team", SET_TPC_PRICE));
        assertFalse(WorkflowPermissions.allowed("User", VIEW_TENDERS));
        assertFalse(WorkflowPermissions.allowed((String) null, UPLOAD_SPEC));
    }

    @ParameterizedTest @ValueSource(ints = {32, 48, 64})
    void jwtAlgorithmMatchesSupportedFrontendVerification(int bytes) throws Exception {
        var jwt = new JwtUtil();
        ReflectionTestUtils.setField(jwt, "secret", "k".repeat(bytes));
        ReflectionTestUtils.setField(jwt, "expiration", 60L);
        String token = jwt.generateToken("verified-user", "Admin");
        JsonNode header = new ObjectMapper().readTree(Base64.getUrlDecoder().decode(token.split("\\.")[0]));
        assertEquals(bytes == 32 ? "HS256" : bytes == 48 ? "HS384" : "HS512", header.path("alg").asText());
        assertEquals("Admin", jwt.extractRole(token));
    }

    @ParameterizedTest @ValueSource(strings = {"Admin", "Tender Executive", "Clearance Team", "TPC Pricing Team", "MIS Team"})
    void endpointGuardsRunBeforeRepositoryOrProviderEffects(String role) {
        authenticate(role);
        var repository = mock(TenderRepository.class);
        when(repository.findById(anyString())).thenReturn(Optional.empty());
        var workflow = new WorkflowController();
        var tenders = new TenderController();
        ReflectionTestUtils.setField(workflow, "tenderRepository", repository);
        ReflectionTestUtils.setField(tenders, "tenderRepository", repository);
        var actions = List.of(UPLOAD_SPEC, APPROVE_SPEC, SET_TPC_PRICE, SET_MIS_PRICE, GENERATE_BIDS,
                RECORD_PAYMENT, RECORD_SUBMISSION, RECORD_OUTCOME);
        var responses = List.of(
            workflow.sendClearanceRequest("missing", "Admin", "spoofed", Map.of()),
            workflow.approveClearance("missing", "spoofed", Map.of()),
            workflow.submitTpcPrice("missing", "spoofed", Map.of()),
            workflow.submitMisPrice("missing", "spoofed", Map.of()),
            tenders.generateBidDocs("Admin", "spoofed", "missing", Map.of()),
            workflow.submitPaymentRequest("missing", "spoofed", Map.of()),
            workflow.submitSubmissionRequest("missing", "spoofed", Map.of()),
            workflow.submitWinLossRequest("missing", "spoofed", Map.of()));
        for (int i = 0; i < actions.size(); i++) {
            assertEquals(WorkflowPermissions.allowed(role, actions.get(i)) ? 404 : 403,
                    responses.get(i).getStatusCode().value(), actions.get(i).name());
        }
        verify(repository, never()).save(any());
    }

    @Test void forgedHeadersCannotBypassAuthenticationOrUserManagement() {
        SecurityContextHolder.clearContext();
        assertEquals(403, new TenderController().generateBidDocs("Admin", "admin", "missing", Map.of()).getStatusCode().value());
        assertEquals(403, new WorkflowController().sendClearanceRequest("missing", "Admin", "admin", Map.of()).getStatusCode().value());
        authenticate("MIS Team");
        assertEquals(403, new AuthController().createUser("Admin", "admin", null, Map.of()).getStatusCode().value());
        var logController = new ActivityLogController();
        ReflectionTestUtils.setField(logController, "activityLogRepository", mock(ActivityLogRepository.class));
        assertEquals(403, logController.getActivityLogs(null).getStatusCode().value());
    }

    @Test void genericPatchCannotBypassPricingOrApprovalPermissions() {
        authenticate("Tender Executive");
        assertFalse(WorkflowPermissions.allowedPatch(Map.of("tpc_purchase_price", 100), "SPEC_CLEARANCE"));
        assertFalse(WorkflowPermissions.allowedPatch(Map.of("spec_verification_status", "Approved"), "SPEC_CLEARANCE"));
        assertFalse(WorkflowPermissions.allowedPatch(Map.of("payment_status", "Approved"), "SPEC_CLEARANCE"));
        assertFalse(WorkflowPermissions.allowedPatch(Map.of("current_stage", "WON"), "SPEC_CLEARANCE"));
        assertFalse(WorkflowPermissions.allowedPatch(Map.of("status", "Won"), "SPEC_CLEARANCE"));
        assertTrue(WorkflowPermissions.allowedPatch(Map.of("notes", "Operational note"), "SPEC_CLEARANCE"));
    }

    @Test void completedApprovalCannotBypassStageAuthorization() {
        authenticate("Clearance Team");
        var repository = mock(TenderApprovalRepository.class);
        var request = new TenderApprovalRequest("T-1", TenderWorkflowStage.MIS_PRICING, "tpc", "misteam", "APPROVED");
        when(repository.findById(1L)).thenReturn(Optional.of(request));
        var controller = new ApprovalController();
        ReflectionTestUtils.setField(controller, "approvalRepository", repository);
        var response = controller.reviewApproval(1L, Map.of("action", "APPROVED", "comment", "Review"));
        assertEquals(403, response.getStatusCode().value());
        verify(repository, never()).save(any());
    }

    @Test void priceAdviceMasksNestedDataWithoutMutatingStoredEntities() {
        var original = Map.of("tpc_purchase_price", 450000, "nested", List.of(Map.of(
                "tpcPurchasePrice", 450000, "stage", "TPC_PRICING", "commentText", "Quote 450000")));
        var advice = new ManufacturerPriceAdvice(new ObjectMapper());
        for (String role : List.of("Tender Executive", "Clearance Team")) {
            authenticate(role);
            Object result = advice.beforeBodyWrite(original, null, MediaType.APPLICATION_JSON,
                    MappingJackson2HttpMessageConverter.class, null, null);
            JsonNode json = (JsonNode) result;
            assertTrue(json.path("tpc_purchase_price").isNull());
            assertTrue(json.path("nested").path(0).path("tpcPurchasePrice").isNull());
            assertFalse(json.toString().contains("450000"));
        }
        assertEquals(450000, original.get("tpc_purchase_price"));
        authenticate("MIS Team");
        assertSame(original, advice.beforeBodyWrite(original, null, MediaType.APPLICATION_JSON,
                MappingJackson2HttpMessageConverter.class, null, null));
    }

    @ParameterizedTest @ValueSource(strings = {"DOC_VERIFICATION", "PAYMENT_APPROVAL"})
    void legacyReviewUsesTheSameDocumentThenPaymentOrder(String stage) {
        authenticate("MIS Team");
        var tender = new Tender();
        tender.setId("T-1"); tender.setCurrentStage(stage);
        var request = new TenderApprovalRequest("T-1", TenderWorkflowStage.valueOf(stage),
                "executive", "verified-user", "PENDING");
        var tenders = mock(TenderRepository.class);
        var approvals = mock(TenderApprovalRepository.class);
        when(tenders.findById("T-1")).thenReturn(Optional.of(tender));
        when(approvals.findByTenderIdOrderByCreatedAtDesc("T-1")).thenReturn(List.of(request));
        var controller = new WorkflowController();
        ReflectionTestUtils.setField(controller, "tenderRepository", tenders);
        ReflectionTestUtils.setField(controller, "approvalRepository", approvals);
        ReflectionTestUtils.setField(controller, "commentRepository", mock(TenderCommentRepository.class));
        var response = controller.reviewApproval("T-1", Map.of("action", "APPROVED", "comment", "Reviewed"));
        assertEquals(200, response.getStatusCode().value());
        assertEquals(stage.equals("DOC_VERIFICATION") ? "PAYMENT_APPROVAL" : "SUBMISSION_PENDING", tender.getCurrentStage());
        assertEquals("Approved", stage.equals("DOC_VERIFICATION") ? tender.getVerificationStatus() : tender.getPaymentStatus());
    }
}
