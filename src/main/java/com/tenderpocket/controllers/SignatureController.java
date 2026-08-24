package com.tenderpocket.controllers;

import com.tenderpocket.models.UserSignature;
import com.tenderpocket.repositories.UserSignatureRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/signatures")
public class SignatureController {

    @Autowired
    private UserSignatureRepository signatureRepository;

    @PostMapping("/upload")
    public ResponseEntity<?> uploadSignature(
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestParam("file") MultipartFile file) {

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Signature file is empty"));
        }

        try {
            String uploadDir = "public/images/signatures/";
            Path dirPath = Paths.get(uploadDir);
            if (!Files.exists(dirPath)) {
                Files.createDirectories(dirPath);
            }

            String filename = username + "_signature.png";
            Path filePath = dirPath.resolve(filename);
            Files.write(filePath, file.getBytes());

            // Also copy to public/images/signature.png for default fallback
            Path defaultPath = Paths.get("public/images/signature.png");
            Files.write(defaultPath, file.getBytes());

            String imageUrl = "/images/signatures/" + filename;
            UserSignature sig = new UserSignature(username, imageUrl);
            signatureRepository.save(sig);

            return ResponseEntity.ok(Map.of("success", true, "message", "Signature image uploaded successfully!", "imageUrl", imageUrl));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("success", false, "error", "Failed to upload signature: " + e.getMessage()));
        }
    }

    @GetMapping("/{username}")
    public ResponseEntity<?> getSignature(@PathVariable("username") String username) {
        Optional<UserSignature> opt = signatureRepository.findById(username);
        if (opt.isPresent()) {
            return ResponseEntity.ok(Map.of("success", true, "signature", opt.get()));
        }
        return ResponseEntity.ok(Map.of("success", true, "signature", Map.of("username", username, "signatureImageUrl", "/images/signature.png")));
    }
}
