package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.models.User;

import java.time.LocalDateTime;
import java.util.List;

/** Small builders shared by the notification tests. */
final class NotifyTestData {

    private NotifyTestData() {}

    static Tender undecided(String id) {
        Tender t = new Tender();
        t.setId(id);
        t.setTitle("Tender " + id);
        t.setRefNo("REF-" + id);
        t.setAuthority("Test Authority");
        t.setStatus("Issued");
        t.setCurrentStage("NEW");
        return t;
    }

    /** Participating, executive assigned, stage SPEC_CLEARANCE, spec not sent yet. */
    static Tender assigned(String id, String executive) {
        Tender t = undecided(id);
        t.setStatus("Participating");
        t.setMisExecutive(executive);
        t.setCurrentStage("SPEC_CLEARANCE");
        return t;
    }

    /** Spec approved and bid package generated: next is EMD. */
    static Tender atEmd(String id, String executive) {
        Tender t = assigned(id, executive);
        t.setSpecVerificationStatus("Approved");
        t.setWorkingPath("/docs/" + id);
        t.setCurrentStage("EMD_PAYMENT");
        return t;
    }

    /** In dual track with nothing done on either track. */
    static Tender atDualTrack(String id, String executive) {
        Tender t = atEmd(id, executive);
        t.setPaymentStatus("Approved");
        t.setCurrentStage("DUAL_TRACK");
        return t;
    }

    static TenderApprovalRequest pending(String tenderId, TenderWorkflowStage stage, String assignedTo, LocalDateTime created) {
        TenderApprovalRequest r = new TenderApprovalRequest(tenderId, stage, "someone", assignedTo, "PENDING");
        r.setCreatedAt(created);
        r.setUpdatedAt(created);
        return r;
    }

    static List<User> standardUsers() {
        return List.of(
                new User("admin", "x", "Admin", "admin@example.com"),
                new User("misteam", "x", "MIS Team", "mis@example.com"),
                new User("mis2", "x", "MIS Team", "mis2@example.com"),
                new User("executive", "x", "Tender Executive", "exec@example.com"),
                new User("exec2", "x", "Tender Executive", "exec2@example.com"),
                new User("clearance", "x", "Clearance Team", "clr@example.com"),
                new User("tpc", "x", "TPC Team", "tpc@example.com"));
    }

    static RecipientDirectory directory() {
        return new RecipientDirectory(standardUsers(), u -> "");
    }
}
