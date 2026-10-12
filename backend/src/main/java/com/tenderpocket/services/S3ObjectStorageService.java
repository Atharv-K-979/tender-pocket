package com.tenderpocket.services;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.io.InputStream;
import java.time.Duration;

@Service
@ConditionalOnProperty(name = "aws.s3.enabled", havingValue = "true")
public class S3ObjectStorageService implements ObjectStorageService {

    private final S3Client s3Client;
    private final S3Presigner s3Presigner;
    private final String bucketName;

    public S3ObjectStorageService(
            S3Client s3Client,
            S3Presigner s3Presigner,
            @Value("${aws.s3.bucket-name:}") String bucketName) {
        if (bucketName == null || bucketName.trim().isEmpty()) {
            throw new IllegalArgumentException("AWS S3 is enabled but aws.s3.bucket-name is not configured or blank.");
        }
        this.s3Client = s3Client;
        this.s3Presigner = s3Presigner;
        this.bucketName = bucketName.trim();
    }

    @Override
    public String upload(
            String key,
            InputStream inputStream,
            String contentType,
            long contentLength) {

        try {
            PutObjectRequest.Builder requestBuilder = PutObjectRequest.builder()
                    .bucket(bucketName)
                    .key(key);

            if (contentType != null && !contentType.isBlank()) {
                requestBuilder.contentType(contentType);
            }

            if (contentLength >= 0) {
                requestBuilder.contentLength(contentLength);
                s3Client.putObject(
                        requestBuilder.build(),
                        RequestBody.fromInputStream(inputStream, contentLength)
                );
            } else {
                java.nio.file.Path tempFile = java.nio.file.Files.createTempFile("s3_upload_", ".tmp");
                try {
                    java.nio.file.Files.copy(inputStream, tempFile, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    long tempLength = java.nio.file.Files.size(tempFile);
                    requestBuilder.contentLength(tempLength);
                    s3Client.putObject(
                            requestBuilder.build(),
                            RequestBody.fromFile(tempFile)
                    );
                } finally {
                    java.nio.file.Files.deleteIfExists(tempFile);
                }
            }

            return key;

        } catch (S3Exception e) {
            String errorMsg = (e.awsErrorDetails() != null && e.awsErrorDetails().errorMessage() != null)
                    ? e.awsErrorDetails().errorMessage()
                    : e.getMessage();
            throw new RuntimeException(
                    "Failed to upload file to S3: " + key + " in bucket: " + bucketName + " (Status: " + e.statusCode() + "): " + errorMsg, e
            );
        } catch (Exception e) {
            throw new RuntimeException(
                    "Error during S3 upload for key: " + key + " in bucket: " + bucketName + ": " + e.getMessage(), e
            );
        }
    }

    @Override
    public boolean exists(String key) {
        try {
            HeadObjectRequest headObjectRequest = HeadObjectRequest.builder()
                    .bucket(bucketName)
                    .key(key)
                    .build();
            s3Client.headObject(headObjectRequest);
            return true;
        } catch (NoSuchKeyException e) {
            return false;
        } catch (NoSuchBucketException e) {
            System.err.println("[S3ObjectStorageService] S3 bucket does not exist: " + bucketName + " when checking key " + key + ": " + e.getMessage());
            throw new RuntimeException("S3 bucket does not exist: " + bucketName, e);
        } catch (S3Exception e) {
            String errorCode = (e.awsErrorDetails() != null) ? e.awsErrorDetails().errorCode() : null;
            if ("NoSuchBucket".equalsIgnoreCase(errorCode)) {
                System.err.println("[S3ObjectStorageService] S3 bucket does not exist: " + bucketName + " when checking key " + key + ": " + e.getMessage());
                throw new RuntimeException("S3 bucket does not exist: " + bucketName, e);
            }
            if (e.statusCode() == 404) {
                return false;
            }
            if (e.statusCode() == 403 || "AccessDenied".equalsIgnoreCase(errorCode)) {
                System.err.println("[S3ObjectStorageService] Access denied checking object existence for key " + key + " in bucket " + bucketName + ": " + e.getMessage());
                throw new RuntimeException("Access denied checking S3 object existence for key: " + key + " in bucket: " + bucketName, e);
            }
            System.err.println("[S3ObjectStorageService] S3 headObject failed for key " + key + " in bucket " + bucketName + " (Status: " + e.statusCode() + "): " + e.getMessage());
            throw new RuntimeException("S3 error checking existence for key: " + key + " in bucket: " + bucketName + " (Status: " + e.statusCode() + "): " + e.getMessage(), e);
        } catch (Exception e) {
            System.err.println("[S3ObjectStorageService] Unexpected error or network failure checking existence for key " + key + ": " + e.getMessage());
            throw new RuntimeException("Network or unexpected failure checking S3 object existence for key: " + key + ": " + e.getMessage(), e);
        }
    }

    @Override
    public String generateDownloadUrl(String key) {
        GetObjectRequest getObjectRequest = GetObjectRequest.builder()
                .bucket(bucketName)
                .key(key)
                .build();

        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
                .signatureDuration(Duration.ofMinutes(15))
                .getObjectRequest(getObjectRequest)
                .build();

        return s3Presigner
                .presignGetObject(presignRequest)
                .url()
                .toString();
    }

    @Override
    public void delete(String key) {
        DeleteObjectRequest request = DeleteObjectRequest.builder()
                .bucket(bucketName)
                .key(key)
                .build();

        s3Client.deleteObject(request);
    }

    @Override
    public boolean isRemote() {
        return true;
    }
}
