package com.tenderpocket.services;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;

@Service
@ConditionalOnProperty(name = "aws.s3.enabled", havingValue = "false", matchIfMissing = true)
public class LocalStorageService implements ObjectStorageService {

    private final String baseDir;

    public LocalStorageService(@Value("${file.upload-dir:public/documents}") String baseDir) {
        this.baseDir = baseDir;
    }

    private Path resolvePath(String key) {
        String relativePath = key;
        if (key.startsWith("tenders/")) {
            relativePath = key.substring("tenders/".length());
        }
        return Paths.get(baseDir, relativePath.split("/")).toAbsolutePath().normalize();
    }

    @Override
    public String upload(String key, InputStream inputStream, String contentType, long contentLength) {
        try {
            Path targetPath = resolvePath(key);
            if (targetPath.getParent() != null) {
                Files.createDirectories(targetPath.getParent());
            }
            Files.copy(inputStream, targetPath, StandardCopyOption.REPLACE_EXISTING);
            return key;
        } catch (Exception e) {
            throw new RuntimeException("Failed to save local file for key: " + key + ": " + e.getMessage(), e);
        }
    }

    @Override
    public String generateDownloadUrl(String key) {
        if (key.startsWith("tenders/")) {
            return "/documents/" + key.substring("tenders/".length());
        }
        return "/documents/" + key;
    }

    @Override
    public boolean exists(String key) {
        Path path = resolvePath(key);
        return Files.exists(path) && Files.isRegularFile(path);
    }

    @Override
    public void delete(String key) {
        try {
            Path path = resolvePath(key);
            Files.deleteIfExists(path);
        } catch (Exception e) {
            System.err.println("[LocalStorageService] Failed to delete file for key: " + key + ": " + e.getMessage());
        }
    }

    @Override
    public boolean isRemote() {
        return false;
    }
}
