package com.tenderpocket.controllers;
import com.tenderpocket.config.WorkflowPermissions;
import static com.tenderpocket.config.WorkflowPermissions.Action.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tenderpocket.models.ActivityLog;
import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.repositories.ActivityLogRepository;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.services.DocumentGeneratorService;
import com.tenderpocket.services.ComplianceProgressService;
import com.tenderpocket.services.ComplianceConversionMetrics;
import com.tenderpocket.services.AISpecificationIntelligenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;

@RestController
@RequestMapping("/api/tenders")
public class TenderController {

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private com.tenderpocket.repositories.TenderApprovalRepository approvalRepository;

    @Autowired
    private com.tenderpocket.repositories.TenderWorkflowCommentRepository commentRepository;

    @Autowired
    private ActivityLogRepository activityLogRepository;

    @Autowired
    private com.tenderpocket.repositories.StatusHistoryRepository statusHistoryRepository;

    @Autowired
    private DocumentGeneratorService documentGeneratorService;

    @Autowired
    private ComplianceProgressService complianceProgressService;

    @Autowired
    private com.tenderpocket.services.GeMScraperService geMScraperService;

    @Autowired
    private com.tenderpocket.services.EmailSyncService emailSyncService;

    @Autowired
    private com.tenderpocket.services.EmailNotificationService emailNotificationService;

    @Value("${gemini.api.key}")
    private String geminiApiKey;

    private final ObjectMapper mapper = new ObjectMapper();
 
