package com.tenderpocket.config;

import java.util.*;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** API permissions from the README matrix, including the established legacy role aliases. */
public final class WorkflowPermissions {
    private WorkflowPermissions() {}
    public enum Action {
        VIEW_TENDERS, UPLOAD_SPEC, APPROVE_SPEC, SET_TPC_PRICE, VIEW_TPC_PRICE, SET_MIS_PRICE,
        GENERATE_BIDS, REVIEW_BIDS, RECORD_PAYMENT, RECORD_SUBMISSION, RECORD_OUTCOME, MANAGE_USERS, VIEW_AUDIT
    }

    public static String canonicalRole(String role) {
        if (role == null) return "";
        return switch (role.replaceFirst("(?i)^ROLE_", "").replace('_', ' ').trim().toUpperCase(Locale.ROOT)) {
            case "ADMIN" -> "Admin";
            case "EXECUTIVE", "MIS EXECUTIVE", "TENDER EXECUTIVE" -> "Tender Executive";
            case "SPECIFICATION TEAM", "CLEARANCE TEAM" -> "Clearance Team";
            case "TPC TEAM", "TPC PRICING TEAM" -> "TPC Pricing Team";
            case "MIS TEAM" -> "MIS Team";
            default -> "";
        };
    }

    public static String role() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getName())) return "";
        return auth.getAuthorities().stream().map(a -> canonicalRole(a.getAuthority()))
                .filter(r -> !r.isEmpty()).findFirst().orElse("");
    }

    public static String username() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth == null ? "" : auth.getName();
    }

    public static boolean allowed(Action action) { return allowed(role(), action); }
    public static boolean allowed(String role, Action action) {
        String canonical = canonicalRole(role);
        if (canonical.isEmpty() || action == null) return false;
        if (action == Action.VIEW_TENDERS) return true;
        return switch (action) {
            case UPLOAD_SPEC, GENERATE_BIDS -> canonical.equals("Tender Executive");
            case APPROVE_SPEC -> canonical.equals("Clearance Team");
            case SET_TPC_PRICE -> canonical.equals("TPC Pricing Team");
            case VIEW_TPC_PRICE -> canonical.equals("TPC Pricing Team") || canonical.equals("MIS Team") || canonical.equals("Admin");
            case SET_MIS_PRICE -> canonical.equals("MIS Team") || canonical.equals("Admin");
            case MANAGE_USERS, VIEW_AUDIT -> canonical.equals("Admin");
            case REVIEW_BIDS, RECORD_PAYMENT, RECORD_SUBMISSION, RECORD_OUTCOME -> canonical.equals("MIS Team");
            default -> false;
        };
    }

    public static Action reviewAction(String stage) {
        if (stage == null) return null;
        return switch (stage) {
            case "SPEC_CLEARANCE" -> Action.APPROVE_SPEC;
            case "TPC_PRICING" -> Action.SET_TPC_PRICE;
            case "MIS_PRICING" -> Action.SET_MIS_PRICE;
            case "DOC_VERIFICATION" -> Action.REVIEW_BIDS;
            case "PAYMENT_APPROVAL", "PAYMENT_PENDING" -> Action.RECORD_PAYMENT;
            case "SUBMISSION_PENDING" -> Action.RECORD_SUBMISSION;
            case "WIN_LOSS_PENDING" -> Action.RECORD_OUTCOME;
            default -> null;
        };
    }

    public static ResponseEntity<?> denied() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("success", false, "error", "Access denied for this workflow action."));
    }

    public static boolean allowedPatch(Map<String, Object> body, String currentStage) {
        Map<String, Action> fields = Map.ofEntries(
            Map.entry("tpc_purchase_price", Action.SET_TPC_PRICE),
            Map.entry("mis_final_price", Action.SET_MIS_PRICE),
            Map.entry("verification_status", Action.REVIEW_BIDS),
            Map.entry("payment_status", Action.RECORD_PAYMENT),
            Map.entry("emd_amount_actual", Action.RECORD_PAYMENT),
            Map.entry("emd_payment_mode", Action.RECORD_PAYMENT),
            Map.entry("emd_payment_ref", Action.RECORD_PAYMENT),
            Map.entry("emd_payment_date", Action.RECORD_PAYMENT),
            Map.entry("assigned_mis_member_emd", Action.RECORD_PAYMENT),
            Map.entry("submission_status", Action.RECORD_SUBMISSION),
            Map.entry("assigned_mis_member_submission", Action.RECORD_SUBMISSION),
            Map.entry("outcome_status", Action.RECORD_OUTCOME),
            Map.entry("loss_reason", Action.RECORD_OUTCOME));
        for (var field : fields.entrySet()) if (body.containsKey(field.getKey()) && !allowed(field.getValue())) return false;
        if (body.containsKey("spec_verification_status") && !allowed(
                List.of("Approved", "Rejected").contains(String.valueOf(body.get("spec_verification_status")))
                ? Action.APPROVE_SPEC : Action.UPLOAD_SPEC)) return false;
        if (body.containsKey("current_stage") && !Objects.equals(currentStage, body.get("current_stage"))
                && !role().equals("Admin")) return false;
        String status = String.valueOf(body.get("status"));
        if (List.of("Won", "Lost", "Awarded", "Not Awarded", "Disqualified", "Missed Opportunity").contains(status)
                && !allowed(Action.RECORD_OUTCOME)) return false;
        return !List.of("Submitted", "Filed").contains(status) || allowed(Action.RECORD_SUBMISSION);
    }
}
