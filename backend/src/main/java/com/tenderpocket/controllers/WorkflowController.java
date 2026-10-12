package com.tenderpocket.controllers;
import com.tenderpocket.config.WorkflowPermissions;
import static com.tenderpocket.config.WorkflowPermissions.Action.*;

import com.tenderpocket.models.*;
import com.tenderpocket.repositories.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/tenders")
public class WorkflowController {

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private TenderApprovalRepository approvalRepository;

    @Autowired
    private TenderCommentRepository commentRepository;

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

    // POST /api/tenders/{id}/approve-clearance (Clearance Team approves spec -> Notify Executive & send to TPC Team)
    @PostMapping("/{id}/approve-clearance")
    @Transactional
    public ResponseEntity<?> approveClearance(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "clearance") String username,
            @RequestBody(required = false) Map<String, String> body) {

        if (!WorkflowPermissions.allowed(APPROVE_SPEC)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Tender tender = tOpt.get();
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
        tender.setCurrentStage("TPC_PRICING");
        tender.setSpecVerificationStatus("Approved");
        tenderRepository.save(tender);

        // Resolve all pending SPEC_CLEARANCE requests as APPROVED so it clears out of Approvals Center
        List<TenderApprovalRequest> pendingSpecList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.SPEC_CLEARANCE);
        for (TenderApprovalRequest a : pendingSpecList) {
            if ("PENDING".equalsIgnoreCase(a.getStatus())) {
                a.setStatus("APPROVED");
                a.setUpdatedAt(java.time.LocalDateTime.now());
                approvalRepository.save(a);
            }
        }

        // Avoid duplicate TPC_PRICING requests if already pending
        List<TenderApprovalRequest> existingTpcList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.TPC_PRICING);
        TenderApprovalRequest targetTpc = null;
        for (TenderApprovalRequest a : existingTpcList) {
            if ("PENDING".equalsIgnoreCase(a.getStatus())) {
                if (targetTpc == null) {
                    targetTpc = a;
                } else {
                    approvalRepository.delete(a);
                }
            }
        }

        if (targetTpc != null) {
            targetTpc.setRequestedBy(username);
            targetTpc.setAssignedTo("TPC Team");
            targetTpc.setStatus("PENDING");
            targetTpc.setUpdatedAt(java.time.LocalDateTime.now());
            approvalRepository.save(targetTpc);
        } else {
            TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.TPC_PRICING, username, "TPC Team", "PENDING");
            approvalRepository.save(req);
        }

        String comment = (body != null && body.containsKey("comment")) ? body.get("comment") : "Technical specification approved by Clearance Team.";
        commentRepository.save(new TenderComment(id, "SPEC_CLEARANCE", username, "Clearance Team", comment + " [Notification to Executive: Technical specification cleared! Tender sent to TPC Team for manufacturer purchase price.]"));

        return ResponseEntity.ok(Map.of(
            "success", true,
            "message", "Technical specification approved! Executive notified and tender forwarded to TPC Team for manufacturer purchase price.",
            "notification", "Technical specification cleared by Clearance Team! Sent to TPC Team for purchase price."
        ));
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
        tender.setTpcPurchasePrice(price);
        tender.setCurrentStage("MIS_PRICING");
        tenderRepository.save(tender);

        List<TenderApprovalRequest> pendingTpcList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.TPC_PRICING);
        for (TenderApprovalRequest a : pendingTpcList) {
            if ("PENDING".equalsIgnoreCase(a.getStatus())) {
                a.setStatus("APPROVED");
                a.setTpcPurchasePrice(price);
                a.setUpdatedAt(java.time.LocalDateTime.now());
                approvalRepository.save(a);
            }
        }

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
            targetMis.setAssignedTo("MIS Team");
            targetMis.setTpcPurchasePrice(price);
            targetMis.setStatus("PENDING");
            targetMis.setUpdatedAt(java.time.LocalDateTime.now());
            approvalRepository.save(targetMis);
        } else {
            TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.MIS_PRICING, username, "MIS Team", "PENDING");
            req.setTpcPurchasePrice(price);
            approvalRepository.save(req);
        }

        commentRepository.save(new TenderComment(id, "TPC_PRICING", username, "TPC Team", "Obtained manufacturer purchase price (₹" + price + "). Forwarded securely to MIS Team."));

        return ResponseEntity.ok(Map.of("success", true, "message", "Manufacturer purchase price obtained by TPC Team and forwarded securely to MIS Team."));
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
        if (!"Approved".equals(tender.getSpecVerificationStatus()) || tender.getTpcPurchasePrice() == null
                || !Double.isFinite(tender.getTpcPurchasePrice()) || tender.getTpcPurchasePrice() <= 0) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Approved specifications and a TPC quote are required before MIS pricing."));
        }
        tender.setMisFinalPrice(price);
        tender.setCurrentStage("BID_DOC_PENDING");
        tenderRepository.save(tender);

        List<TenderApprovalRequest> pendingMisList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.MIS_PRICING);
        for (TenderApprovalRequest a : pendingMisList) {
            if ("PENDING".equalsIgnoreCase(a.getStatus())) {
                a.setStatus("APPROVED");
                a.setMisFinalPrice(price);
                approvalRepository.save(a);
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
        if (!"Approved".equals(tender.getSpecVerificationStatus()) || tender.getMisFinalPrice() == null
                || !Double.isFinite(tender.getMisFinalPrice()) || tender.getMisFinalPrice() <= 0) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Specification clearance and finalized MIS pricing are required before document verification."));
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
            @RequestBody Map<String, String> body) {

        String authRole = getAuthenticatedRole();
        String authUsername = getAuthenticatedUsername();

        if (!WorkflowPermissions.allowed(REVIEW_BIDS) && !WorkflowPermissions.allowed(APPROVE_SPEC)
                && !WorkflowPermissions.allowed(SET_TPC_PRICE)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: Valid MIS Team or Admin authentication required"));
        }

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        List<TenderApprovalRequest> requests = approvalRepository.findByTenderIdOrderByCreatedAtDesc(id);
        if (requests.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "No approval requests found for this tender"));
        }

        TenderApprovalRequest latest = requests.get(0);
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
        if (!expectedStage.equalsIgnoreCase(tender.getCurrentStage())) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("success", false, "error", "Conflict: Tender is currently at stage " + tender.getCurrentStage() + ", cannot action approval for stage " + expectedStage));
        }

        String action = body.getOrDefault("action", "APPROVED").toUpperCase(); // APPROVED, REJECTED, CHANGES_REQUESTED
        if (!List.of("APPROVED", "REJECTED", "CHANGES_REQUESTED").contains(action)) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Invalid approval action."));
        }
        String comment = body.getOrDefault("comment", "Review completed by MIS Team.");
        String lossReasonMis = body.getOrDefault("lossReasonMis", "");

        if ("APPROVED".equals(action)) {
            switch (expectedStage) {
                case "PAYMENT_APPROVAL" -> {
                    tender.setPaymentStatus("Approved");
                    tender.setCurrentStage("SUBMISSION_PENDING");
                }
                case "DOC_VERIFICATION" -> {
                    tender.setVerificationStatus("Approved");
                    tender.setCurrentStage("PAYMENT_APPROVAL");
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
                    String outcome = body.get("outcome");
                    boolean isLoss = "Lost".equalsIgnoreCase(outcome)
                            || (!"Won".equalsIgnoreCase(outcome) && (
                                   (latest.getLossReasonExecutive() != null && !latest.getLossReasonExecutive().isBlank())
                                   || !lossReasonMis.isEmpty()
                               ));
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
                case "SPEC_CLEARANCE" -> {
                    tender.setSpecVerificationStatus("Approved");
                    tender.setCurrentStage("TPC_PRICING");
                }
                case "TPC_PRICING"    -> {
                    if (latest.getTpcPurchasePrice() != null) {
                        tender.setTpcPurchasePrice(latest.getTpcPurchasePrice());
                    }
                    tender.setCurrentStage("MIS_PRICING");
                }
                case "MIS_PRICING"    -> {
                    if (latest.getMisFinalPrice() != null) {
                        tender.setMisFinalPrice(latest.getMisFinalPrice());
                    }
                    tender.setCurrentStage("BID_DOC_PENDING");
                }
                default -> {}
            }
            tenderRepository.save(tender);
        }

        if (!"APPROVED".equals(action)) {
            switch (expectedStage) {
                case "SPEC_CLEARANCE" -> tender.setSpecVerificationStatus("Rejected");
                case "DOC_VERIFICATION" -> tender.setVerificationStatus("Rejected");
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

        commentRepository.save(new TenderComment(id, expectedStage, authUsername, authRole, action + ": " + comment + (lossReasonMis.isEmpty() ? "" : " [MIS Final Loss Reason: " + lossReasonMis + "]")));

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
