package com.tenderpocket.controllers;

import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.services.ObjectStorageService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class TenderControllerDocumentDownloadTest {

    @Mock
    private TenderRepository tenderRepository;

    @Mock
    private ObjectStorageService objectStorageService;

    @InjectMocks
    private TenderController tenderController;

    @Test
    void testDownloadDocumentRedirectsToS3PresignedUrlFromDownloadedDocs() {
        String tenderId = "1001";
        String fileName = "Bid_Documents_1001.pdf";
        String s3Key = "tenders/1001/Bid_Documents_1001.pdf";
        String presignedUrl = "https://s3.ap-south-1.amazonaws.com/test-bucket/" + s3Key + "?signature=abc";

        Tender tender = new Tender();
        tender.setId(tenderId);
        tender.setDownloadedDocs("[{\"name\":\"Generated Bid Documents (PDF)\",\"filename\":\"" + fileName + "\",\"s3_key\":\"" + s3Key + "\"}]");

        when(tenderRepository.findById(tenderId)).thenReturn(Optional.of(tender));
        when(objectStorageService.generateDownloadUrl(s3Key)).thenReturn(presignedUrl);

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, fileName);

        assertEquals(HttpStatus.FOUND, response.getStatusCode());
        assertEquals(presignedUrl, response.getHeaders().getFirst(HttpHeaders.LOCATION));
        verify(objectStorageService).generateDownloadUrl(s3Key);
    }

    @Test
    void testDownloadDocumentRedirectsToS3PresignedUrlFromDocumentUrl() {
        String tenderId = "1002";
        String fileName = "Bid_Document_1002.pdf";
        String s3Key = "tenders/1002/Bid_Document_1002.pdf";
        String presignedUrl = "https://s3.ap-south-1.amazonaws.com/test-bucket/" + s3Key + "?signature=def";

        Tender tender = new Tender();
        tender.setId(tenderId);
        tender.setDocumentUrl(s3Key);

        when(tenderRepository.findById(tenderId)).thenReturn(Optional.of(tender));
        when(objectStorageService.generateDownloadUrl(s3Key)).thenReturn(presignedUrl);

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, fileName);

        assertEquals(HttpStatus.FOUND, response.getStatusCode());
        assertEquals(presignedUrl, response.getHeaders().getFirst(HttpHeaders.LOCATION));
        verify(objectStorageService).generateDownloadUrl(s3Key);
    }

    @Test
    void testDownloadDocumentNotFoundWhenNoS3AndNoLocalFile() {
        String tenderId = "1003";
        String fileName = "non_existent_file.pdf";

        when(tenderRepository.findById(tenderId)).thenReturn(Optional.empty());

        ResponseEntity<?> response = tenderController.downloadDocumentFile(tenderId, fileName);

        assertEquals(HttpStatus.NOT_FOUND, response.getStatusCode());
    }
}
