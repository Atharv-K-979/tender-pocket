package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.models.TenderWorkflowState;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Decides which action(s) a tender is waiting on.
 *
 * This follows the same milestone checks as resolveTenderStageDetails in
 * frontend/src/lib/tenderStatus.ts, so a mail never disagrees with the step the tender
 * workspace shows. Steps are checked in order and the first one not done is the current one.
 * Step 5 is the exception: pricing (track A) and document verification (track B) run at the
 * same time, so a tender there can wait on two teams at once.
 *
 * Where the frontend reads a field that is not reliable on the backend, this deviates on
 * purpose:
 *  - tender_workflow_states.emd_status defaults to "PENDING" when the row is created, so it is
 *    only trusted for the values that are set deliberately (APPROVED, EXEMPT_SKIPPED).
 *  - Stage PAYMENT_APPROVAL alone does not mean MIS has something to approve: bid package
 *    generation moves tenders there before the executive has entered the payment.
 *  - Once a TPC price exists, pricing waits on MIS even though pricing_route still says TPC.
 */
public final class PendingWorkResolver {

    private PendingWorkResolver() {}

    private static final Set<String> CLOSED_STATUSES = Set.of(
            "not participating", "non_participating", "awarded", "won", "not awarded", "lost", "missed opportunity");
    private static final Set<String> SUBMITTED_STATUSES = Set.of("submitted", "filed");
    private static final Set<String> CLOSED_STAGES = Set.of("WON", "LOST", "UNABLE_TO_SUBMIT");
    private static final Set<String> SUBMITTED_STAGES = Set.of("SUBMITTED", "WIN_LOSS_PENDING");

    private static final Set<String> PAST_STEP_3_STAGES = Set.of(
            "PAYMENT_APPROVAL", "EMD_PENDING", "EMD_PAYMENT", "EMD_PAYMENT_READY",
            "DUAL_TRACK", "DUAL_TRACK_ACTIVE", "TPC_PRICING", "MIS_PRICING",
            "DOC_VERIFICATION", "SUBMISSION_READY", "SUBMISSION_PENDING",
            "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST");
    private static final Set<String> PAST_STEP_4_STAGES = Set.of(
            "DUAL_TRACK", "DUAL_TRACK_ACTIVE", "TPC_PRICING", "MIS_PRICING",
            "DOC_VERIFICATION", "SUBMISSION_READY", "SUBMISSION_PENDING",
            "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST");

    /** Values that mean "nobody assigned" although the column is filled; same list as the tender workspace. */
    private static final Set<String> UNASSIGNED_PLACEHOLDERS = Set.of("unassigned", "not assigned", "n/a", "none", "null", "-");

    private static final Pattern GENERATED_DOCS = Pattern.compile("(?i)bid_documents_|generated bid documents");
    private static final Pattern EMD_EXEMPT_TEXT = Pattern.compile("(?i).*(exempt|nil|not applicable).*");

    /** Won, lost, declined or abandoned: nothing left to do and nothing to remind anyone about. */
    public static boolean isClosed(Tender t) {
        if (t == null) return true;
        return CLOSED_STATUSES.contains(lower(t.getStatus()))
                || CLOSED_STAGES.contains(upper(t.getCurrentStage()))
                || eq(t.getOutcomeStatus(), "Won")
                || eq(t.getOutcomeStatus(), "Lost");
    }

    /** Filed on the portal. The deadline can no longer be missed. */
    public static boolean isSubmitted(Tender t) {
        if (t == null) return false;
        return SUBMITTED_STATUSES.contains(lower(t.getStatus()))
                || SUBMITTED_STAGES.contains(upper(t.getCurrentStage()))
                || eq(t.getSubmissionStatus(), "Approved");
    }