    /**
     * Resolves user role with defense-in-depth:
     * 1. Checks SecurityContextHolder (populated from verified JWT by JwtRequestFilter)
     * 2. Falls back to request header for legacy same-origin internal calls
     */
    private String resolveUserRole(String headerRole) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getName())) {
            String jwtRole = auth.getAuthorities().stream()
                    .map(GrantedAuthority::getAuthority)
                    .findFirst()
                    .map(r -> r.replace("ROLE_", "").replace("_", " "))
                    .orElse(null);
            if (jwtRole != null && !jwtRole.isBlank()) {
                return jwtRole;
            }
        }
        return (headerRole != null && !headerRole.isBlank()) ? headerRole : "Admin";
    }

    private String resolveUsername(String headerUsername) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.isAuthenticated() && !"anonymousUser".equals(auth.getName())) {
            String name = auth.getName();
            if (name != null && !name.isBlank()) {
                return name;
            }
        }
        return (headerUsername != null && !headerUsername.isBlank()) ? headerUsername : "admin";
    }

    @PostMapping("/sync-gem")
    public ResponseEntity<?> syncGeM(@RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String userRole) {
        userRole = resolveUserRole(userRole);
        if (!"Admin".equalsIgnoreCase(userRole) && !"MIS Team".equalsIgnoreCase(userRole) && !"MIS Executive".equalsIgnoreCase(userRole) && !"Tender Executive".equalsIgnoreCase(userRole)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: Admin, MIS Team, or Executive only"));
        }
        try {
            System.out.println("[API Trigger] Initiating manual GeM sync in background...");
            java.util.concurrent.CompletableFuture.runAsync(() -> {
                try {
                    geMScraperService.syncTenders(true, Collections.emptyList());
                } catch (Exception e) {
                    System.err.println("Background manual GeM sync failed: " + e.getMessage());
                }
            });
            return ResponseEntity.ok(Map.of("success", true, "message", "GeM synchronization started in the background. It will process in parallel."));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("success", false, "error", "Failed to start GeM sync: " + e.getMessage()));
        }
    }

    @PostMapping("/sync-emails")
    public ResponseEntity<?> syncEmails(@RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String userRole) {
        userRole = resolveUserRole(userRole);
        if (!"Admin".equalsIgnoreCase(userRole) && !"MIS Team".equalsIgnoreCase(userRole) && !"MIS Executive".equalsIgnoreCase(userRole) && !"Tender Executive".equalsIgnoreCase(userRole)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("success", false, "error", "Access denied: Admin, MIS Team, or Executive only"));
        }
        try {
            System.out.println("[API Trigger] Initiating manual Email sync in background...");
            java.util.concurrent.CompletableFuture.runAsync(() -> {
                try {
                    emailSyncService.syncEmails();
                } catch (Exception e) {
                    System.out.println("[API Trigger] Email sync skipped or unconfigured: " + e.getMessage());
                }
            });
            return ResponseEntity.ok(Map.of("success", true, "message", "Email sync started in the background.", "importedCount", 0));
        } catch (Exception e) {
            System.out.println("[API Trigger] Email sync skipped or unconfigured: " + e.getMessage());
            return ResponseEntity.ok(Map.of("success", true, "message", "Email sync skipped: " + e.getMessage(), "importedCount", 0));
        }
    }

    @PostMapping("/trigger-due-alerts")
    public ResponseEntity<?> triggerDueAlerts() {
        try {
            System.out.println("[API Trigger] Initiating manual due-date email alerts...");
            emailNotificationService.sendDueDateAlerts();
            return ResponseEntity.ok(Map.of("success", true, "message", "Manual due-date alerts triggered successfully."));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("success", false, "error", "Trigger failed: " + e.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<?> getTenders(
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String userRole,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "admin") String username,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "location", required = false) String location,
            @RequestParam(value = "sector", required = false) String sector,
            @RequestParam(value = "mis_executive", required = false) String misExecutive) {

        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        userRole = WorkflowPermissions.role();
        username = WorkflowPermissions.username();
        List<Tender> list = tenderRepository.findAll();
        List<Tender> filtered = new ArrayList<>();

        String todayIST = java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Kolkata")).toLocalDate().toString();

        for (Tender t : list) {
            // Apply role restriction
            if (("MIS Executive".equalsIgnoreCase(userRole) || "Tender Executive".equalsIgnoreCase(userRole)) && !username.equalsIgnoreCase(t.getMisExecutive())) {
                continue;
            }
            if (("Clearance Team".equalsIgnoreCase(userRole) || "Specification Team".equalsIgnoreCase(userRole))) {
                boolean match = username.equalsIgnoreCase(t.getAssignedMisMemberSpec())
                        || "clearance".equalsIgnoreCase(t.getAssignedMisMemberSpec())
                        || "Clearance Team".equalsIgnoreCase(t.getAssignedMisMemberSpec())
                        || "SPEC_CLEARANCE".equalsIgnoreCase(t.getCurrentStage());
                if (!match) continue;
            }
            if (misExecutive != null && !misExecutive.isEmpty() && !misExecutive.equalsIgnoreCase(t.getMisExecutive())) {
                continue;
            }

            // Resolve dynamic status
            String resolvedStatus = resolveStatus(t, todayIST);
            t.setStatus(resolvedStatus);

            // Filter by search query
            if (search != null && !search.isEmpty()) {
                String q = search.toLowerCase();
                boolean matches = (t.getTitle() != null && t.getTitle().toLowerCase().contains(q))
                        || (t.getId() != null && t.getId().toLowerCase().contains(q))
                        || (t.getRefNo() != null && t.getRefNo().toLowerCase().contains(q))
                        || (t.getAuthority() != null && t.getAuthority().toLowerCase().contains(q))
                        || (t.getSourceId() != null && t.getSourceId().toLowerCase().contains(q));
                if (!matches) continue;
            }

            // Filter by status or urgency
            if (status != null && !status.isEmpty()) {
                if ("Pending".equalsIgnoreCase(status) || "Approved".equalsIgnoreCase(status) || "Rejected".equalsIgnoreCase(status)) {
                    if (!status.equalsIgnoreCase(t.getSpecVerificationStatus())) {
                        continue;
                    }
                } else if ("Missed".equalsIgnoreCase(status)) {
                    if (!"Missed Deadline".equalsIgnoreCase(resolvedStatus)
                            && !"Missed Opportunity".equalsIgnoreCase(resolvedStatus)
                            && !"Lapsed".equalsIgnoreCase(resolvedStatus)) {
                        continue;
                    }
                } else if ("T2".equalsIgnoreCase(status) || "Due Today".equalsIgnoreCase(status)) {
                    boolean isDueToday = t.getDueDate() != null && t.getDueDate().startsWith(todayIST);
                    if (!isDueToday) {
                        continue;
                    }
                } else if ("T2-3 days".equalsIgnoreCase(status) || "Due in 3 Days".equalsIgnoreCase(status)) {
                    boolean isDueSoon = false;
                    if (t.getDueDate() != null && !t.getDueDate().isEmpty()) {
                        try {
                            String dueStr = t.getDueDate().split(" ")[0];
                            LocalDate due = LocalDate.parse(dueStr);
                            LocalDate todayDate = LocalDate.parse(todayIST);
                            long days = ChronoUnit.DAYS.between(todayDate, due);
                            if (days >= 1 && days <= 3) {
                                isDueSoon = true;
                            }
                        } catch (Exception e) {}
                    }
                    if (!isDueSoon) {
                        continue;
                    }
                } else if (!status.equalsIgnoreCase(resolvedStatus)) {
                    continue;
                }
            }

            // Filter by location
            if (location != null && !location.isEmpty() && !location.equalsIgnoreCase(t.getLocation())) {
                continue;
            }

            // Filter by sector
            if (sector != null && !sector.isEmpty() && !sector.equalsIgnoreCase(t.getSector())) {
                continue;
            }

            filtered.add(t);
        }

        // Sort by scraped_at DESC by default
        filtered.sort((a, b) -> {
            String sa = a.getScrapedAt() != null ? a.getScrapedAt() : "";
            String sb = b.getScrapedAt() != null ? b.getScrapedAt() : "";
            return sb.compareTo(sa);
        });

        // Get filter options
        List<String> locations = ("MIS Executive".equalsIgnoreCase(userRole) || "Tender Executive".equalsIgnoreCase(userRole))
                ? tenderRepository.findUniqueLocationsByExecutive(username)
                : "Specification Team".equalsIgnoreCase(userRole)
                ? tenderRepository.findUniqueLocationsBySpecMember(username)
                : tenderRepository.findUniqueLocations();
        List<String> sectors = ("MIS Executive".equalsIgnoreCase(userRole) || "Tender Executive".equalsIgnoreCase(userRole))
                ? tenderRepository.findUniqueSectorsByExecutive(username)
                : "Specification Team".equalsIgnoreCase(userRole)
                ? tenderRepository.findUniqueSectorsBySpecMember(username)
                : tenderRepository.findUniqueSectors();

        return ResponseEntity.ok(Map.of(
                "success", true,
                "tenders", filtered,
                "filters", Map.of("locations", locations, "sectors", sectors)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getTenderById(@PathVariable("id") String id) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        Optional<Tender> opt = tenderRepository.findById(id);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));
        }

        Tender tender = opt.get();
        String todayIST = LocalDate.now().toString();
        tender.setStatus(resolveStatus(tender, todayIST));

        // Generate Standard Summaries
        String detailsSummary = generateDetailsSummary(tender);
        String historySummary = "This tender is currently in state '" + tender.getStatus() + "'. No prior transitions recorded.";

        return ResponseEntity.ok(Map.of(
                "success", true,
                "tender", tender,
                "history", Collections.emptyList(),
                "summaries", Map.of("detailsSummary", detailsSummary, "statusHistorySummary", historySummary)
        ));
    }

    @PostMapping
    public ResponseEntity<?> createTender(
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String userRole,
            @RequestBody Tender tender) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        userRole = resolveUserRole(userRole);
        if (!WorkflowPermissions.role().equals("Admin") && (tender.getTpcPurchasePrice() != null
                || tender.getMisFinalPrice() != null
                || (tender.getCurrentStage() != null && !List.of("SPEC_CLEARANCE", "TECH_SPEC_PENDING").contains(tender.getCurrentStage()))
                || java.util.stream.Stream.of(tender.getSpecVerificationStatus(), tender.getVerificationStatus(),
                        tender.getPaymentStatus(), tender.getSubmissionStatus(), tender.getOutcomeStatus())
                    .anyMatch(value -> value != null && !value.isBlank() && !"None".equals(value)))) {
            return ResponseEntity.badRequest().body(Map.of("success", false,
                    "error", "Use the workflow endpoints to set approval state or pricing."));
        }
        if (!WorkflowPermissions.allowedPatch(Map.of("status", String.valueOf(tender.getStatus())), null))
            return WorkflowPermissions.denied();

        if (tender.getId() == null || tender.getTitle() == null || tender.getOriginalUrl() == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "id, title, and originalUrl are required"));
        }

        if (tenderRepository.existsById(tender.getId())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Tender already exists. Use its update endpoint."));
        }
        tender.setScrapedAt(new Date().toString());
        tenderRepository.save(tender);

        return ResponseEntity.ok(Map.of("success", true, "message", "Tender added successfully"));
    }

    @PatchMapping("/{id}")
    public ResponseEntity<?> updateTender(
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String userRole,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "admin") String username,
            @PathVariable("id") String id,
            @RequestBody Map<String, Object> body) {

        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        userRole = resolveUserRole(userRole);
        username = resolveUsername(username);


        Optional<Tender> opt = tenderRepository.findById(id);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));
        }

        Tender tender = opt.get();
        if (!WorkflowPermissions.allowedPatch(body, tender.getCurrentStage())) return WorkflowPermissions.denied();
        if (List.of("Generated", "Pending").contains(String.valueOf(body.get("spec_verification_status")))
                && !Objects.equals(body.get("spec_verification_status"), tender.getSpecVerificationStatus())) {
            return ResponseEntity.badRequest().body(Map.of("success", false,
                    "error", "Use the specification upload or clearance-request endpoint."));
        }
        List<String> logDetails = new ArrayList<>();

        if (body.containsKey("status")) {
            String oldStatus = tender.getStatus();
            String newStatus = (String) body.get("status");
            tender.setStatus(newStatus);
            logDetails.add("status changed from '" + oldStatus + "' to '" + newStatus + "'");

            if ("Awarded".equalsIgnoreCase(newStatus) || "Won".equalsIgnoreCase(newStatus)) {
                tender.setCurrentStage("WON");
                tender.setOutcomeStatus("Won");
                List<TenderApprovalRequest> pending = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tender.getId(), TenderWorkflowStage.WIN_LOSS_PENDING);
                for (TenderApprovalRequest r : pending) {
                    if ("PENDING".equalsIgnoreCase(r.getStatus())) {
                        r.setStatus("APPROVED");
                        r.setUpdatedAt(java.time.LocalDateTime.now());
                        approvalRepository.save(r);
                    }
                }
            } else if ("Not Awarded".equalsIgnoreCase(newStatus) || "Lost".equalsIgnoreCase(newStatus)) {
                tender.setCurrentStage("LOST");
                tender.setOutcomeStatus("Lost");
                List<TenderApprovalRequest> pending = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tender.getId(), TenderWorkflowStage.WIN_LOSS_PENDING);
                for (TenderApprovalRequest r : pending) {
                    if ("PENDING".equalsIgnoreCase(r.getStatus())) {
                        r.setStatus("APPROVED");
                        r.setUpdatedAt(java.time.LocalDateTime.now());
                        approvalRepository.save(r);
                    }
                }
            }

            try {
                String nowStr = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());
                statusHistoryRepository.save(new com.tenderpocket.models.StatusHistory(id, oldStatus, newStatus, username, nowStr));
            } catch (Exception e) {}
        }

        if (body.containsKey("notes")) {
            tender.setNotes((String) body.get("notes"));
            logDetails.add("notes updated");
        }

        if (body.containsKey("quoted_qty")) {
            tender.setQuotedQty((Integer) body.get("quoted_qty"));
        }

        if (body.containsKey("bid_qty")) {
            tender.setBidQty((Integer) body.get("bid_qty"));
        }

        if (body.containsKey("mis_executive")) {
            String newExec = (String) body.get("mis_executive");
            String currentStatus = tender.getStatus();
            tender.setMisExecutive(newExec);
            tender.setAssignedBy(newExec != null && !newExec.trim().isEmpty() ? username : null);
            tender.setAssignedAt(newExec != null && !newExec.trim().isEmpty() ? new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()) : null);

            // Auto-participate if currently New, Issued, or Lapsed
            if (newExec != null && !newExec.trim().isEmpty()) {
                if (currentStatus == null || "Issued".equalsIgnoreCase(currentStatus) || "New".equalsIgnoreCase(currentStatus) || "Lapsed".equalsIgnoreCase(currentStatus) || "Lapsed (Unreviewed)".equalsIgnoreCase(currentStatus)) {
                    tender.setStatus("Participating");
                    logDetails.add("status auto-changed to 'Participating' on executive assignment");
                }
            }
            logDetails.add(newExec != null && !newExec.trim().isEmpty() ? "assigned to executive '" + newExec + "'" : "unassigned executive");
        }

        if (body.containsKey("working_path") || body.containsKey("workingPath")) {
            String val = (String) (body.containsKey("working_path") ? body.get("working_path") : body.get("workingPath"));
            tender.setWorkingPath(val);
            logDetails.add("working path updated to '" + val + "'");
        }

        if (body.containsKey("assigned_mis_member") || body.containsKey("assignedMisMember")) {
            String val = (String) (body.containsKey("assigned_mis_member") ? body.get("assigned_mis_member") : body.get("assignedMisMember"));
            tender.setAssignedMisMember(val);
            logDetails.add("assigned MIS member updated to '" + val + "'");
        }

        if (body.containsKey("emd_amount_actual") || body.containsKey("emdAmountActual")) {
            Object rawVal = body.containsKey("emd_amount_actual") ? body.get("emd_amount_actual") : body.get("emdAmountActual");
            Double val = rawVal != null ? Double.valueOf(rawVal.toString()) : null;
            tender.setEmdAmountActual(val);
            logDetails.add("EMD actual amount updated to " + val);
        }

        if (body.containsKey("emd_payment_mode") || body.containsKey("emdPaymentMode")) {
            String val = (String) (body.containsKey("emd_payment_mode") ? body.get("emd_payment_mode") : body.get("emdPaymentMode"));
            tender.setEmdPaymentMode(val);
            logDetails.add("EMD payment mode updated to '" + val + "'");
        }

        if (body.containsKey("emd_payment_ref") || body.containsKey("emdPaymentRef")) {
            String val = (String) (body.containsKey("emd_payment_ref") ? body.get("emd_payment_ref") : body.get("emdPaymentRef"));
            tender.setEmdPaymentRef(val);
            logDetails.add("EMD payment ref updated to '" + val + "'");
        }

        if (body.containsKey("emd_payment_date") || body.containsKey("emdPaymentDate")) {
            String val = (String) (body.containsKey("emd_payment_date") ? body.get("emd_payment_date") : body.get("emdPaymentDate"));
            tender.setEmdPaymentDate(val);
            logDetails.add("EMD payment date updated to '" + val + "'");
        }

        if (body.containsKey("loss_reason") || body.containsKey("lossReason")) {
            String val = (String) (body.containsKey("loss_reason") ? body.get("loss_reason") : body.get("lossReason"));
            tender.setLossReason(val);
            logDetails.add("loss reason updated");
        }

        if (body.containsKey("payment_status") || body.containsKey("paymentStatus")) {
            String val = (String) (body.containsKey("payment_status") ? body.get("payment_status") : body.get("paymentStatus"));
            tender.setPaymentStatus(val);
            logDetails.add("payment status updated to '" + val + "'");
        }

        if (body.containsKey("verification_status") || body.containsKey("verificationStatus")) {
            String val = (String) (body.containsKey("verification_status") ? body.get("verification_status") : body.get("verificationStatus"));
            tender.setVerificationStatus(val);
            logDetails.add("verification status updated to '" + val + "'");
        }

        if (body.containsKey("submission_status") || body.containsKey("submissionStatus")) {
            String val = (String) (body.containsKey("submission_status") ? body.get("submission_status") : body.get("submissionStatus"));
            tender.setSubmissionStatus(val);
            logDetails.add("submission status updated to '" + val + "'");
        }

        if (body.containsKey("outcome_status") || body.containsKey("outcomeStatus")) {
            String val = (String) (body.containsKey("outcome_status") ? body.get("outcome_status") : body.get("outcomeStatus"));
            tender.setOutcomeStatus(val);
            logDetails.add("outcome status updated to '" + val + "'");
        }

        if (body.containsKey("spec_verification_status") || body.containsKey("specVerificationStatus")) {
            String val = (String) (body.containsKey("spec_verification_status") ? body.get("spec_verification_status") : body.get("specVerificationStatus"));
            tender.setSpecVerificationStatus(val);
            logDetails.add("spec verification status updated to '" + val + "'");
        }

        if (body.containsKey("assigned_mis_member_spec") || body.containsKey("assignedMisMemberSpec")) {
            String val = (String) (body.containsKey("assigned_mis_member_spec") ? body.get("assigned_mis_member_spec") : body.get("assignedMisMemberSpec"));
            tender.setAssignedMisMemberSpec(val);
            logDetails.add("assigned Specification Team member updated to '" + val + "'");
        }

        tender.setAiDetailsSummary(null);
        tender.setAiHistorySummary(null);
        tenderRepository.save(tender);

        // Audit Log
        ActivityLog log = new ActivityLog(
                username, userRole, "Updated Tender", id,
                new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()),
                String.join(", ", logDetails)
        );
        activityLogRepository.save(log);

        return ResponseEntity.ok(Map.of("success", true, "message", "Tender updated successfully"));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteTender(
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String userRole,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "admin") String username,
            @PathVariable("id") String id) {

        if (!WorkflowPermissions.role().equals("Admin") && !WorkflowPermissions.role().equals("MIS Team"))
            return WorkflowPermissions.denied();
        userRole = resolveUserRole(userRole);
        username = resolveUsername(username);

        Optional<Tender> opt = tenderRepository.findById(id);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));
        }

        Tender tender = opt.get();
        tenderRepository.deleteById(id);

        // Audit Log
        ActivityLog log = new ActivityLog(
                username, userRole, "Deleted Tender", null,
                new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()),
                "Deleted tender: " + tender.getTitle() + " (" + id + ")"
        );
        activityLogRepository.save(log);

        return ResponseEntity.ok(Map.of("success", true, "message", "Tender deleted successfully"));
    }

    @PostMapping("/{id}/generate-bid-docs")
    public ResponseEntity<?> generateBidDocs(
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String userRole,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "admin") String username,
            @PathVariable("id") String id,
            @RequestBody Map<String, String> body) {

        userRole = resolveUserRole(userRole);
        username = resolveUsername(username);


        if (!WorkflowPermissions.allowed(GENERATE_BIDS)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "success", false,
                    "error", "Access denied: Tender Executive or Admin required to generate bid documents."
            ));
        }

        Optional<Tender> opt = tenderRepository.findById(id);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));
        }

        Tender tender = opt.get();

        if (!isTechSpecProvided(tender)) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "success", false,
                    "error", "Technical Specification PDF must be provided/uploaded by the Tender Executive first before generating Bid Documents."
            ));
        }
        if (!"Approved".equals(tender.getSpecVerificationStatus()) || tender.getMisFinalPrice() == null
                || !Double.isFinite(tender.getMisFinalPrice()) || tender.getMisFinalPrice() <= 0) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false,
                    "error", "Specification clearance and finalized MIS pricing are required before generating bid documents."));
        }

        try {
            String docDir = "public/documents/" + id;
            Files.createDirectories(Paths.get(docDir));

            // Generate PDF
            byte[] pdfBytes = documentGeneratorService.generatePdf(body);
            String pdfFileName = "Bid_Documents_" + id + ".pdf";
            String pdfFilePath = docDir + "/" + pdfFileName;
            String pdfDownloadUrl = "/documents/" + id + "/" + pdfFileName;
            try (FileOutputStream fos = new FileOutputStream(pdfFilePath)) {
                fos.write(pdfBytes);
            }

            // Generate DOCX
            byte[] docxBytes = documentGeneratorService.generateDocx(body);
            String docFileName = "Bid_Documents_" + id + ".docx";
            String docFilePath = docDir + "/" + docFileName;
            String docDownloadUrl = "/documents/" + id + "/" + docFileName;
            try (FileOutputStream fos = new FileOutputStream(docFilePath)) {
                fos.write(docxBytes);
            }

            // Generate Technical Specification PDF
            byte[] techPdfBytes = documentGeneratorService.generateTechSpecPdf(body);
            String techPdfFileName = "Technical_Specification_Sheet_" + id + ".pdf";
            String techPdfFilePath = docDir + "/" + techPdfFileName;
            String techPdfDownloadUrl = "/documents/" + id + "/" + techPdfFileName;
            try (FileOutputStream fos = new FileOutputStream(techPdfFilePath)) {
                fos.write(techPdfBytes);
            }

            // Generate Technical Specification DOCX
            byte[] techDocxBytes = documentGeneratorService.generateTechSpecDocx(body);
            String techDocFileName = "Technical_Specification_Sheet_" + id + ".docx";
            String techDocFilePath = docDir + "/" + techDocFileName;
            String techDocDownloadUrl = "/documents/" + id + "/" + techDocFileName;
            try (FileOutputStream fos = new FileOutputStream(techDocFilePath)) {
                fos.write(techDocxBytes);
            }

            // Update downloaded_docs field metadata without overwriting existing files (e.g. GeM Bid PDF)
            String createdDate = LocalDate.now().toString();
            List<Map<String, String>> newDocs = List.of(
                    Map.of("name", "Generated Bid Documents (PDF)", "filename", pdfFileName, "local_path", pdfDownloadUrl, "created_date", createdDate),
                    Map.of("name", "Generated Bid Documents (Word DOCX)", "filename", docFileName, "local_path", docDownloadUrl, "created_date", createdDate),
                    Map.of("name", "Technical Specification Sheet (PDF)", "filename", techPdfFileName, "local_path", techPdfDownloadUrl, "created_date", createdDate),
                    Map.of("name", "Technical Specification Sheet (Word DOCX)", "filename", techDocFileName, "local_path", techDocDownloadUrl, "created_date", createdDate)
            );
            tender.setDownloadedDocs(appendOrUpdateDownloadedDocs(tender.getDownloadedDocs(), newDocs));
            tenderRepository.save(tender);

            // Audit Log
            ActivityLog log = new ActivityLog(
                    username, userRole, "Generated Bid Documents", id,
                    new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()),
                    "Generated Word & PDF bid document package"
            );
            activityLogRepository.save(log);

            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "downloadUrl", docDownloadUrl,
                    "pdfDownloadUrl", pdfDownloadUrl,
                    "status", resolveStatus(tender, LocalDate.now().toString())
            ));

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("success", false, "error", "Failed to generate documents: " + e.getMessage()));
        }
    }

    private String appendOrUpdateDownloadedDocs(String existingJson, List<Map<String, String>> newDocs) {
        List<Map<String, Object>> docsList = new ArrayList<>();
        ObjectMapper objectMapper = new ObjectMapper();

        if (existingJson != null && !existingJson.trim().isEmpty()) {
            try {
                docsList = objectMapper.readValue(existingJson, new TypeReference<List<Map<String, Object>>>() {});
            } catch (Exception e) {
                System.out.println("[TenderController] Parsing existing downloaded_docs failed, initializing new list: " + e.getMessage());
            }
        }

        for (Map<String, String> newDoc : newDocs) {
            String filename = newDoc.get("filename");
            String localPath = newDoc.get("local_path");
            boolean updated = false;

            for (Map<String, Object> item : docsList) {
                String exFile = (String) item.get("filename");
                String exPath = (String) item.get("local_path");
                if ((filename != null && filename.equalsIgnoreCase(exFile)) || (localPath != null && localPath.equalsIgnoreCase(exPath))) {
                    item.putAll(newDoc);
                    updated = true;
                    break;
                }
            }

            if (!updated) {
                docsList.add(new HashMap<>(newDoc));
            }
        }

        try {
            return objectMapper.writeValueAsString(docsList);
        } catch (Exception e) {
            e.printStackTrace();
            return existingJson;
        }
    }

    private boolean isTechSpecProvided(Tender tender) {
        if (tender == null || tender.getDownloadedDocs() == null) return false;
        String docs = tender.getDownloadedDocs().toLowerCase();
        return docs.contains("technical specification") || docs.contains("tech_spec") || docs.contains("uploaded pdf");
    }

    @GetMapping("/{id}/tech-spec-progress")
    public ResponseEntity<?> getTechSpecProgress(@PathVariable("id") String id) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        return ResponseEntity.ok(complianceProgressService.snapshot(id));
    }

    @PostMapping("/{id}/upload-tech-spec")
    public ResponseEntity<?> uploadTechSpec(
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String userRole,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "admin") String username,
            @PathVariable("id") String id,
            @RequestParam("file") org.springframework.web.multipart.MultipartFile file,
            @RequestParam(value = "offeredModel", required = false) String offeredModel,
            @RequestParam(value = "offered_model", required = false) String offeredModelLegacy,
            @RequestParam(value = "offeredMake", required = false) String offeredMake,
            @RequestParam(value = "scheduleNo", required = false) String scheduleNo,
            @RequestParam(value = "productDescription", required = false) String productDescription) {

        if (!WorkflowPermissions.allowed(UPLOAD_SPEC)) return WorkflowPermissions.denied();
        userRole = WorkflowPermissions.role();
        username = WorkflowPermissions.username();
        if (offeredModel == null || offeredModel.trim().isEmpty()) {
            offeredModel = offeredModelLegacy;
        }

        Optional<Tender> opt = tenderRepository.findById(id);
        Tender tender;
        if (opt.isEmpty()) {
            tender = new Tender();
            tender.setId(id);
            tender.setRefNo("GEM/" + id);
            tender.setTitle("Manual Upload Tender " + id);
            tender.setAuthority("GeM Portal");
            tender.setOriginalUrl("https://bidplus.gem.gov.in/showbidDocument/" + id);
            tender.setStatus("New");
            tender.setScrapedAt(java.time.LocalDateTime.now().toString());
            tender.setSource("Manual Upload");
            tender = tenderRepository.save(tender);
        } else {
            tender = opt.get();
        }

        if (file.isEmpty()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("success", false, "error", "Uploaded file is empty"));
        }

        complianceProgressService.start(id,
                file.getOriginalFilename() != null ? file.getOriginalFilename() : "document");
        ComplianceConversionMetrics conversionMetrics = complianceProgressService.metricsFor(id);

        try {
            String docDir = "public/documents/" + id;
            Files.createDirectories(Paths.get(docDir));

            byte[] uploadedBytes = file.getBytes();
            String originalFilename = file.getOriginalFilename() != null ? file.getOriginalFilename() : "specification.pdf";

            // 1. Save uploaded input file as specification.pdf
            String inputFilePath = docDir + "/specification.pdf";
            String inputDownloadUrl = "/documents/" + id + "/specification.pdf";
            try (FileOutputStream fos = new FileOutputStream(inputFilePath)) {
                fos.write(uploadedBytes);
            }
            complianceProgressService.update(id, "UPLOADED",
                    "Upload saved. Inspecting " + originalFilename + ".", 3, 0, 0, 0);

            // Save offeredModel on Tender entity if passed
            if (offeredModel != null && !offeredModel.trim().isEmpty()) {
                tender.setOfferedModel(offeredModel.trim());
            }

            // 2. Build data map for header & reference details
            Map<String, String> data = new java.util.HashMap<>();
            data.put("bidNumber", tender.getRefNo() != null ? tender.getRefNo() : id);
            
            String finalProdDesc = (productDescription != null && !productDescription.trim().isEmpty()) 
                                   ? productDescription.trim() 
                                   : (tender.getProductNameAsPerTender() != null ? tender.getProductNameAsPerTender() : (tender.getTitle() != null ? tender.getTitle() : "Medical Equipment"));
            data.put("productDescription", finalProdDesc);
            data.put("productName", finalProdDesc);

            String finalModel = (offeredModel != null && !offeredModel.trim().isEmpty()) 
                                ? offeredModel.trim() 
                                : (tender.getOfferedModel() != null ? tender.getOfferedModel() : "-");
            data.put("offeredModel", finalModel);

            String finalMake = (offeredMake != null && !offeredMake.trim().isEmpty()) ? offeredMake.trim() : "MarkEn";
            data.put("offeredMake", finalMake);

            if (scheduleNo != null && !scheduleNo.trim().isEmpty()) {
                data.put("scheduleNo", scheduleNo.trim());
            }

            data.put("date", java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Kolkata"))
                    .format(java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy")));
            data.put("companyName", "Mark Enterprises");
            data.put("companyAddress", "Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India");
            data.put("companyEmail", "info@markenworld.com");
            data.put("companyWebsite", "www.markenworld.com");
            data.put("companyContact", "09175559646 / 090111 04332");
            data.put("signatoryName", "Korra Praveen Naik");
            data.put("signatoryDesignation", "Partner");

            // 3. Parse product compliance clauses from specification.pdf (with OCR fallback & tender context)
            List<String[]> extractedClauses = documentGeneratorService.parseSpecificationClauses(
                    uploadedBytes, originalFilename, data,
                    (stage, message, percent, completed, total, clauses) ->
                            complianceProgressService.update(id, stage, message, percent,
                                    completed, total, clauses), conversionMetrics);

            if (AISpecificationIntelligenceService.isCompletedEmpty(extractedClauses)) {
                String message = "No products found with applicable compliance requirements.";
                tender.setDownloadedDocs(appendOrUpdateDownloadedDocs(tender.getDownloadedDocs(),
                        List.of(Map.of("name", "Uploaded Input (specification.pdf)", "filename", "specification.pdf",
                                "local_path", inputDownloadUrl, "created_date", LocalDate.now().toString()))));
                tenderRepository.save(tender);
                complianceProgressService.completeNoProducts(id, message);
                Map<String, Object> response = new LinkedHashMap<>();
                response.put("success", true);
                response.put("generated", false);
                response.put("message", message);
                response.put("products", List.of());
                response.put("pdfDownloadUrl", null);
                response.put("docxDownloadUrl", null);
                response.put("xlsxDownloadUrl", null);
                response.put("clauseCount", 0);
                response.put("status", resolveStatus(tender, LocalDate.now().toString()));
                response.put("metrics", conversionMetrics.snapshot());
                return ResponseEntity.ok(response);
            }

            if (extractedClauses == null || extractedClauses.isEmpty()) {
                complianceProgressService.fail(id,
                        "Conversion stopped because a required page batch could not be validated.");
                Map<String, Object> failure = new LinkedHashMap<>();
                failure.put("success", false);
                failure.put("error", "Could not validate every specification page. Please retry; no partial sheets were generated.");
                failure.put("metrics", conversionMetrics.snapshot());
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(failure);
            }

            if (offeredModel != null && !offeredModel.trim().isEmpty()) {
                data.put("offeredModel", offeredModel.trim());
            }

            String createdDate = LocalDate.now().toString();
            List<Map<String, String>> newDocs = new ArrayList<>();
            newDocs.add(Map.of("name", "Uploaded Input (specification.pdf)", "filename", "specification.pdf",
                    "local_path", inputDownloadUrl, "created_date", createdDate));
            List<com.tenderpocket.services.SpecificationSheetContent.Product> sheets =
                    com.tenderpocket.services.SpecificationSheetContent.fromSourceRequirements(extractedClauses).stream()
                            .filter(product -> product.clauseCount() > 0).toList();
            if (sheets.isEmpty()) throw new IllegalStateException("No product specifications found");
            List<Map<String, Object>> products = new ArrayList<>();
            int totalClauses = sheets.stream().mapToInt(
                    com.tenderpocket.services.SpecificationSheetContent.Product::clauseCount).sum();
            conversionMetrics.setResultCounts(sheets.size(), totalClauses);
            conversionMetrics.beginRendering();
            String stem = "Combined_Technical_Data_Sheet";
            String pdfFileName = stem + ".pdf", docxFileName = stem + ".docx", xlsxFileName = stem + ".xlsx";
            String pdfDownloadUrl = "/documents/" + id + "/" + pdfFileName;
            String docxDownloadUrl = "/documents/" + id + "/" + docxFileName;
            String xlsxDownloadUrl = "/documents/" + id + "/" + xlsxFileName;
            complianceProgressService.update(id, "RENDERING_PDF", "Generating combined PDF.",
                    80, 0, 0, totalClauses);
            byte[] pdfBytes = documentGeneratorService.generateCombinedSheetPdf(data, sheets);
            complianceProgressService.update(id, "RENDERING_DOCX", "Generating combined Word document.",
                    86, 0, 0, totalClauses);
            byte[] docxBytes = documentGeneratorService.generateCombinedSheetDocx(data, sheets);
            complianceProgressService.update(id, "RENDERING_XLSX", "Generating combined Excel workbook.",
                    92, 0, 0, totalClauses);
            byte[] xlsxBytes = documentGeneratorService.generateCombinedSheetXlsx(data, sheets);
            Files.write(Paths.get(docDir, pdfFileName), pdfBytes);
            Files.write(Paths.get(docDir, docxFileName), docxBytes);
            Files.write(Paths.get(docDir, xlsxFileName), xlsxBytes);
            File downloadsDir = new File(System.getProperty("user.home"), "Downloads");
            if (downloadsDir.isDirectory()) {
                try {
                    Files.write(downloadsDir.toPath().resolve(pdfFileName), pdfBytes);
                    Files.write(downloadsDir.toPath().resolve(docxFileName), docxBytes);
                    Files.write(downloadsDir.toPath().resolve(xlsxFileName), xlsxBytes);
                } catch (java.io.IOException copyFailure) {
                    System.err.println("[TenderController] Optional Downloads copy failed.");
                }
            }
            newDocs.add(Map.of("name", "Combined Technical Specifications (PDF)",
                    "filename", pdfFileName, "local_path", pdfDownloadUrl, "created_date", createdDate));
            newDocs.add(Map.of("name", "Combined Technical Specifications (DOCX)",
                    "filename", docxFileName, "local_path", docxDownloadUrl, "created_date", createdDate));
            newDocs.add(Map.of("name", "Combined Technical Specifications (XLSX)",
                    "filename", xlsxFileName, "local_path", xlsxDownloadUrl, "created_date", createdDate));
            for (var sheet : sheets) {
                products.add(Map.of("productName", sheet.name(), "scheduleNumber", sheet.schedule(),
                        "clauseCount", sheet.clauseCount(), "pdfDownloadUrl", pdfDownloadUrl,
                        "docxDownloadUrl", docxDownloadUrl, "xlsxDownloadUrl", xlsxDownloadUrl));
            }
            conversionMetrics.endRendering();

            tender.setDownloadedDocs(appendOrUpdateDownloadedDocs(tender.getDownloadedDocs(), newDocs));
            tender.setSpecVerificationStatus("Generated");
            complianceProgressService.update(id, "SAVING",
                    "Saving output files and document links.", 97, 0, 0, extractedClauses.size());
            tenderRepository.save(tender);

            // Audit Log
            ActivityLog log = new ActivityLog(
                    username, userRole, "Uploaded Technical Specification & Generated Documents", id,
                    new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()),
                    "Uploaded specification.pdf and generated Technical Specification Sheet PDF, DOCX & XLSX outputs with " + extractedClauses.size() + " extracted clauses."
            );
            activityLogRepository.save(log);

            Map<String, Object> response = new java.util.HashMap<>();
            response.put("success", true);
            response.put("generated", true);
            response.put("combined", true);
            response.put("pdfDownloadUrl", pdfDownloadUrl);
            response.put("docxDownloadUrl", docxDownloadUrl);
            response.put("xlsxDownloadUrl", xlsxDownloadUrl);
            response.put("products", products);
            response.put("message", "Combined technical specifications generated for " + products.size() + " products.");
            response.put("status", resolveStatus(tender, LocalDate.now().toString()));
            response.put("clauseCount", totalClauses);

            complianceProgressService.completeProducts(id, totalClauses, products, true);
            response.put("metrics", conversionMetrics.snapshot());

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            e.printStackTrace();
            complianceProgressService.fail(id, "Compliance creation failed: " + e.getMessage());
            Map<String, Object> failure = new LinkedHashMap<>();
            failure.put("success", false);
            failure.put("error", "Failed to upload technical specification: " + e.getMessage());
            failure.put("metrics", conversionMetrics.snapshot());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(failure);
        }
    }

    @PostMapping("/{id}/generate-tech-specs")
    public ResponseEntity<?> generateTechSpecs(
            @RequestHeader(value = "x-user-role", defaultValue = "Executive") String userRole,
            @RequestHeader(value = "x-user-username", defaultValue = "system") String username,
            @PathVariable("id") String id,
            @RequestBody Map<String, String> body) {

        if (!WorkflowPermissions.allowed(UPLOAD_SPEC)) return WorkflowPermissions.denied();
        userRole = WorkflowPermissions.role();
        username = WorkflowPermissions.username();
        Optional<Tender> opt = tenderRepository.findById(id);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));
        }

        Tender tender = opt.get();

        try {
            String docDir = "public/documents/" + id;
            Files.createDirectories(Paths.get(docDir));

            // Generate Technical Specification PDF
            byte[] pdfBytes = documentGeneratorService.generateTechSpecPdf(body);
            String pdfFileName = "Technical_Specification_Sheet_" + id + ".pdf";
            String pdfFilePath = docDir + "/" + pdfFileName;
            String pdfDownloadUrl = "/documents/" + id + "/" + pdfFileName;
            try (FileOutputStream fos = new FileOutputStream(pdfFilePath)) {
                fos.write(pdfBytes);
            }

            // Generate Technical Specification DOCX
            byte[] docxBytes = documentGeneratorService.generateTechSpecDocx(body);
            String docFileName = "Technical_Specification_Sheet_" + id + ".docx";
            String docFilePath = docDir + "/" + docFileName;
            String docDownloadUrl = "/documents/" + id + "/" + docFileName;
            try (FileOutputStream fos = new FileOutputStream(docFilePath)) {
                fos.write(docxBytes);
            }

            // Update downloaded_docs metadata without overwriting existing files
            String createdDate = LocalDate.now().toString();
            List<Map<String, String>> newDocs = List.of(
                    Map.of("name", "Technical Specification Sheet (PDF)", "filename", pdfFileName, "local_path", pdfDownloadUrl, "created_date", createdDate),
                    Map.of("name", "Technical Specification Sheet (Word DOCX)", "filename", docFileName, "local_path", docDownloadUrl, "created_date", createdDate)
            );
            tender.setDownloadedDocs(appendOrUpdateDownloadedDocs(tender.getDownloadedDocs(), newDocs));
            tenderRepository.save(tender);

            // Audit Log
            ActivityLog log = new ActivityLog(
                    username, userRole, "Generated Technical Specifications", id,
                    new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()),
                    "Generated Technical Specification Sheet (PDF & Word DOCX)"
            );
            activityLogRepository.save(log);

            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "downloadUrl", docDownloadUrl,
                    "pdfDownloadUrl", pdfDownloadUrl,
                    "status", resolveStatus(tender, LocalDate.now().toString())
            ));

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("success", false, "error", "Failed to generate technical specifications: " + e.getMessage()));
        }
    }

    private String resolveStatus(Tender t, String todayIST) {
        boolean hasPassedDueDate = t.getDueDate() != null && t.getDueDate().split(" ")[0].compareTo(todayIST) < 0;

        if ("Awarded".equalsIgnoreCase(t.getStatus())) return "Won";
        if ("Not Awarded".equalsIgnoreCase(t.getStatus())) return "Lost";
        if ("Filed".equalsIgnoreCase(t.getStatus())) return "Submitted";

        if (hasPassedDueDate) {
            if ("Not Participating".equalsIgnoreCase(t.getStatus())) return "Missed Opportunity";
            if ("Issued".equalsIgnoreCase(t.getStatus()) || "Participating".equalsIgnoreCase(t.getStatus()) || t.getStatus() == null) {
                return "Missed Deadline";
            }
        }

        if ("Not Participating".equalsIgnoreCase(t.getStatus())) return "Not Participating";
        if ("Participating".equalsIgnoreCase(t.getStatus())) return "Participating";

        if (t.getPublishDate() != null && !"N/A".equals(t.getPublishDate())) {
            try {
                LocalDate pub = LocalDate.parse(t.getPublishDate());
                long diff = ChronoUnit.DAYS.between(pub, LocalDate.now());
                if (diff > 3) return "Lapsed";
            } catch (Exception e) {}
        }

        return "New";
    }

    private String generateDetailsSummary(Tender t) {
        StringBuilder sb = new StringBuilder();
        sb.append(String.format("This tender, titled \"%s\", ", t.getTitle()));
        if (t.getAuthority() != null) sb.append(String.format("issued by %s, ", t.getAuthority()));
        sb.append(String.format("is for procuring \"%s\" under the %s vertical. ", 
                t.getProductNameAsPerTender() != null ? t.getProductNameAsPerTender() : "specified equipment",
                t.getVerticalName() != null ? t.getVerticalName() : "Others"));
        if (t.getDueDate() != null) {
            sb.append("The final submission due date is scheduled for ").append(t.getDueDate()).append(". ");
        }
        return sb.toString();
    }

    @GetMapping("/{id}/comments")
    public ResponseEntity<?> getComments(@PathVariable("id") String id) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        List<com.tenderpocket.models.TenderWorkflowComment> comments = commentRepository.findByTenderIdOrderByCreatedAtAsc(id);
        return ResponseEntity.ok(Map.of("success", true, "comments", comments));
    }

    @PostMapping("/{id}/comments")
    public ResponseEntity<?> postComment(
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "admin") String username,
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String role,
            @PathVariable("id") String id,
            @RequestBody Map<String, String> body) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        username = WorkflowPermissions.username();
        role = WorkflowPermissions.role();
        String commentText = body.get("comment");
        String phase = body.get("phase");
        if (commentText == null || commentText.isEmpty() || phase == null || phase.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "comment and phase are required"));
        }
        String createdAt = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());
        com.tenderpocket.models.TenderWorkflowComment comment = new com.tenderpocket.models.TenderWorkflowComment(
                id, phase, username, role, commentText, createdAt
        );
        commentRepository.save(comment);
        return ResponseEntity.ok(Map.of("success", true, "comment", comment));
    }

    @GetMapping("/stats")
    public ResponseEntity<?> getStats() {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        List<Object[]> rows;
        try {
            rows = tenderRepository.findStatusHistoryStats();
        } catch (Exception e) {
            System.out.println("[Stats] Status history query fallback: " + e.getMessage());
            rows = Collections.emptyList();
        }
        Map<String, Map<String, Object>> statsMap = new HashMap<>();

        LocalDate today = LocalDate.now();

        for (Object[] row : rows) {
            String exec = (String) row[0];
            String status = (String) row[1];
            String changedAtStr = (String) row[2];

            if (exec == null || exec.isEmpty() || changedAtStr == null) {
                continue;
            }

            boolean isSubmission = "Filed".equalsIgnoreCase(status) || "Submitted".equalsIgnoreCase(status);
            boolean isWon = "Awarded".equalsIgnoreCase(status) || "Won".equalsIgnoreCase(status);
            boolean isLost = "Not Awarded".equalsIgnoreCase(status) || "Lost".equalsIgnoreCase(status);

            if (!isSubmission && !isWon && !isLost) {
                continue;
            }

            statsMap.putIfAbsent(exec, new HashMap<>(Map.of(
                "executive", exec,
                "last7Days", 0,
                "last30Days", 0,
                "last365Days", 0,
                "totalWon", 0,
                "totalLost", 0
            )));

            Map<String, Object> execStats = statsMap.get(exec);

            try {
                String cleanDate = changedAtStr.split(" ")[0].split("T")[0];
                LocalDate changedDate = LocalDate.parse(cleanDate);
                long daysDiff = ChronoUnit.DAYS.between(changedDate, today);

                if (isSubmission) {
                    if (daysDiff <= 7) {
                        execStats.put("last7Days", (int) execStats.get("last7Days") + 1);
                    }
                    if (daysDiff <= 30) {
                        execStats.put("last30Days", (int) execStats.get("last30Days") + 1);
                    }
                    if (daysDiff <= 365) {
                        execStats.put("last365Days", (int) execStats.get("last365Days") + 1);
                    }
                }

                if (isWon) {
                    execStats.put("totalWon", (int) execStats.get("totalWon") + 1);
                }
                if (isLost) {
                    execStats.put("totalLost", (int) execStats.get("totalLost") + 1);
                }

            } catch (Exception e) {
                // Ignore parse errors
            }
        }

        return ResponseEntity.ok(Map.of("success", true, "stats", new ArrayList<>(statsMap.values())));
    }

    @GetMapping("/documents/{id}/{fileName:.+}")
    public ResponseEntity<org.springframework.core.io.Resource> downloadDocumentFile(
            @PathVariable("id") String id,
            @PathVariable("fileName") String fileName) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        try {
            java.nio.file.Path filePath = java.nio.file.Paths.get("public/documents", id, fileName).toAbsolutePath().normalize();
            java.io.File file = filePath.toFile();
            if (!file.exists()) {
                return ResponseEntity.notFound().build();
            }

            org.springframework.core.io.Resource resource = new org.springframework.core.io.UrlResource(filePath.toUri());
            String contentType = java.nio.file.Files.probeContentType(filePath);
            if (contentType == null) {
                contentType = "application/octet-stream";
            }

            return ResponseEntity.ok()
                    .contentType(org.springframework.http.MediaType.parseMediaType(contentType))
                    .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + file.getName() + "\"")
                    .body(resource);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
