package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.models.TenderWorkflowState;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;

/**
 * Best estimate of when an action started waiting, used the first time the pending clock sees
 * it. After that the clock row keeps its own time, so this only matters for tenders that were
 * already waiting when the clock started (and to stay accurate between hourly refreshes).
 *
 * Each estimate is the latest recorded event that leads into the current step.
 */
public final class PendingSinceEstimator {

    private PendingSinceEstimator() {}

    /**
     * @param history   all approval requests of the tender (any status), may be empty
     * @param now       current IST time; the result is never later than this
     * @param serverZone zone that naive server timestamps were written in
     */
    public static LocalDateTime estimate(PendingActionKey key, Tender t, TenderWorkflowState state,
                                         List<TenderApprovalRequest> history, LocalDateTime now, ZoneId serverZone) {
        LocalDateTime estimate = switch (key) {
            case DECIDE -> firstOf(
                    NotifyDates.parseDateTime(t.getEntryDate(), serverZone),
                    NotifyDates.parseDateTime(t.getPublishDate(), serverZone),
                    NotifyDates.parseDateTime(t.getScrapedAt(), serverZone));
            case SPEC_PREP -> latest(
                    NotifyDates.parseDateTime(t.getAssignedAt(), serverZone),
                    lastReviewed(history, TenderWorkflowStage.SPEC_CLEARANCE, serverZone));
            case BID_DOCS -> latest(
                    NotifyDates.parseDateTime(t.getFinalTechSpecUploadedAt(), serverZone),
                    state == null ? null : NotifyDates.parseDateTime(state.getFinalTechSpecUploadedAt(), serverZone),
                    lastReviewed(history, TenderWorkflowStage.SPEC_CLEARANCE, serverZone));
            case EMD_ENTRY -> latest(
                    state == null ? null : NotifyDates.parseDateTime(state.getBidPackageGeneratedAt(), serverZone),
                    lastReviewed(history, TenderWorkflowStage.PAYMENT_APPROVAL, serverZone));
            case PRICE_ROUTE -> latest(
                    state == null ? null : NotifyDates.parseDateTime(state.getEmdApprovedAt(), serverZone),
                    state == null ? null : NotifyDates.parseDateTime(state.getBidPackageGeneratedAt(), serverZone));
            case DOC_FIX -> latest(
                    state == null ? null : NotifyDates.parseDateTime(state.getDocsVerifiedAt(), serverZone),
                    lastReviewed(history, TenderWorkflowStage.DOC_VERIFICATION, serverZone));
            case SUBMIT -> latest(
                    state == null ? null : NotifyDates.parseDateTime(state.getDocsVerifiedAt(), serverZone),
                    NotifyDates.parseDateTime(t.getPricingGoAheadAt(), serverZone),
                    state == null ? null : NotifyDates.parseDateTime(state.getPricingGoAheadAt(), serverZone));
            case SPEC_REVIEW, EMD_APPROVE, TPC_PRICE, MIS_PRICE, DOC_VERIFY, SUBMIT_CONFIRM ->
                    latestPending(history, key.getApprovalStage(), serverZone);
        };

        if (estimate == null && state != null) {
            estimate = NotifyDates.parseDateTime(state.getUpdatedAt(), serverZone);
        }
        if (estimate == null || estimate.isAfter(now)) return now;
        return estimate;
    }

    /** When the newest PENDING request of the stage was raised or last re-raised. */
    private static LocalDateTime latestPending(List<TenderApprovalRequest> history, TenderWorkflowStage stage, ZoneId zone) {
        if (history == null || stage == null) return null;
        LocalDateTime best = null;
        for (TenderApprovalRequest r : history) {
            if (r == null || r.getStage() != stage || !"PENDING".equalsIgnoreCase(r.getStatus())) continue;
            best = latest(best, NotifyDates.toIst(r.getCreatedAt(), zone), NotifyDates.toIst(r.getUpdatedAt(), zone));
        }
        return best;
    }

    /** When a request of the stage was last decided (approved, rejected or sent back). */
    private static LocalDateTime lastReviewed(List<TenderApprovalRequest> history, TenderWorkflowStage stage, ZoneId zone) {
        if (history == null) return null;
        LocalDateTime best = null;
        for (TenderApprovalRequest r : history) {
            if (r == null || r.getStage() != stage || "PENDING".equalsIgnoreCase(r.getStatus())) continue;
            best = latest(best, NotifyDates.toIst(r.getUpdatedAt() != null ? r.getUpdatedAt() : r.getCreatedAt(), zone));
        }
        return best;
    }

    private static LocalDateTime firstOf(LocalDateTime... values) {
        for (LocalDateTime v : values) if (v != null) return v;
        return null;
    }

    private static LocalDateTime latest(LocalDateTime... values) {
        LocalDateTime best = null;
        for (LocalDateTime v : values) {
            if (v != null && (best == null || v.isAfter(best))) best = v;
        }
        return best;
    }
}
