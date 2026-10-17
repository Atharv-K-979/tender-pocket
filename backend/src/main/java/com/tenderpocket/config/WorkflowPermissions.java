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
            case "EXECUTIVE", "TENDER EXECUTIVE", "MIS EXECUTIVE" -> "Tender Executive";
            case "SPECIFICATION TEAM", "CLEARANCE TEAM", "CLEARANCE", "SPECIFICATION" -> "Clearance Team";
            case "TPC TEAM", "TPC PRICING TEAM", "TPC", "TPC PRICING" -> "TPC Pricing Team";
            case "MIS TEAM", "MISTEAM", "MIS" -> "MIS Team";
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
        if ("Admin".equals(canonical)) {
            return switch (action) {
                case VIEW_TPC_PRICE, SET_MIS_PRICE, MANAGE_USERS, VIEW_AUDIT -> true;
                default -> false;
            };
        }
        return switch (action) {
            case UPLOAD_SPEC, GENERATE_BIDS -> canonical.equals("Tender Executive");
            case APPROVE_SPEC -> canonical.equals("Clearance Team");
            case SET_TPC_PRICE -> canonical.equals("TPC Pricing Team");
            case VIEW_TPC_PRICE -> canonical.equals("TPC Pricing Team") || canonical.equals("MIS Team");
            case SET_MIS_PRICE -> canonical.equals("MIS Team");
            case MANAGE_USERS, VIEW_AUDIT -> false;
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

    private static boolean hasAnyKey(Map<String, Object> body, String... keys) {
        if (body == null || keys == null) return false;
        for (String k : keys) {
            if (body.containsKey(k)) return true;
        }
        return false;
    }

    private static Object getAnyVal(Map<String, Object> body, String... keys) {
        if (body == null || keys == null) return null;
        for (String k : keys) {
            if (body.containsKey(k)) return body.get(k);
        }
        return null;
    }

    public static boolean allowedPatch(Map<String, Object> body, String currentStage) {
        return allowedPatch(body, currentStage, role());
    }

    public static boolean allowedPatch(Map<String, Object> body, String currentStage, String role) {
        String canonical = canonicalRole(role);
        if (canonical.isEmpty()) return false;

        boolean isAdmin = "Admin".equals(canonical);
        boolean isExec = "Tender Executive".equals(canonical);
        boolean isMis = "MIS Team".equals(canonical);
        boolean isClearance = "Clearance Team".equals(canonical);
        boolean isTpc = "TPC Pricing Team".equals(canonical);

        // Admin may view management data and edit specifications, but cannot alter operational workflow stages, participation decisions, or approvals
        if (isAdmin) {
            if (hasAnyKey(body, "status", "current_stage", "currentStage", "spec_verification_status", "specVerificationStatus",
                    "verification_status", "verificationStatus", "payment_status", "paymentStatus", "submission_status", "submissionStatus",
                    "outcome_status", "outcomeStatus", "tpc_purchase_price", "tpcPurchasePrice")) {
                return false;
            }
        }

        // TPC confidential purchase price: only TPC Pricing Team
        if (hasAnyKey(body, "tpc_purchase_price", "tpcPurchasePrice") && !isTpc) {
            return false;
        }

        // MIS final price: only MIS Team or Admin
        if (hasAnyKey(body, "mis_final_price", "misFinalPrice") && !isMis && !isAdmin) {
            return false;
        }

        // Document verification status
        if (hasAnyKey(body, "verification_status", "verificationStatus")) {
            String val = String.valueOf(getAnyVal(body, "verification_status", "verificationStatus"));
            if (List.of("Approved", "Rejected").contains(val) && !isMis) return false;
            if ("Pending".equals(val) && !isExec) return false;
            if (!List.of("Approved", "Rejected", "Pending", "None").contains(val) && !isMis) return false;
        }

        // Payment status
        if (hasAnyKey(body, "payment_status", "paymentStatus")) {
            String val = String.valueOf(getAnyVal(body, "payment_status", "paymentStatus"));
            if (List.of("Approved", "Rejected").contains(val) && !isMis) return false;
            if ("Pending".equals(val) && !isExec) return false;
            if (!List.of("Approved", "Rejected", "Pending", "None").contains(val) && !isMis) return false;
        }

        // EMD payment and execution details: only Executive or MIS
        for (String emdField : List.of("emd_amount_actual", "emdAmountActual", "emd_payment_mode", "emdPaymentMode",
                "emd_payment_ref", "emdPaymentRef", "emd_payment_date", "emdPaymentDate",
                "working_path", "workingPath", "downloaded_docs", "downloadedDocs")) {
            if (body.containsKey(emdField) && !isExec && !isMis) return false;
        }

        // Assignment fields: only MIS Team or Admin
        for (String assignField : List.of("mis_executive", "misExecutive", "assigned_mis_member", "assignedMisMember",
                "assigned_mis_member_docs", "assignedMisMemberDocs", "assigned_mis_member_emd", "assignedMisMemberEmd",
                "assigned_mis_member_submission", "assignedMisMemberSubmission", "assigned_mis_member_spec", "assignedMisMemberSpec")) {
            if (body.containsKey(assignField) && !isMis && !isAdmin) return false;
        }

        // Submission status
        if (hasAnyKey(body, "submission_status", "submissionStatus")) {
            String val = String.valueOf(getAnyVal(body, "submission_status", "submissionStatus"));
            if (List.of("Approved", "Rejected").contains(val) && !isMis) return false;
            if ("Pending".equals(val) && !isExec) return false;
            if (!List.of("Approved", "Rejected", "Pending", "None").contains(val) && !isMis) return false;
        }

        // Final outcome and loss reason
        if (hasAnyKey(body, "outcome_status", "outcomeStatus", "loss_reason", "lossReason") && !isMis) {
            return false;
        }

        // Specification clearance verification
        if (hasAnyKey(body, "spec_verification_status", "specVerificationStatus")) {
            String val = String.valueOf(getAnyVal(body, "spec_verification_status", "specVerificationStatus"));
            if (List.of("Approved", "Rejected").contains(val) && !isClearance) return false;
            if ("Pending".equals(val) && !isExec) return false;
            if (!List.of("Approved", "Rejected", "Pending", "None").contains(val) && !isClearance) return false;
        }

        // Current stage
        if (hasAnyKey(body, "current_stage", "currentStage")) {
            String newStage = String.valueOf(getAnyVal(body, "current_stage", "currentStage")).toUpperCase(Locale.ROOT);
            if (List.of("WON", "LOST", "WIN_LOSS_PENDING").contains(newStage) && !isMis) return false;
            if ("DOC_VERIFICATION".equals(newStage) && !isExec && !isMis) return false;
            if ("TPC_PRICING".equals(newStage) && !isClearance && !isExec && !isMis) return false;
            if ("MIS_PRICING".equals(newStage) && !isTpc && !isMis) return false;
            if ("PAYMENT_APPROVAL".equals(newStage) && !isMis && !isExec) return false;
        }

        // Tender overall status
        if (hasAnyKey(body, "status") && getAnyVal(body, "status") != null) {
            String status = String.valueOf(getAnyVal(body, "status"));
            if (List.of("Won", "Lost", "Awarded", "Not Awarded", "Disqualified", "Missed Opportunity").contains(status) && !isMis) return false;
            if (List.of("Participating", "Not Participating").contains(status) && !isMis) return false;
            if (List.of("Submitted", "Filed").contains(status) && !isMis && !isExec) return false;
        }

        return true;
    }
}
