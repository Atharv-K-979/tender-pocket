package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.models.TenderWorkflowState;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static com.tenderpocket.notifications.NotifyTestData.*;
import static com.tenderpocket.notifications.PendingActionKey.*;
import static org.junit.jupiter.api.Assertions.*;

class PendingWorkResolverTest {

    private static List<PendingActionKey> keys(Tender t) {
        return keys(t, null, Map.of());
    }

    private static List<PendingActionKey> keys(Tender t, TenderWorkflowState s, Map<TenderWorkflowStage, TenderApprovalRequest> approvals) {
        return PendingWorkResolver.resolve(t, s, approvals).stream().map(PendingWork::key).toList();
    }

    @Test
    void undecidedTenderWaitsOnMisDecision() {
        assertEquals(List.of(DECIDE), keys(undecided("T1")));
    }

    @Test
    void placeholderExecutiveValuesMeanNobodyIsAssigned() {
        for (String placeholder : List.of("Unassigned", "Not Assigned", "N/A", "none", " - ")) {
            Tender t = undecided("T1");
            t.setMisExecutive(placeholder);
            assertEquals(List.of(DECIDE), keys(t), placeholder);
        }
    }

    @Test
    void lapsedStatusWithoutExecutiveStillNeedsDecision() {
        Tender t = undecided("T1");
        t.setStatus("Lapsed (Unreviewed)");
        assertEquals(List.of(DECIDE), keys(t));
    }

    @Test
    void closedTendersWaitOnNobody() {
        for (String status : List.of("Not Participating", "Awarded", "Won", "Not Awarded", "Lost", "Missed Opportunity")) {
            Tender t = undecided("T1");
            t.setStatus(status);
            assertTrue(keys(t).isEmpty(), status);
        }
        Tender unable = assigned("T2", "executive");
        unable.setCurrentStage("UNABLE_TO_SUBMIT");
        assertTrue(keys(unable).isEmpty());
    }

    @Test
    void assignedTenderWaitsOnExecutiveForSpec() {
        List<PendingWork> works = PendingWorkResolver.resolve(assigned("T1", "executive"), null, Map.of());
        assertEquals(1, works.size());
        assertEquals(SPEC_PREP, works.get(0).key());
        assertEquals(List.of("executive"), works.get(0).preferredOwners());
    }

    @Test
    void legacyNewStageWithExecutiveCountsAsSpecPrep() {
        Tender t = assigned("T1", "executive");
        t.setCurrentStage("NEW");
        assertEquals(List.of(SPEC_PREP), keys(t));
    }

    @Test
    void rejectedSpecGoesBackToExecutive() {
        Tender t = assigned("T1", "executive");
        t.setSpecVerificationStatus("Rejected");
        assertEquals(List.of(SPEC_PREP), keys(t));
    }

    @Test
    void sentSpecWaitsOnClearanceAndNamesTheChosenReviewerFirst() {
        Tender t = assigned("T1", "executive");
        t.setSpecVerificationStatus("Pending");
        t.setAssignedMisMemberSpec("clearance");
        TenderApprovalRequest req = pending("T1", TenderWorkflowStage.SPEC_CLEARANCE, "Clearance Team", LocalDateTime.now());
        List<PendingWork> works = PendingWorkResolver.resolve(t, null, Map.of(TenderWorkflowStage.SPEC_CLEARANCE, req));
        assertEquals(SPEC_REVIEW, works.get(0).key());
        assertEquals(List.of("Clearance Team", "clearance"), works.get(0).preferredOwners());
    }

    @Test
    void approvedSpecWithoutBidPackageWaitsOnExecutive() {
        Tender t = assigned("T1", "executive");
        t.setSpecVerificationStatus("Approved");
        t.setCurrentStage("BID_DOCS_PREPARATION");
        assertEquals(List.of(BID_DOCS), keys(t));
    }

    @Test
    void finalSpecFileAloneCountsAsApproved() {
        Tender t = assigned("T1", "executive");
        t.setFinalTechSpecFilename("spec.docx");
        t.setCurrentStage("BID_DOCS_PREPARATION");
        assertEquals(List.of(BID_DOCS), keys(t));
    }

    @Test
    void generatedPackageDetectedFromDownloadedDocs() {
        Tender t = assigned("T1", "executive");
        t.setSpecVerificationStatus("Approved");
        t.setCurrentStage("BID_DOCS_PREPARATION");
        t.setDownloadedDocs("a.pdf, bid_documents_2026.zip");
        assertEquals(List.of(EMD_ENTRY), keys(t));
    }

