package com.tenderpocket.controllers;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.ActivityLogRepository;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.services.ObjectStorageService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.InputStream;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** POST /api/tenders/{id}/upload-document - attaching a document from the PC when adding a tender. */
@ExtendWith(MockitoExtension.class)
public class TenderDocumentUploadTest {

    @Mock
    private TenderRepository tenderRepository;

    @Mock
    private ActivityLogRepository activityLogRepository;

    @Mock
    private ObjectStorageService objectStorageService;

    @InjectMocks
    private TenderController tenderController;

    private final ObjectMapper json = new ObjectMapper();
    private Tender tender;

    @BeforeEach
    void setUp() {
        tender = new Tender();
        tender.setId("T-UP-1");
        tender.setTitle("Uploaded doc tender");
        tender.setOriginalUrl("https://example.com/t");
        // Use the (mocked) object storage so no files are written during tests
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", true);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private void loginAs(String username, String role) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                username, null, List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase().replace(" ", "_")))));
    }

    private MockMultipartFile pdf(String name) {
        return new MockMultipartFile("file", name, "application/pdf", "%PDF-1.4 test".getBytes());
    }

    private List<Map<String, Object>> savedDocs() throws Exception {
        return json.readValue(tender.getDownloadedDocs(), new TypeReference<List<Map<String, Object>>>() {});
    }

    @Test
    void misCanUploadAndDocumentIsListedOnTheTender() throws Exception {
        loginAs("misteam", "MIS Team");
        when(tenderRepository.findById("T-UP-1")).thenReturn(Optional.of(tender));
        when(objectStorageService.isRemote()).thenReturn(true);

        ResponseEntity<?> response = tenderController.uploadTenderDocument("T-UP-1", pdf("Tender Spec Sheet.pdf"));

        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response: " + response.getBody());
        verify(objectStorageService).upload(eq("tenders/T-UP-1/Tender_Spec_Sheet.pdf"), any(InputStream.class), eq("application/pdf"), anyLong());
        verify(tenderRepository).save(tender);
        verify(activityLogRepository).save(any());

        List<Map<String, Object>> docs = savedDocs();
        assertEquals(1, docs.size());
        assertEquals("Tender Spec Sheet.pdf", docs.get(0).get("name"), "Shown with its original name");
        assertEquals("Tender_Spec_Sheet.pdf", docs.get(0).get("filename"));
        assertEquals("/documents/T-UP-1/Tender_Spec_Sheet.pdf", docs.get(0).get("local_path"));
        assertEquals("misteam", docs.get(0).get("uploaded_by"));
        assertNotNull(docs.get(0).get("created_date"));
    }

    @Test
    void existingDocumentsAreKeptAndSameNameDoesNotOverwrite() throws Exception {
        loginAs("misteam", "MIS Team");
        tender.setDownloadedDocs("[{\"name\":\"Bid Document\",\"filename\":\"spec.pdf\",\"local_path\":\"/documents/T-UP-1/spec.pdf\",\"created_date\":\"2026-11-01\"}]");
        when(tenderRepository.findById("T-UP-1")).thenReturn(Optional.of(tender));
        when(objectStorageService.isRemote()).thenReturn(true);

        ResponseEntity<?> response = tenderController.uploadTenderDocument("T-UP-1", pdf("spec.pdf"));

        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response: " + response.getBody());
        verify(objectStorageService).upload(eq("tenders/T-UP-1/spec_2.pdf"), any(InputStream.class), anyString(), anyLong());
        List<Map<String, Object>> docs = savedDocs();
        assertEquals(2, docs.size(), "The earlier document must still be listed");
        assertEquals("spec.pdf", docs.get(0).get("filename"));
        assertEquals("spec_2.pdf", docs.get(1).get("filename"));
    }

    @Test
    void fileNamesAreMadeSafe() throws Exception {
        loginAs("misteam", "MIS Team");
        when(tenderRepository.findById("T-UP-1")).thenReturn(Optional.of(tender));
        when(objectStorageService.isRemote()).thenReturn(true);

        // Path parts are dropped, ".." collapsed, and "emd_receipt" renamed so the file isn't treated as confidential EMD proof
        ResponseEntity<?> response = tenderController.uploadTenderDocument("T-UP-1", pdf("C:\\fakepath\\my emd_receipt..pdf"));

        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response: " + response.getBody());
        String filename = (String) savedDocs().get(0).get("filename");
        assertEquals("my_emd-receipt.pdf", filename);
        assertFalse(filename.contains(".."));
    }

    @Test
    void adminCanUploadToo() throws Exception {
        loginAs("admin", "Admin");
        when(tenderRepository.findById("T-UP-1")).thenReturn(Optional.of(tender));
        when(objectStorageService.isRemote()).thenReturn(true);

        ResponseEntity<?> response = tenderController.uploadTenderDocument("T-UP-1", pdf("a.pdf"));

        assertEquals(HttpStatus.OK, response.getStatusCode(), "Response: " + response.getBody());
        verify(tenderRepository).save(tender);
        assertEquals("admin", savedDocs().get(0).get("uploaded_by"));
    }

    @Test
    void onlyMisTeamAndAdminCanUpload() {
        for (String role : List.of("Tender Executive", "Clearance Team", "TPC Pricing Team")) {
            loginAs("user", role);
            ResponseEntity<?> response = tenderController.uploadTenderDocument("T-UP-1", pdf("a.pdf"));
            assertEquals(HttpStatus.FORBIDDEN, response.getStatusCode(), role + " must not upload here");
        }
        verifyNoInteractions(objectStorageService);
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void unknownTenderIsRejected() {
        loginAs("misteam", "MIS Team");
        when(tenderRepository.findById("NOPE")).thenReturn(Optional.empty());

        ResponseEntity<?> response = tenderController.uploadTenderDocument("NOPE", pdf("a.pdf"));
        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
        verifyNoInteractions(objectStorageService);
    }

    @Test
    void emptyOrMissingFileIsRejected() {
        loginAs("misteam", "MIS Team");
        when(tenderRepository.findById("T-UP-1")).thenReturn(Optional.of(tender));

        assertEquals(HttpStatus.BAD_REQUEST, tenderController.uploadTenderDocument("T-UP-1", null).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, tenderController.uploadTenderDocument("T-UP-1",
                new MockMultipartFile("file", "empty.pdf", "application/pdf", new byte[0])).getStatusCode());
        verifyNoInteractions(objectStorageService);
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void disallowedFileTypeIsRejected() {
        loginAs("misteam", "MIS Team");
        when(tenderRepository.findById("T-UP-1")).thenReturn(Optional.of(tender));

        for (String name : List.of("virus.exe", "script.sh", "noextension")) {
            ResponseEntity<?> response = tenderController.uploadTenderDocument("T-UP-1",
                    new MockMultipartFile("file", name, "application/octet-stream", "x".getBytes()));
            assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode(), name + " must be rejected");
        }
        verifyNoInteractions(objectStorageService);
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void unreadableDocumentListStopsTheUploadInsteadOfWipingIt() {
        loginAs("misteam", "MIS Team");
        tender.setDownloadedDocs("not json");
        when(tenderRepository.findById("T-UP-1")).thenReturn(Optional.of(tender));

        ResponseEntity<?> response = tenderController.uploadTenderDocument("T-UP-1", pdf("a.pdf"));
        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        assertEquals("not json", tender.getDownloadedDocs(), "Existing value must be left untouched");
        verifyNoInteractions(objectStorageService);
        verify(tenderRepository, never()).save(any());
    }
}