    /**
     * @param state            the tender's workflow state row, or null if it has none
     * @param pendingApprovals the tender's PENDING approval requests, newest per stage
     */
    public static List<PendingWork> resolve(Tender t, TenderWorkflowState state,
                                            Map<TenderWorkflowStage, TenderApprovalRequest> pendingApprovals) {
        List<PendingWork> out = new ArrayList<>();
        if (t == null || isClosed(t)) return out;
        Map<TenderWorkflowStage, TenderApprovalRequest> approvals = pendingApprovals == null ? Map.of() : pendingApprovals;
        String stage = upper(t.getCurrentStage());

        if (isSubmitted(t)) {
            if (eq(t.getSubmissionStatus(), "Pending")) {
                out.add(team(PendingActionKey.SUBMIT_CONFIRM, t, approvals));
            }
            return out;
        }

        // Step 1: MIS decides and assigns an executive.
        if (assignedExecutive(t).isEmpty()) {
            out.add(new PendingWork(PendingActionKey.DECIDE, List.of()));
            return out;
        }

        // Step 2: executive prepares the spec, Clearance approves it.
        boolean specApproved = eq(t.getSpecVerificationStatus(), "Approved") || !isBlank(t.getFinalTechSpecFilename());
        if (!specApproved) {
            out.add(eq(t.getSpecVerificationStatus(), "Pending")
                    ? team(PendingActionKey.SPEC_REVIEW, t, approvals)
                    : executive(PendingActionKey.SPEC_PREP, t));
            return out;
        }

        // Step 3: executive generates the bid package.
        boolean docsGenerated = !isBlank(t.getWorkingPath())
                || (t.getDownloadedDocs() != null && GENERATED_DOCS.matcher(t.getDownloadedDocs()).find());
        boolean pastStep3 = PAST_STEP_3_STAGES.contains(stage)
                || in(t.getPaymentStatus(), "Pending", "Approved", "Exempt")
                || (state != null && in(state.getEmdStatus(), "APPROVED", "EXEMPT_SKIPPED"))
                || !isBlank(t.getEmdBeneficiaryName())
                || eq(t.getPricingStatus(), "Approved")
                || eq(t.getVerificationStatus(), "Approved");
        boolean step3Done = pastStep3 || (docsGenerated && !eq(t.getVerificationStatus(), "Rejected"));
        if (!step3Done) {
            out.add(executive(PendingActionKey.BID_DOCS, t));
            return out;
        }

        // Step 4: executive enters the EMD payment, MIS approves it. Exempt tenders skip this.
        boolean explicitlyApplicable = Boolean.TRUE.equals(t.getEmdApplicable())
                || "PAYMENT_APPROVAL".equals(stage)
                || eq(t.getPaymentStatus(), "Pending")
                || !isBlank(t.getEmdBeneficiaryName());
        boolean exempt = !explicitlyApplicable && (
                Boolean.FALSE.equals(t.getEmdApplicable())
                        || eq(t.getPaymentStatus(), "Exempt")
                        || (state != null && eq(state.getEmdStatus(), "EXEMPT_SKIPPED"))
                        || (t.getEmdRaw() != null && EMD_EXEMPT_TEXT.matcher(t.getEmdRaw()).matches()));
        boolean pastStep4 = PAST_STEP_4_STAGES.contains(stage)
                || eq(t.getPricingStatus(), "Approved")
                || eq(t.getVerificationStatus(), "Approved");
        boolean emdDone = exempt
                || eq(t.getPaymentStatus(), "Approved")
                || (state != null && eq(state.getEmdStatus(), "APPROVED"))
                || pastStep4;
        if (!emdDone) {
            boolean awaitingApproval = eq(t.getPaymentStatus(), "Pending")
                    || "EMD_PENDING".equals(stage)
                    || approvals.containsKey(TenderWorkflowStage.PAYMENT_APPROVAL);
            out.add(awaitingApproval
                    ? team(PendingActionKey.EMD_APPROVE, t, approvals)
                    : executive(PendingActionKey.EMD_ENTRY, t));
            return out;
        }

        // Step 5: pricing (track A) and document verification (track B) in parallel.
        String trackA = state == null ? "" : upper(state.getTrackAPricingStatus());
        String trackB = state == null ? "" : upper(state.getTrackBDocStatus());
        boolean pricingApproved = eq(t.getPricingStatus(), "Approved") || positive(t.getMisFinalPrice()) || "APPROVED".equals(trackA);
        boolean docsVerified = eq(t.getVerificationStatus(), "Approved") || "APPROVED".equals(trackB);
        if (!pricingApproved || !docsVerified) {
            if (!pricingApproved) {
                if (positive(t.getTpcPurchasePrice())) {
                    out.add(team(PendingActionKey.MIS_PRICE, t, approvals));
                } else if (eq(t.getPricingRoute(), "TPC") || "TPC_PRICING".equals(stage) || "TPC_PENDING".equals(trackA)) {
                    out.add(team(PendingActionKey.TPC_PRICE, t, approvals));
                } else if (eq(t.getPricingRoute(), "MIS") || "MIS_PRICING".equals(stage) || "MIS_PENDING".equals(trackA)) {
                    out.add(team(PendingActionKey.MIS_PRICE, t, approvals));
                } else {
                    out.add(executive(PendingActionKey.PRICE_ROUTE, t));
                }
            }
            if (!docsVerified) {
                boolean rejected = eq(t.getVerificationStatus(), "Rejected") || "CHANGES_REQUESTED".equals(trackB);
                out.add(rejected
                        ? executive(PendingActionKey.DOC_FIX, t)
                        : team(PendingActionKey.DOC_VERIFY, t, approvals));
            }
            return out;
        }

        // Step 6: executive files on the portal, MIS confirms.
        if (eq(t.getSubmissionStatus(), "Pending") || "SUBMISSION_PENDING".equals(stage)) {
            out.add(team(PendingActionKey.SUBMIT_CONFIRM, t, approvals));
        } else {
            out.add(executive(PendingActionKey.SUBMIT, t));
        }
        return out;
    }

