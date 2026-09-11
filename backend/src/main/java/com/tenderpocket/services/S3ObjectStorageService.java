package com.tenderpocket.services;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.io.InputStream;
import java.time.Duration;

@Service
public class S3ObjectStorageService implements ObjectStorageService {

    private final S3Client s3Client;
    private final S3Presigner s3Presigner;
    private final String bucketName;

    public S3ObjectStorageService(
            S3Client s3Client,
            S3Presigner s3Presigner,
            @Value("${aws.s3.bucket-name:tender-pocket-prod-documents}") String bucketName) {
        this.s3Client = s3Client;
        this.s3Presigner = s3Presigner;
        this.bucketName = bucketName;
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
                byte[] bytes = inputStream.readAllBytes();
                requestBuilder.contentLength((long) bytes.length);
                s3Client.putObject(
                        requestBuilder.build(),
                        RequestBody.fromBytes(bytes)
                );
            }

            return key;

        } catch (S3Exception e) {
            throw new RuntimeException(
                    "Failed to upload file to S3: " + key, e
            );
        } catch (Exception e) {
            throw new RuntimeException(
                    "Error during S3 upload for key: " + key, e
            );
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
}
