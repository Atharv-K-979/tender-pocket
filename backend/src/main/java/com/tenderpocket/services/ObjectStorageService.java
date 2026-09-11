package com.tenderpocket.services;

import java.io.InputStream;

public interface ObjectStorageService {

    String upload(String key, InputStream inputStream, String contentType, long contentLength);

    String generateDownloadUrl(String key);

    void delete(String key);
}
