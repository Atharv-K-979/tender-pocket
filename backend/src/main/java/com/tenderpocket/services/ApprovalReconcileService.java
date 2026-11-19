package com.tenderpocket.services;

import com.tenderpocket.cache.DataVersion;
import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.repositories.TenderApprovalRepository;
import com.tenderpocket.repositories.TenderRepository;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;

/**
 * Keeps the approval queue consistent with the tenders: removes duplicate pending requests, closes
 * requests whose stage the tender has already passed, and creates the pending request a tender's
 * stage needs when it is missing.
 *
 * This clean-up used to run on every Approvals Center read (counts and list), which made the screen
 * scan every tender on each open. It now runs in the background instead: a few seconds after a
 * committed tender or approval-request change (at most every 15 seconds while changes keep coming),
 * and every 10 minutes as a safety net. The clean-up logic itself is unchanged.
 */
@Service
public class ApprovalReconcileService {

    /** Stages that are owned by / visible to any MIS Team member (team queue). */
    private static final List<TenderWorkflowStage> MIS_TEAM_STAGES = List.of(
            TenderWorkflowStage.PAYMENT_APPROVAL,
            TenderWorkflowStage.MIS_PRICING,
            TenderWorkflowStage.DOC_VERIFICATION,
            TenderWorkflowStage.SUBMISSION_PENDING,
            TenderWorkflowStage.WIN_LOSS_PENDING
    );

    /** Wait after a change before running, so that a burst of changes causes a single run. */
    private static final long AFTER_CHANGE_DELAY_SECONDS = 3;
    /** Runs triggered by changes start at least this far apart, so steady activity cannot keep it running back to back. */
    private static final long MIN_SECONDS_BETWEEN_RUNS = 15;
    private static final long FIRST_RUN_DELAY_SECONDS = 30;
    private static final long PERIOD_SECONDS = 10 * 60;

    @Autowired
    private TenderApprovalRepository approvalRepository;

    @Autowired
    private TenderRepository tenderRepository;

    /** One thread: runs never overlap, and a long tender sync on Spring's scheduler cannot delay them. */
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "approval-reconcile");
        thread.setDaemon(true);
        return thread;
    });

    private final AtomicBoolean runRequested = new AtomicBoolean(false);
    private volatile long lastRunStartedMillis = 0L;

    @PostConstruct
    void start() {
        DataVersion.onWorkflowChange(this::requestRun);
        executor.scheduleWithFixedDelay(this::runSafely, FIRST_RUN_DELAY_SECONDS, PERIOD_SECONDS, TimeUnit.SECONDS);
    }

    @PreDestroy
    void stop() {
        executor.shutdownNow();
    }

    /** Schedules a run shortly; requests made before that run starts are merged into it. */
    public void requestRun() {
        if (runRequested.compareAndSet(false, true)) {
            long sinceLastRun = System.currentTimeMillis() - lastRunStartedMillis;
            long delayMillis = Math.max(TimeUnit.SECONDS.toMillis(AFTER_CHANGE_DELAY_SECONDS),
                    TimeUnit.SECONDS.toMillis(MIN_SECONDS_BETWEEN_RUNS) - sinceLastRun);
            try {
                executor.schedule(() -> {
                    runRequested.set(false);
                    runSafely();
                }, delayMillis, TimeUnit.MILLISECONDS);
            } catch (RuntimeException e) {
                runRequested.set(false); // executor shut down
            }
        }
    }

    private void runSafely() {
        lastRunStartedMillis = System.currentTimeMillis();
        try {
            // The clean-up's own saves must not schedule yet another clean-up.
            DataVersion.runQuietly(this::reconcileStaleAndDuplicateApprovals);
        } catch (Throwable t) {
            System.err.println("[ApprovalReconcile] Clean-up failed: " + t.getMessage());
        }
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

    // ── Reconciliation (unchanged logic, formerly run on every counts / pending read) ─────────
    // Not transactional: each save commits on its own, as it always has.
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
}
