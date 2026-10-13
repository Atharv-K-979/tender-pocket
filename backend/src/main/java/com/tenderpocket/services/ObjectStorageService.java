package com.tenderpocket.services;

import java.io.InputStream;

public interface ObjectStorageService {

    String upload(String key, InputStream inputStream, String contentType, long contentLength);

    default String upload(String key, byte[] bytes, String contentType) {
        return upload(key, new java.io.ByteArrayInputStream(bytes), contentType, bytes.length);
    }

    String generateDownloadUrl(String key);

    boolean exists(String key);

    void delete(String key);

    boolean isRemote();
}
