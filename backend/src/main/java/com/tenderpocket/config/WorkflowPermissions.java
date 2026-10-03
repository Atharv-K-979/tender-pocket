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
            case "EXECUTIVE", "TENDER EXECUTIVE" -> "Tender Executive";
            case "SPECIFICATION TEAM", "CLEARANCE TEAM", "CLEARANCE", "SPECIFICATION" -> "Clearance Team";
            case "TPC TEAM", "TPC PRICING TEAM", "TPC", "TPC PRICING" -> "TPC Pricing Team";
            case "MIS EXECUTIVE", "MIS TEAM", "MISTEAM", "MIS" -> "MIS Team";
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
        if (action == Action.VIEW_TENDERS || "Admin".equals(canonical)) return true;
        return switch (action) {
            case UPLOAD_SPEC, GENERATE_BIDS -> canonical.equals("Tender Executive");
            case APPROVE_SPEC -> canonical.equals("Clearance Team");
            case SET_TPC_PRICE -> canonical.equals("TPC Pricing Team");
            case VIEW_TPC_PRICE -> canonical.equals("TPC Pricing Team") || canonical.equals("MIS Team");
            case SET_MIS_PRICE -> canonical.equals("MIS Team");
            case MANAGE_USERS, VIEW_AUDIT -> true;
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
        String canonical = canonicalRole(role());
        if (canonical.isEmpty()) return false;
        if ("Admin".equals(canonical)) return true;

        boolean isExec = "Tender Executive".equals(canonical);
        boolean isMis = "MIS Team".equals(canonical);

        if (body.containsKey("verification_status")) {
            String val = String.valueOf(body.get("verification_status"));
            if (List.of("Approved", "Rejected").contains(val) && !isMis) return false;
            if ("Pending".equals(val) && !isExec) return false;
        }

        if (body.containsKey("payment_status")) {
            String val = String.valueOf(body.get("payment_status"));
            if (List.of("Approved", "Rejected").contains(val) && !isMis) return false;
            if ("Pending".equals(val) && !isExec) return false;
        }

        for (String emdField : List.of("emd_amount_actual", "emd_payment_mode", "emd_payment_ref", "emd_payment_date", "assigned_mis_member_emd", "assigned_mis_member", "assigned_mis_member_docs", "assigned_mis_member_submission", "working_path")) {
            if (body.containsKey(emdField) && !isExec) return false;
        }

        if (body.containsKey("submission_status")) {
            String val = String.valueOf(body.get("submission_status"));
            if (List.of("Approved", "Rejected").contains(val) && !isMis) return false;
            if ("Pending".equals(val) && !isExec) return false;
        }

        if (body.containsKey("tpc_purchase_price") && !"TPC Pricing Team".equals(canonical)) return false;
        if (body.containsKey("mis_final_price") && !isMis) return false;
        if ((body.containsKey("outcome_status") || body.containsKey("loss_reason")) && !isMis) return false;

        if (body.containsKey("spec_verification_status") && !allowed(
                List.of("Approved", "Rejected").contains(String.valueOf(body.get("spec_verification_status")))
                ? Action.APPROVE_SPEC : Action.UPLOAD_SPEC)) return false;

        String status = String.valueOf(body.get("status"));
        if (List.of("Won", "Lost", "Awarded", "Not Awarded", "Disqualified", "Missed Opportunity").contains(status)
                && !isMis) return false;
        if (List.of("Submitted", "Filed").contains(status) && !isMis && !isExec) return false;

        return true;
    }
}
