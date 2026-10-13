package com.tenderpocket.services;

import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Comparator;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class GeMScraperServiceStorageTest {

    @Mock
    private TenderRepository tenderRepository;

    @Mock
    private ObjectStorageService objectStorageService;

    @InjectMocks
    private GeMScraperService geMScraperService;

    private Path testDocsDir;
    private final String tenderId = "GEM-TEST-999";

    @BeforeEach
    void setUp() throws Exception {
        testDocsDir = Paths.get("public/documents", tenderId);
        Files.createDirectories(testDocsDir);
        ReflectionTestUtils.setField(geMScraperService, "uploadDir", "public/documents");
    }

    @AfterEach
    void tearDown() throws Exception {
        if (testDocsDir != null && Files.exists(testDocsDir)) {
            Files.walk(testDocsDir)
                    .sorted(Comparator.reverseOrder())
                    .map(Path::toFile)
                    .forEach(File::delete);
        }
    }

    @Test
    void testRetryPendingS3UploadSucceedsAndClearsWarningNote() throws Exception {
        ReflectionTestUtils.setField(geMScraperService, "awsS3Enabled", true);

        Path localFile = testDocsDir.resolve("Bid_Document_" + tenderId + ".pdf");
        Files.write(localFile, "Mock GeM Bid Document PDF Content".getBytes());

        Tender existingTender = new Tender();
        existingTender.setId(tenderId);
        existingTender.setNotes("[S3_UPLOAD_PENDING: Connection timed out | Local copy preserved at /documents/" + tenderId + "/Bid_Document_" + tenderId + ".pdf] Original Notes");

        when(tenderRepository.findById(tenderId)).thenReturn(Optional.of(existingTender));
        when(objectStorageService.upload(eq("tenders/" + tenderId + "/Bid_Document_" + tenderId + ".pdf"), any(InputStream.class), eq("application/pdf"), anyLong()))
                .thenReturn("tenders/" + tenderId + "/Bid_Document_" + tenderId + ".pdf");

        ReflectionTestUtils.invokeMethod(geMScraperService, "retryPendingS3UploadIfPresent", tenderId);

        // Verify upload was invoked
        verify(objectStorageService, times(1)).upload(eq("tenders/" + tenderId + "/Bid_Document_" + tenderId + ".pdf"), any(InputStream.class), eq("application/pdf"), anyLong());

        // Verify pending note was removed and tender updated
        assertFalse(existingTender.getNotes().contains("S3_UPLOAD_PENDING"));
        assertTrue(existingTender.getNotes().contains("Original Notes"));
        verify(tenderRepository, times(1)).save(existingTender);
        assertTrue(Files.exists(localFile), "Local file must remain safely intact");
    }

    @Test
    void testRetryPendingS3UploadFailureKeepsWarningAndLocalDocument() throws Exception {
        ReflectionTestUtils.setField(geMScraperService, "awsS3Enabled", true);

        Path localFile = testDocsDir.resolve("Bid_Document_" + tenderId + ".pdf");
        Files.write(localFile, "Mock GeM Bid Document PDF Content".getBytes());

        Tender existingTender = new Tender();
        existingTender.setId(tenderId);
        String warning = "[S3_UPLOAD_PENDING: S3 bucket down | Local copy preserved at /documents/" + tenderId + "/Bid_Document_" + tenderId + ".pdf]";
        existingTender.setNotes(warning);

        when(tenderRepository.findById(tenderId)).thenReturn(Optional.of(existingTender));
        when(objectStorageService.upload(anyString(), any(InputStream.class), anyString(), anyLong()))
                .thenThrow(new RuntimeException("S3 bucket still down"));

        ReflectionTestUtils.invokeMethod(geMScraperService, "retryPendingS3UploadIfPresent", tenderId);

        // Verify error did not crash, warning is preserved, and local file is safe
        assertEquals(warning, existingTender.getNotes());
        verify(tenderRepository, never()).save(existingTender);
        assertTrue(Files.exists(localFile), "Local file must remain safely intact");
    }
}