    private static PendingWork executive(PendingActionKey key, Tender t) {
        return new PendingWork(key, List.of(assignedExecutive(t)));
    }

    /** The executive actually assigned, or "" when the column is blank or holds a placeholder such as "Unassigned". */
    public static String assignedExecutive(Tender t) {
        String value = t == null || t.getMisExecutive() == null ? "" : t.getMisExecutive().trim();
        return UNASSIGNED_PLACEHOLDERS.contains(value.toLowerCase(Locale.ROOT)) ? "" : value;
    }

    private static PendingWork team(PendingActionKey key, Tender t, Map<TenderWorkflowStage, TenderApprovalRequest> approvals) {
        List<String> owners = new ArrayList<>();
        TenderApprovalRequest pending = key.getApprovalStage() == null ? null : approvals.get(key.getApprovalStage());
        if (pending != null) owners.add(pending.getAssignedTo());
        switch (key) {
            case SPEC_REVIEW -> owners.add(t.getAssignedMisMemberSpec());
            case EMD_APPROVE -> { owners.add(t.getAssignedMisMemberEmd()); owners.add(t.getAssignedMisMember()); }
            case DOC_VERIFY -> { owners.add(t.getAssignedMisMemberDocs()); owners.add(t.getAssignedMisMember()); }
            case SUBMIT_CONFIRM -> { owners.add(t.getAssignedMisMemberSubmission()); owners.add(t.getAssignedMisMember()); }
            case MIS_PRICE -> owners.add(t.getAssignedMisMember());
            default -> { }
        }
        return new PendingWork(key, owners);
    }

    private static boolean positive(Double d) { return d != null && d > 0; }

    private static boolean isBlank(String s) { return s == null || s.isBlank(); }

    private static boolean eq(String a, String b) { return a != null && a.trim().equalsIgnoreCase(b); }

    private static boolean in(String value, String... options) {
        for (String option : options) if (eq(value, option)) return true;
        return false;
    }

    private static String lower(String s) { return s == null ? "" : s.trim().toLowerCase(Locale.ROOT); }

    private static String upper(String s) { return s == null ? "" : s.trim().toUpperCase(Locale.ROOT); }
}
