package com.tenderpocket.models;

public enum TenderWorkflowStage {
    SPEC_CLEARANCE,
    TPC_PRICING,
    MIS_PRICING,
    BID_DOC_GENERATED,
    PAYMENT_APPROVAL,
    DOC_VERIFICATION,
    SUBMISSION_PENDING,
    SUBMITTED,
    WIN_LOSS_PENDING,
    WON,
    LOST,
    UNABLE_TO_SUBMIT
}
