package com.tenderpocket.controllers;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tenderpocket.models.*;
import com.tenderpocket.repositories.*;
import com.tenderpocket.services.WorkflowSyncService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

public class WorkflowControllerClearanceTest {

    @Mock
    private TenderRepository tenderRepository;

    @Mock
    private TenderApprovalRepository approvalRepository;

    @Mock
    private TenderCommentRepository commentRepository;

    @Mock
    private WorkflowSyncService workflowSyncService;

    /** Row locks taken by the approve actions; a mock does nothing here. */
    @Mock
    private jakarta.persistence.EntityManager entityManager;

    @InjectMocks
    private WorkflowController workflowController;

    private Tender testTender;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        SecurityContextHolder.clearContext();

        // Authenticate as Clearance Team member
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        "clearance_user", null,
                        List.of(new SimpleGrantedAuthority("ROLE_CLEARANCE_TEAM"))
                )
        );

        testTender = new Tender();
        testTender.setId("T-CLEAR-001");
        testTender.setCurrentStage("SPEC_CLEARANCE");
        testTender.setSpecVerificationStatus("Pending");
        testTender.setAssignedMisMemberSpec("clearance_user");
        testTender.setDownloadedDocs("[{\"name\":\"Combined Technical Specifications (PDF)\",\"filename\":\"Combined_Technical_Data_Sheet.pdf\",\"local_path\":\"/documents/T-CLEAR-001/Combined_Technical_Data_Sheet.pdf\"}]");

        when(tenderRepository.findById("T-CLEAR-001")).thenReturn(Optional.of(testTender));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(eq("T-CLEAR-001"), eq(TenderWorkflowStage.SPEC_CLEARANCE)))
                .thenReturn(Collections.emptyList());
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("Clearance member can GRANT CLEARANCE with ALL COMPLY and no uploads")
    void testGrantClearanceAllComplyWithoutUploads() {
        ResponseEntity<?> resp = workflowController.approveClearanceMultipart(
                "T-CLEAR-001", "clearance_user", "ALL COMPLY",
                "Specifications verified and completely comply.", null, null, null, null, null
        );

        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals("Approved", testTender.getSpecVerificationStatus());
        assertEquals("ALL COMPLY", testTender.getSpecComplianceType());
        verify(tenderRepository, atLeastOnce()).save(testTender);
    }

    @Test
    @DisplayName("Clearance member can GRANT CLEARANCE with COMPLY WITH DEVIATIONS without mandatory uploads")
    void testGrantClearanceComplyWithDeviationsWithoutUploads() {
        ResponseEntity<?> resp = workflowController.approveClearanceMultipart(
                "T-CLEAR-001", "clearance_user", "COMPLY WITH DEVIATIONS",
                "Deviations noted and accepted.", null, null, null, null, null
        );

        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals("Approved", testTender.getSpecVerificationStatus());
        assertEquals("COMPLY WITH DEVIATIONS", testTender.getSpecComplianceType());
        verify(tenderRepository, atLeastOnce()).save(testTender);
    }

    @Test
    @DisplayName("Clearance member uploading superior docs replaces AI docs in downloaded_docs")
    void testGrantClearanceWithSuperiorDocsReplacesAiDocs() throws Exception {
        MockMultipartFile superiorWord = new MockMultipartFile(
                "docxFile", "revised_spec.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "Superior specification Word content".getBytes()
        );

        ResponseEntity<?> resp = workflowController.approveClearanceMultipart(
                "T-CLEAR-001", "clearance_user", "COMPLY WITH DEVIATIONS",
                "Clearance superior Word document replacing executive spec.",
                null, superiorWord, null, null, null
        );

        assertEquals(HttpStatus.OK, resp.getStatusCode());
        assertEquals("Approved", testTender.getSpecVerificationStatus());
        assertEquals("COMPLY WITH DEVIATIONS", testTender.getSpecComplianceType());

        // Verify downloaded_docs updated with superior clearance replacement and only clearance-uploaded docs carry forward
        ObjectMapper mapper = new ObjectMapper();
        List<Map<String, Object>> docs = mapper.readValue(testTender.getDownloadedDocs(), new TypeReference<>() {});
        assertEquals(1, docs.size(), "Only documents uploaded by clearance must be carried forward");
        boolean foundSuperiorWord = docs.stream().anyMatch(d ->
                "Combined_Technical_Data_Sheet.docx".equals(d.get("filename")) && Boolean.TRUE.equals(d.get("superior"))
        );
        assertTrue(foundSuperiorWord, "Superior DOCX uploaded by clearance must be recorded in downloaded_docs");
        boolean foundOldPdf = docs.stream().anyMatch(d -> "Combined_Technical_Data_Sheet.pdf".equals(d.get("filename")));
        assertFalse(foundOldPdf, "Old AI-generated PDF must not be carried forward when clearance uploaded replacement Word spec");
        assertEquals("Combined_Technical_Data_Sheet.docx", testTender.getFinalTechSpecFilename());
    }
}
