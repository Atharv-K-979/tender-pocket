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
import java.util.stream.Collectors;

/**
 * ApprovalController — dedicated REST controller for the MIS Approvals Center.
 *
 * Mapped to /api/approvals (separate from WorkflowController to keep concerns clean).
 *
 * All role authorization is derived exclusively from SecurityContextHolder,
 * which is populated by JwtRequestFilter from the verified JWT token.
 * No @RequestHeader("x-user-role") is used here.
 */
@RestController
@RequestMapping("/api/approvals")
public class ApprovalController {

    /** Stages that are owned by / visible to any MIS Team member (team queue). */
    private static final List<TenderWorkflowStage> MIS_TEAM_STAGES = List.of(
            TenderWorkflowStage.SPEC_CLEARANCE,
            TenderWorkflowStage.TPC_PRICING,
            TenderWorkflowStage.MIS_PRICING,
            TenderWorkflowStage.PAYMENT_APPROVAL,
            TenderWorkflowStage.DOC_VERIFICATION,
            TenderWorkflowStage.SUBMISSION_PENDING,
            TenderWorkflowStage.WIN_LOSS_PENDING
    );

    @Autowired
    private TenderApprovalRepository approvalRepository;

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private TenderCommentRepository commentRepository;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Extract the authenticated username from the verified JWT context. */
    private String getAuthenticatedUsername() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) return null;
        return auth.getName();
    }

    /** Extract the authenticated role from the verified JWT context. */
    private String getAuthenticatedRole() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) return null;
        return auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .findFirst()
                .map(r -> r.replace("ROLE_", "").replace("_", " "))
                .orElse(null);
    }

    /** Returns true if the current user is allowed to access the approvals center. */
    private boolean isAuthorized(String role) {
        if ("Admin".equalsIgnoreCase(WorkflowPermissions.canonicalRole(role))) {
            return true;
        }
        return WorkflowPermissions.allowed(role, REVIEW_BIDS) || WorkflowPermissions.allowed(role, APPROVE_SPEC)
                || WorkflowPermissions.allowed(role, SET_TPC_PRICE);
    }

    /**
     * Converts the GROUP BY query result into a named count map.
     * Input rows: [TenderWorkflowStage, Long]
     */
    private Map<String, Long> buildCountMap(List<Object[]> rows) {
        Map<String, Long> counts = new HashMap<>();
        long total = 0;
        for (Object[] row : rows) {
            String stage = row[0].toString();
            long count = ((Number) row[1]).longValue();
            counts.put(stage, count);
            total += count;
        }
        counts.put("TOTAL", total);
        return counts;
    }

    // ── Reconciliation Helper ────────────────────────────────────────────────
    @Transactional
    public void reconcileStaleAndDuplicateApprovals() {
        try {
            List<TenderApprovalRequest> pending = approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING");
            if (pending.isEmpty()) return;

            Set<String> tenderIds = pending.stream().map(TenderApprovalRequest::getTenderId).collect(Collectors.toSet());
            Map<String, Tender> tenderMap = new HashMap<>();
            tenderRepository.findAllById(tenderIds).forEach(t -> tenderMap.put(t.getId(), t));

            Map<String, List<TenderApprovalRequest>> grouped = new HashMap<>();
            for (TenderApprovalRequest req : pending) {
                String key = req.getTenderId() + "::" + req.getStage();
                grouped.computeIfAbsent(key, k -> new ArrayList<>()).add(req);
            }

            for (Map.Entry<String, List<TenderApprovalRequest>> entry : grouped.entrySet()) {
                List<TenderApprovalRequest> list = entry.getValue();
                TenderApprovalRequest latest = list.get(0);
                Tender tender = tenderMap.get(latest.getTenderId());

                // Delete older duplicate requests
                for (int i = 1; i < list.size(); i++) {
                    approvalRepository.delete(list.get(i));
                }

                if (tender == null) continue;

                boolean isStale = false;
                TenderWorkflowStage stage = latest.getStage();

                if (stage == TenderWorkflowStage.SPEC_CLEARANCE) {
                    if ("Approved".equalsIgnoreCase(tender.getSpecVerificationStatus()) || 
                        (tender.getCurrentStage() != null && !"SPEC_CLEARANCE".equalsIgnoreCase(tender.getCurrentStage()))) {
                        isStale = true;
                    }
                } else if (stage == TenderWorkflowStage.TPC_PRICING) {
                    if (tender.getCurrentStage() != null && !"TPC_PRICING".equalsIgnoreCase(tender.getCurrentStage())) {
                        isStale = true;
                    }
                } else if (stage == TenderWorkflowStage.MIS_PRICING) {
                    if (tender.getCurrentStage() != null && !"MIS_PRICING".equalsIgnoreCase(tender.getCurrentStage())) {
                        isStale = true;
                    }
                } else if (stage == TenderWorkflowStage.PAYMENT_APPROVAL) {
                    if ("Approved".equalsIgnoreCase(tender.getPaymentStatus()) ||
                        (tender.getCurrentStage() != null && List.of("SUBMISSION_PENDING", "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST").contains(tender.getCurrentStage().toUpperCase()))) {
                        isStale = true;
                    }
                } else if (stage == TenderWorkflowStage.DOC_VERIFICATION) {
                    if ("Approved".equalsIgnoreCase(tender.getVerificationStatus()) ||
                        (tender.getCurrentStage() != null && List.of("PAYMENT_APPROVAL", "SUBMISSION_PENDING", "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST").contains(tender.getCurrentStage().toUpperCase()))) {
                        isStale = true;
                    }
                } else if (stage == TenderWorkflowStage.SUBMISSION_PENDING) {
                    if ("Approved".equalsIgnoreCase(tender.getSubmissionStatus()) ||
                        (tender.getCurrentStage() != null && List.of("SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST").contains(tender.getCurrentStage().toUpperCase()))) {
                        isStale = true;
                    }
                } else if (stage == TenderWorkflowStage.WIN_LOSS_PENDING) {
                    if ((tender.getOutcomeStatus() != null && !"Pending".equalsIgnoreCase(tender.getOutcomeStatus()))
                            || "WON".equalsIgnoreCase(tender.getCurrentStage())
                            || "LOST".equalsIgnoreCase(tender.getCurrentStage())
                            || "Awarded".equalsIgnoreCase(tender.getStatus())
                            || "Won".equalsIgnoreCase(tender.getStatus())
                            || "Not Awarded".equalsIgnoreCase(tender.getStatus())
                            || "Lost".equalsIgnoreCase(tender.getStatus())) {
                        isStale = true;
                    }
                }

                if (isStale) {
                    latest.setStatus("APPROVED");
                    latest.setUpdatedAt(java.time.LocalDateTime.now());
                    approvalRepository.save(latest);
                }
            }
        } catch (Exception e) {
            // Non-blocking: log and allow query to proceed
        }
    }

    // ── GET /api/approvals/counts ─────────────────────────────────────────────
    /**
     * Returns pending approval counts broken down by stage.
     * MIS Team users see all items in MIS queue or assigned to them.
     * Admin users see counts across all users.
     */
    @GetMapping("/counts")
    public ResponseEntity<?> getPendingCounts(@RequestParam(required = false, defaultValue = "PENDING") String status) {
        String username = getAuthenticatedUsername();
        String role = getAuthenticatedRole();

        if (!isAuthorized(role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: MIS Team or Admin required"));
        }

        // Clean stale/duplicate pending approvals
        reconcileStaleAndDuplicateApprovals();

        String statusParam = (status != null && !status.isBlank()) ? status.trim().toUpperCase() : "PENDING";

        List<Object[]> rows;
        List<Object[]> pendingRows;
        List<Object[]> historyRows;
        if ("Admin".equalsIgnoreCase(role)) {
            rows = approvalRepository.countByStageForAdmin(statusParam);
            pendingRows = approvalRepository.countByStageForAdmin("PENDING");
            historyRows = approvalRepository.countByStageForAdmin("HISTORY");
        } else if ("MIS Team".equalsIgnoreCase(role)) {
            rows = approvalRepository.countByStageForMisTeam(username, statusParam, MIS_TEAM_STAGES);
            pendingRows = approvalRepository.countByStageForMisTeam(username, "PENDING", MIS_TEAM_STAGES);
            historyRows = approvalRepository.countByStageForMisTeam(username, "HISTORY", MIS_TEAM_STAGES);
        } else {
            rows = approvalRepository.countByStageForUser(username, statusParam);
            pendingRows = approvalRepository.countByStageForUser(username, "PENDING");
            historyRows = approvalRepository.countByStageForUser(username, "HISTORY");
        }

        Map<String, Long> counts = buildCountMap(rows);
        Map<String, Long> pendingCounts = buildCountMap(pendingRows);
        Map<String, Long> historyCounts = buildCountMap(historyRows);

        // Status counts for tabs (Pending vs History)
        List<Object[]> statusRows = approvalRepository.countByStatusForAdmin();
        Map<String, Long> statusCounts = new HashMap<>(Map.of(
                "TOTAL", 0L,
                "PENDING", 0L,
                "APPROVED", 0L,
                "REJECTED", 0L,
                "CHANGES_REQUESTED", 0L,
                "HISTORY", 0L
        ));
        long totalStatus = 0L;
        for (Object[] row : statusRows) {
            if (row != null && row.length >= 2 && row[0] != null && row[1] != null) {
                String s = row[0].toString().toUpperCase();
                Long c = ((Number) row[1]).longValue();
                statusCounts.put(s, c);
                totalStatus += c;
            }
        }
        long historyCount = statusCounts.getOrDefault("APPROVED", 0L)
                + statusCounts.getOrDefault("REJECTED", 0L)
                + statusCounts.getOrDefault("CHANGES_REQUESTED", 0L);
        statusCounts.put("HISTORY", historyCount);
        statusCounts.put("TOTAL", totalStatus);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "counts", counts,
                "pendingCounts", pendingCounts,
                "historyCounts", historyCounts,
                "statusCounts", statusCounts,
                "username", username,
                "role", role
        ));
    }

    // ── GET /api/approvals/pending ────────────────────────────────────────────
    /**
     * Returns the list of pending approval requests enriched with tender metadata.
     *
     * Query params:
     *   ?stage=PAYMENT_APPROVAL  (optional, filters by stage)
     *   ?search=term             (optional, filters by tender title / ref no / authority)
     *   ?status=ALL|PENDING|...  (optional, filters by approval status)
     *
     * MIS Team: sees requests assigned to their team queue or username.
     * Admin:    sees all requests according to status filter.
     */
    @GetMapping("/pending")
    public ResponseEntity<?> getPendingApprovals(
            @RequestParam(required = false) String stage,
            @RequestParam(required = false) String search,
            @RequestParam(required = false, defaultValue = "PENDING") String status,
            @RequestParam(required = false) String team,
            @RequestParam(required = false, name = "role") String requesterRole) {

        String username = getAuthenticatedUsername();
        String role = getAuthenticatedRole();

        if (!isAuthorized(role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: MIS Team or Admin required"));
        }

        // Clean stale/duplicate pending approvals
        reconcileStaleAndDuplicateApprovals();

        String statusParam = (status != null && !status.isBlank()) ? status.trim().toUpperCase() : "PENDING";
        boolean isAll = "ALL".equalsIgnoreCase(statusParam);

        // Fetch raw approval requests
        List<TenderApprovalRequest> requests;

        if (stage != null && !stage.isBlank()) {
            TenderWorkflowStage stageEnum;
            try {
                stageEnum = TenderWorkflowStage.valueOf(stage.toUpperCase());
            } catch (IllegalArgumentException e) {
                return ResponseEntity.badRequest()
                        .body(Map.of("success", false, "error", "Invalid stage: " + stage));
            }
            if ("Admin".equalsIgnoreCase(role)) {
                requests = isAll
                        ? approvalRepository.findByStageOrderByCreatedAtDesc(stageEnum)
                        : approvalRepository.findByStageAndStatusForAdmin(stageEnum, statusParam);
            } else if ("MIS Team".equalsIgnoreCase(role)) {
                requests = approvalRepository.findByStageAndStatusForMisTeam(username, stageEnum, statusParam, MIS_TEAM_STAGES);
            } else {
                requests = isAll
                        ? approvalRepository.findByAssignedToAndStageOrderByCreatedAtDesc(username, stageEnum)
                        : approvalRepository.findByAssignedToAndStageAndStatusOrderByCreatedAtDesc(username, stageEnum, statusParam);
            }
        } else {
            if ("Admin".equalsIgnoreCase(role)) {
                requests = isAll
                        ? approvalRepository.findAllByOrderByCreatedAtDesc()
                        : approvalRepository.findByStatusForAdmin(statusParam);
            } else if ("MIS Team".equalsIgnoreCase(role)) {
                requests = approvalRepository.findByStatusForMisTeam(username, statusParam, MIS_TEAM_STAGES);
            } else {
                requests = isAll
                        ? approvalRepository.findByAssignedToOrderByCreatedAtDesc(username)
                        : approvalRepository.findByAssignedToAndStatusOrderByCreatedAtDesc(username, statusParam);
            }
        }

        // Bulk-load associated tenders in one query to avoid N+1
        Set<String> tenderIds = requests.stream()
                .map(TenderApprovalRequest::getTenderId)
                .collect(Collectors.toSet());

        Map<String, Tender> tenderMap = new HashMap<>();
        if (!tenderIds.isEmpty()) {
            tenderRepository.findAllById(tenderIds)
                    .forEach(t -> tenderMap.put(t.getId(), t));
        }

        // Build enriched DTOs
        List<ApprovalSummaryDto> result = new ArrayList<>();
        for (TenderApprovalRequest req : requests) {
            Tender tender = tenderMap.get(req.getTenderId());

            // Tenders in SPEC_CLEARANCE stage must have a generated tech spec to appear in Clearance Team queue
            if (req.getStage() == TenderWorkflowStage.SPEC_CLEARANCE) {
                boolean hasTechSpec = tender != null && tender.getDownloadedDocs() != null && (tender.getDownloadedDocs().contains("Technical Specification") || tender.getDownloadedDocs().contains("specification"));
                if (tender == null || !hasTechSpec || !"Pending".equalsIgnoreCase(tender.getSpecVerificationStatus())) {
                    continue;
                }
            }

            // Apply search filter on tender fields (post-load, avoids complex JPQL join)
            if (search != null && !search.isBlank()) {
                String lc = search.toLowerCase();
                boolean matches = false;
                if (tender != null) {
                    matches = (tender.getTitle() != null && tender.getTitle().toLowerCase().contains(lc))
                            || (tender.getRefNo() != null && tender.getRefNo().toLowerCase().contains(lc))
                            || (tender.getAuthority() != null && tender.getAuthority().toLowerCase().contains(lc))
                            || req.getTenderId().toLowerCase().contains(lc)
                            || (req.getRequestedBy() != null && req.getRequestedBy().toLowerCase().contains(lc));
                } else {
                    matches = req.getTenderId().toLowerCase().contains(lc);
                }
                if (!matches) continue;
            }

            // Apply team and role filters
            if (team != null && !team.isBlank() && !"ALL".equalsIgnoreCase(team)) {
                if (req.getAssignedTo() == null || !req.getAssignedTo().equalsIgnoreCase(team.trim())) {
                    continue;
                }
            }
            if (requesterRole != null && !requesterRole.isBlank() && !"ALL".equalsIgnoreCase(requesterRole)) {
                if (req.getRequestedBy() == null || !req.getRequestedBy().equalsIgnoreCase(requesterRole.trim())) {
                    continue;
                }
            }

            result.add(new ApprovalSummaryDto(req, tender));
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "approvals", result,
                "total", result.size()
        ));
    }

    // ── POST /api/approvals/{approvalId}/review ───────────────────────────────
    /**
     * Reviews a specific approval request by its database ID.
     *
     * Request body:
     * {
     *   "action": "APPROVED" | "REJECTED" | "CHANGES_REQUESTED",
     *   "comment": "Reviewer remarks (required)",
     *   "lossReasonMis": "Optional — only for WIN_LOSS_PENDING rejections"
     * }
     *
     * On APPROVED: advances Tender.currentStage to the next stage in the workflow.
     * On REJECTED / CHANGES_REQUESTED: sets approval row status, tender stage unchanged.
     */
    @PostMapping("/{approvalId}/review")
    @Transactional
    public ResponseEntity<?> reviewApproval(
            @PathVariable("approvalId") Long approvalId,
            @RequestBody Map<String, String> body) {

        String username = getAuthenticatedUsername();
        String role = getAuthenticatedRole();

        if ("Admin".equalsIgnoreCase(role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Admin has view-only access to Approvals Center. Approvals must be provided by assigned operational teams."));
        }

        if (!isAuthorized(role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: Authorized operational team role required"));
        }

        // Validate action
        String action = body.getOrDefault("action", "").toUpperCase();
        if (!List.of("APPROVED", "REJECTED", "CHANGES_REQUESTED").contains(action)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("success", false, "error", "Invalid action. Must be APPROVED, REJECTED, or CHANGES_REQUESTED"));
        }

        String comment = body.getOrDefault("comment", "").trim();
        if (comment.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("success", false, "error", "A reviewer comment is required"));
        }

        String lossReasonMis = body.getOrDefault("lossReasonMis", "");

        // Fetch the specific approval request by ID
        Optional<TenderApprovalRequest> reqOpt = approvalRepository.findById(approvalId);
        if (reqOpt.isEmpty()) {
            // Fallback: Check if tenderId and stage are passed in body
            String tenderId = body.get("tenderId");
            String stageStr = body.get("stage");
            if (tenderId != null && stageStr != null) {
                try {
                    TenderWorkflowStage stageEnum = TenderWorkflowStage.valueOf(stageStr.toUpperCase());
                    List<TenderApprovalRequest> matches = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, stageEnum);
                    if (!matches.isEmpty()) {
                        reqOpt = matches.stream().filter(r -> "PENDING".equalsIgnoreCase(r.getStatus())).findFirst();
                        if (reqOpt.isEmpty()) {
                            reqOpt = Optional.of(matches.get(0));
                        }
                    }
                } catch (IllegalArgumentException ignored) {}
            }
        }
        if (reqOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("success", false, "error", "Approval request not found"));
        }

        TenderApprovalRequest approvalReq = reqOpt.get();
        if (!WorkflowPermissions.allowed(role, WorkflowPermissions.reviewAction(approvalReq.getStage().name()))) {
            return WorkflowPermissions.denied();
        }

        // Verify the request is still PENDING
        if (!"PENDING".equalsIgnoreCase(approvalReq.getStatus())) {
            if ("APPROVED".equalsIgnoreCase(action)) {
                return ResponseEntity.ok(Map.of("success", true, "message", "This approval request has already been completed."));
            }
            return ResponseEntity.badRequest()
                    .body(Map.of("success", false, "error",
                            "This approval request has already been actioned (status: " + approvalReq.getStatus() + ")"));
        }

        // Ownership safeguard: Non-Admin users can only review requests assigned to them or their unassigned team queue
        if (!"Admin".equalsIgnoreCase(role)) {
            String assigned = approvalReq.getAssignedTo();
            boolean isAssignedToUser = username != null && assigned != null && assigned.equalsIgnoreCase(username);

            boolean isTeamQueue = false;
            if ("MIS Team".equalsIgnoreCase(role) || "MIS Executive".equalsIgnoreCase(role)) {
                isTeamQueue = assigned == null || assigned.isBlank() || "misteam".equalsIgnoreCase(assigned) || "mis team".equalsIgnoreCase(assigned);
            } else if ("Clearance Team".equalsIgnoreCase(role) || "Specification Team".equalsIgnoreCase(role)) {
                isTeamQueue = assigned == null || assigned.isBlank() || "clearance".equalsIgnoreCase(assigned) || "clearance team".equalsIgnoreCase(assigned) || "specification team".equalsIgnoreCase(assigned);
            } else if ("TPC Pricing Team".equalsIgnoreCase(role) || "TPC Team".equalsIgnoreCase(role)) {
                isTeamQueue = assigned == null || assigned.isBlank() || "tpc".equalsIgnoreCase(assigned) || "tpc team".equalsIgnoreCase(assigned) || "tpc pricing team".equalsIgnoreCase(assigned);
            }

            if (!isAssignedToUser && !isTeamQueue) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(Map.of("success", false, "error", "Access denied: This approval request is assigned to " + assigned + ". You have view-only access."));
            }

            // Stage-level authorization check
            TenderWorkflowStage stageEnum = approvalReq.getStage();
            boolean isMisStage = List.of(
                    TenderWorkflowStage.MIS_PRICING,
                    TenderWorkflowStage.DOC_VERIFICATION,
                    TenderWorkflowStage.PAYMENT_APPROVAL,
                    TenderWorkflowStage.SUBMISSION_PENDING,
                    TenderWorkflowStage.WIN_LOSS_PENDING
            ).contains(stageEnum);
            boolean isSpecStage = stageEnum == TenderWorkflowStage.SPEC_CLEARANCE;
            boolean isTpcStage = stageEnum == TenderWorkflowStage.TPC_PRICING;

            boolean isMisTeamMember = "MIS Team".equalsIgnoreCase(role) || "MIS Executive".equalsIgnoreCase(role);
            boolean isSpecTeamMember = "Specification Team".equalsIgnoreCase(role) || "Clearance Team".equalsIgnoreCase(role);
            boolean isTpcTeamMember = "TPC Team".equalsIgnoreCase(role) || "TPC Pricing Team".equalsIgnoreCase(role);

            if (isMisStage && !isMisTeamMember) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(Map.of("success", false, "error", "Access denied: MIS Team or Admin required for " + stageEnum));
            }
            if (isSpecStage && !isSpecTeamMember) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(Map.of("success", false, "error", "Access denied: Clearance Team or Admin required for " + stageEnum));
            }
            if (isTpcStage && !isTpcTeamMember) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(Map.of("success", false, "error", "Access denied: TPC Team or Admin required for " + stageEnum));
            }
        }

        // Fetch the tender
        Optional<Tender> tOpt = tenderRepository.findById(approvalReq.getTenderId());
        if (tOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("success", false, "error", "Associated tender not found"));
        }

        Tender tender = tOpt.get();
        String stage = approvalReq.getStage().name();

        // Concurrency safeguard: Verify tender is still at the approval request's stage
        boolean stageMatches = stage.equalsIgnoreCase(tender.getCurrentStage())
                || ("DOC_VERIFICATION".equalsIgnoreCase(stage) && "BID_DOC_PENDING".equalsIgnoreCase(tender.getCurrentStage()));
        if (!stageMatches) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("success", false, "error",
                            "Conflict: Tender is currently at stage '" + tender.getCurrentStage() + 
                            "', cannot apply approval for stage '" + stage + "'."));
        }

        // Advance the workflow stage on APPROVED
        if ("APPROVED".equals(action)) {
            switch (stage) {
                case "DOC_VERIFICATION"  -> {
                    tender.setVerificationStatus("Approved");
                    tender.setCurrentStage("PAYMENT_APPROVAL");
                }
                case "PAYMENT_APPROVAL"  -> {
                    tender.setPaymentStatus("Approved");
                    tender.setCurrentStage("SUBMISSION_PENDING");
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
                                tender.getMisExecutive() != null ? tender.getMisExecutive() : username,
                                outcomeAssignee,
                                "PENDING"
                        );
                        approvalRepository.save(outcomeReq);
                    }
                }
                case "WIN_LOSS_PENDING" -> {
                    String outcome = (String) body.get("outcome");
                    boolean isLoss = "Lost".equalsIgnoreCase(outcome)
                            || (!"Won".equalsIgnoreCase(outcome) && (
                                   (approvalReq.getLossReasonExecutive() != null && !approvalReq.getLossReasonExecutive().isBlank())
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
                    // TPC has already stored the price on the approval request; copy it to the tender
                    if (approvalReq.getTpcPurchasePrice() != null) {
                        tender.setTpcPurchasePrice(approvalReq.getTpcPurchasePrice());
                    }
                    tender.setCurrentStage("MIS_PRICING");
                }
                case "MIS_PRICING"    -> {
                    if (approvalReq.getMisFinalPrice() != null) {
                        tender.setMisFinalPrice(approvalReq.getMisFinalPrice());
                    }
                    tender.setCurrentStage("BID_DOC_PENDING");
                }
                default -> { /* No automatic stage transition for other stages */ }
            }
            tenderRepository.save(tender);
        }

        // Update the approval request record
        if (!"APPROVED".equals(action)) {
            switch (stage) {
                case "SPEC_CLEARANCE" -> tender.setSpecVerificationStatus("Rejected");
                case "DOC_VERIFICATION" -> tender.setVerificationStatus("Rejected");
                case "PAYMENT_APPROVAL" -> tender.setPaymentStatus("Rejected");
                case "SUBMISSION_PENDING" -> tender.setSubmissionStatus("Rejected");
                default -> { }
            }
            tenderRepository.save(tender);
        }
        approvalReq.setStatus(action);
        approvalReq.setReviewedBy(username);
        if (!comment.isEmpty()) approvalReq.setReviewerComment(comment);
        if (!lossReasonMis.isEmpty()) approvalReq.setLossReasonMis(lossReasonMis);
        approvalReq.setUpdatedAt(java.time.LocalDateTime.now());
        approvalRepository.save(approvalReq);

        // Also delete any other remaining duplicate pending requests for this stage & tender
        List<TenderApprovalRequest> remaining = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(approvalReq.getTenderId(), approvalReq.getStage());
        for (TenderApprovalRequest r : remaining) {
            if (!r.getId().equals(approvalReq.getId()) && "PENDING".equalsIgnoreCase(r.getStatus())) {
                approvalRepository.delete(r);
            }
        }

        // Write workflow comment / audit trail
        String commentText = action + " by " + username + ": " + comment
                + (lossReasonMis.isEmpty() ? "" : " [MIS Loss Reason: " + lossReasonMis + "]");
        commentRepository.save(new TenderComment(
                approvalReq.getTenderId(), stage, username, role, commentText));

        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Approval request " + approvalId + " updated to: " + action,
                "newTenderStage", tender.getCurrentStage()
        ));
    }
}
