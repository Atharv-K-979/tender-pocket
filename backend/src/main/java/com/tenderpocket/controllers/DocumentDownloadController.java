package com.tenderpocket.controllers;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DocumentDownloadController {

    @Autowired
    private TenderController tenderController;

    @GetMapping("/documents/{id}/{fileName:.+}")
    public ResponseEntity<?> downloadDocumentFile(
            @PathVariable("id") String id,
            @PathVariable("fileName") String fileName) {
        return tenderController.downloadDocumentFile(id, fileName);
    }
}
