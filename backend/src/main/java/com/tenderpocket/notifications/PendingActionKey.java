package com.tenderpocket.notifications;

import com.tenderpocket.models.TenderWorkflowStage;

/**
 * Every action that can hold a live tender up, the team that owns it, and the approval-request
 * stage (if any) whose PENDING request names the specific person.
 */
public enum PendingActionKey {
    DECIDE("Assign & Participate decision", Team.MIS, null),
    SPEC_PREP("Prepare spec and send for clearance", Team.EXECUTIVE, null),
    SPEC_REVIEW("Review technical spec", Team.CLEARANCE, TenderWorkflowStage.SPEC_CLEARANCE),
    BID_DOCS("Generate bid package", Team.EXECUTIVE, null),
    EMD_ENTRY("Enter EMD payment details", Team.EXECUTIVE, null),
    EMD_APPROVE("Approve EMD payment", Team.MIS, TenderWorkflowStage.PAYMENT_APPROVAL),
    PRICE_ROUTE("Route pricing to TPC or MIS", Team.EXECUTIVE, null),
    TPC_PRICE("Enter manufacturer purchase price", Team.TPC, TenderWorkflowStage.TPC_PRICING),
    MIS_PRICE("Set final price", Team.MIS, TenderWorkflowStage.MIS_PRICING),
    DOC_VERIFY("Verify bid documents", Team.MIS, TenderWorkflowStage.DOC_VERIFICATION),
    DOC_FIX("Fix rejected documents", Team.EXECUTIVE, null),
    SUBMIT("Submit on portal", Team.EXECUTIVE, null),
    SUBMIT_CONFIRM("Confirm portal submission", Team.MIS, TenderWorkflowStage.SUBMISSION_PENDING);

    private final String label;
    private final Team owner;
    private final TenderWorkflowStage approvalStage;

    PendingActionKey(String label, Team owner, TenderWorkflowStage approvalStage) {
        this.label = label;
        this.owner = owner;
        this.approvalStage = approvalStage;
    }

    public String getLabel() { return label; }

    public Team getOwner() { return owner; }

    public TenderWorkflowStage getApprovalStage() { return approvalStage; }
}
