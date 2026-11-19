package com.tenderpocket.controllers;
import com.tenderpocket.config.WorkflowPermissions;
import static com.tenderpocket.config.WorkflowPermissions.Action.*;

import com.tenderpocket.models.*;
import com.tenderpocket.repositories.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.PersistenceContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api/tenders")
public class WorkflowController {

    @Autowired
    private TenderRepository tenderRepository;

    @PersistenceContext
    private EntityManager entityManager;

    @Autowired
    private TenderApprovalRepository approvalRepository;

    @Autowired
    private TenderCommentRepository commentRepository;

    @Autowired
    private com.tenderpocket.services.WorkflowSyncService workflowSyncService;

    private boolean isSafeUrl(String url) {
        if (url == null || url.isBlank()) return true;
        String trimmed = url.trim().toLowerCase();
        return trimmed.startsWith("/documents/") ||
               trimmed.startsWith("/uploads/") ||
               trimmed.startsWith("https://") ||
               trimmed.startsWith("http://");
    }

    private String getAuthenticatedUsername() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) return null;
        return auth.getName();
    }

    private String getAuthenticatedRole() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) return null;
        return auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .findFirst()
                .map(r -> r.replace("ROLE_", "").replace("_", " "))
                .orElse(null);
    }

    // GET /api/tenders/{id}/workflow-details
    @GetMapping("/{id}/workflow-details")
    public ResponseEntity<?> getWorkflowDetails(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-role", required = false) String userRole,
            @RequestHeader(value = "x-user-username", required = false) String username) {

        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        String authRole = getAuthenticatedRole();
        if (authRole != null && !authRole.isBlank()) userRole = authRole;
        String authUser = getAuthenticatedUsername();
        if (authUser != null && !authUser.isBlank()) username = authUser;

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("success", false, "error", "Tender not found"));
        }
        Tender tender = tOpt.get();
        List<TenderApprovalRequest> requests = approvalRepository.findByTenderIdOrderByCreatedAtDesc(id);
        List<TenderComment> comments = commentRepository.findByTenderIdOrderByCreatedAtAsc(id);

        Map<String, Object> resp = new HashMap<>();
        resp.put("success", true);
        resp.put("currentStage", tender.getCurrentStage());
        resp.put("status", tender.getStatus());
        resp.put("workingPath", tender.getWorkingPath());
        resp.put("assignedMisExecutive", tender.getAssignedMisExecutive());
        resp.put("lossReason", tender.getLossReason());
        resp.put("misFinalPrice", tender.getMisFinalPrice());
        resp.put("isCorrigendum", tender.getIsCorrigendum());
        resp.put("officialReferenceNumber", tender.getOfficialReferenceNumber());
        resp.put("eprocurementPortalId", tender.getEprocurementPortalId());

        // ROLE SECURITY: Strictly hide TPC Purchase Price from Tender Executive
        if (userRole != null && ("Tender Executive".equalsIgnoreCase(userRole) || "Executive".equalsIgnoreCase(userRole))) {
            resp.put("tpcPurchasePrice", null);
        } else {
            resp.put("tpcPurchasePrice", tender.getTpcPurchasePrice());
        }

        resp.put("approvalRequests", requests);
        resp.put("comments", comments);

        return ResponseEntity.ok(resp);
    }

    @PostMapping("/{id}/clearance-request")
    @Transactional
    public ResponseEntity<?> sendClearanceRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Tender Executive") String userRole,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody(required = false) Map<String, String> body) {

        String authRole = getAuthenticatedRole();
        if (authRole != null && !authRole.isBlank()) userRole = authRole;
        String authUser = getAuthenticatedUsername();
        if (authUser != null && !authUser.isBlank()) username = authUser;

        if (!WorkflowPermissions.allowed(UPLOAD_SPEC)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "success", false,
                    "error", "Access denied: Tender Executive or Admin required to submit specifications."
            ));
        }

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Tender tender = tOpt.get();
        if (!List.of("Generated", "Rejected", "Pending", "Approved").contains(
                String.valueOf(tender.getSpecVerificationStatus()))
                || tender.getDownloadedDocs() == null || "[]".equals(tender.getDownloadedDocs())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Technical specifications must be generated before clearance submission."));
        }
        tender.setCurrentStage("SPEC_CLEARANCE");
        tender.setSpecVerificationStatus("Pending");
        String assigned = (body != null && body.containsKey("assignedClearanceRep")) ? body.get("assignedClearanceRep") : "clearance";
        tender.setAssignedMisMemberSpec(assigned);
        tenderRepository.save(tender);

        // Patch existing pending request if present rather than creating redundant new requests
        List<TenderApprovalRequest> existingList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.SPEC_CLEARANCE);
        TenderApprovalRequest targetReq = null;
        for (TenderApprovalRequest req : existingList) {
            if ("PENDING".equalsIgnoreCase(req.getStatus())) {
                if (targetReq == null) {
                    targetReq = req;
                } else {
                    approvalRepository.delete(req);
                }
            }
        }

        if (targetReq != null) {
            targetReq.setRequestedBy(username);
            targetReq.setAssignedTo(assigned);
            targetReq.setStatus("PENDING");
            targetReq.setUpdatedAt(java.time.LocalDateTime.now());
            approvalRepository.save(targetReq);
        } else {
            TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.SPEC_CLEARANCE, username, assigned, "PENDING");
            approvalRepository.save(req);
        }

        String note = (body != null && body.containsKey("note")) ? body.get("note") : "Submitted technical specification for clearance approval.";
        commentRepository.save(new TenderComment(id, "SPEC_CLEARANCE", username, "Tender Executive", note));

        return ResponseEntity.ok(Map.of("success", true, "message", "Technical specification submitted to Clearance Team for approval."));
    }

    // Helper to mirror/save documents to all candidate paths
    private void saveDocBytesToAllLocations(String tenderId, String fileName, byte[] data) {
        String[] locations = new String[] {
            "public/documents/" + tenderId,
            "backend/public/documents/" + tenderId,
            "../backend/public/documents/" + tenderId,
            "../public/documents/" + tenderId,
            "../frontend/public/documents/" + tenderId,
            "frontend/public/documents/" + tenderId
        };
        for (String loc : locations) {
            try {
                Path p = Paths.get(loc).toAbsolutePath().normalize();
                if (p.getParent() != null) {
                    Files.createDirectories(p);
                    Files.write(p.resolve(fileName), data);
                }
            } catch (Exception ignored) {}
        }
    }

    // Helper to remove obsolete/superseded documents from all candidate paths
    private void deleteDocFromAllLocations(String tenderId, String fileName) {
        String[] locations = new String[] {
            "public/documents/" + tenderId,
            "backend/public/documents/" + tenderId,
            "../backend/public/documents/" + tenderId,
            "../public/documents/" + tenderId,
            "../frontend/public/documents/" + tenderId,
            "frontend/public/documents/" + tenderId
        };
        for (String loc : locations) {
            try {
                Path p = Paths.get(loc).toAbsolutePath().normalize().resolve(fileName);
                Files.deleteIfExists(p);
            } catch (Exception ignored) {}
        }
    }

    // POST /api/tenders/{id}/approve-clearance (Clearance Team approves spec: 1. Approved [All Comply] or 2. Approved with deviation [Upload 3 replacement docs])
    @PostMapping(value = "/{id}/approve-clearance", consumes = {MediaType.APPLICATION_JSON_VALUE, MediaType.APPLICATION_OCTET_STREAM_VALUE})
    @Transactional
    public ResponseEntity<?> approveClearance(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "clearance") String username,
            @RequestBody(required = false) Map<String, Object> body) {
        String complianceType = (body != null && body.containsKey("complianceType")) ? String.valueOf(body.get("complianceType")) : "ALL_COMPLY";
        String comment = (body != null && body.containsKey("comment")) ? String.valueOf(body.get("comment")) : null;
        return handleClearanceApproval(id, username, complianceType, comment, null, null, null);
    }

    @PostMapping(value = "/{id}/approve-clearance", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional
    public ResponseEntity<?> approveClearanceMultipart(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "clearance") String username,
            @RequestParam(value = "complianceType", required = false, defaultValue = "ALL COMPLY") String complianceType,
            @RequestParam(value = "comment", required = false) String comment,
            @RequestParam(value = "pdfFile", required = false) MultipartFile pdfFile,
            @RequestParam(value = "docxFile", required = false) MultipartFile docxFile,
            @RequestParam(value = "wordFile", required = false) MultipartFile wordFile,
            @RequestParam(value = "xlsxFile", required = false) MultipartFile xlsxFile,
            @RequestParam(value = "excelFile", required = false) MultipartFile excelFile) {
        MultipartFile effectiveDocx = docxFile != null ? docxFile : wordFile;
        MultipartFile effectiveXlsx = xlsxFile != null ? xlsxFile : excelFile;
        return handleClearanceApproval(id, username, complianceType, comment, pdfFile, effectiveDocx, effectiveXlsx);
    }

    private ResponseEntity<?> handleClearanceApproval(
            String id,
            String username,
            String complianceType,
            String comment,
            MultipartFile pdfFile,
            MultipartFile docxFile,
            MultipartFile xlsxFile) {

        if (!WorkflowPermissions.allowed(APPROVE_SPEC)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Tender tender = tOpt.get();
        // Lock the tender row and re-read it, so that two clearance approvals sent at the same moment are
        // handled one after the other: the second finds the clearance no longer pending.
        entityManager.refresh(tender, LockModeType.PESSIMISTIC_WRITE);
        if (!"Pending".equals(tender.getSpecVerificationStatus())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Specification clearance is not pending."));
        }

        // Ownership safeguard: If assigned to a specific representative, only that representative can approve
        String assignedSpec = tender.getAssignedMisMemberSpec();
        if (assignedSpec != null && !assignedSpec.isBlank()) {
            String canonicalAssigned = assignedSpec.trim().toLowerCase();
            boolean isQueue = List.of("clearance", "clearance team", "specification", "specification team").contains(canonicalAssigned);
            if (!isQueue && username != null && !canonicalAssigned.equalsIgnoreCase(username.trim())) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("success", false,
                        "error", "Access denied: Specification clearance is assigned to " + assignedSpec));
            }
        }

        boolean isDeviation = complianceType != null && (
                "DEVIATIONS".equalsIgnoreCase(complianceType.trim())
                || "COMPLY WITH DEVIATIONS".equalsIgnoreCase(complianceType.trim())
                || "COMPLY_WITH_DEVIATIONS".equalsIgnoreCase(complianceType.trim())
                || "Approved with some deviation".equalsIgnoreCase(complianceType.trim())
                || "comply with deviations".equalsIgnoreCase(complianceType.trim())
                || "deviation".equalsIgnoreCase(complianceType.trim())
                || "deviations".equalsIgnoreCase(complianceType.trim())
        );
        String compType = isDeviation ? "COMPLY WITH DEVIATIONS" : "ALL COMPLY";

        String fileError = validateClearanceFiles(pdfFile, docxFile, xlsxFile);
        if (fileError != null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", fileError));
        }

        boolean hasPdf = pdfFile != null && !pdfFile.isEmpty();
        boolean hasDocx = docxFile != null && !docxFile.isEmpty();
        boolean hasXlsx = xlsxFile != null && !xlsxFile.isEmpty();
        boolean hasUploadedDocs = hasPdf || hasDocx || hasXlsx;

        String stem = "Combined_Technical_Data_Sheet";
        String pdfFileName = stem + ".pdf";
        String docxFileName = stem + ".docx";
        String xlsxFileName = stem + ".xlsx";
        String pdfDownloadUrl = "/documents/" + id + "/" + pdfFileName;
        String docxDownloadUrl = "/documents/" + id + "/" + docxFileName;
        String xlsxDownloadUrl = "/documents/" + id + "/" + xlsxFileName;
        String now = LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        String today = LocalDate.now().toString();
        String version = String.valueOf(System.currentTimeMillis());

        if (hasUploadedDocs) {
            // Delete previous AI specs that were NOT uploaded by clearance!
            // ONLY things uploaded by clearance are carried forward!
            try {
                if (!hasPdf) {
                    deleteDocFromAllLocations(id, pdfFileName);
                }
                if (!hasDocx) {
                    deleteDocFromAllLocations(id, docxFileName);
                }
                if (!hasXlsx) {
                    deleteDocFromAllLocations(id, xlsxFileName);
                }
                deleteDocFromAllLocations(id, "specification.pdf");

                if (hasPdf) {
                    saveDocBytesToAllLocations(id, pdfFileName, pdfFile.getBytes());
                }
                if (hasDocx) {
                    saveDocBytesToAllLocations(id, docxFileName, docxFile.getBytes());
                }
                if (hasXlsx) {
                    saveDocBytesToAllLocations(id, xlsxFileName, xlsxFile.getBytes());
                }
            } catch (Exception e) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(Map.of("success", false, "error", "Failed to save clearance superior documents: " + e.getMessage()));
            }

            // Update downloaded_docs so ONLY clearance superior docs carry forward
            List<Map<String, Object>> docsList = new ArrayList<>();
            ObjectMapper objectMapper = new ObjectMapper();
            String existingJson = tender.getDownloadedDocs();
            if (existingJson != null && !existingJson.isBlank()) {
                try {
                    docsList = objectMapper.readValue(existingJson, new TypeReference<List<Map<String, Object>>>() {});
                } catch (Exception ignored) {}
            }

            // Purge ALL prior technical spec entries (AI specs, previous drafts)
            docsList.removeIf(item -> {
                if ("brochure".equals(String.valueOf(item.get("source")))) return false; // the Brochure Team's upload stays
                String fn = item.get("filename") != null ? item.get("filename").toString().toLowerCase() : "";
                String nm = item.get("name") != null ? item.get("name").toString().toLowerCase() : "";
                return fn.contains("combined_technical") || fn.contains("tech_spec") || fn.contains("technical_specification") || fn.equals("specification.pdf")
                        || nm.contains("combined technical") || nm.contains("technical specification");
            });

            if (hasPdf) {
                Map<String, Object> doc = replacementDoc("Combined Technical Specifications (PDF) [Clearance Superior]", pdfFileName, pdfDownloadUrl, today, version);
                doc.put("superior", true);
                doc.put("uploaded_by", username);
                docsList.add(doc);
            }
            if (hasDocx) {
                Map<String, Object> doc = replacementDoc("Combined Technical Specifications (DOCX) [Clearance Superior]", docxFileName, docxDownloadUrl, today, version);
                doc.put("superior", true);
                doc.put("uploaded_by", username);
                docsList.add(doc);
            }
            if (hasXlsx) {
                Map<String, Object> doc = replacementDoc("Combined Technical Specifications (XLSX) [Clearance Superior]", xlsxFileName, xlsxDownloadUrl, today, version);
                doc.put("superior", true);
                doc.put("uploaded_by", username);
                docsList.add(doc);
            }

            // Set finalTechSpecFilename to the primary uploaded document
            if (hasPdf) {
                tender.setFinalTechSpecFilename(pdfFileName);
            } else if (hasDocx) {
                tender.setFinalTechSpecFilename(docxFileName);
            } else if (hasXlsx) {
                tender.setFinalTechSpecFilename(xlsxFileName);
            }

            try {
                tender.setDownloadedDocs(objectMapper.writeValueAsString(docsList));
            } catch (Exception ignored) {}

            tender.setFinalTechSpecUploadedBy(username);
            tender.setFinalTechSpecUploadedAt(now);
        } else {
            // Keep AI-generated documents if no replacement files uploaded
            if (tender.getFinalTechSpecFilename() == null || tender.getFinalTechSpecFilename().isBlank()) {
                tender.setFinalTechSpecFilename(pdfFileName);
            }
        }

        tender.setSpecVerificationStatus("Approved");
        tender.setSpecComplianceType(compType);
        tenderRepository.save(tender);

        String effectiveSpecFilename = tender.getFinalTechSpecFilename() != null && !tender.getFinalTechSpecFilename().isBlank()
                ? tender.getFinalTechSpecFilename()
                : (hasDocx ? docxFileName : (hasXlsx ? xlsxFileName : pdfFileName));

        // Sync modern workflow: clearance returns the tender to the executive for EMD.
        if (workflowSyncService != null) {
            try {
                workflowSyncService.recordFinalTechSpec(id, effectiveSpecFilename, compType, comment, username);
            } catch (Exception ex) {
                System.err.println("[WorkflowController] Error syncing workflow state: " + ex.getMessage());
                workflowSyncService.handOffClearedSpecToExecutive(tender, null);
                tenderRepository.save(tender);
            }
        } else {
            workflowSyncServiceMissingHandoff(tender);
            tenderRepository.save(tender);
        }

        // Resolve all pending SPEC_CLEARANCE requests as APPROVED so it clears out of Approvals Center
        List<TenderApprovalRequest> pendingSpecList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.SPEC_CLEARANCE);
        for (TenderApprovalRequest a : pendingSpecList) {
            if ("PENDING".equalsIgnoreCase(a.getStatus())) {
                a.setStatus("APPROVED");
                String revComment = hasUploadedDocs
                        ? (isDeviation ? "Approved with Deviations (Clearance superior documents uploaded)." : "Approved: All Comply (Clearance superior documents uploaded).")
                        : (isDeviation ? "Approved with Deviations." : "Approved: Technical specifications verified (All Comply).");
                a.setReviewerComment(revComment);
                a.setUpdatedAt(java.time.LocalDateTime.now());
                approvalRepository.save(a);
            }
        }

        String stageNow = tender.getCurrentStage() == null ? "BID_DOCS_PREPARATION" : tender.getCurrentStage();
        String defaultComment;
        if (isDeviation) {
            defaultComment = hasUploadedDocs
                    ? "Comply with deviations. Clearance superior documents uploaded and replace previous AI specifications."
                    : "Comply with deviations accepted.";
        } else {
            defaultComment = hasUploadedDocs
                    ? "All comply. Clearance superior documents uploaded and replace previous AI specifications."
                    : "All comply. Existing specification documents continue with this tender.";
        }
        String finalComment = (comment != null && !comment.isBlank()) ? comment : defaultComment;
        String handoff = " Tender returned to the Tender Executive to generate the bid package."
                + (com.tenderpocket.services.WorkflowSyncService.BROCHURE_PENDING.equalsIgnoreCase(tender.getBrochureStatus())
                    ? " The Brochure Team uploads the brochure in parallel."
                    : "");
        commentRepository.save(new TenderComment(id, "SPEC_CLEARANCE", username, "Clearance Team",
                finalComment + " [" + compType + "." + handoff + "]"));

        String message = hasUploadedDocs
                ? (compType + " recorded. Clearance superior documents replace previous specifications." + handoff)
                : (compType + " recorded. Specifications continue to Executive." + handoff);

        return ResponseEntity.ok(Map.of(
            "success", true,
            "complianceType", compType,
            "currentStage", stageNow,
            "message", message,
            "notification", message
        ));
    }

    private void workflowSyncServiceMissingHandoff(Tender tender) {
        tender.setCurrentStage("BID_DOCS_PREPARATION");
        com.tenderpocket.services.WorkflowSyncService.requestBrochure(tender);
    }

    private boolean isEmdSettled(Tender tender) {
        if (tender == null) return false;
        if (tender.getEmd() != null && tender.getEmd() == 0.0) return true;
        if (Boolean.FALSE.equals(tender.getEmdApplicable())) return true;
        String payment = tender.getPaymentStatus();
        return "Approved".equalsIgnoreCase(payment) || "Exempt".equalsIgnoreCase(payment);
    }

    private String validateClearanceFiles(MultipartFile pdfFile, MultipartFile docxFile, MultipartFile xlsxFile) {
        if (pdfFile != null && !pdfFile.isEmpty()) {
            String pdfName = pdfFile.getOriginalFilename() == null ? "" : pdfFile.getOriginalFilename().toLowerCase(Locale.ROOT);
            if (!pdfName.endsWith(".pdf")) {
                return "Uploaded PDF document must have a .pdf extension.";
            }
        }
        if (docxFile != null && !docxFile.isEmpty()) {
            String docxName = docxFile.getOriginalFilename() == null ? "" : docxFile.getOriginalFilename().toLowerCase(Locale.ROOT);
            if (!docxName.endsWith(".docx") && !docxName.endsWith(".doc")) {
                return "Uploaded Word document must have a .docx or .doc extension.";
            }
        }
        if (xlsxFile != null && !xlsxFile.isEmpty()) {
            String xlsxName = xlsxFile.getOriginalFilename() == null ? "" : xlsxFile.getOriginalFilename().toLowerCase(Locale.ROOT);
            if (!xlsxName.endsWith(".xlsx") && !xlsxName.endsWith(".xls")) {
                return "Uploaded Excel spreadsheet must have a .xlsx or .xls extension.";
            }
        }
        return null;
    }

    private Map<String, Object> replacementDoc(String name, String filename, String path, String today, String version) {
        Map<String, Object> doc = new HashMap<>();
        doc.put("name", name);
        doc.put("filename", filename);
        doc.put("local_path", path + "?v=" + version);
        doc.put("created_date", today);
        doc.put("source", "clearance_replacement");
        return doc;
    }

    // POST /api/tenders/{id}/tpc-price (TPC Team enters manufacturer purchase price -> Forward to MIS Team)
    @PostMapping("/{id}/tpc-price")
    @Transactional
    public ResponseEntity<?> submitTpcPrice(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "tpc") String username,
            @RequestBody Map<String, Object> body) {

        if (!WorkflowPermissions.allowed(SET_TPC_PRICE)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Double price = positivePrice(body.get("tpcPurchasePrice"));
        if (price == null) return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Valid manufacturer purchase price is required"));
        Tender tender = tOpt.get();
        if (!"Approved".equals(tender.getSpecVerificationStatus())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Specification clearance is required before TPC pricing."));
        }
        if (!isEmdSettled(tender)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "EMD must be approved or exempt before commercial pricing."));
        }

        String chosenMis = (body.get("assignedMisMember") != null && !body.get("assignedMisMember").toString().isBlank())
                ? body.get("assignedMisMember").toString().trim()
                : (body.get("misAssignee") != null && !body.get("misAssignee").toString().isBlank() ? body.get("misAssignee").toString().trim() : null);
        if (chosenMis != null && !chosenMis.isBlank()) {
            tender.setAssignedMisMember(chosenMis);
        }

        tender.setTpcPurchasePrice(price);
        if (!"DUAL_TRACK".equalsIgnoreCase(tender.getCurrentStage()) && !"DUAL_TRACK_ACTIVE".equalsIgnoreCase(tender.getCurrentStage())) {
            tender.setCurrentStage("MIS_PRICING");
        }
        tenderRepository.save(tender);

        if (workflowSyncService != null) {
            try {
                workflowSyncService.recordTpcPricing(id, price, chosenMis, username);
            } catch (Exception ex) {
                System.err.println("[WorkflowController] Error syncing recordTpcPricing: " + ex.getMessage());
            }
        }

        List<TenderApprovalRequest> pendingTpcList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.TPC_PRICING);
        for (TenderApprovalRequest a : pendingTpcList) {
            if ("PENDING".equalsIgnoreCase(a.getStatus())) {
                a.setStatus("APPROVED");
                a.setTpcPurchasePrice(price);
                a.setUpdatedAt(java.time.LocalDateTime.now());
                approvalRepository.save(a);
            }
        }

        String targetMisAssignee = (chosenMis != null && !chosenMis.isBlank()) ? chosenMis :
                (tender.getAssignedMisMember() != null && !tender.getAssignedMisMember().isBlank() ? tender.getAssignedMisMember() : "MIS Team");

        // Avoid duplicate MIS_PRICING requests if already pending
        List<TenderApprovalRequest> existingMisList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.MIS_PRICING);
        TenderApprovalRequest targetMis = null;
        for (TenderApprovalRequest a : existingMisList) {
            if ("PENDING".equalsIgnoreCase(a.getStatus())) {
                if (targetMis == null) {
                    targetMis = a;
                } else {
                    approvalRepository.delete(a);
                }
            }
        }

        if (targetMis != null) {
            targetMis.setRequestedBy(username);
            targetMis.setAssignedTo(targetMisAssignee);
            targetMis.setTpcPurchasePrice(price);
            targetMis.setStatus("PENDING");
            targetMis.setUpdatedAt(java.time.LocalDateTime.now());
            approvalRepository.save(targetMis);
        } else {
            TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.MIS_PRICING, username, targetMisAssignee, "PENDING");
            req.setTpcPurchasePrice(price);
            approvalRepository.save(req);
        }

        commentRepository.save(new TenderComment(id, "TPC_PRICING", username, "TPC Team", "Obtained manufacturer purchase price (₹" + price + "). Forwarded securely to MIS member: " + targetMisAssignee + "."));

        return ResponseEntity.ok(Map.of("success", true, "message", "Manufacturer purchase price obtained by TPC Team and forwarded securely to MIS member: " + targetMisAssignee + "."));
    }

    // POST /api/tenders/{id}/mis-price (MIS Team provides final purchase price to Tender Executive)
    @PostMapping("/{id}/mis-price")
    public ResponseEntity<?> submitMisPrice(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "misteam") String username,
            @RequestBody Map<String, Object> body) {

        if (!WorkflowPermissions.allowed(SET_MIS_PRICE)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Double price = positivePrice(body.get("misFinalPrice"));
        if (price == null) return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Valid MIS final price is required"));
        Tender tender = tOpt.get();
        if (!"Approved".equals(tender.getSpecVerificationStatus())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Approved technical specification clearance is required before MIS pricing."));
        }
        if (!isEmdSettled(tender)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "EMD must be approved or exempt before the final commercial price."));
        }
        tender.setMisFinalPrice(price);
        if (tender.getCurrentStage() == null || List.of("MIS_PRICING", "TPC_PRICING", "EMD_PAYMENT", "PAYMENT_APPROVAL").contains(tender.getCurrentStage())) {
            tender.setCurrentStage("DUAL_TRACK");
        }
        tenderRepository.save(tender);

        List<TenderApprovalRequest> pendingMisList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.MIS_PRICING);
        for (TenderApprovalRequest a : pendingMisList) {
            if ("PENDING".equalsIgnoreCase(a.getStatus())) {
                a.setStatus("APPROVED");
                a.setMisFinalPrice(price);
                a.setUpdatedAt(java.time.LocalDateTime.now());
                approvalRepository.save(a);
            }
        }

        // Also resolve any pending TPC_PRICING requests if MIS directly provides pricing
        List<TenderApprovalRequest> pendingTpcList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.TPC_PRICING);
        for (TenderApprovalRequest a : pendingTpcList) {
            if ("PENDING".equalsIgnoreCase(a.getStatus())) {
                a.setStatus("APPROVED");
                if (a.getReviewerComment() == null || a.getReviewerComment().isBlank()) {
                    a.setReviewerComment("Priced directly by MIS Team");
                }
                a.setUpdatedAt(java.time.LocalDateTime.now());
                approvalRepository.save(a);
            }
        }

        if (workflowSyncService != null) {
            try {
                workflowSyncService.approveTrackAPricing(id, price, username);
            } catch (Exception ex) {
                System.err.println("[WorkflowController] Error syncing workflow state: " + ex.getMessage());
            }
        }

        commentRepository.save(new TenderComment(id, "MIS_PRICING", username, "MIS Team", "Final purchase price provided to Tender Executive: ₹" + price));

        return ResponseEntity.ok(Map.of("success", true, "message", "Final purchase price configured for Tender Executive."));
    }

    // POST /api/tenders/{id}/payment-request
    @PostMapping("/{id}/payment-request")
    @Transactional
    public ResponseEntity<?> submitPaymentRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody Map<String, Object> body) {

        if (!WorkflowPermissions.allowed(RECORD_PAYMENT)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        String assignedMis = body.get("assignedMisExecutive") != null ? body.get("assignedMisExecutive").toString() : "misteam";
        Double emdAmount = body.get("emdAmount") != null ? Double.parseDouble(body.get("emdAmount").toString()) : 0.0;
        String transferMode = body.get("transferMode") != null ? body.get("transferMode").toString() : "NEFT";
        String refNo = body.get("transferRefNo") != null ? body.get("transferRefNo").toString() : "";
        String receiptUrl = body.get("receiptFileUrl") != null ? body.get("receiptFileUrl").toString() : "";
        String comment = body.get("comment") != null ? body.get("comment").toString() : "Submitted payment approval request.";

        if (!isSafeUrl(receiptUrl)) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Invalid receipt URL: Only https:// and internal document paths are allowed"));
        }

        Tender tender = tOpt.get();

        if (!"Approved".equals(tender.getVerificationStatus())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Bid document approval is required before payment."));
        }
        tender.setAssignedMisExecutive(assignedMis);
        tender.setCurrentStage("PAYMENT_APPROVAL");
        tenderRepository.save(tender);

        List<TenderApprovalRequest> existingList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.PAYMENT_APPROVAL);
        TenderApprovalRequest targetReq = null;
        for (TenderApprovalRequest req : existingList) {
            if ("PENDING".equalsIgnoreCase(req.getStatus())) {
                if (targetReq == null) {
                    targetReq = req;
                } else {
                    approvalRepository.delete(req);
                }
            }
        }

        if (targetReq != null) {
            targetReq.setRequestedBy(username);
            targetReq.setAssignedTo(assignedMis);
            targetReq.setEmdAmount(emdAmount);
            targetReq.setTransferMode(transferMode);
            targetReq.setTransferRefNo(refNo);
            targetReq.setReceiptFileUrl(receiptUrl);
            targetReq.setStatus("PENDING");
            targetReq.setUpdatedAt(java.time.LocalDateTime.now());
            approvalRepository.save(targetReq);
        } else {
            TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.PAYMENT_APPROVAL, username, assignedMis, "PENDING");
            req.setEmdAmount(emdAmount);
            req.setTransferMode(transferMode);
            req.setTransferRefNo(refNo);
            req.setReceiptFileUrl(receiptUrl);
            approvalRepository.save(req);
        }

        commentRepository.save(new TenderComment(id, "PAYMENT_APPROVAL", username, "Tender Executive", comment + " [Mode: " + transferMode + ", Ref: " + refNo + "]"));

        return ResponseEntity.ok(Map.of("success", true, "message", "Payment approval request submitted to MIS Executive: " + assignedMis));
    }

    // POST /api/tenders/{id}/doc-verification-request
    @PostMapping("/{id}/doc-verification-request")
    @Transactional
    public ResponseEntity<?> submitDocVerificationRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody Map<String, String> body) {

        if (!WorkflowPermissions.allowed(GENERATE_BIDS)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        String assignedMis = body.getOrDefault("assignedMisExecutive", "misteam");
        String workingPath = body.getOrDefault("workingPath", "");
        String comment = body.getOrDefault("comment", "Submitted document verification request.");

        Tender tender = tOpt.get();
        if (!"Approved".equals(tender.getSpecVerificationStatus())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Specification clearance is required before document verification."));
        }
        if (!isEmdSettled(tender)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "EMD must be approved or exempt before document verification. Pricing runs in parallel and is not required first."));
        }
        String downloadedDocsVal = body.get("downloadedDocs");
        if (downloadedDocsVal == null) downloadedDocsVal = body.get("downloaded_docs");
        if (downloadedDocsVal != null && !downloadedDocsVal.trim().isEmpty()) {
            tender.setDownloadedDocs(downloadedDocsVal);
        }

        tender.setAssignedMisExecutive(assignedMis);
        tender.setWorkingPath(workingPath);
        tender.setCurrentStage("DOC_VERIFICATION");
        tenderRepository.save(tender);

        List<TenderApprovalRequest> existingList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.DOC_VERIFICATION);
        TenderApprovalRequest targetReq = null;
        for (TenderApprovalRequest req : existingList) {
            if ("PENDING".equalsIgnoreCase(req.getStatus())) {
                if (targetReq == null) {
                    targetReq = req;
                } else {
                    approvalRepository.delete(req);
                }
            }
        }

        if (targetReq != null) {
            targetReq.setRequestedBy(username);
            targetReq.setAssignedTo(assignedMis);
            targetReq.setWorkingPath(workingPath);
            targetReq.setStatus("PENDING");
            targetReq.setUpdatedAt(java.time.LocalDateTime.now());
            approvalRepository.save(targetReq);
        } else {
            TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.DOC_VERIFICATION, username, assignedMis, "PENDING");
            req.setWorkingPath(workingPath);
            approvalRepository.save(req);
        }

        commentRepository.save(new TenderComment(id, "DOC_VERIFICATION", username, "Tender Executive", comment + " [Working Path: " + workingPath + "]"));

        return ResponseEntity.ok(Map.of("success", true, "message", "Document verification request sent to MIS Executive: " + assignedMis));
    }

    // POST /api/tenders/{id}/submission-request ("I have filed a tender please verify")
    @PostMapping("/{id}/submission-request")
    @Transactional
    public ResponseEntity<?> submitSubmissionRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody(required = false) Map<String, String> body) {

        if (!WorkflowPermissions.allowed(RECORD_SUBMISSION)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Tender tender = tOpt.get();
        if (!"Approved".equals(tender.getPaymentStatus())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Payment approval is required before submission."));
        }
        tender.setCurrentStage("SUBMISSION_PENDING");
        tenderRepository.save(tender);

        List<TenderApprovalRequest> existingList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.SUBMISSION_PENDING);
        TenderApprovalRequest targetReq = null;
        for (TenderApprovalRequest req : existingList) {
            if ("PENDING".equalsIgnoreCase(req.getStatus())) {
                if (targetReq == null) {
                    targetReq = req;
                } else {
                    approvalRepository.delete(req);
                }
            }
        }

        String assignedSub = tender.getAssignedMisMemberSubmission() != null && !tender.getAssignedMisMemberSubmission().isBlank()
                ? tender.getAssignedMisMemberSubmission()
                : (tender.getAssignedMisMember() != null && !tender.getAssignedMisMember().isBlank() ? tender.getAssignedMisMember() : "misteam");

        if (targetReq != null) {
            targetReq.setRequestedBy(username);
            targetReq.setAssignedTo(assignedSub);
            targetReq.setStatus("PENDING");
            targetReq.setUpdatedAt(java.time.LocalDateTime.now());
            approvalRepository.save(targetReq);
        } else {
            TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.SUBMISSION_PENDING, username, assignedSub, "PENDING");
            approvalRepository.save(req);
        }

        String note = (body != null && body.containsKey("note")) ? body.get("note") : "I have filed this tender on the portal. Please verify and mark as Submitted.";
        commentRepository.save(new TenderComment(id, "SUBMISSION_PENDING", username, "Tender Executive", note));

        return ResponseEntity.ok(Map.of("success", true, "message", "Submission verification request sent to MIS Team."));
    }

    // POST /api/tenders/{id}/win-loss-request
    @PostMapping("/{id}/win-loss-request")
    @Transactional
    public ResponseEntity<?> submitWinLossRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody Map<String, String> body) {

        if (!WorkflowPermissions.allowed(RECORD_OUTCOME)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        String status = body.getOrDefault("status", "Won"); // Won or Lost
        String lossReason = body.getOrDefault("lossReason", "");

        Tender tender = tOpt.get();
        tender.setCurrentStage("WIN_LOSS_PENDING");
        tender.setOutcomeStatus("Pending");
        if ("Lost".equalsIgnoreCase(status)) {
            tender.setLossReason(lossReason);
        }
        tenderRepository.save(tender);

        List<TenderApprovalRequest> existingList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.WIN_LOSS_PENDING);
        TenderApprovalRequest targetReq = null;
        for (TenderApprovalRequest req : existingList) {
            if ("PENDING".equalsIgnoreCase(req.getStatus())) {
                if (targetReq == null) {
                    targetReq = req;
                } else {
                    approvalRepository.delete(req);
                }
            }
        }

        String assignedSub = tender.getAssignedMisMemberSubmission() != null && !tender.getAssignedMisMemberSubmission().isBlank()
                ? tender.getAssignedMisMemberSubmission()
                : (tender.getAssignedMisMember() != null && !tender.getAssignedMisMember().isBlank() ? tender.getAssignedMisMember() : "misteam");

        if (targetReq != null) {
            targetReq.setRequestedBy(username);
            targetReq.setAssignedTo(assignedSub);
            targetReq.setLossReasonExecutive(lossReason);
            targetReq.setStatus("PENDING");
            targetReq.setUpdatedAt(java.time.LocalDateTime.now());
            approvalRepository.save(targetReq);
        } else {
            TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.WIN_LOSS_PENDING, username, assignedSub, "PENDING");
            req.setLossReasonExecutive(lossReason);
            approvalRepository.save(req);
        }

        commentRepository.save(new TenderComment(id, "WIN_LOSS_PENDING", username, "Tender Executive", "Declared tender outcome: " + status + (lossReason.isEmpty() ? "" : " (Reason: " + lossReason + ")")));

        return ResponseEntity.ok(Map.of("success", true, "message", "Win/Loss verification request sent to MIS Team."));
    }

    // POST /api/tenders/{id}/review-approval (MIS Team approves/rejects requests)
    @PostMapping("/{id}/review-approval")
    @Transactional
    public ResponseEntity<?> reviewApproval(
            @PathVariable("id") String id,
            @RequestBody Map<String, Object> body) {

        String authRole = getAuthenticatedRole();
        String authUsername = getAuthenticatedUsername();

        if ("Admin".equalsIgnoreCase(authRole)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Admin has view-only access to approvals."));
        }

        if (!WorkflowPermissions.allowed(REVIEW_BIDS) && !WorkflowPermissions.allowed(APPROVE_SPEC)
                && !WorkflowPermissions.allowed(SET_TPC_PRICE)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: Valid operational role authentication required"));
        }

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));
        // Lock the tender row first and re-read it: every approval path locks the tender before its
        // requests, so two of them never wait for each other in a cycle.
        entityManager.refresh(tOpt.get(), LockModeType.PESSIMISTIC_WRITE);

        List<TenderApprovalRequest> requests = approvalRepository.findByTenderIdOrderByCreatedAtDesc(id);
        if (requests.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "No approval requests found for this tender"));
        }

        TenderApprovalRequest latest = requests.get(0);
        // Lock the request row and re-read it, so that simultaneous reviews of the same request are
        // handled one after the other: the second finds it already actioned below.
        entityManager.refresh(latest, LockModeType.PESSIMISTIC_WRITE);
        if (!WorkflowPermissions.allowed(WorkflowPermissions.reviewAction(latest.getStage().name()))) {
            return WorkflowPermissions.denied();
        }

        // Verify request is still pending
        if (!"PENDING".equalsIgnoreCase(latest.getStatus())) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Latest approval request is already actioned (" + latest.getStatus() + ")"));
        }

        // Ownership check: if not Admin, must be assigned to logged-in user or unassigned queue
        if (!"Admin".equalsIgnoreCase(authRole)) {
            String assigned = latest.getAssignedTo();
            boolean isAssignedToUser = authUsername != null && assigned != null && assigned.equalsIgnoreCase(authUsername);
            boolean isTeamQueue = assigned == null || assigned.isBlank()
                    || "misteam".equalsIgnoreCase(assigned) || "mis team".equalsIgnoreCase(assigned)
                    || "clearance".equalsIgnoreCase(assigned) || "clearance team".equalsIgnoreCase(assigned) || "specification team".equalsIgnoreCase(assigned)
                    || "tpc".equalsIgnoreCase(assigned) || "tpc team".equalsIgnoreCase(assigned) || "tpc pricing team".equalsIgnoreCase(assigned);
            if (!isAssignedToUser && !isTeamQueue) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(Map.of("success", false, "error", "Access denied: This approval request is assigned to " + assigned + ". You have view-only access."));
            }
        }

        Tender tender = tOpt.get();
        String expectedStage = latest.getStage().name();

        // Concurrency / stale safeguard: Ensure tender is still at the stage of the approval request
        String currentStage = tender.getCurrentStage() != null ? tender.getCurrentStage().toUpperCase() : "";
        boolean stageMatches = expectedStage.equalsIgnoreCase(currentStage)
                || ("DOC_VERIFICATION".equalsIgnoreCase(expectedStage) && List.of("DOC_VERIFICATION", "BID_DOC_PENDING", "DUAL_TRACK", "DUAL_TRACK_ACTIVE", "TPC_PRICING", "MIS_PRICING").contains(currentStage))
                || ("MIS_PRICING".equalsIgnoreCase(expectedStage) && List.of("MIS_PRICING", "DUAL_TRACK", "DUAL_TRACK_ACTIVE", "TPC_PRICING", "DOC_VERIFICATION", "BID_DOC_PENDING").contains(currentStage))
                || ("TPC_PRICING".equalsIgnoreCase(expectedStage) && List.of("TPC_PRICING", "DUAL_TRACK", "DUAL_TRACK_ACTIVE", "DOC_VERIFICATION", "BID_DOC_PENDING").contains(currentStage))
                || ("PAYMENT_APPROVAL".equalsIgnoreCase(expectedStage) && List.of("PAYMENT_APPROVAL", "BID_DOCS_PREPARATION", "EMD_PENDING", "EMD_PAYMENT").contains(currentStage))
                || ("SPEC_CLEARANCE".equalsIgnoreCase(expectedStage) && List.of("SPEC_CLEARANCE", "SPEC_GENERATION_PENDING", "EXECUTIVE_ASSIGNMENT").contains(currentStage))
                || ("SUBMISSION_PENDING".equalsIgnoreCase(expectedStage) && List.of("SUBMISSION_READY", "SUBMISSION_PENDING", "SUBMITTED").contains(currentStage))
                || ("WIN_LOSS_PENDING".equalsIgnoreCase(expectedStage) && List.of("WIN_LOSS_PENDING", "SUBMITTED", "SUBMISSION_READY").contains(currentStage));
        if (!stageMatches) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("success", false, "error", "Conflict: Tender is currently at stage " + tender.getCurrentStage() + ", cannot action approval for stage " + expectedStage));
        }

        String action = body.get("action") != null ? body.get("action").toString().trim().toUpperCase() : "APPROVED";
        if (!List.of("APPROVED", "REJECTED", "CHANGES_REQUESTED").contains(action)) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Invalid approval action."));
        }
        if ("REJECTED".equals(action) && "SPEC_CLEARANCE".equalsIgnoreCase(expectedStage)) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Clearance team cannot reject technical specifications. Only 'All Comply' or 'Deviations' are allowed."));
        }
        String comment = body.get("comment") != null ? body.get("comment").toString().trim() : "Review completed by MIS Team.";
        String lossReasonMis = body.get("lossReasonMis") != null ? body.get("lossReasonMis").toString().trim() : "";

        // Parse optional prices from review body
        Double reqTpcPrice = positivePrice(body.get("tpcPurchasePrice"));
        if (reqTpcPrice == null) reqTpcPrice = positivePrice(body.get("tpc_purchase_price"));

        Double reqMisPrice = positivePrice(body.get("misFinalPrice"));
        if (reqMisPrice == null) reqMisPrice = positivePrice(body.get("mis_final_price"));

        if ("APPROVED".equals(action)) {
            switch (expectedStage) {
                case "PAYMENT_APPROVAL" -> {
                    tender.setPaymentStatus("Approved");
                    if (workflowSyncService != null) {
                        workflowSyncService.approveEmdPayment(tender.getId(), authUsername);
                    } else {
                        tender.setCurrentStage("SUBMISSION_PENDING");
                    }
                }
                case "DOC_VERIFICATION" -> {
                    tender.setVerificationStatus("Approved");
                    if (workflowSyncService != null) {
                        workflowSyncService.approveTrackBDocs(tender.getId(), authUsername, comment);
                        tender = tenderRepository.findById(tender.getId()).orElse(tender);
                    } else {
                        boolean pricingDone = "Approved".equalsIgnoreCase(tender.getPricingStatus())
                                || (tender.getMisFinalPrice() != null && tender.getMisFinalPrice() > 0);
                        if (pricingDone) {
                            tender.setCurrentStage("SUBMISSION_READY");
                            tender.setCanFinalSubmit(true);
                        } else if (!List.of("TPC_PRICING", "MIS_PRICING", "DUAL_TRACK", "DUAL_TRACK_ACTIVE").contains(tender.getCurrentStage())) {
                            tender.setCurrentStage("PAYMENT_APPROVAL");
                        }
                    }
                }
                case "SUBMISSION_PENDING" -> {
                    tender.setSubmissionStatus("Approved");
                    tender.setOutcomeStatus("Pending");
                    tender.setCurrentStage("WIN_LOSS_PENDING");
                    tender.setStatus("Submitted");
                    List<TenderApprovalRequest> existingOutcome = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tender.getId(), TenderWorkflowStage.WIN_LOSS_PENDING);
                    boolean hasPendingOutcome = existingOutcome.stream().anyMatch(r -> "PENDING".equalsIgnoreCase(r.getStatus()));
                    if (!hasPendingOutcome) {
                        String outcomeAssignee = tender.getAssignedMisMemberSubmission() != null && !tender.getAssignedMisMemberSubmission().isBlank()
                                ? tender.getAssignedMisMemberSubmission()
                                : (tender.getAssignedMisMember() != null && !tender.getAssignedMisMember().isBlank() ? tender.getAssignedMisMember() : "misteam");
                        TenderApprovalRequest outcomeReq = new TenderApprovalRequest(
                                tender.getId(),
                                TenderWorkflowStage.WIN_LOSS_PENDING,
                                tender.getMisExecutive() != null ? tender.getMisExecutive() : authUsername,
                                outcomeAssignee,
                                "PENDING"
                        );
                        approvalRepository.save(outcomeReq);
                    }
                }
                case "WIN_LOSS_PENDING" -> {
                    String outcome = body.get("outcome") != null ? body.get("outcome").toString() : null;
                    boolean isLoss = "Lost".equalsIgnoreCase(outcome)
                            || (!"Won".equalsIgnoreCase(outcome) && (
                                   (latest.getLossReasonExecutive() != null && !latest.getLossReasonExecutive().isBlank())
                                   || !lossReasonMis.isEmpty()
                                ));
                    if (workflowSyncService != null) {
                        workflowSyncService.recordOutcome(tender.getId(), isLoss ? "Lost" : "Won", lossReasonMis, authUsername);
                    } else {
                        if (isLoss) {
                            tender.setCurrentStage("LOST");
                            tender.setOutcomeStatus("Lost");
                            tender.setStatus("Not Awarded");
                            if (!lossReasonMis.isEmpty()) tender.setLossReason(lossReasonMis);
                        } else {
                            tender.setCurrentStage("WON");
                            tender.setOutcomeStatus("Won");
                            tender.setStatus("Awarded");
                        }
                    }
                }
                case "SPEC_CLEARANCE" -> {
                    tender.setSpecVerificationStatus("Approved");
                    tender.setSpecComplianceType("ALL_COMPLY");
                    if (workflowSyncService != null) {
                        String specFile = tender.getFinalTechSpecFilename() != null && !tender.getFinalTechSpecFilename().isBlank()
                                ? tender.getFinalTechSpecFilename() : "Combined_Technical_Data_Sheet.pdf";
                        workflowSyncService.recordFinalTechSpec(tender.getId(), specFile, "ALL_COMPLY", comment, authUsername);
                    } else {
                        tender.setCurrentStage("BID_DOCS_PREPARATION");
                        com.tenderpocket.services.WorkflowSyncService.requestBrochure(tender);
                    }
                }
                case "TPC_PRICING"    -> {
                    Double tpcPriceToSet = reqTpcPrice != null ? reqTpcPrice : latest.getTpcPurchasePrice();
                    if (tpcPriceToSet != null) {
                        latest.setTpcPurchasePrice(tpcPriceToSet);
                        tender.setTpcPurchasePrice(tpcPriceToSet);
                    }
                    tender.setCurrentStage("MIS_PRICING");
                    try {
                        List<TenderApprovalRequest> existingMis = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tender.getId(), TenderWorkflowStage.MIS_PRICING);
                        boolean hasPendingMis = existingMis.stream().anyMatch(r -> "PENDING".equalsIgnoreCase(r.getStatus()));
                        if (!hasPendingMis) {
                            String misAssignee = tender.getAssignedMisMember() != null && !tender.getAssignedMisMember().isBlank()
                                    ? tender.getAssignedMisMember()
                                    : (tender.getMisExecutive() != null && !tender.getMisExecutive().isBlank() ? tender.getMisExecutive() : "MIS Team");
                            TenderApprovalRequest misReq = new TenderApprovalRequest(
                                    tender.getId(),
                                    TenderWorkflowStage.MIS_PRICING,
                                    authUsername,
                                    misAssignee,
                                    "PENDING"
                            );
                            if (tpcPriceToSet != null) {
                                misReq.setTpcPurchasePrice(tpcPriceToSet);
                            }
                            approvalRepository.save(misReq);
                        }
                    } catch (Exception ignored) {}
                }
                case "MIS_PRICING"    -> {
                    Double misPriceToSet = reqMisPrice != null ? reqMisPrice : latest.getMisFinalPrice();
                    if (misPriceToSet != null) {
                        latest.setMisFinalPrice(misPriceToSet);
                        tender.setMisFinalPrice(misPriceToSet);
                    }
                    if (tender.getTpcPurchasePrice() != null && latest.getTpcPurchasePrice() == null) {
                        latest.setTpcPurchasePrice(tender.getTpcPurchasePrice());
                    }
                    if (workflowSyncService != null) {
                        workflowSyncService.approveTrackAPricing(tender.getId(), misPriceToSet != null ? misPriceToSet : 0.0, authUsername);
                        tender = tenderRepository.findById(tender.getId()).orElse(tender);
                    } else {
                        boolean docsDone = "Approved".equalsIgnoreCase(tender.getVerificationStatus());
                        if (docsDone) {
                            tender.setCurrentStage("SUBMISSION_READY");
                            tender.setCanFinalSubmit(true);
                        } else {
                            tender.setCurrentStage("BID_DOC_PENDING");
                        }
                    }
                }
                default -> {}
            }
            tenderRepository.save(tender);
        }

        if (!"APPROVED".equals(action)) {
            switch (expectedStage) {
                case "SPEC_CLEARANCE" -> tender.setSpecVerificationStatus("Rejected");
                case "DOC_VERIFICATION" -> {
                    tender.setVerificationStatus("Rejected");
                    if (workflowSyncService != null) {
                        workflowSyncService.rejectTrackBDocs(tender.getId(), authUsername, comment);
                        tender = tenderRepository.findById(tender.getId()).orElse(tender);
                    }
                }
                case "PAYMENT_APPROVAL" -> tender.setPaymentStatus("Rejected");
                case "SUBMISSION_PENDING" -> tender.setSubmissionStatus("Rejected");
                default -> { }
            }
            tenderRepository.save(tender);
        }
        latest.setStatus(action);
        if (!lossReasonMis.isEmpty()) latest.setLossReasonMis(lossReasonMis);
        latest.setUpdatedAt(java.time.LocalDateTime.now());
        approvalRepository.save(latest);

        String extraInfo = "";
        if (!lossReasonMis.isEmpty()) extraInfo += " [MIS Final Loss Reason: " + lossReasonMis + "]";
        if ("TPC_PRICING".equals(expectedStage) && tender.getTpcPurchasePrice() != null) {
            extraInfo += " [TPC Price: ₹" + tender.getTpcPurchasePrice() + "]";
        } else if ("MIS_PRICING".equals(expectedStage) && tender.getMisFinalPrice() != null) {
            extraInfo += " [MIS Final Price: ₹" + tender.getMisFinalPrice() + "]";
        }
        commentRepository.save(new TenderComment(id, expectedStage, authUsername, authRole, action + ": " + comment + extraInfo));

        return ResponseEntity.ok(Map.of("success", true, "message", "Tender workflow approval updated to: " + action, "currentStage", tender.getCurrentStage()));
    }


    // POST /api/tenders/{id}/unable-to-submit
    @PostMapping("/{id}/unable-to-submit")
    public ResponseEntity<?> unableToSubmit(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody Map<String, String> body) {

        if (!WorkflowPermissions.allowed(RECORD_OUTCOME)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        String reason = body.getOrDefault("reason", "Unable to submit tender");
        Tender tender = tOpt.get();
        tender.setCurrentStage("UNABLE_TO_SUBMIT");
        tender.setStatus("Missed Opportunity");
        tender.setLossReason(reason);
        tenderRepository.save(tender);

        TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.UNABLE_TO_SUBMIT, username, tender.getAssignedMisExecutive(), "SUBMITTED");
        req.setLossReasonExecutive(reason);
        approvalRepository.save(req);

        commentRepository.save(new TenderComment(id, "UNABLE_TO_SUBMIT", username, "Tender Executive", "Declared unable to submit tender. Reason: " + reason));

        return ResponseEntity.ok(Map.of("success", true, "message", "Tender marked as Missed Opportunity (Unable to Submit)."));
    }

    // GET /api/tenders/{id}/workflow-comments
    @GetMapping("/{id}/workflow-comments")
    public ResponseEntity<?> getComments(@PathVariable("id") String id) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        List<TenderComment> comments = commentRepository.findByTenderIdOrderByCreatedAtAsc(id);
        return ResponseEntity.ok(Map.of("success", true, "comments", comments));
    }

    // POST /api/tenders/{id}/workflow-comments
    @PostMapping("/{id}/workflow-comments")
    public ResponseEntity<?> addComment(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Tender Executive") String userRole,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody Map<String, String> body) {

        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        String authRole = getAuthenticatedRole();
        if (authRole != null && !authRole.isBlank()) userRole = authRole;
        String authUser = getAuthenticatedUsername();
        if (authUser != null && !authUser.isBlank()) username = authUser;

        String commentText = body.get("commentText");
        if (commentText == null || commentText.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Comment text required"));
        }

        Optional<Tender> tOpt = tenderRepository.findById(id);
        String stage = tOpt.isPresent() ? tOpt.get().getCurrentStage() : "GENERAL";

        TenderComment comment = new TenderComment(id, stage, username, userRole, commentText.trim());
        commentRepository.save(comment);

        return ResponseEntity.ok(Map.of("success", true, "comment", comment));
    }

    private Double positivePrice(Object value) {
        if (!(value instanceof Number) && !(value instanceof String)) return null;
        try {
            double parsed = Double.parseDouble(value.toString());
            return Double.isFinite(parsed) && parsed > 0 ? parsed : null;
        } catch (NumberFormatException ignored) { return null; }
    }
}
