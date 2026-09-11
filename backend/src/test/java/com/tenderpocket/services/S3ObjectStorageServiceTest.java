package com.tenderpocket.services;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectResponse;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URL;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class S3ObjectStorageServiceTest {

    @Mock
    private S3Client s3Client;

    @Mock
    private S3Presigner s3Presigner;

    private S3ObjectStorageService storageService;

    private final String bucketName = "test-tender-pocket-bucket";

    @BeforeEach
    void setUp() {
        storageService = new S3ObjectStorageService(s3Client, s3Presigner, bucketName);
    }

    @Test
    void testUploadSuccess() {
        String key = "tenders/123/Bid_Document_123.pdf";
        byte[] data = "Sample PDF Content".getBytes();
        InputStream is = new ByteArrayInputStream(data);

        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenReturn(PutObjectResponse.builder().build());

        String resultKey = storageService.upload(key, is, "application/pdf", data.length);

        assertEquals(key, resultKey);
        verify(s3Client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
    }

    @Test
    void testUploadWithNegativeLengthReadsAllBytes() {
        String key = "tenders/123/specification.pdf";
        byte[] data = "Sample Spec Content".getBytes();
        InputStream is = new ByteArrayInputStream(data);

        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenReturn(PutObjectResponse.builder().build());

        String resultKey = storageService.upload(key, is, "application/pdf", -1);

        assertEquals(key, resultKey);
        verify(s3Client, times(1)).putObject(any(PutObjectRequest.class), any(RequestBody.class));
    }

    @Test
    void testUploadThrowsRuntimeExceptionOnS3Exception() {
        String key = "tenders/123/fail.pdf";
        byte[] data = "Content".getBytes();
        InputStream is = new ByteArrayInputStream(data);

        when(s3Client.putObject(any(PutObjectRequest.class), any(RequestBody.class)))
                .thenThrow(S3Exception.builder().message("Access Denied").build());

        RuntimeException exception = assertThrows(RuntimeException.class, () ->
                storageService.upload(key, is, "application/pdf", data.length)
        );

        assertTrue(exception.getMessage().contains("Failed to upload file to S3"));
    }

    @Test
    void testGenerateDownloadUrlSuccess() throws Exception {
        String key = "tenders/123/Bid_Document_123.pdf";
        URL expectedUrl = new URL("https://s3.ap-south-1.amazonaws.com/test-tender-pocket-bucket/tenders/123/Bid_Document_123.pdf?X-Amz-Signature=xyz");

        PresignedGetObjectRequest presignedRequest = mock(PresignedGetObjectRequest.class);
        when(presignedRequest.url()).thenReturn(expectedUrl);
        when(s3Presigner.presignGetObject(any(GetObjectPresignRequest.class))).thenReturn(presignedRequest);

        String generatedUrl = storageService.generateDownloadUrl(key);

        assertEquals(expectedUrl.toString(), generatedUrl);
        verify(s3Presigner, times(1)).presignGetObject(any(GetObjectPresignRequest.class));
    }

    @Test
    void testDeleteSuccess() {
        String key = "tenders/123/Bid_Document_123.pdf";

        storageService.delete(key);

        verify(s3Client, times(1)).deleteObject(any(DeleteObjectRequest.class));
    }
}
