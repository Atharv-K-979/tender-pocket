package com.tenderpocket.controllers;

import com.tenderpocket.config.WorkflowPermissions;
import static com.tenderpocket.config.WorkflowPermissions.Action.*;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderDocumentManifest;
import com.tenderpocket.models.TenderWorkflowState;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.services.TenderFolderScannerService;
import com.tenderpocket.services.WorkflowSyncService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.*;

@RestController
@RequestMapping("/api/v2/workflow")
public class WorkflowSyncController {

    @Autowired
    private WorkflowSyncService workflowSyncService;

    @Autowired
    private TenderFolderScannerService folderScannerService;

    @Autowired
    private TenderRepository tenderRepository;

    private String getUsername() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return (auth != null && auth.isAuthenticated()) ? auth.getName() : "user";
    }

    private String getRole() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) return "";
        return auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .findFirst()
                .map(WorkflowPermissions::canonicalRole)
                .orElse("");
    }

    /**
     * GET /api/v2/workflow/{tenderId}/state
     * Returns minimal, role-scoped workflow state.
     * Information Hiding: Strips internal TPC purchase cost from Tender Executive.
     */
    @GetMapping("/{tenderId}/state")
    public ResponseEntity<?> getWorkflowState(@PathVariable("tenderId") String tenderId) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        TenderWorkflowState state = workflowSyncService.getOrCreateState(tenderId);
        if (state == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));
        }

        String role = getRole();
        boolean isExecutive = "Tender Executive".equalsIgnoreCase(role);
        boolean isFinance = "MIS Team".equalsIgnoreCase(role) || "Admin".equalsIgnoreCase(role);

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("success", true);
        resp.put("tenderId", state.getTenderId());
        resp.put("currentStep", state.getCurrentStep());
        resp.put("stepName", state.getStepName());
        resp.put("assignedExecutive", state.getAssignedExecutive());
        resp.put("specStatus", state.getSpecStatus());
        resp.put("specComplianceType", state.getSpecComplianceType());
        resp.put("finalTechSpecFilename", state.getFinalTechSpecFilename());
        resp.put("bidPackageStatus", state.getBidPackageStatus());
        resp.put("emdApplicable", state.getEmdApplicable());
        resp.put("emdStatus", state.getEmdStatus());
        resp.put("emdBeneficiaryName", state.getEmdBeneficiaryName());
        resp.put("emdAmount", state.getEmdAmount());
        resp.put("emdPaymentMode", state.getEmdPaymentMode());

        // Mask confidential EMD receipt path for non-finance users
        if (isFinance || getUsername().equalsIgnoreCase(state.getAssignedExecutive())) {
            resp.put("emdReceiptDocPath", state.getEmdReceiptDocPath());
        } else {
            resp.put("emdReceiptDocPath", null);
        }

        resp.put("trackAPricingStatus", state.getTrackAPricingStatus());
        resp.put("pricingRoute", state.getPricingRoute());
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        resp.put("assignedMisMember", tOpt.map(Tender::getAssignedMisMember).orElse(null));
        // Mask TPC purchase price from Tender Executive
        if (isExecutive) {
            resp.put("tpcPurchasePrice", null);
        } else {
            resp.put("tpcPurchasePrice", state.getTpcPurchasePrice());
        }
        resp.put("misFinalPrice", state.getMisFinalPrice());
        resp.put("pricingGoAheadBy", state.getPricingGoAheadBy());

        resp.put("trackBDocStatus", state.getTrackBDocStatus());
        resp.put("totalPathDocs", state.getTotalPathDocs());
        resp.put("verifiedPathDocs", state.getVerifiedPathDocs());
        resp.put("canFinalSubmit", state.getCanFinalSubmit());
        resp.put("outcomeStatus", state.getOutcomeStatus());
        resp.put("lossReason", state.getLossReason());

        return ResponseEntity.ok(resp);
    }

    /**
     * GET /api/v2/workflow/{tenderId}/manifest
     * Step 5 Track B: Returns all documents in the directory path for verification.
     */
    @GetMapping("/{tenderId}/manifest")
    public ResponseEntity<?> getFolderManifest(@PathVariable("tenderId") String tenderId) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        List<TenderDocumentManifest> list = folderScannerService.scanAndSyncFolder(tenderId);

        String role = getRole();
        boolean isFinance = "MIS Team".equalsIgnoreCase(role) || "Admin".equalsIgnoreCase(role);

        // Map to minimal client-friendly view (Information Hiding: no local server disk paths)
        List<Map<String, Object>> safeList = new ArrayList<>();
        for (TenderDocumentManifest d : list) {
            // Mask confidential files from unprivileged roles
            if (Boolean.TRUE.equals(d.getIsConfidential()) && !isFinance) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", d.getId());
            item.put("fileName", d.getFileName());
            item.put("displayName", d.getDisplayName());
            item.put("fileCategory", d.getFileCategory());
            item.put("fileExtension", d.getFileExtension());
            item.put("fileSizeBytes", d.getFileSizeBytes());
            item.put("isAuthoritative", d.getIsAuthoritative());
            item.put("isConfidential", d.getIsConfidential());
            item.put("verified", d.getVerifiedByMis());
            item.put("verifiedByUser", d.getVerifiedByUser());
            item.put("verifiedAt", d.getVerifiedAt());
            item.put("downloadUrl", "/api/tenders/" + tenderId + "/documents/" + d.getFileName());
            safeList.add(item);
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "tenderId", tenderId,
                "totalCount", safeList.size(),
                "verifiedCount", safeList.stream().filter(i -> Boolean.TRUE.equals(i.get("verified"))).count(),
                "documents", safeList
        ));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/assign-executive (Step 1)
     */
    @PostMapping("/{tenderId}/assign-executive")
    public ResponseEntity<?> assignExecutive(
            @PathVariable("tenderId") String tenderId,
            @RequestBody Map<String, String> body) {
        String role = getRole();
        if (!"MIS Team".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }
        String exec = body.get("executive");
        if (exec == null || exec.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Executive name is required"));
        }
        TenderWorkflowState state = workflowSyncService.assignExecutive(tenderId, exec.trim(), getUsername());
        return ResponseEntity.ok(Map.of("success", true, "message", "Assigned to executive " + exec, "state", state));
    }

    /**
     * Backward-compatible overload for 4-argument calls
     */
    public ResponseEntity<?> recordSpecClearance(
            String tenderId,
            MultipartFile file,
            String complianceType,
            String remarks) {
        return recordSpecClearance(tenderId, file, null, null, null, null, null, complianceType, remarks);
    }

    /**
     * POST /api/v2/workflow/{tenderId}/spec-clearance (Step 2)
     * Clearance team approves spec: ALL_COMPLY or DEVIATIONS (with 3 replacement docs).
     */
    @PostMapping("/{tenderId}/spec-clearance")
    public ResponseEntity<?> recordSpecClearance(
            @PathVariable("tenderId") String tenderId,
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "pdfFile", required = false) MultipartFile pdfFile,
            @RequestParam(value = "docxFile", required = false) MultipartFile docxFile,
            @RequestParam(value = "wordFile", required = false) MultipartFile wordFile,
            @RequestParam(value = "xlsxFile", required = false) MultipartFile xlsxFile,
            @RequestParam(value = "excelFile", required = false) MultipartFile excelFile,
            @RequestParam(value = "complianceType", defaultValue = "ALL COMPLY") String complianceType,
            @RequestParam(value = "remarks", required = false) String remarks) {

        String role = getRole();
        if (!"Clearance Team".equalsIgnoreCase(role) && !"Specification Team".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }

        MultipartFile effectiveDocx = docxFile != null ? docxFile : wordFile;
        MultipartFile effectiveXlsx = xlsxFile != null ? xlsxFile : excelFile;
        MultipartFile actualPdf = pdfFile != null && !pdfFile.isEmpty() ? pdfFile : file;

        boolean isDeviation = complianceType != null && (
                "DEVIATIONS".equalsIgnoreCase(complianceType.trim())
                || "COMPLY WITH DEVIATIONS".equalsIgnoreCase(complianceType.trim())
                || "COMPLY_WITH_DEVIATIONS".equalsIgnoreCase(complianceType.trim())
                || "Approved with some deviation".equalsIgnoreCase(complianceType.trim())
                || "comply with deviations".equalsIgnoreCase(complianceType.trim())
                || "deviation".equalsIgnoreCase(complianceType.trim())
                || "deviations".equalsIgnoreCase(complianceType.trim())
        );
        String type = isDeviation ? "COMPLY WITH DEVIATIONS" : "ALL COMPLY";

        boolean hasPdf = actualPdf != null && !actualPdf.isEmpty();
        boolean hasDocx = effectiveDocx != null && !effectiveDocx.isEmpty();
        boolean hasXlsx = effectiveXlsx != null && !effectiveXlsx.isEmpty();
        boolean hasUploadedDocs = hasPdf || hasDocx || hasXlsx;

        String stem = "Combined_Technical_Data_Sheet";
        String pdfFileName = stem + ".pdf";
        String docxFileName = stem + ".docx";
        String xlsxFileName = stem + ".xlsx";

        String resolvedFilename = (actualPdf != null && actualPdf.getOriginalFilename() != null && !actualPdf.getOriginalFilename().isBlank())
                ? actualPdf.getOriginalFilename()
                : pdfFileName;

        if (hasUploadedDocs) {
            String[] saveDirs = new String[] {
                "public/documents/" + tenderId,
                "backend/public/documents/" + tenderId,
                "../backend/public/documents/" + tenderId,
                "../public/documents/" + tenderId,
                "../frontend/public/documents/" + tenderId,
                "frontend/public/documents/" + tenderId
            };
            try {
                // Delete un-uploaded old spec files from disk so ONLY uploaded files carry forward
                if (!hasPdf) {
                    for (String d : saveDirs) {
                        try { Files.deleteIfExists(Paths.get(d).toAbsolutePath().normalize().resolve(pdfFileName)); } catch (Exception ignored) {}
                    }
                }
                if (!hasDocx) {
                    for (String d : saveDirs) {
                        try { Files.deleteIfExists(Paths.get(d).toAbsolutePath().normalize().resolve(docxFileName)); } catch (Exception ignored) {}
                    }
                }
                if (!hasXlsx) {
                    for (String d : saveDirs) {
                        try { Files.deleteIfExists(Paths.get(d).toAbsolutePath().normalize().resolve(xlsxFileName)); } catch (Exception ignored) {}
                    }
                }
                for (String d : saveDirs) {
                    try { Files.deleteIfExists(Paths.get(d).toAbsolutePath().normalize().resolve("specification.pdf")); } catch (Exception ignored) {}
                }

                if (hasPdf) {
                    byte[] b = actualPdf.getBytes();
                    for (String d : saveDirs) {
                        try {
                            Path p = Paths.get(d).toAbsolutePath().normalize();
                            if (p.getParent() != null) { Files.createDirectories(p); Files.write(p.resolve(pdfFileName), b); }
                        } catch (Exception ignored) {}
                    }
                }
                if (hasDocx) {
                    byte[] b = effectiveDocx.getBytes();
                    for (String d : saveDirs) {
                        try {
                            Path p = Paths.get(d).toAbsolutePath().normalize();
                            if (p.getParent() != null) { Files.createDirectories(p); Files.write(p.resolve(docxFileName), b); }
                        } catch (Exception ignored) {}
                    }
                }
                if (hasXlsx) {
                    byte[] b = effectiveXlsx.getBytes();
                    for (String d : saveDirs) {
                        try {
                            Path p = Paths.get(d).toAbsolutePath().normalize();
                            if (p.getParent() != null) { Files.createDirectories(p); Files.write(p.resolve(xlsxFileName), b); }
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception e) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(Map.of("success", false, "error", "Failed to store clearance spec files"));
            }

            // Replace tech spec entries in downloaded_docs
            Optional<Tender> tOpt = tenderRepository.findById(tenderId);
            if (tOpt.isPresent()) {
                Tender tender = tOpt.get();
                List<Map<String, Object>> docsList = new ArrayList<>();
                com.fasterxml.jackson.databind.ObjectMapper objectMapper = new com.fasterxml.jackson.databind.ObjectMapper();
                String existingJson = tender.getDownloadedDocs();
                if (existingJson != null && !existingJson.isBlank()) {
                    try {
                        docsList = objectMapper.readValue(existingJson, new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {});
                    } catch (Exception ignored) {}
                }

                // Purge ALL prior technical spec entries (AI specs, drafts)
                docsList.removeIf(item -> {
                    if ("brochure".equals(String.valueOf(item.get("source")))) return false; // the Brochure Team's upload stays
                    String fn = item.get("filename") != null ? item.get("filename").toString().toLowerCase() : "";
                    String nm = item.get("name") != null ? item.get("name").toString().toLowerCase() : "";
                    return fn.contains("combined_technical") || fn.contains("tech_spec") || fn.contains("technical_specification") || fn.equals("specification.pdf")
                            || nm.contains("combined technical") || nm.contains("technical specification");
                });

                String today = java.time.LocalDate.now().toString();
                String version = String.valueOf(System.currentTimeMillis());
                if (hasPdf) {
                    docsList.add(new HashMap<>(Map.of(
                        "name", "Combined Technical Specifications (PDF) [Clearance Superior]",
                        "filename", pdfFileName,
                        "local_path", "/documents/" + tenderId + "/" + pdfFileName + "?v=" + version,
                        "created_date", today,
                        "superior", true
                    )));
                }
                if (hasDocx) {
                    docsList.add(new HashMap<>(Map.of(
                        "name", "Combined Technical Specifications (DOCX) [Clearance Superior]",
                        "filename", docxFileName,
                        "local_path", "/documents/" + tenderId + "/" + docxFileName + "?v=" + version,
                        "created_date", today,
                        "superior", true
                    )));
                }
                if (hasXlsx) {
                    docsList.add(new HashMap<>(Map.of(
                        "name", "Combined Technical Specifications (XLSX) [Clearance Superior]",
                        "filename", xlsxFileName,
                        "local_path", "/documents/" + tenderId + "/" + xlsxFileName + "?v=" + version,
                        "created_date", today,
                        "superior", true
                    )));
                }

                if (hasPdf) {
                    tender.setFinalTechSpecFilename(pdfFileName);
                } else if (hasDocx) {
                    tender.setFinalTechSpecFilename(docxFileName);
                } else if (hasXlsx) {
                    tender.setFinalTechSpecFilename(xlsxFileName);
                }

                try {
                    tender.setDownloadedDocs(objectMapper.writeValueAsString(docsList));
                    tenderRepository.save(tender);
                } catch (Exception ignored) {}
            }
        }

        String effectiveFilename = hasPdf ? pdfFileName : (hasDocx ? docxFileName : (hasXlsx ? xlsxFileName : resolvedFilename));
        TenderWorkflowState state = workflowSyncService.recordFinalTechSpec(tenderId, effectiveFilename, type, remarks, getUsername());

        String stageNow = state != null && state.getStepName() != null ? state.getStepName() : "BID_DOCS_PREPARATION";
        boolean brochureRequested = tenderRepository.findById(tenderId)
                .map(t -> WorkflowSyncService.BROCHURE_PENDING.equalsIgnoreCase(t.getBrochureStatus()))
                .orElse(false);
        String message = (isDeviation
                ? "Comply with deviations saved. The three new documents replace the previous specification files. The Tender Executive can now generate the bid package."
                : "All comply recorded. The Tender Executive can now generate the bid package. EMD follows that package.")
                + (brochureRequested ? " The Brochure Team uploads the brochure in parallel." : "");
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", message,
                "currentStage", stageNow,
                "finalTechSpec", resolvedFilename
        ));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/bid-docs-prep (Step 3)
     * Executive generates template bid package -> auto-skips EMD if exempt.
     */
    @PostMapping("/{tenderId}/bid-docs-prep")
    public ResponseEntity<?> completeBidDocsPrep(
            @PathVariable("tenderId") String tenderId,
            @RequestBody(required = false) Map<String, String> body) {
        String role = getRole();
        if (!"Tender Executive".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }

        String workingPath = body != null ? body.getOrDefault("workingPath", "") : "";
        TenderWorkflowState state = workflowSyncService.completeBidDocsPrep(tenderId, workingPath, getUsername());

        boolean isSkipped = "EXEMPT_SKIPPED".equalsIgnoreCase(state.getEmdStatus());
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", isSkipped ? "Bid package generated. EMD is exempt/₹0 — skipped directly to Step 5 (Dual Track)!"
                                     : "Bid package generated. Please submit EMD payment details.",
                "currentStep", state.getCurrentStep(),
                "stepName", state.getStepName(),
                "isEmdSkipped", isSkipped
        ));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/emd-applicability (Step 4 Executive Applicability Check)
     */
    @PostMapping("/{tenderId}/emd-applicability")
    public ResponseEntity<?> setEmdApplicability(
            @PathVariable("tenderId") String tenderId,
            @RequestBody Map<String, Object> body) {
        String role = getRole();
        if (!"Tender Executive".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }

        boolean applicable = true;
        if (body != null && body.containsKey("applicable")) {
            applicable = Boolean.parseBoolean(body.get("applicable").toString());
        } else if (body != null && body.containsKey("emdApplicable")) {
            applicable = Boolean.parseBoolean(body.get("emdApplicable").toString());
        }

        TenderWorkflowState state = workflowSyncService.setEmdApplicability(tenderId, applicable, getUsername());
        return ResponseEntity.ok(Map.of(
                "success", true,
                "applicable", applicable,
                "message", applicable ? "EMD payment marked as required. Please enter EMD details."
                                      : "EMD marked not required / exempt. Automatically advanced to Step 5 Dual Track!",
                "currentStep", state.getCurrentStep(),
                "stepName", state.getStepName(),
                "state", state
        ));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/emd-payment (Step 4)
     * Submits Beneficiary Name & optional confidential receipt file.
     */
    @PostMapping("/{tenderId}/emd-payment")
    public ResponseEntity<?> submitEmdPayment(
            @PathVariable("tenderId") String tenderId,
            @RequestParam("beneficiaryName") String beneficiaryName,
            @RequestParam(value = "amount", defaultValue = "0") Double amount,
            @RequestParam(value = "mode", defaultValue = "NEFT") String mode,
            @RequestParam(value = "receiptFile", required = false) MultipartFile receiptFile) {

        String role = getRole();
        if (!"Tender Executive".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }

        String receiptPath = "";
        if (receiptFile != null && !receiptFile.isEmpty()) {
            try {
                Path dir = Paths.get("public/documents", tenderId, "confidential");
                Files.createDirectories(dir);
                String name = "emd_receipt_" + System.currentTimeMillis() + "_" + (receiptFile.getOriginalFilename() != null ? receiptFile.getOriginalFilename() : "receipt.pdf");
                Path target = dir.resolve(name);
                Files.copy(receiptFile.getInputStream(), target, StandardCopyOption.REPLACE_EXISTING);
                receiptPath = "/documents/" + tenderId + "/confidential/" + name;
            } catch (Exception e) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(Map.of("success", false, "error", "Failed to save EMD receipt file"));
            }
        }

        TenderWorkflowState state = workflowSyncService.submitEmdPayment(
                tenderId, beneficiaryName, amount, mode, receiptPath, true, getUsername()
        );

        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "EMD payment submitted with Beneficiary Name: " + beneficiaryName + ". Sent to MIS/Finance for approval.",
                "state", state
        ));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/verify-document/{manifestId} (Step 5 Track B)
     */
    @PostMapping("/{tenderId}/verify-document/{manifestId}")
    public ResponseEntity<?> verifySingleDoc(
            @PathVariable("tenderId") String tenderId,
            @PathVariable("manifestId") Long manifestId) {
        String role = getRole();
        if (!"MIS Team".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }
        TenderDocumentManifest doc = folderScannerService.verifyDocument(manifestId, getUsername());
        return ResponseEntity.ok(Map.of("success", true, "document", doc));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/verify-all-documents (Step 5 Track B Sign-Off)
     */
    @PostMapping("/{tenderId}/verify-all-documents")
    public ResponseEntity<?> verifyAllDocs(
            @PathVariable("tenderId") String tenderId,
            @RequestBody(required = false) Map<String, String> body) {
        String role = getRole();
        if (!"MIS Team".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }
        String remarks = body != null ? body.getOrDefault("remarks", "All documents verified.") : "All documents verified.";
        TenderWorkflowState state = workflowSyncService.approveTrackBDocs(tenderId, getUsername(), remarks);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Full document verification completed and signed off.",
                "trackBDocStatus", state.getTrackBDocStatus(),
                "canFinalSubmit", state.getCanFinalSubmit()
        ));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/reject-documents (Step 5 Track B)
     * MIS can request changes on folder documents while dual track is open.
     */
    @PostMapping("/{tenderId}/reject-documents")
    public ResponseEntity<?> rejectDocs(
            @PathVariable("tenderId") String tenderId,
            @RequestBody(required = false) Map<String, String> body) {
        String role = getRole();
        if (!"MIS Team".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }
        String remarks = body != null ? body.getOrDefault("remarks", "Changes requested.") : "Changes requested.";
        TenderWorkflowState state = workflowSyncService.rejectTrackBDocs(tenderId, getUsername(), remarks);
        if (state == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("success", false, "error", "Tender not found"));
        }
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Document changes requested. Track B remains open until the folder is approved.",
                "trackBDocStatus", state.getTrackBDocStatus(),
                "canFinalSubmit", Boolean.FALSE
        ));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/route-pricing (Step 5 Track A Pricing Route Selection)
     * Executive chooses: Option 1 (TPC Team) or Option 2 (MIS Team for pricing).
     */
    @PostMapping("/{tenderId}/route-pricing")
    public ResponseEntity<?> routePricing(
            @PathVariable("tenderId") String tenderId,
            @RequestBody Map<String, String> body) {
        String role = getRole();
        if (!"Tender Executive".equalsIgnoreCase(role) && !"MIS Team".equalsIgnoreCase(role) && !"Admin".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }

        String route = body != null ? body.get("route") : null;
        if (route == null || route.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Pricing route ('TPC' or 'MIS') is required"));
        }

        TenderWorkflowState state;
        String message;
        if ("TPC".equalsIgnoreCase(route.trim())) {
            state = workflowSyncService.routePricingToTpc(tenderId, getUsername());
            message = "Tender sent to TPC Team for commercial pricing quote.";
        } else if ("MIS".equalsIgnoreCase(route.trim())) {
            String misMember = body.get("misMember");
            if (misMember == null || misMember.isBlank()) {
                misMember = body.get("assignedMisMember");
            }
            state = workflowSyncService.routePricingToMis(tenderId, getUsername(), misMember);
            message = "Tender sent directly to MIS Team for pricing (TPC bypassed).";
        } else {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Invalid route. Allowed values: 'TPC', 'MIS'"));
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", message,
                "pricingRoute", state != null ? state.getPricingRoute() : route,
                "trackAPricingStatus", state != null ? state.getTrackAPricingStatus() : "",
                "state", state != null ? state : Map.of()
        ));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/commercial-go-ahead (Step 5 Track A Sign-Off)
     */
    @PostMapping("/{tenderId}/commercial-go-ahead")
    public ResponseEntity<?> commercialGoAhead(
            @PathVariable("tenderId") String tenderId,
            @RequestBody Map<String, Object> body) {
        String role = getRole();
        if (!"MIS Team".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }
        Double price = 0.0;
        if (body.get("finalPrice") != null) {
            price = Double.parseDouble(body.get("finalPrice").toString());
        }
        if (price <= 0) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Valid commercial quote price is required"));
        }

        TenderWorkflowState state = workflowSyncService.approveTrackAPricing(tenderId, price, getUsername());
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Commercial quote finalized at ₹" + price + ". Go-ahead approved.",
                "trackAPricingStatus", state.getTrackAPricingStatus(),
                "canFinalSubmit", state.getCanFinalSubmit()
        ));
    }

    /**
     * POST /api/v2/workflow/{tenderId}/final-submission (Step 6)
     * Tender Executive submits tender once both Track A and Track B are approved.
     */
    @PostMapping("/{tenderId}/final-submission")
    public ResponseEntity<?> finalSubmission(
            @PathVariable("tenderId") String tenderId,
            @RequestBody(required = false) Map<String, String> body) {
        String role = getRole();
        if (!"Tender Executive".equalsIgnoreCase(role)) {
            return WorkflowPermissions.denied();
        }

        TenderWorkflowState state = workflowSyncService.getOrCreateState(tenderId);
        if (state == null || !Boolean.TRUE.equals(state.getCanFinalSubmit())) {
            return ResponseEntity.status(HttpStatus.PRECONDITION_FAILED)
                    .body(Map.of("success", false, "error", "Submission is locked until both Commercial Pricing (Track A) and Full Document Verification (Track B) are approved."));
        }

        String ackPath = body != null ? body.getOrDefault("ackDocPath", "") : "";
        TenderWorkflowState submitted = workflowSyncService.recordFinalSubmission(tenderId, getUsername(), ackPath);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Tender officially submitted on the portal! Moved to Step 7 (Outcome evaluation).",
                "state", submitted
        ));
    }
}
