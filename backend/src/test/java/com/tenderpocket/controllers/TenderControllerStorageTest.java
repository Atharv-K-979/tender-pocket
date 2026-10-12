package com.tenderpocket.controllers;

import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.ActivityLogRepository;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.services.DocumentGeneratorService;
import com.tenderpocket.services.ObjectStorageService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.File;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class TenderControllerStorageTest {

    @Mock
    private TenderRepository tenderRepository;

    @Mock
    private ActivityLogRepository activityLogRepository;

    @Mock
    private DocumentGeneratorService documentGeneratorService;

    @Mock
    private com.tenderpocket.services.ComplianceProgressService complianceProgressService;

    @Mock
    private ObjectStorageService objectStorageService;

    @InjectMocks
    private TenderController tenderController;

    private Path testDocsDir;
    private final String tenderId = "T-STORAGE-100";

    @BeforeEach
    void setUp() throws Exception {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("executive", "pass", List.of(new SimpleGrantedAuthority("ROLE_TENDER_EXECUTIVE")))
        );

        testDocsDir = Paths.get("public/documents", tenderId);
        Files.createDirectories(testDocsDir);
    }

    @AfterEach
    void tearDown() throws Exception {
        SecurityContextHolder.clearContext();
        if (testDocsDir != null && Files.exists(testDocsDir)) {
            Files.walk(testDocsDir)
                    .sorted(Comparator.reverseOrder())
                    .map(Path::toFile)
                    .forEach(File::delete);
        }
    }

    @Test
    void testDownloadWhenS3EnabledAndObjectExistsInS3Redirects302() {
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", true);
        when(objectStorageService.isRemote()).thenReturn(true);
        when(objectStorageService.exists("tenders/" + tenderId + "/test.pdf")).thenReturn(true);
        when(objectStorageService.generateDownloadUrl("tenders/" + tenderId + "/test.pdf"))
                .thenReturn("https://s3.ap-south-1.amazonaws.com/bucket/tenders/" + tenderId + "/test.pdf?X-Amz-Signature=abc");

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, "test.pdf");

        assertEquals(HttpStatus.FOUND, response.getStatusCode());
        assertEquals(URI.create("https://s3.ap-south-1.amazonaws.com/bucket/tenders/" + tenderId + "/test.pdf?X-Amz-Signature=abc"),
                response.getHeaders().getLocation());
    }

    @Test
    void testDownloadWhenS3EnabledAndObjectNotInS3FallsBackToExistingLocalFile() throws Exception {
        // Safe compatibility strategy for the 85 existing local documents
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", true);
        when(objectStorageService.isRemote()).thenReturn(true);
        when(objectStorageService.exists("tenders/" + tenderId + "/local_doc.pdf")).thenReturn(false);

        Path localFile = testDocsDir.resolve("local_doc.pdf");
        Files.write(localFile, "Existing Local Document Content".getBytes());

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, "local_doc.pdf");

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertTrue(response.getBody() instanceof Resource);
        assertEquals("application/pdf", response.getHeaders().getContentType().toString());
        assertTrue(response.getHeaders().getFirst("Content-Disposition").contains("local_doc.pdf"));
    }

    @Test
    void testDownloadWhenS3EnabledAndMissingInBothReturns404() {
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", true);
        when(objectStorageService.isRemote()).thenReturn(true);
        when(objectStorageService.exists("tenders/" + tenderId + "/missing.pdf")).thenReturn(false);

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, "missing.pdf");

        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
    }

    @Test
    void testDownloadWhenS3DisabledAndFileExistsLocallyReturns200() throws Exception {
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", false);

        Path localFile = testDocsDir.resolve("local_spec.docx");
        Files.write(localFile, "Sample DOCX Content".getBytes());

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, "local_spec.docx");

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertTrue(response.getHeaders().getFirst("Content-Disposition").contains("local_spec.docx"));
    }

    @Test
    void testDownloadWhenS3DisabledAndFileMissingReturns404() {
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", false);

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, "absent.pdf");

        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
    }

    @Test
    void testGenerateBidDocsUploadsToS3WhenEnabled() throws Exception {
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", true);
        when(objectStorageService.isRemote()).thenReturn(true);

        Tender tender = new Tender();
        tender.setId(tenderId);
        tender.setTitle("Medical Procurement");
        tender.setSpecVerificationStatus("Approved");
        tender.setMisFinalPrice(75000.0);
        tender.setDownloadedDocs("[{\"name\":\"Technical Specification Sheet (PDF)\"}]");

        when(tenderRepository.findById(tenderId)).thenReturn(Optional.of(tender));
        when(documentGeneratorService.generatePdf(anyMap())).thenReturn("PDF data".getBytes());
        when(documentGeneratorService.generateDocx(anyMap())).thenReturn("DOCX data".getBytes());
        when(documentGeneratorService.generateTechSpecPdf(anyMap())).thenReturn("Tech PDF data".getBytes());
        when(documentGeneratorService.generateTechSpecDocx(anyMap())).thenReturn("Tech DOCX data".getBytes());

        Map<String, String> body = Map.of("bidNumber", "BID-100", "companyName", "Mark Enterprises");
        ResponseEntity<?> response = tenderController.generateBidDocs("Tender Executive", "executive", tenderId, body);

        assertEquals(HttpStatus.OK, response.getStatusCode());

        // Verify all 4 documents were uploaded to S3
        ArgumentCaptor<String> keyCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> typeCaptor = ArgumentCaptor.forClass(String.class);
        verify(objectStorageService, times(4)).upload(keyCaptor.capture(), any(InputStream.class), typeCaptor.capture(), anyLong());

        List<String> uploadedKeys = keyCaptor.getAllValues();
        assertTrue(uploadedKeys.contains("tenders/" + tenderId + "/Bid_Documents_" + tenderId + ".pdf"));
        assertTrue(uploadedKeys.contains("tenders/" + tenderId + "/Bid_Documents_" + tenderId + ".docx"));
        assertTrue(uploadedKeys.contains("tenders/" + tenderId + "/Technical_Specification_Sheet_" + tenderId + ".pdf"));
        assertTrue(uploadedKeys.contains("tenders/" + tenderId + "/Technical_Specification_Sheet_" + tenderId + ".docx"));

        List<String> contentTypes = typeCaptor.getAllValues();
        assertTrue(contentTypes.contains("application/pdf"));
        assertTrue(contentTypes.contains("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    }

    @Test
    void testGenerateBidDocsSurfacesErrorOnS3UploadFailure() throws Exception {
        // Verifies upload failure is not hidden by silent fallback
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", true);
        when(objectStorageService.isRemote()).thenReturn(true);

        Tender tender = new Tender();
        tender.setId(tenderId);
        tender.setTitle("Medical Procurement");
        tender.setSpecVerificationStatus("Approved");
        tender.setMisFinalPrice(75000.0);
        tender.setDownloadedDocs("[{\"name\":\"Technical Specification Sheet (PDF)\"}]");

        when(tenderRepository.findById(tenderId)).thenReturn(Optional.of(tender));
        when(documentGeneratorService.generatePdf(anyMap())).thenReturn("PDF data".getBytes());

        when(objectStorageService.upload(anyString(), any(InputStream.class), anyString(), anyLong()))
                .thenThrow(new RuntimeException("S3 bucket tender-pocket-uat-documents does not exist"));

        Map<String, String> body = Map.of("bidNumber", "BID-100");
        ResponseEntity<?> response = tenderController.generateBidDocs("Tender Executive", "executive", tenderId, body);

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertTrue(response.getBody().toString().contains("Failed to generate documents"));
        assertTrue(response.getBody().toString().contains("S3 bucket tender-pocket-uat-documents does not exist"));
    }

    @Test
    void testGenerateBidDocsWritesLocallyWhenS3Disabled() throws Exception {
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", false);

        Tender tender = new Tender();
        tender.setId(tenderId);
        tender.setTitle("Medical Procurement");
        tender.setSpecVerificationStatus("Approved");
        tender.setMisFinalPrice(75000.0);
        tender.setDownloadedDocs("[{\"name\":\"Technical Specification Sheet (PDF)\"}]");

        when(tenderRepository.findById(tenderId)).thenReturn(Optional.of(tender));
        when(documentGeneratorService.generatePdf(anyMap())).thenReturn("PDF local data".getBytes());
        when(documentGeneratorService.generateDocx(anyMap())).thenReturn("DOCX local data".getBytes());
        when(documentGeneratorService.generateTechSpecPdf(anyMap())).thenReturn("Tech PDF local data".getBytes());
        when(documentGeneratorService.generateTechSpecDocx(anyMap())).thenReturn("Tech DOCX local data".getBytes());

        Map<String, String> body = Map.of("bidNumber", "BID-100");
        ResponseEntity<?> response = tenderController.generateBidDocs("Tender Executive", "executive", tenderId, body);

        assertEquals(HttpStatus.OK, response.getStatusCode());

        // Verify S3 upload was NEVER called
        verify(objectStorageService, never()).upload(anyString(), any(InputStream.class), anyString(), anyLong());

        // Verify files exist locally
        assertTrue(Files.exists(testDocsDir.resolve("Bid_Documents_" + tenderId + ".pdf")));
        assertTrue(Files.exists(testDocsDir.resolve("Bid_Documents_" + tenderId + ".docx")));
        assertTrue(Files.exists(testDocsDir.resolve("Technical_Specification_Sheet_" + tenderId + ".pdf")));
        assertTrue(Files.exists(testDocsDir.resolve("Technical_Specification_Sheet_" + tenderId + ".docx")));
    }

    @Test
    void testPathTraversalRejectedWithBadRequest() {
        // Path traversal in ID
        ResponseEntity<?> resp1 = tenderController.downloadDocumentFile("../etc", "passwd");
        assertEquals(HttpStatus.BAD_REQUEST, resp1.getStatusCode());

        // Path traversal in filename
        ResponseEntity<?> resp2 = tenderController.downloadDocumentFile(tenderId, "../../../secret.txt");
        assertEquals(HttpStatus.BAD_REQUEST, resp2.getStatusCode());

        // Slash or backslash in path segment
        ResponseEntity<?> resp3 = tenderController.downloadDocumentFile(tenderId, "sub/file.pdf");
        assertEquals(HttpStatus.BAD_REQUEST, resp3.getStatusCode());
    }

    @Test
    void testUnauthenticatedAccessRejected() {
        SecurityContextHolder.clearContext();
        ResponseEntity<?> resp = tenderController.downloadDocumentFile(tenderId, "doc.pdf");
        assertEquals(HttpStatus.FORBIDDEN, resp.getStatusCode());
    }

    @Test
    void testS3ExistsFailureWithoutLocalFileReturns500() {
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", true);
        when(objectStorageService.isRemote()).thenReturn(true);
        when(objectStorageService.exists("tenders/" + tenderId + "/broken.pdf"))
                .thenThrow(new RuntimeException("Access denied checking S3 object existence for key: tenders/" + tenderId + "/broken.pdf in bucket: my-bucket"));

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, "broken.pdf");

        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, response.getStatusCode());
        assertTrue(response.getBody().toString().contains("S3 document storage error"));
    }

    @Test
    void testS3ExistsFailureWithHistoricalLocalFileFallsBackSafely() throws Exception {
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", true);
        when(objectStorageService.isRemote()).thenReturn(true);
        when(objectStorageService.exists("tenders/" + tenderId + "/resilient.pdf"))
                .thenThrow(new RuntimeException("Network or unexpected failure checking S3 object existence"));

        Path localFile = testDocsDir.resolve("resilient.pdf");
        Files.write(localFile, "Historical local document data".getBytes());

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, "resilient.pdf");

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
    }

    @Test
    void testLocalStoragePathCompatibilityWithDeploymentLayout() throws Exception {
        ReflectionTestUtils.setField(tenderController, "awsS3Enabled", false);
        ReflectionTestUtils.setField(tenderController, "uploadDir", "public/documents");

        com.tenderpocket.services.LocalStorageService localStorageService =
                new com.tenderpocket.services.LocalStorageService("public/documents");

        byte[] payload = "Deployment Mount Shared Content".getBytes();
        localStorageService.upload("tenders/" + tenderId + "/shared.pdf", new java.io.ByteArrayInputStream(payload), "application/pdf", payload.length);

        // Verify tenderController serves the exact same file created by LocalStorageService
        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, "shared.pdf");

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
    }
}
