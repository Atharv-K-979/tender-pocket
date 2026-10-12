package com.tenderpocket.services;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;

import static org.junit.jupiter.api.Assertions.*;

public class LocalStorageServiceTest {

    private Path tempDir;
    private LocalStorageService storageService;

    @BeforeEach
    void setUp() throws Exception {
        tempDir = Files.createTempDirectory("test-local-storage-");
        storageService = new LocalStorageService(tempDir.toString());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (tempDir != null && Files.exists(tempDir)) {
            Files.walk(tempDir)
                    .sorted(Comparator.reverseOrder())
                    .map(Path::toFile)
                    .forEach(File::delete);
        }
    }

    @Test
    void testUploadAndExistsAndDownloadUrl() throws Exception {
        String key = "tenders/456/sample.pdf";
        byte[] data = "Sample PDF Local Content".getBytes();
        InputStream is = new ByteArrayInputStream(data);

        String resultKey = storageService.upload(key, is, "application/pdf", data.length);
        assertEquals(key, resultKey);

        assertTrue(storageService.exists(key));

        String downloadUrl = storageService.generateDownloadUrl(key);
        assertEquals("/documents/456/sample.pdf", downloadUrl);

        Path savedFile = tempDir.resolve("456/sample.pdf");
        assertTrue(Files.exists(savedFile));
        assertArrayEquals(data, Files.readAllBytes(savedFile));
    }

    @Test
    void testExistsReturnsFalseWhenMissing() {
        assertFalse(storageService.exists("tenders/999/nonexistent.pdf"));
    }

    @Test
    void testDeleteRemovesFile() {
        String key = "tenders/456/to_delete.pdf";
        storageService.upload(key, new ByteArrayInputStream("to delete".getBytes()), "application/pdf", 9);
        assertTrue(storageService.exists(key));

        storageService.delete(key);
        assertFalse(storageService.exists(key));
    }

    @Test
    void testIsRemoteReturnsFalse() {
        assertFalse(storageService.isRemote());
    }
}
