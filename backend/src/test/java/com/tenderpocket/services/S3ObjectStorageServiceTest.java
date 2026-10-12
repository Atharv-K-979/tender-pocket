package com.tenderpocket.services;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URL;
import java.time.Duration;

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

    private final String bucketName = "test-isolated-documents-bucket";

    @BeforeEach
    void setUp() {
        storageService = new S3ObjectStorageService(s3Client, s3Presigner, bucketName);
    }

    @Test
    void testConstructorRejectsBlankBucket() {
        assertThrows(IllegalArgumentException.class, () ->
                new S3ObjectStorageService(s3Client, s3Presigner, "  ")
        );
        assertThrows(IllegalArgumentException.class, () ->
                new S3ObjectStorageService(s3Client, s3Presigner, null)
        );
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

        ArgumentCaptor<PutObjectRequest> requestCaptor = ArgumentCaptor.forClass(PutObjectRequest.class);
        verify(s3Client, times(1)).putObject(requestCaptor.capture(), any(RequestBody.class));
        PutObjectRequest captured = requestCaptor.getValue();
        assertEquals(bucketName, captured.bucket());
        assertEquals(key, captured.key());
        assertEquals("application/pdf", captured.contentType());
        assertEquals(data.length, captured.contentLength());
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
                .thenThrow(S3Exception.builder().message("Access Denied").statusCode(403).build());

        RuntimeException exception = assertThrows(RuntimeException.class, () ->
                storageService.upload(key, is, "application/pdf", data.length)
        );

        assertTrue(exception.getMessage().contains("Failed to upload file to S3"));
        assertTrue(exception.getMessage().contains(bucketName));
    }

    @Test
    void testExistsReturnsTrueWhenObjectPresent() {
        String key = "tenders/123/Bid_Document_123.pdf";
        when(s3Client.headObject(any(HeadObjectRequest.class)))
                .thenReturn(HeadObjectResponse.builder().build());

        assertTrue(storageService.exists(key));

        ArgumentCaptor<HeadObjectRequest> captor = ArgumentCaptor.forClass(HeadObjectRequest.class);
        verify(s3Client).headObject(captor.capture());
        assertEquals(bucketName, captor.getValue().bucket());
        assertEquals(key, captor.getValue().key());
    }

    @Test
    void testExistsReturnsFalseOnNoSuchKey() {
        String key = "tenders/123/missing.pdf";
        when(s3Client.headObject(any(HeadObjectRequest.class)))
                .thenThrow(NoSuchKeyException.builder().message("Object not found").build());

        assertFalse(storageService.exists(key));
    }

    @Test
    void testExistsReturnsFalseOnS3Exception404() {
        String key = "tenders/123/missing.pdf";
        when(s3Client.headObject(any(HeadObjectRequest.class)))
                .thenThrow(S3Exception.builder().statusCode(404).message("Not Found").build());

        assertFalse(storageService.exists(key));
    }

    @Test
    void testExistsThrowsOnNoSuchBucketException() {
        String key = "tenders/123/doc.pdf";
        when(s3Client.headObject(any(HeadObjectRequest.class)))
                .thenThrow(NoSuchBucketException.builder().message("Bucket not found").statusCode(404).build());

        RuntimeException ex = assertThrows(RuntimeException.class, () -> storageService.exists(key));
        assertTrue(ex.getMessage().contains("S3 bucket does not exist"));
    }

    @Test
    void testExistsThrowsOnAccessDenied403() {
        String key = "tenders/123/doc.pdf";
        when(s3Client.headObject(any(HeadObjectRequest.class)))
                .thenThrow(S3Exception.builder().statusCode(403).message("Forbidden").build());

        RuntimeException ex = assertThrows(RuntimeException.class, () -> storageService.exists(key));
        assertTrue(ex.getMessage().contains("Access denied"));
    }

    @Test
    void testExistsThrowsOnNetworkOrClientFailure() {
        String key = "tenders/123/doc.pdf";
        when(s3Client.headObject(any(HeadObjectRequest.class)))
                .thenThrow(software.amazon.awssdk.core.exception.SdkClientException.create("Connection timed out"));

        RuntimeException ex = assertThrows(RuntimeException.class, () -> storageService.exists(key));
        assertTrue(ex.getMessage().contains("Network or unexpected failure"));
    }

    @Test
    void testGenerateDownloadUrlSuccess() throws Exception {
        String key = "tenders/123/Bid_Document_123.pdf";
        URL expectedUrl = new URL("https://s3.ap-south-1.amazonaws.com/test-isolated-documents-bucket/tenders/123/Bid_Document_123.pdf?X-Amz-Signature=xyz");

        PresignedGetObjectRequest presignedRequest = mock(PresignedGetObjectRequest.class);
        when(presignedRequest.url()).thenReturn(expectedUrl);
        when(s3Presigner.presignGetObject(any(GetObjectPresignRequest.class))).thenReturn(presignedRequest);

        String generatedUrl = storageService.generateDownloadUrl(key);

        assertEquals(expectedUrl.toString(), generatedUrl);

        ArgumentCaptor<GetObjectPresignRequest> captor = ArgumentCaptor.forClass(GetObjectPresignRequest.class);
        verify(s3Presigner, times(1)).presignGetObject(captor.capture());
        GetObjectPresignRequest req = captor.getValue();
        assertEquals(Duration.ofMinutes(15), req.signatureDuration());
        assertEquals(bucketName, req.getObjectRequest().bucket());
        assertEquals(key, req.getObjectRequest().key());
    }

    @Test
    void testDeleteSuccess() {
        String key = "tenders/123/Bid_Document_123.pdf";

        storageService.delete(key);

        ArgumentCaptor<DeleteObjectRequest> captor = ArgumentCaptor.forClass(DeleteObjectRequest.class);
        verify(s3Client, times(1)).deleteObject(captor.capture());
        assertEquals(bucketName, captor.getValue().bucket());
        assertEquals(key, captor.getValue().key());
    }

    @Test
    void testIsRemoteReturnsTrue() {
        assertTrue(storageService.isRemote());
    }
}
