package com.tenderpocket.controllers;
import com.tenderpocket.services.WorkflowSyncService;
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
            TenderWorkflowStage.PAYMENT_APPROVAL,
            TenderWorkflowStage.MIS_PRICING,
            TenderWorkflowStage.DOC_VERIFICATION,
            TenderWorkflowStage.SUBMISSION_PENDING,
            TenderWorkflowStage.WIN_LOSS_PENDING
    );

    @Autowired
    private WorkflowSyncService workflowSyncService;

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

    private Double positivePrice(Object value) {
        if (value == null) return null;
        if (!(value instanceof Number) && !(value instanceof String)) return null;
        try {
            double parsed = Double.parseDouble(value.toString().trim());
            return Double.isFinite(parsed) && parsed > 0 ? parsed : null;
        } catch (NumberFormatException ignored) { return null; }
    }

    private TenderApprovalRequest ensurePendingApproval(String tenderId, TenderWorkflowStage stage, String requestedBy, String assignedTo,
                                                        Double emdAmount, String transferMode, String transferRefNo, String receiptUrl, Double tpcPrice) {
        List<TenderApprovalRequest> list = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, stage);
        TenderApprovalRequest existing = list.stream().filter(r -> "PENDING".equalsIgnoreCase(r.getStatus())).findFirst().orElse(null);
        if (existing == null) {
            existing = new TenderApprovalRequest(tenderId, stage, requestedBy != null ? requestedBy : "system", assignedTo != null ? assignedTo : "misteam", "PENDING");
            if (emdAmount != null) existing.setEmdAmount(emdAmount);
            if (transferMode != null) existing.setTransferMode(transferMode);
            if (transferRefNo != null) existing.setTransferRefNo(transferRefNo);
            if (receiptUrl != null) existing.setReceiptFileUrl(receiptUrl);
            if (tpcPrice != null) existing.setTpcPurchasePrice(tpcPrice);
            existing.setCreatedAt(java.time.LocalDateTime.now());
            existing.setUpdatedAt(java.time.LocalDateTime.now());
            return approvalRepository.save(existing);
        } else {
            boolean changed = false;
            if (emdAmount != null && existing.getEmdAmount() == null) { existing.setEmdAmount(emdAmount); changed = true; }
            if (transferMode != null && existing.getTransferMode() == null) { existing.setTransferMode(transferMode); changed = true; }
            if (transferRefNo != null && existing.getTransferRefNo() == null) { existing.setTransferRefNo(transferRefNo); changed = true; }
            if (receiptUrl != null && existing.getReceiptFileUrl() == null) { existing.setReceiptFileUrl(receiptUrl); changed = true; }
            if (tpcPrice != null && existing.getTpcPurchasePrice() == null) { existing.setTpcPurchasePrice(tpcPrice); changed = true; }
            if (changed) {
                existing.setUpdatedAt(java.time.LocalDateTime.now());
                return approvalRepository.save(existing);
            }
            return existing;
        }
    }

    // ── Reconciliation Helper ────────────────────────────────────────────────
    @Transactional
    public void reconcileStaleAndDuplicateApprovals() {
        try {
            List<TenderApprovalRequest> pending = approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING");
            if (!pending.isEmpty()) {
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
                        } else if (!"Pending".equalsIgnoreCase(tender.getSpecVerificationStatus())) {
                            // Spec has not been generated or submitted for clearance yet; this pending request is premature
                            approvalRepository.delete(latest);
                            continue;
                        }
                    } else if (stage == TenderWorkflowStage.TPC_PRICING) {
                        if ((tender.getTpcPurchasePrice() != null && tender.getTpcPurchasePrice() > 0)
                                || "MIS".equalsIgnoreCase(tender.getPricingRoute())
                                || (tender.getCurrentStage() != null && List.of("SUBMISSION_READY", "SUBMISSION_PENDING", "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST").contains(tender.getCurrentStage().toUpperCase()))) {
                            isStale = true;
                        }
                    } else if (stage == TenderWorkflowStage.MIS_PRICING) {
                        if ((tender.getMisFinalPrice() != null && tender.getMisFinalPrice() > 0)
                                || "Approved".equalsIgnoreCase(tender.getPricingStatus())
                                || (tender.getCurrentStage() != null && List.of("SUBMISSION_READY", "SUBMISSION_PENDING", "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST").contains(tender.getCurrentStage().toUpperCase()))) {
                            isStale = true;
                        }
                    } else if (stage == TenderWorkflowStage.PAYMENT_APPROVAL) {
                        if ("Approved".equalsIgnoreCase(tender.getPaymentStatus()) ||
                            (tender.getCurrentStage() != null && List.of("DUAL_TRACK", "SUBMISSION_READY", "SUBMISSION_PENDING", "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST").contains(tender.getCurrentStage().toUpperCase()))) {
                            isStale = true;
                        }
                    } else if (stage == TenderWorkflowStage.DOC_VERIFICATION) {
                        if ("Approved".equalsIgnoreCase(tender.getVerificationStatus()) ||
                            (tender.getCurrentStage() != null && List.of("SUBMISSION_READY", "SUBMISSION_PENDING", "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST").contains(tender.getCurrentStage().toUpperCase()))) {
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
                    } else if (MIS_TEAM_STAGES.contains(stage)) {
                        String curAssigned = latest.getAssignedTo();
                        if (curAssigned != null && List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(curAssigned.trim().toLowerCase())) {
                            String fixedAssignee = tender.getAssignedMisMember() != null && !tender.getAssignedMisMember().isBlank()
                                    && !List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(tender.getAssignedMisMember().trim().toLowerCase())
                                    ? tender.getAssignedMisMember().trim() : "misteam";
                            latest.setAssignedTo(fixedAssignee);
                            latest.setUpdatedAt(java.time.LocalDateTime.now());
                            approvalRepository.save(latest);
                        }
                    }
                }
            }

            // ── Auto-reconcile active tenders that need pending approvals ──────────────
            List<Tender> activeTenders = tenderRepository.findAll();
            for (Tender t : activeTenders) {
                if (t.getStatus() != null && List.of("Won", "Lost", "Awarded", "Not Awarded", "Not Participating").contains(t.getStatus())) {
                    continue;
                }

                String stage = t.getCurrentStage() != null ? t.getCurrentStage().toUpperCase() : "";

                // 1. SPEC_CLEARANCE: Only ensure pending approval when tech specs have been submitted for clearance
                if ("Pending".equalsIgnoreCase(t.getSpecVerificationStatus())) {
                    if (!"Approved".equalsIgnoreCase(t.getSpecVerificationStatus())) {
                        ensurePendingApproval(t.getId(), TenderWorkflowStage.SPEC_CLEARANCE,
                                t.getMisExecutive() != null ? t.getMisExecutive() : "executive",
                                t.getAssignedMisMemberSpec() != null ? t.getAssignedMisMemberSpec() : "clearance",
                                null, null, null, null, null);
                    }
                }

                // 2. PAYMENT_APPROVAL (EMD Payment)
                if ("PAYMENT_APPROVAL".equalsIgnoreCase(stage) || "EMD_PENDING".equalsIgnoreCase(stage) || "Pending".equalsIgnoreCase(t.getPaymentStatus())) {
                    if (!"Approved".equalsIgnoreCase(t.getPaymentStatus()) && !"Exempt".equalsIgnoreCase(t.getPaymentStatus())) {
                        if (t.getPaymentStatus() == null || "None".equalsIgnoreCase(t.getPaymentStatus())) {
                            t.setPaymentStatus("Pending");
                            tenderRepository.save(t);
                        }
                        String misAssignee = t.getAssignedMisMemberEmd() != null && !t.getAssignedMisMemberEmd().isBlank()
                                ? t.getAssignedMisMemberEmd()
                                : (t.getAssignedMisMember() != null && !t.getAssignedMisMember().isBlank() ? t.getAssignedMisMember() : "misteam");
                        ensurePendingApproval(t.getId(), TenderWorkflowStage.PAYMENT_APPROVAL,
                                t.getMisExecutive() != null ? t.getMisExecutive() : "executive",
                                misAssignee,
                                t.getEmdAmountActual(),
                                t.getEmdPaymentMode() != null ? t.getEmdPaymentMode() : "NEFT / RTGS",
                                t.getEmdBeneficiaryName() != null ? t.getEmdBeneficiaryName() : t.getEmdPaymentRef(),
                                t.getEmdReceiptDocPath(),
                                null);
                    }
                }

                // 3. TPC_PRICING
                if ("TPC_PRICING".equalsIgnoreCase(stage) || ("DUAL_TRACK".equalsIgnoreCase(stage) && (t.getTpcPurchasePrice() == null || t.getTpcPurchasePrice() <= 0) && (t.getMisFinalPrice() == null || t.getMisFinalPrice() <= 0))) {
                    ensurePendingApproval(t.getId(), TenderWorkflowStage.TPC_PRICING,
                            "clearance", "tpc",
                            null, null, null, null, null);
                }

                // 4. MIS_PRICING
                if ("MIS_PRICING".equalsIgnoreCase(stage) && (t.getMisFinalPrice() == null || t.getMisFinalPrice() <= 0)) {
                    if (t.getAssignedMisMember() != null && List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(t.getAssignedMisMember().trim().toLowerCase())) {
                        t.setAssignedMisMember(null);
                        tenderRepository.save(t);
                    }
                    String misAssignee = t.getAssignedMisMember() != null && !t.getAssignedMisMember().isBlank()
                            && !List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(t.getAssignedMisMember().trim().toLowerCase())
                            ? t.getAssignedMisMember().trim() : "misteam";
                    TenderApprovalRequest misReq = ensurePendingApproval(t.getId(), TenderWorkflowStage.MIS_PRICING,
                            "tpc", misAssignee,
                            null, null, null, null, t.getTpcPurchasePrice());
                    if (misReq != null && misReq.getAssignedTo() != null && List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(misReq.getAssignedTo().trim().toLowerCase())) {
                        misReq.setAssignedTo(misAssignee);
                        approvalRepository.save(misReq);
                    }
                }

                // 5. DOC_VERIFICATION
                if ("DOC_VERIFICATION".equalsIgnoreCase(stage) || "Pending".equalsIgnoreCase(t.getVerificationStatus())) {
                    if (!"Approved".equalsIgnoreCase(t.getVerificationStatus())) {
                        String misAssignee = t.getAssignedMisMemberDocs() != null && !t.getAssignedMisMemberDocs().isBlank()
                                ? t.getAssignedMisMemberDocs()
                                : (t.getAssignedMisMember() != null && !t.getAssignedMisMember().isBlank() ? t.getAssignedMisMember() : "misteam");
                        TenderApprovalRequest req = ensurePendingApproval(t.getId(), TenderWorkflowStage.DOC_VERIFICATION,
                                t.getMisExecutive() != null ? t.getMisExecutive() : "executive",
                                misAssignee,
                                null, null, null, null, null);
                        if (req != null && t.getWorkingPath() != null && req.getWorkingPath() == null) {
                            req.setWorkingPath(t.getWorkingPath());
                            approvalRepository.save(req);
                        }
                    }
                }

                // 6. SUBMISSION_PENDING
                if ("SUBMISSION_PENDING".equalsIgnoreCase(stage) || "Pending".equalsIgnoreCase(t.getSubmissionStatus())) {
                    if (!"Approved".equalsIgnoreCase(t.getSubmissionStatus())) {
                        String misAssignee = t.getAssignedMisMemberSubmission() != null && !t.getAssignedMisMemberSubmission().isBlank()
                                ? t.getAssignedMisMemberSubmission()
                                : (t.getAssignedMisMember() != null && !t.getAssignedMisMember().isBlank() ? t.getAssignedMisMember() : "misteam");
                        ensurePendingApproval(t.getId(), TenderWorkflowStage.SUBMISSION_PENDING,
                                t.getMisExecutive() != null ? t.getMisExecutive() : "executive",
                                misAssignee,
                                null, null, null, null, null);
                    }
                }

                // 7. WIN_LOSS_PENDING
                if ("WIN_LOSS_PENDING".equalsIgnoreCase(stage) || "Pending".equalsIgnoreCase(t.getOutcomeStatus())) {
                    if (!"Won".equalsIgnoreCase(t.getOutcomeStatus()) && !"Lost".equalsIgnoreCase(t.getOutcomeStatus())
                            && !"Approved".equalsIgnoreCase(t.getOutcomeStatus())) {
                        String misAssignee = t.getAssignedMisMemberSubmission() != null && !t.getAssignedMisMemberSubmission().isBlank()
                                ? t.getAssignedMisMemberSubmission()
                                : (t.getAssignedMisMember() != null && !t.getAssignedMisMember().isBlank() ? t.getAssignedMisMember() : "misteam");
                        TenderApprovalRequest req = ensurePendingApproval(t.getId(), TenderWorkflowStage.WIN_LOSS_PENDING,
                                t.getMisExecutive() != null ? t.getMisExecutive() : "executive",
                                misAssignee,
                                null, null, null, null, null);
                        if (req != null && t.getLossReason() != null && req.getLossReasonExecutive() == null) {
                            req.setLossReasonExecutive(t.getLossReason());
                            approvalRepository.save(req);
                        }
                    }
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

        String canonicalRole = WorkflowPermissions.canonicalRole(role);
        boolean isTpc = "TPC Pricing Team".equalsIgnoreCase(canonicalRole) || "TPC Team".equalsIgnoreCase(role) || "TPC Pricing Team".equalsIgnoreCase(role);
        boolean isClearance = "Clearance Team".equalsIgnoreCase(canonicalRole) || "Clearance Team".equalsIgnoreCase(role) || "Specification Team".equalsIgnoreCase(role);
        boolean isExecutive = "Tender Executive".equalsIgnoreCase(canonicalRole) || "Tender Executive".equalsIgnoreCase(role) || "Executive".equalsIgnoreCase(role);

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
        } else if (isTpc) {
            rows = approvalRepository.countByStageForTpcTeam(username, statusParam, TenderWorkflowStage.TPC_PRICING);
            pendingRows = approvalRepository.countByStageForTpcTeam(username, "PENDING", TenderWorkflowStage.TPC_PRICING);
            historyRows = approvalRepository.countByStageForTpcTeam(username, "HISTORY", TenderWorkflowStage.TPC_PRICING);
        } else if (isClearance) {
            rows = approvalRepository.countByStageForClearanceTeam(username, statusParam, TenderWorkflowStage.SPEC_CLEARANCE);
            pendingRows = approvalRepository.countByStageForClearanceTeam(username, "PENDING", TenderWorkflowStage.SPEC_CLEARANCE);
            historyRows = approvalRepository.countByStageForClearanceTeam(username, "HISTORY", TenderWorkflowStage.SPEC_CLEARANCE);
            if (rows.isEmpty()) {
                rows = approvalRepository.countByStageForUser(username, statusParam);
                pendingRows = approvalRepository.countByStageForUser(username, "PENDING");
                historyRows = approvalRepository.countByStageForUser(username, "HISTORY");
            }
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

        // For non-admin roles, status counts must reflect their role/team queue, not global DB totals
        if (!"Admin".equalsIgnoreCase(role)) {
            long rolePending = pendingCounts.getOrDefault("TOTAL", 0L);
            long roleHistory = historyCounts.getOrDefault("TOTAL", 0L);
            statusCounts.put("PENDING", rolePending);
            statusCounts.put("HISTORY", roleHistory);
            statusCounts.put("TOTAL", rolePending + roleHistory);
        }

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

    private boolean isAuthorizedForEmdReceipt(String userRole, String username, Tender tender) {
        if (tender == null) return false;
        if ("Admin".equalsIgnoreCase(userRole)) return true;

        String u = username != null ? username.trim().toLowerCase() : "";

        // That particular executive:
        String execUser = tender.getMisExecutive() != null ? tender.getMisExecutive().trim().toLowerCase() : "";
        if (execUser.isEmpty() && tender.getAssignedMisExecutive() != null) {
            execUser = tender.getAssignedMisExecutive().trim().toLowerCase();
        }
        if ("Tender Executive".equalsIgnoreCase(userRole) && (u.equals(execUser) || execUser.isEmpty())) {
            return true;
        }

        // His MIS team:
        String misUser = tender.getAssignedMisMemberEmd() != null && !tender.getAssignedMisMemberEmd().isBlank()
                ? tender.getAssignedMisMemberEmd().trim().toLowerCase()
                : (tender.getAssignedMisMember() != null ? tender.getAssignedMisMember().trim().toLowerCase() : "");
        if (("MIS Team".equalsIgnoreCase(userRole) || "MIS Executive".equalsIgnoreCase(userRole)) &&
                (u.equals(misUser) || misUser.isEmpty() || "misteam".equals(misUser) || "mis team".equals(misUser))) {
            return true;
        }

        return false;
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

        String canonicalRole = WorkflowPermissions.canonicalRole(role);
        boolean isTpc = "TPC Pricing Team".equalsIgnoreCase(canonicalRole) || "TPC Team".equalsIgnoreCase(role) || "TPC Pricing Team".equalsIgnoreCase(role);
        boolean isClearance = "Clearance Team".equalsIgnoreCase(canonicalRole) || "Clearance Team".equalsIgnoreCase(role) || "Specification Team".equalsIgnoreCase(role);
        boolean isExecutive = "Tender Executive".equalsIgnoreCase(canonicalRole) || "Tender Executive".equalsIgnoreCase(role) || "Executive".equalsIgnoreCase(role);

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
            } else if (isTpc) {
                requests = approvalRepository.findByStageAndStatusForTpcTeam(username, stageEnum, statusParam);
            } else if (isClearance) {
                requests = isAll
                        ? approvalRepository.findByAssignedToAndStageOrderByCreatedAtDesc(username, stageEnum)
                        : approvalRepository.findByAssignedToAndStageAndStatusOrderByCreatedAtDesc(username, stageEnum, statusParam);
                if (requests == null || requests.isEmpty()) {
                    requests = approvalRepository.findByStageAndStatusForClearanceTeam(username, stageEnum, statusParam);
                }
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
            } else if (isTpc) {
                requests = approvalRepository.findByStatusForTpcTeam(username, statusParam, TenderWorkflowStage.TPC_PRICING);
            } else if (isClearance) {
                requests = isAll
                        ? approvalRepository.findByAssignedToOrderByCreatedAtDesc(username)
                        : approvalRepository.findByAssignedToAndStatusOrderByCreatedAtDesc(username, statusParam);
                if (requests == null || requests.isEmpty()) {
                    requests = approvalRepository.findByStatusForClearanceTeam(username, statusParam, TenderWorkflowStage.SPEC_CLEARANCE);
                }
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

            // Tenders in SPEC_CLEARANCE stage must have a generated tech spec or clearance pending status
            if (req.getStage() == TenderWorkflowStage.SPEC_CLEARANCE) {
                boolean hasTechSpec = tender != null && (
                        (tender.getDownloadedDocs() != null && (tender.getDownloadedDocs().contains("Technical Specification") || tender.getDownloadedDocs().contains("specification")))
                        || (tender.getFinalTechSpecFilename() != null && !tender.getFinalTechSpecFilename().isBlank())
                        || "SPEC_CLEARANCE".equalsIgnoreCase(tender.getCurrentStage())
                );
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

            ApprovalSummaryDto dto = new ApprovalSummaryDto(req, tender);
            if (!isAuthorizedForEmdReceipt(role, username, tender)) {
                dto.setReceiptFileUrl(null);
            }
            if ("Tender Executive".equalsIgnoreCase(canonicalRole) || "Executive".equalsIgnoreCase(role)) {
                dto.setTpcPurchasePrice(null);
            }
            result.add(dto);
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
            @RequestBody Map<String, Object> body) {

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
        String action = body.get("action") != null ? body.get("action").toString().trim().toUpperCase() : "";
        if (!List.of("APPROVED", "REJECTED", "CHANGES_REQUESTED").contains(action)) {
            return ResponseEntity.badRequest()
                    .body(Map.of("success", false, "error", "Invalid action. Must be APPROVED, REJECTED, or CHANGES_REQUESTED"));
        }

        String comment = body.get("comment") != null ? body.get("comment").toString().trim() : "";
        if (comment.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("success", false, "error", "A reviewer comment is required"));
        }

        String lossReasonMis = body.get("lossReasonMis") != null ? body.get("lossReasonMis").toString().trim() : "";

        // Parse optional prices from review body
        Double reqTpcPrice = positivePrice(body.get("tpcPurchasePrice"));
        if (reqTpcPrice == null) reqTpcPrice = positivePrice(body.get("tpc_purchase_price"));

        Double reqMisPrice = positivePrice(body.get("misFinalPrice"));
        if (reqMisPrice == null) reqMisPrice = positivePrice(body.get("mis_final_price"));

        // Fetch the specific approval request by ID
        Optional<TenderApprovalRequest> reqOpt = approvalRepository.findById(approvalId);
        if (reqOpt.isEmpty()) {
            // Fallback: Check if tenderId and stage are passed in body
            String tenderId = body.get("tenderId") != null ? body.get("tenderId").toString() : null;
            String stageStr = body.get("stage") != null ? body.get("stage").toString() : null;
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
            // Stage-level authorization check
            TenderWorkflowStage stageEnum = approvalReq.getStage();
            boolean isMisStage = List.of(
                    TenderWorkflowStage.MIS_PRICING,
                    TenderWorkflowStage.DOC_VERIFICATION,
                    TenderWorkflowStage.PAYMENT_APPROVAL,
                    TenderWorkflowStage.SUBMISSION_PENDING,
                    TenderWorkflowStage.WIN_LOSS_PENDING
            ).contains(stageEnum);

            String assigned = approvalReq.getAssignedTo();
            boolean isAssignedToUser = username != null && assigned != null && assigned.equalsIgnoreCase(username);

            boolean isTeamQueue = false;
            if ("MIS Team".equalsIgnoreCase(role) || "MIS Executive".equalsIgnoreCase(role)) {
                isTeamQueue = assigned == null || assigned.isBlank() || "misteam".equalsIgnoreCase(assigned) || "mis team".equalsIgnoreCase(assigned)
                        || "mis executive".equalsIgnoreCase(assigned) || isMisStage;
            } else if ("Clearance Team".equalsIgnoreCase(role) || "Specification Team".equalsIgnoreCase(role)) {
                isTeamQueue = assigned == null || assigned.isBlank() || "clearance".equalsIgnoreCase(assigned) || "clearance team".equalsIgnoreCase(assigned) || "specification team".equalsIgnoreCase(assigned);
            } else if ("TPC Pricing Team".equalsIgnoreCase(role) || "TPC Team".equalsIgnoreCase(role)) {
                isTeamQueue = assigned == null || assigned.isBlank() || "tpc".equalsIgnoreCase(assigned) || "tpc team".equalsIgnoreCase(assigned) || "tpc pricing team".equalsIgnoreCase(assigned);
            }

            if (!isAssignedToUser && !isTeamQueue) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN)
                        .body(Map.of("success", false, "error", "Access denied: This approval request is assigned to " + assigned + ". You have view-only access."));
            }
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
        String currentStage = tender.getCurrentStage() != null ? tender.getCurrentStage().toUpperCase() : "";
        boolean stageMatches = stage.equalsIgnoreCase(currentStage)
                || ("DOC_VERIFICATION".equalsIgnoreCase(stage) && List.of("DOC_VERIFICATION", "BID_DOC_PENDING", "DUAL_TRACK", "DUAL_TRACK_ACTIVE", "TPC_PRICING", "MIS_PRICING").contains(currentStage))
                || ("MIS_PRICING".equalsIgnoreCase(stage) && List.of("MIS_PRICING", "DUAL_TRACK", "DUAL_TRACK_ACTIVE", "TPC_PRICING", "DOC_VERIFICATION", "BID_DOC_PENDING").contains(currentStage))
                || ("TPC_PRICING".equalsIgnoreCase(stage) && List.of("TPC_PRICING", "DUAL_TRACK", "DUAL_TRACK_ACTIVE", "DOC_VERIFICATION", "BID_DOC_PENDING").contains(currentStage))
                || ("PAYMENT_APPROVAL".equalsIgnoreCase(stage) && List.of("PAYMENT_APPROVAL", "BID_DOCS_PREPARATION", "EMD_PENDING", "EMD_PAYMENT").contains(currentStage))
                || ("SPEC_CLEARANCE".equalsIgnoreCase(stage) && List.of("SPEC_CLEARANCE", "SPEC_GENERATION_PENDING", "EXECUTIVE_ASSIGNMENT").contains(currentStage))
                || ("SUBMISSION_PENDING".equalsIgnoreCase(stage) && List.of("SUBMISSION_READY", "SUBMISSION_PENDING", "SUBMITTED").contains(currentStage))
                || ("WIN_LOSS_PENDING".equalsIgnoreCase(stage) && List.of("WIN_LOSS_PENDING", "SUBMITTED", "SUBMISSION_READY").contains(currentStage));
        if (!stageMatches) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("success", false, "error",
                            "Conflict: Tender is currently at stage '" + tender.getCurrentStage() + 
                            "', cannot apply approval for stage '" + stage + "'."));
        }

        if ("SPEC_CLEARANCE".equalsIgnoreCase(stage) && !"APPROVED".equalsIgnoreCase(action)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Clearance Team cannot reject specifications. Clearance must mark 'All Comply' or upload replacement documents with 'Deviations'."));
        }

        // Advance the workflow stage on APPROVED
        if ("APPROVED".equals(action)) {
            switch (stage) {
                case "DOC_VERIFICATION"  -> {
                    tender.setVerificationStatus("Approved");
                    if (workflowSyncService != null) {
                        workflowSyncService.approveTrackBDocs(tender.getId(), username, comment);
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
                case "PAYMENT_APPROVAL"  -> {
                    tender.setPaymentStatus("Approved");
                    if (workflowSyncService != null) {
                        workflowSyncService.approveEmdPayment(tender.getId(), username);
                    } else {
                        tender.setCurrentStage("SUBMISSION_PENDING");
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
                                tender.getMisExecutive() != null ? tender.getMisExecutive() : username,
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
                                   (approvalReq.getLossReasonExecutive() != null && !approvalReq.getLossReasonExecutive().isBlank())
                                   || !lossReasonMis.isEmpty()
                                ));
                    if (workflowSyncService != null) {
                        workflowSyncService.recordOutcome(tender.getId(), isLoss ? "Lost" : "Won", lossReasonMis, username);
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
                    String complianceType = body.get("complianceType") != null ? body.get("complianceType").toString() : "ALL COMPLY";
                    boolean isDeviation = "DEVIATIONS".equalsIgnoreCase(complianceType)
                            || "COMPLY WITH DEVIATIONS".equalsIgnoreCase(complianceType)
                            || "COMPLY_WITH_DEVIATIONS".equalsIgnoreCase(complianceType)
                            || "Approved with some deviation".equalsIgnoreCase(complianceType)
                            || "comply with deviations".equalsIgnoreCase(complianceType)
                            || "deviation".equalsIgnoreCase(complianceType);
                    String compType = isDeviation ? "COMPLY WITH DEVIATIONS" : "ALL COMPLY";

                    tender.setSpecVerificationStatus("Approved");
                    tender.setSpecComplianceType(compType);

                    String specFile = tender.getFinalTechSpecFilename() != null && !tender.getFinalTechSpecFilename().isBlank()
                            ? tender.getFinalTechSpecFilename() : "Combined_Technical_Data_Sheet.pdf";

                    if (workflowSyncService != null) {
                        try {
                            workflowSyncService.recordFinalTechSpec(tender.getId(), specFile, compType, comment, username);
                        } catch (Exception ex) {
                            System.err.println("[ApprovalController] Error syncing workflow state: " + ex.getMessage());
                            tender.setCurrentStage("BID_DOCS_PREPARATION");
                            WorkflowSyncService.requestBrochure(tender);
                        }
                    } else {
                        tender.setCurrentStage("BID_DOCS_PREPARATION");
                        WorkflowSyncService.requestBrochure(tender);
                    }
                }
                case "TPC_PRICING"    -> {
                    Double tpcPriceToSet = reqTpcPrice != null ? reqTpcPrice : approvalReq.getTpcPurchasePrice();
                    if (tpcPriceToSet != null) {
                        approvalReq.setTpcPurchasePrice(tpcPriceToSet);
                        tender.setTpcPurchasePrice(tpcPriceToSet);
                    }
                    String chosenMis = (body.get("assignedMisMember") != null && !body.get("assignedMisMember").toString().isBlank())
                            ? body.get("assignedMisMember").toString().trim()
                            : (body.get("misAssignee") != null && !body.get("misAssignee").toString().isBlank() ? body.get("misAssignee").toString().trim() : null);
                    if (chosenMis != null && !chosenMis.isBlank() && !List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(chosenMis.toLowerCase())) {
                        tender.setAssignedMisMember(chosenMis);
                    } else {
                        chosenMis = null;
                        if (tender.getAssignedMisMember() != null && List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(tender.getAssignedMisMember().trim().toLowerCase())) {
                            tender.setAssignedMisMember(null);
                        }
                    }
                    tender.setCurrentStage("MIS_PRICING");
                    String misAssignee = (chosenMis != null && !chosenMis.isBlank()) ? chosenMis
                            : (tender.getAssignedMisMember() != null && !tender.getAssignedMisMember().isBlank() && !List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(tender.getAssignedMisMember().trim().toLowerCase())
                            ? tender.getAssignedMisMember().trim()
                            : "misteam");

                    if (workflowSyncService != null) {
                        try {
                            workflowSyncService.recordTpcPricing(tender.getId(), tpcPriceToSet, misAssignee, username);
                        } catch (Exception ex) {
                            System.err.println("[ApprovalController] Error syncing recordTpcPricing: " + ex.getMessage());
                        }
                    } else {
                        try {
                            List<TenderApprovalRequest> existingMis = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tender.getId(), TenderWorkflowStage.MIS_PRICING);
                            boolean hasPendingMis = existingMis.stream().anyMatch(r -> "PENDING".equalsIgnoreCase(r.getStatus()));
                            if (!hasPendingMis) {
                                TenderApprovalRequest misReq = new TenderApprovalRequest(
                                        tender.getId(),
                                        TenderWorkflowStage.MIS_PRICING,
                                        username,
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
                }
                case "MIS_PRICING"    -> {
                    Double misPriceToSet = reqMisPrice != null ? reqMisPrice : approvalReq.getMisFinalPrice();
                    // If no final price was explicitly typed and TPC price is available (e.g. direct send to executive), use TPC price
                    if ((misPriceToSet == null || misPriceToSet <= 0) && tender.getTpcPurchasePrice() != null && tender.getTpcPurchasePrice() > 0) {
                        misPriceToSet = tender.getTpcPurchasePrice();
                    }
                    if (misPriceToSet != null) {
                        approvalReq.setMisFinalPrice(misPriceToSet);
                        tender.setMisFinalPrice(misPriceToSet);
                    }
                    if (tender.getTpcPurchasePrice() != null && approvalReq.getTpcPurchasePrice() == null) {
                        approvalReq.setTpcPurchasePrice(tender.getTpcPurchasePrice());
                    }
                    if (workflowSyncService != null) {
                        workflowSyncService.approveTrackAPricing(tender.getId(), misPriceToSet != null ? misPriceToSet : 0.0, username);
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
                    // Also resolve any pending TPC_PRICING request if MIS priced directly
                    try {
                        List<TenderApprovalRequest> pendingTpcList = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tender.getId(), TenderWorkflowStage.TPC_PRICING);
                        for (TenderApprovalRequest a : pendingTpcList) {
                            if (a.getStage() == TenderWorkflowStage.TPC_PRICING
                                    && !java.util.Objects.equals(a.getId(), approvalReq.getId())
                                    && "PENDING".equalsIgnoreCase(a.getStatus())) {
                                a.setStatus("APPROVED");
                                if (a.getReviewerComment() == null || a.getReviewerComment().isBlank()) {
                                    a.setReviewerComment("Priced directly by MIS Team");
                                }
                                a.setUpdatedAt(java.time.LocalDateTime.now());
                                approvalRepository.save(a);
                            }
                        }
                    } catch (Exception ignored) {}
                }
                default -> { /* No automatic stage transition for other stages */ }
            }
            tenderRepository.save(tender);
        }

        // Update the approval request record
        if (!"APPROVED".equals(action)) {
            switch (stage) {
                case "DOC_VERIFICATION" -> {
                    tender.setVerificationStatus("Rejected");
                    if (workflowSyncService != null) {
                        workflowSyncService.rejectTrackBDocs(tender.getId(), username, comment);
                        tender = tenderRepository.findById(tender.getId()).orElse(tender);
                    }
                }
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
        String extraInfo = "";
        if (!lossReasonMis.isEmpty()) extraInfo += " [MIS Loss Reason: " + lossReasonMis + "]";
        if ("TPC_PRICING".equals(stage) && tender.getTpcPurchasePrice() != null) {
            extraInfo += " [TPC Price: ₹" + tender.getTpcPurchasePrice() + "]";
        } else if ("MIS_PRICING".equals(stage) && tender.getMisFinalPrice() != null) {
            extraInfo += " [MIS Final Price: ₹" + tender.getMisFinalPrice() + "]";
        }
        String commentText = action + " by " + username + ": " + comment + extraInfo;
        commentRepository.save(new TenderComment(
                approvalReq.getTenderId(), stage, username, role, commentText));

        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Approval request " + approvalId + " updated to: " + action,
                "newTenderStage", tender.getCurrentStage()
        ));
    }
}
