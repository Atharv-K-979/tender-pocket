package com.tenderpocket.controllers;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderWorkflowComment;
import com.tenderpocket.repositories.ActivityLogRepository;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.repositories.TenderWorkflowCommentRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Brochure documents (several files, ZIP, edit, delete) and discussion attachments. */
@ExtendWith(MockitoExtension.class)
class BrochureDocumentsAndDiscussionTest {

    @Mock private TenderRepository tenderRepository;
    @Mock private ActivityLogRepository activityLogRepository;
    @Mock private TenderWorkflowCommentRepository commentRepository;
    @InjectMocks private TenderController controller;

    private static final String TENDER_ID = "T-BROCHURE-DOCS-1";
    private static final byte[] PDF = "%PDF-1.4\nsample brochure\n".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] ZIP = new byte[] { 'P', 'K', 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
    private static final byte[] PNG = new byte[] { (byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0, 0, 0, 0 };
    private final ObjectMapper mapper = new ObjectMapper();
    private Tender tender;
    private Path docsDir;

    @BeforeEach
    void setUp() throws Exception {
        ReflectionTestUtils.setField(controller, "awsS3Enabled", false);
        tender = new Tender();
        tender.setId(TENDER_ID);
        tender.setSpecVerificationStatus("Approved");
        tender.setBrochureStatus("Pending");
        tender.setCurrentStage("EMD_PAYMENT");
        tender.setDownloadedDocs("[{\"name\":\"Bid Document\",\"filename\":\"Bid_Document_1.pdf\",\"source\":\"gem\"}]");
        docsDir = Paths.get("public/documents", TENDER_ID);
        authenticate("brochure", "ROLE_BROCHURE_TEAM");
    }

    @AfterEach
    void tearDown() throws Exception {
        SecurityContextHolder.clearContext();
        if (Files.exists(docsDir)) {
            Files.walk(docsDir).sorted(Comparator.reverseOrder()).map(Path::toFile).forEach(File::delete);
        }
    }

    private static void authenticate(String user, String authority) {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(user, "pass", List.of(new SimpleGrantedAuthority(authority))));
    }

    private List<Map<String, Object>> brochureDocs() throws Exception {
        List<Map<String, Object>> docs = mapper.readValue(tender.getDownloadedDocs(), new TypeReference<>() {});
        docs.removeIf(d -> !"brochure".equals(d.get("source")));
        return docs;
    }

    @Test
    void severalBrochureDocumentsIncludingZipAreKeptEditedAndDeleted() throws Exception {
        when(tenderRepository.findById(TENDER_ID)).thenReturn(Optional.of(tender));

        // Upload two documents at once, one of them a ZIP
        List<MultipartFile> files = List.of(
                new MockMultipartFile("file", "Fridge Leaflet.pdf", "application/pdf", PDF),
                new MockMultipartFile("file", "spares.zip", "application/zip", ZIP));
        ResponseEntity<?> upload = controller.uploadBrochure(TENDER_ID, files);
        assertEquals(200, upload.getStatusCode().value(), String.valueOf(upload.getBody()));
        assertEquals(2, brochureDocs().size());
        assertEquals("Uploaded", tender.getBrochureStatus());
        assertEquals("EMD_PAYMENT", tender.getCurrentStage(), "brochure changes never move the tender");

        // A second upload adds to the list instead of replacing
        controller.uploadBrochure(TENDER_ID, List.of(new MockMultipartFile("file", "brochure-v2.pdf", "application/pdf", PDF)));
        List<Map<String, Object>> docs = brochureDocs();
        assertEquals(3, docs.size());
        assertTrue(mapper.readValue(tender.getDownloadedDocs(), List.class).toString().contains("Bid_Document_1.pdf"), "other documents stay");
        for (Map<String, Object> d : docs) {
            assertTrue(Files.exists(docsDir.resolve(String.valueOf(d.get("filename")))), "stored: " + d.get("filename"));
        }
        assertEquals(tender.getBrochureFilename(), docs.get(2).get("filename"), "summary points at the latest document");

        // Rename one document
        String leaflet = String.valueOf(docs.get(0).get("filename"));
        assertEquals(200, controller.editBrochureDocument(TENDER_ID, leaflet, "Refrigerator leaflet", null).getStatusCode().value());
        assertEquals("Refrigerator leaflet", brochureDocs().get(0).get("name"));

        // Replace its file: the new file is stored and the old one is deleted
        ResponseEntity<?> replaced = controller.editBrochureDocument(TENDER_ID, leaflet, null,
                new MockMultipartFile("file", "Fridge Leaflet 2026.pdf", "application/pdf", PDF));
        assertEquals(200, replaced.getStatusCode().value(), String.valueOf(replaced.getBody()));
        String newLeaflet = String.valueOf(brochureDocs().get(0).get("filename"));
        assertNotEquals(leaflet, newLeaflet);
        assertTrue(Files.exists(docsDir.resolve(newLeaflet)));
        assertFalse(Files.exists(docsDir.resolve(leaflet)));

        // Delete every brochure document: the request is pending again and the files are gone
        for (Map<String, Object> d : brochureDocs()) {
            assertEquals(200, controller.deleteBrochureDocument(TENDER_ID, String.valueOf(d.get("filename"))).getStatusCode().value());
            assertFalse(Files.exists(docsDir.resolve(String.valueOf(d.get("filename")))));
        }
        assertTrue(brochureDocs().isEmpty());
        assertEquals("Pending", tender.getBrochureStatus());
        assertNull(tender.getBrochureFilename());
    }

    @Test
    void wrongOrFakeFilesAreRejectedAndNothingIsSaved() throws Exception {
        when(tenderRepository.findById(TENDER_ID)).thenReturn(Optional.of(tender));
        ResponseEntity<?> fakeZip = controller.uploadBrochure(TENDER_ID, List.of(
                new MockMultipartFile("file", "ok.pdf", "application/pdf", PDF),
                new MockMultipartFile("file", "fake.zip", "application/zip", "not a zip".getBytes(StandardCharsets.UTF_8))));
        assertEquals(400, fakeZip.getStatusCode().value());
        ResponseEntity<?> exe = controller.uploadBrochure(TENDER_ID, List.of(
                new MockMultipartFile("file", "tool.exe", "application/octet-stream", PDF)));
        assertEquals(400, exe.getStatusCode().value());
        assertTrue(brochureDocs().isEmpty());
        assertEquals("Pending", tender.getBrochureStatus());
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void onlyTheBrochureTeamCanChangeBrochureDocuments() {
        authenticate("executive", "ROLE_TENDER_EXECUTIVE");
        assertEquals(403, controller.deleteBrochureDocument(TENDER_ID, "Brochure_x.pdf").getStatusCode().value());
        assertEquals(403, controller.editBrochureDocument(TENDER_ID, "Brochure_x.pdf", "x", null).getStatusCode().value());
        verify(tenderRepository, never()).save(any());
    }

    @Test
    void discussionMessagesCarryImageAndDocumentAttachments() throws Exception {
        authenticate("brochure", "ROLE_BROCHURE_TEAM");
        when(tenderRepository.findById(TENDER_ID)).thenReturn(Optional.of(tender));

        ResponseEntity<?> posted = controller.postCommentWithAttachments(TENDER_ID, "Photos of the unit", "Brochure", List.of(
                new MockMultipartFile("files", "front view.png", "image/png", PNG),
                new MockMultipartFile("files", "datasheet.pdf", "application/pdf", PDF)));
        assertEquals(200, posted.getStatusCode().value(), String.valueOf(posted.getBody()));
        ArgumentCaptor<TenderWorkflowComment> saved = ArgumentCaptor.forClass(TenderWorkflowComment.class);
        verify(commentRepository).save(saved.capture());
        assertEquals("Photos of the unit", saved.getValue().getComment());
        assertEquals("Brochure", saved.getValue().getPhase());
        List<Map<String, Object>> attachments = mapper.readValue(saved.getValue().getAttachments(), new TypeReference<>() {});
        assertEquals(2, attachments.size());
        assertEquals("front view.png", attachments.get(0).get("name"));
        assertEquals("image/png", attachments.get(0).get("content_type"));
        for (Map<String, Object> a : attachments) {
            assertTrue(Files.exists(docsDir.resolve(String.valueOf(a.get("filename")))));
            assertTrue(String.valueOf(a.get("url")).startsWith("/documents/" + TENDER_ID + "/Discussion_"));
        }

        // An attachment-only message is fine; an empty one, a fake image or a too-long text is not
        assertEquals(200, controller.postCommentWithAttachments(TENDER_ID, "", "Spec",
                List.of(new MockMultipartFile("files", "a.pdf", "application/pdf", PDF))).getStatusCode().value());
        assertEquals(400, controller.postCommentWithAttachments(TENDER_ID, "  ", "Spec", List.of()).getStatusCode().value());
        assertEquals(400, controller.postCommentWithAttachments(TENDER_ID, "x", "Spec",
                List.of(new MockMultipartFile("files", "photo.jpg", "image/jpeg", PDF))).getStatusCode().value());
        assertEquals(400, controller.postCommentWithAttachments(TENDER_ID, "y".repeat(256), "Spec", null).getStatusCode().value());
    }
}
