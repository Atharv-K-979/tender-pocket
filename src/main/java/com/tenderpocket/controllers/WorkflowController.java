package com.tenderpocket.controllers;

import com.tenderpocket.models.*;
import com.tenderpocket.repositories.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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

    // GET /api/tenders/{id}/workflow-details
    @GetMapping("/{id}/workflow-details")
    public ResponseEntity<?> getWorkflowDetails(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-role", required = false) String userRole,
            @RequestHeader(value = "x-user-username", required = false) String username) {

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

    // POST /api/tenders/{id}/clearance-request (Send spec to Clearance Team)
    @PostMapping("/{id}/clearance-request")
    public ResponseEntity<?> sendClearanceRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody(required = false) Map<String, String> body) {

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Tender tender = tOpt.get();
        tender.setCurrentStage("SPEC_CLEARANCE");
        tenderRepository.save(tender);

        TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.SPEC_CLEARANCE, username, "Clearance Team", "PENDING");
        approvalRepository.save(req);

        String note = (body != null && body.containsKey("note")) ? body.get("note") : "Submitted technical specification for clearance approval.";
        commentRepository.save(new TenderComment(id, "SPEC_CLEARANCE", username, "Tender Executive", note));

        return ResponseEntity.ok(Map.of("success", true, "message", "Technical specification submitted to Clearance Team for approval."));
    }

    // POST /api/tenders/{id}/tpc-price (TPC Team submits purchase price)
    @PostMapping("/{id}/tpc-price")
    public ResponseEntity<?> submitTpcPrice(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "tpc") String username,
            @RequestBody Map<String, Object> body) {

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Double price = Double.parseDouble(body.get("tpcPurchasePrice").toString());
        Tender tender = tOpt.get();
        tender.setTpcPurchasePrice(price);
        tender.setCurrentStage("MIS_PRICING");
        tenderRepository.save(tender);

        TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.TPC_PRICING, username, "MIS Team", "APPROVED");
        req.setTpcPurchasePrice(price);
        approvalRepository.save(req);

        commentRepository.save(new TenderComment(id, "TPC_PRICING", username, "TPC Team", "Submitted TPC purchase price to MIS Team."));

        return ResponseEntity.ok(Map.of("success", true, "message", "TPC purchase price submitted securely to MIS Team."));
    }

    // POST /api/tenders/{id}/mis-price (MIS Team provides final purchase price to Tender Executive)
    @PostMapping("/{id}/mis-price")
    public ResponseEntity<?> submitMisPrice(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "misteam") String username,
            @RequestBody Map<String, Object> body) {

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Double price = Double.parseDouble(body.get("misFinalPrice").toString());
        Tender tender = tOpt.get();
        tender.setMisFinalPrice(price);
        tender.setCurrentStage("BID_DOC_GENERATED");
        tenderRepository.save(tender);

        TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.MIS_PRICING, username, tender.getMisExecutive(), "APPROVED");
        req.setMisFinalPrice(price);
        approvalRepository.save(req);

        commentRepository.save(new TenderComment(id, "MIS_PRICING", username, "MIS Team", "Final purchase price provided to Tender Executive: ₹" + price));

        return ResponseEntity.ok(Map.of("success", true, "message", "Final purchase price configured for Tender Executive."));
    }

    // POST /api/tenders/{id}/payment-request
    @PostMapping("/{id}/payment-request")
    public ResponseEntity<?> submitPaymentRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody Map<String, Object> body) {

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        String assignedMis = body.get("assignedMisExecutive") != null ? body.get("assignedMisExecutive").toString() : "misteam";
        Double emdAmount = body.get("emdAmount") != null ? Double.parseDouble(body.get("emdAmount").toString()) : 0.0;
        String transferMode = body.get("transferMode") != null ? body.get("transferMode").toString() : "NEFT";
        String refNo = body.get("transferRefNo") != null ? body.get("transferRefNo").toString() : "";
        String receiptUrl = body.get("receiptFileUrl") != null ? body.get("receiptFileUrl").toString() : "";
        String comment = body.get("comment") != null ? body.get("comment").toString() : "Submitted payment approval request.";

        Tender tender = tOpt.get();
        tender.setAssignedMisExecutive(assignedMis);
        tender.setCurrentStage("PAYMENT_APPROVAL");
        tenderRepository.save(tender);

        TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.PAYMENT_APPROVAL, username, assignedMis, "PENDING");
        req.setEmdAmount(emdAmount);
        req.setTransferMode(transferMode);
        req.setTransferRefNo(refNo);
        req.setReceiptFileUrl(receiptUrl);
        approvalRepository.save(req);

        commentRepository.save(new TenderComment(id, "PAYMENT_APPROVAL", username, "Tender Executive", comment + " [Mode: " + transferMode + ", Ref: " + refNo + "]"));

        return ResponseEntity.ok(Map.of("success", true, "message", "Payment approval request submitted to MIS Executive: " + assignedMis));
    }

    // POST /api/tenders/{id}/doc-verification-request
    @PostMapping("/{id}/doc-verification-request")
    public ResponseEntity<?> submitDocVerificationRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody Map<String, String> body) {

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        String assignedMis = body.getOrDefault("assignedMisExecutive", "misteam");
        String workingPath = body.getOrDefault("workingPath", "");
        String comment = body.getOrDefault("comment", "Submitted document verification request.");

        Tender tender = tOpt.get();
        tender.setAssignedMisExecutive(assignedMis);
        tender.setWorkingPath(workingPath);
        tender.setCurrentStage("DOC_VERIFICATION");
        tenderRepository.save(tender);

        TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.DOC_VERIFICATION, username, assignedMis, "PENDING");
        req.setWorkingPath(workingPath);
        approvalRepository.save(req);

        commentRepository.save(new TenderComment(id, "DOC_VERIFICATION", username, "Tender Executive", comment + " [Working Path: " + workingPath + "]"));

        return ResponseEntity.ok(Map.of("success", true, "message", "Document verification request sent to MIS Executive: " + assignedMis));
    }

    // POST /api/tenders/{id}/submission-request ("I have filed a tender please verify")
    @PostMapping("/{id}/submission-request")
    public ResponseEntity<?> submitSubmissionRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody(required = false) Map<String, String> body) {

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        Tender tender = tOpt.get();
        tender.setCurrentStage("SUBMISSION_PENDING");
        tenderRepository.save(tender);

        TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.SUBMISSION_PENDING, username, tender.getAssignedMisExecutive(), "PENDING");
        approvalRepository.save(req);

        String note = (body != null && body.containsKey("note")) ? body.get("note") : "I have filed this tender on the portal. Please verify and mark as Submitted.";
        commentRepository.save(new TenderComment(id, "SUBMISSION_PENDING", username, "Tender Executive", note));

        return ResponseEntity.ok(Map.of("success", true, "message", "Submission verification request sent to MIS Team."));
    }

    // POST /api/tenders/{id}/win-loss-request
    @PostMapping("/{id}/win-loss-request")
    public ResponseEntity<?> submitWinLossRequest(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody Map<String, String> body) {

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        String status = body.getOrDefault("status", "Won"); // Won or Lost
        String lossReason = body.getOrDefault("lossReason", "");

        Tender tender = tOpt.get();
        tender.setCurrentStage("WIN_LOSS_PENDING");
        if ("Lost".equalsIgnoreCase(status)) {
            tender.setLossReason(lossReason);
        }
        tenderRepository.save(tender);

        TenderApprovalRequest req = new TenderApprovalRequest(id, TenderWorkflowStage.WIN_LOSS_PENDING, username, tender.getAssignedMisExecutive(), "PENDING");
        req.setLossReasonExecutive(lossReason);
        approvalRepository.save(req);

        commentRepository.save(new TenderComment(id, "WIN_LOSS_PENDING", username, "Tender Executive", "Declared tender outcome: " + status + (lossReason.isEmpty() ? "" : " (Reason: " + lossReason + ")")));

        return ResponseEntity.ok(Map.of("success", true, "message", "Win/Loss verification request sent to MIS Team."));
    }

    // POST /api/tenders/{id}/review-approval (MIS Team approves/rejects requests)
    @PostMapping("/{id}/review-approval")
    public ResponseEntity<?> reviewApproval(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "MIS Team") String userRole,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "misteam") String username,
            @RequestBody Map<String, String> body) {

        if (!"Admin".equalsIgnoreCase(userRole) && !"MIS Team".equalsIgnoreCase(userRole) && !"MIS Executive".equalsIgnoreCase(userRole)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("success", false, "error", "Access denied: MIS Team or Admin authority required"));
        }

        Optional<Tender> tOpt = tenderRepository.findById(id);
        if (tOpt.isEmpty()) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));

        String action = body.getOrDefault("action", "APPROVED"); // APPROVED, REJECTED, CHANGES_REQUESTED
        String comment = body.getOrDefault("comment", "Review completed by MIS Team.");
        String lossReasonMis = body.getOrDefault("lossReasonMis", "");

        Tender tender = tOpt.get();
        String stage = tender.getCurrentStage();

        if ("APPROVED".equalsIgnoreCase(action)) {
            if ("PAYMENT_APPROVAL".equalsIgnoreCase(stage)) {
                tender.setCurrentStage("DOC_VERIFICATION");
            } else if ("DOC_VERIFICATION".equalsIgnoreCase(stage)) {
                tender.setCurrentStage("SUBMISSION_PENDING");
            } else if ("SUBMISSION_PENDING".equalsIgnoreCase(stage)) {
                tender.setCurrentStage("SUBMITTED");
                tender.setStatus("Submitted");
            } else if ("WIN_LOSS_PENDING".equalsIgnoreCase(stage)) {
                List<TenderApprovalRequest> reqs = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(id, TenderWorkflowStage.WIN_LOSS_PENDING);
                if (!reqs.isEmpty() && reqs.get(0).getLossReasonExecutive() != null && !reqs.get(0).getLossReasonExecutive().isEmpty()) {
                    tender.setCurrentStage("LOST");
                    tender.setStatus("Lost");
                    if (!lossReasonMis.isEmpty()) tender.setLossReason(lossReasonMis);
                } else {
                    tender.setCurrentStage("WON");
                    tender.setStatus("Won");
                }
            }
            tenderRepository.save(tender);
        }

        List<TenderApprovalRequest> requests = approvalRepository.findByTenderIdOrderByCreatedAtDesc(id);
        if (!requests.isEmpty()) {
            TenderApprovalRequest latest = requests.get(0);
            latest.setStatus(action);
            if (!lossReasonMis.isEmpty()) latest.setLossReasonMis(lossReasonMis);
            latest.setUpdatedAt(java.time.LocalDateTime.now());
            approvalRepository.save(latest);
        }

        commentRepository.save(new TenderComment(id, stage, username, userRole, action + ": " + comment + (lossReasonMis.isEmpty() ? "" : " [MIS Final Loss Reason: " + lossReasonMis + "]")));

        return ResponseEntity.ok(Map.of("success", true, "message", "Tender workflow approval updated to: " + action));
    }

    // POST /api/tenders/{id}/unable-to-submit
    @PostMapping("/{id}/unable-to-submit")
    public ResponseEntity<?> unableToSubmit(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestBody Map<String, String> body) {

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
}
