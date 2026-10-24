package com.tenderpocket.controllers;

import com.tenderpocket.dto.ProductModelDto;
import com.tenderpocket.dto.ProductSpecificationDto;
import com.tenderpocket.services.ProductCatalogueService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.*;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = {"http://localhost:3000", "http://localhost:8085"}, allowCredentials = "true")
public class ProductCatalogueController {

    @Autowired
    private ProductCatalogueService productCatalogueService;

    private String resolveUserRole(String headerRole) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getName())) {
            String jwtRole = auth.getAuthorities().stream()
                    .map(GrantedAuthority::getAuthority)
                    .findFirst()
                    .map(r -> r.replace("ROLE_", "").replace("_", " "))
                    .orElse(null);
            if (jwtRole != null && !jwtRole.isBlank()) {
                return jwtRole;
            }
        }
        return (headerRole != null && !headerRole.isBlank()) ? headerRole : "Admin";
    }

    private String resolveUsername(String headerUsername) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getName())) {
            String name = auth.getName();
            if (name != null && !name.isBlank()) {
                return name;
            }
        }
        return (headerUsername != null && !headerUsername.isBlank()) ? headerUsername : "admin";
    }

    @PostMapping(value = "/products/models/upload", consumes = {"multipart/form-data"})
    public ResponseEntity<?> uploadDatasheet(
            @RequestParam("file") MultipartFile file,
            @RequestParam("model_number") String modelNumber,
            @RequestParam(value = "make", required = false, defaultValue = "MarkEn") String make,
            @RequestParam("product_category") String productCategory,
            @RequestParam(value = "description", required = false, defaultValue = "") String description,
            @RequestHeader(value = "x-user-role", required = false) String headerRole,
            @RequestHeader(value = "x-user-username", required = false) String headerUsername) {

        String username = resolveUsername(headerUsername);
        try {
            ProductModelDto result = productCatalogueService.uploadAndExtractDatasheet(
                    file, modelNumber, make, productCategory, description, username);
            return ResponseEntity.ok(Map.of("success", true, "model", result, "message", "Datasheet uploaded and specifications extracted successfully."));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            System.err.println("[ProductCatalogueController] Error uploading datasheet: " + e.getMessage());
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("success", false, "error", "Failed to process datasheet: " + e.getMessage()));
        }
    }

    @GetMapping("/products/models")
    public ResponseEntity<?> listModels(
            @RequestParam(value = "category", required = false) String category,
            @RequestParam(value = "status", required = false) String status) {
        List<ProductModelDto> list = productCatalogueService.listModels(category, status);
        return ResponseEntity.ok(Map.of("success", true, "models", list, "count", list.size()));
    }

    @GetMapping("/products/models/{id}")
    public ResponseEntity<?> getModel(@PathVariable("id") Long id) {
        return productCatalogueService.getModel(id)
                .map(m -> ResponseEntity.ok(Map.of("success", true, "model", m)))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("success", false, "error", "Product model not found with ID: " + id)));
    }

    @PutMapping("/products/models/{id}/specifications")
    public ResponseEntity<?> updateSpecifications(
            @PathVariable("id") Long id,
            @RequestBody List<ProductSpecificationDto> specs,
            @RequestHeader(value = "x-user-username", required = false) String headerUsername) {
        String username = resolveUsername(headerUsername);
        try {
            ProductModelDto updated = productCatalogueService.updateSpecifications(id, specs, username);
            return ResponseEntity.ok(Map.of("success", true, "model", updated, "message", "Specifications updated successfully."));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @PostMapping("/products/models/{id}/verify")
    public ResponseEntity<?> verifyModel(
            @PathVariable("id") Long id,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "x-user-username", required = false) String headerUsername) {
        String username = resolveUsername(headerUsername);
        List<Long> verifiedIds = null;
        if (body != null && body.containsKey("verified_item_ids")) {
            Object rawList = body.get("verified_item_ids");
            if (rawList instanceof List<?>) {
                verifiedIds = ((List<?>) rawList).stream()
                        .map(o -> Long.parseLong(o.toString()))
                        .toList();
            }
        }
        try {
            ProductModelDto verified = productCatalogueService.verifyModel(id, verifiedIds, username);
            return ResponseEntity.ok(Map.of("success", true, "model", verified, "message", "Product model specifications verified successfully."));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @DeleteMapping("/products/models/{id}")
    public ResponseEntity<?> deleteModel(@PathVariable("id") Long id) {
        boolean deleted = productCatalogueService.deleteModel(id);
        if (deleted) {
            return ResponseEntity.ok(Map.of("success", true, "message", "Product model deleted successfully."));
        }
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Model not found."));
    }

    @PostMapping("/tenders/{id}/offered-models")
    public ResponseEntity<?> assignTenderModels(
            @PathVariable("id") String tenderId,
            @RequestBody Map<String, Object> payload,
            @RequestHeader(value = "x-user-username", required = false) String headerUsername) {
        String username = resolveUsername(headerUsername);
        Long defaultModelId = null;
        if (payload.containsKey("selected_model_id") && payload.get("selected_model_id") != null) {
            try {
                defaultModelId = Long.parseLong(payload.get("selected_model_id").toString());
            } catch (Exception ignored) {}
        }
        Map<String, Long> scheduleMap = new HashMap<>();
        if (payload.containsKey("schedule_models") && payload.get("schedule_models") instanceof Map<?, ?> rawMap) {
            for (var entry : rawMap.entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null) {
                    try {
                        scheduleMap.put(entry.getKey().toString(), Long.parseLong(entry.getValue().toString()));
                    } catch (Exception ignored) {}
                }
            }
        }

        try {
            productCatalogueService.assignTenderModels(tenderId, defaultModelId, scheduleMap, username);
            return ResponseEntity.ok(Map.of("success", true, "message", "Offered product models updated for tender."));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    @GetMapping("/tenders/{id}/offered-models")
    public ResponseEntity<?> getTenderModels(@PathVariable("id") String tenderId) {
        try {
            Map<String, Object> data = productCatalogueService.getTenderModelSelection(tenderId);
            return ResponseEntity.ok(Map.of("success", true, "data", data));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("success", false, "error", e.getMessage()));
        }
    }
}