    @Test
    void emdNotEnteredWaitsOnExecutive_evenAtPaymentApprovalStage() {
        Tender t = atEmd("T1", "executive");
        t.setCurrentStage("PAYMENT_APPROVAL");
        // The workflow-state row defaults emd_status to PENDING; that must not be read as "awaiting approval".
        TenderWorkflowState s = new TenderWorkflowState("T1");
        s.setEmdStatus("PENDING");
        assertEquals(List.of(EMD_ENTRY), keys(t, s, Map.of()));
    }

    @Test
    void enteredEmdWaitsOnMis() {
        Tender t = atEmd("T1", "executive");
        t.setPaymentStatus("Pending");
        t.setAssignedMisMemberEmd("mis2");
        List<PendingWork> works = PendingWorkResolver.resolve(t, null, Map.of());
        assertEquals(EMD_APPROVE, works.get(0).key());
        assertEquals(List.of("mis2"), works.get(0).preferredOwners());
    }

    @Test
    void rejectedEmdGoesBackToExecutive() {
        Tender t = atEmd("T1", "executive");
        t.setPaymentStatus("Rejected");
        assertEquals(List.of(EMD_ENTRY), keys(t));
    }

    @Test
    void exemptEmdSkipsToDualTrack() {
        Tender t = atEmd("T1", "executive");
        t.setEmdApplicable(null);
        t.setEmdRaw("Exempted for MSE");
        assertEquals(List.of(PRICE_ROUTE, DOC_VERIFY), keys(t));
    }

    @Test
    void dualTrackWithNoRouteWaitsOnExecutiveAndMisAtOnce() {
        assertEquals(List.of(PRICE_ROUTE, DOC_VERIFY), keys(atDualTrack("T1", "executive")));
    }

    @Test
    void dualTrackRoutedToTpc() {
        Tender t = atDualTrack("T1", "executive");
        t.setPricingRoute("TPC");
        t.setCurrentStage("TPC_PRICING");
        assertEquals(List.of(TPC_PRICE, DOC_VERIFY), keys(t));
    }

    @Test
    void tpcPriceEnteredMovesPricingToMisEvenThoughRouteStillSaysTpc() {
        Tender t = atDualTrack("T1", "executive");
        t.setPricingRoute("TPC");
        t.setTpcPurchasePrice(1000.0);
        t.setVerificationStatus("Approved");
        assertEquals(List.of(MIS_PRICE), keys(t));
    }

    @Test
    void trackStatusesFromWorkflowStateAreUsed() {
        Tender t = atDualTrack("T1", "executive");
        TenderWorkflowState s = new TenderWorkflowState("T1");
        s.setTrackAPricingStatus("MIS_PENDING");
        s.setTrackBDocStatus("CHANGES_REQUESTED");
        assertEquals(List.of(MIS_PRICE, DOC_FIX), keys(t, s, Map.of()));
    }

    @Test
    void rejectedDocumentsGoBackToExecutive() {
        Tender t = atDualTrack("T1", "executive");
        t.setMisFinalPrice(5000.0);
        t.setVerificationStatus("Rejected");
        assertEquals(List.of(DOC_FIX), keys(t));
    }

    @Test
    void bothTracksDoneWaitsOnExecutiveToSubmit() {
        Tender t = atDualTrack("T1", "executive");
        t.setMisFinalPrice(5000.0);
        t.setVerificationStatus("Approved");
        t.setCurrentStage("SUBMISSION_READY");
        assertEquals(List.of(SUBMIT), keys(t));
    }

    @Test
    void filedTenderWaitsOnMisConfirmationOnly() {
        Tender t = atDualTrack("T1", "executive");
        t.setMisFinalPrice(5000.0);
        t.setVerificationStatus("Approved");
        t.setStatus("Submitted");
        t.setSubmissionStatus("Pending");
        assertTrue(PendingWorkResolver.isSubmitted(t));
        assertEquals(List.of(SUBMIT_CONFIRM), keys(t));
    }

    @Test
    void confirmedOrOutcomeStagesWaitOnNobody() {
        Tender confirmed = atDualTrack("T1", "executive");
        confirmed.setStatus("Submitted");
        confirmed.setSubmissionStatus("Approved");
        assertTrue(keys(confirmed).isEmpty());

        Tender winLoss = atDualTrack("T2", "executive");
        winLoss.setCurrentStage("WIN_LOSS_PENDING");
        assertTrue(keys(winLoss).isEmpty(), "Win/Loss recording is not mailed");
    }
}
