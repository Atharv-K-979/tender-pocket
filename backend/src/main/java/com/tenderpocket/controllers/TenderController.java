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

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
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

    @Autowired(required = false)
    private com.tenderpocket.services.ProductCatalogueService productCatalogueService;

    public void setProductCatalogueService(com.tenderpocket.services.ProductCatalogueService productCatalogueService) {
        this.productCatalogueService = productCatalogueService;
    }

    @Value("${aws.s3.enabled:false}")
    private boolean awsS3Enabled;

    @Value("${file.upload-dir:public/documents}")
    private String uploadDir = "public/documents";

    @Autowired(required = false)
    private com.tenderpocket.services.ObjectStorageService objectStorageService;

    @Value("${gemini.api.key}")
    private String geminiApiKey;

    private final ObjectMapper mapper = new ObjectMapper();

    private Path resolveSafeLocalPath(String id, String fileName) {
        if (id == null || fileName == null || id.isBlank() || fileName.isBlank() ||
                id.contains("..") || fileName.contains("..") ||
                id.contains("/") || id.contains("\\") || fileName.contains("/") || fileName.contains("\\")) {
            return null;
        }
        Path basePath = Paths.get(uploadDir).toAbsolutePath().normalize();
        Path targetPath = basePath.resolve(id).resolve(fileName).normalize();
        if (!targetPath.startsWith(basePath)) {
            return null;
        }
        return targetPath;
    }

    private void persistDocument(String tenderId, String fileName, byte[] data, String contentType) {
        String objectKey = "tenders/" + tenderId + "/" + fileName;
        if (awsS3Enabled && objectStorageService != null && objectStorageService.isRemote()) {
            try (ByteArrayInputStream bais = new ByteArrayInputStream(data)) {
                objectStorageService.upload(objectKey, bais, contentType, data.length);
            } catch (Exception e) {
                System.err.println("[TenderController] S3 upload failed for key " + objectKey + ": " + e.getMessage());
                throw new RuntimeException("Failed to upload document to S3 storage (" + objectKey + "): " + e.getMessage(), e);
            }
        } else {
            try {
                Path filePath = resolveSafeLocalPath(tenderId, fileName);
                if (filePath == null) {
                    throw new IllegalArgumentException("Invalid path or traversal attempt: " + tenderId + "/" + fileName);
                }
                if (filePath.getParent() != null) {
                    Files.createDirectories(filePath.getParent());
                }
                Files.write(filePath, data);
            } catch (Exception e) {
                throw new RuntimeException("Failed to save document to local storage (" + fileName + "): " + e.getMessage(), e);
            }
        }
    }

    private String resolveContentTypeByExtension(String fileName) {
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".zip")) return "application/zip";
        return "application/octet-stream";
    }
 
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
                    geMScraperService.syncTenders(false, Collections.emptyList());
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
            @RequestParam(value = "mis_executive", required = false) String misExecutive,
            @RequestParam(value = "minCost", required = false) Double minCost,
            @RequestParam(value = "maxCost", required = false) Double maxCost,
            @RequestParam(value = "sortBy", required = false, defaultValue = "scraped_at") String sortBy,
            @RequestParam(value = "order", required = false, defaultValue = "desc") String order) {

        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        userRole = resolveUserRole(userRole);
        username = resolveUsername(username);
        List<Tender> list = tenderRepository.findAll();
        List<Tender> filtered = new ArrayList<>();

        String todayIST = java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Kolkata")).toLocalDate().toString();
        boolean isTpcRole = "TPC Pricing Team".equalsIgnoreCase(userRole) || "TPC Team".equalsIgnoreCase(userRole);
        boolean canViewTpcPrice = WorkflowPermissions.allowed(userRole, VIEW_TPC_PRICE);

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
            if (isTpcRole) {
                boolean match = "TPC_PRICING".equalsIgnoreCase(t.getCurrentStage())
                        || "REJECTED_TPC".equalsIgnoreCase(t.getCurrentStage())
                        || (t.getTpcPurchasePrice() != null && t.getTpcPurchasePrice() > 0);
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
                if (isTpcRole) {
                    if ("Pending".equalsIgnoreCase(status)) {
                        boolean isPending = "TPC_PRICING".equalsIgnoreCase(t.getCurrentStage())
                                && (t.getTpcPurchasePrice() == null || t.getTpcPurchasePrice() == 0)
                                && !"Rejected".equalsIgnoreCase(t.getStatus());
                        if (!isPending) continue;
                    } else if ("Approved".equalsIgnoreCase(status)) {
                        boolean isApproved = t.getTpcPurchasePrice() != null && t.getTpcPurchasePrice() > 0;
                        if (!isApproved) continue;
                    } else if ("Rejected".equalsIgnoreCase(status)) {
                        boolean isRejected = "Rejected".equalsIgnoreCase(t.getStatus()) || "REJECTED_TPC".equalsIgnoreCase(t.getCurrentStage());
                        if (!isRejected) continue;
                    }
                } else if ("Pending".equalsIgnoreCase(status) || "Approved".equalsIgnoreCase(status) || "Rejected".equalsIgnoreCase(status)) {
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

            // Filter by minCost & maxCost
            if (minCost != null && (t.getEstimatedCost() == null || t.getEstimatedCost() < minCost)) {
                continue;
            }
            if (maxCost != null && (t.getEstimatedCost() == null || t.getEstimatedCost() > maxCost)) {
                continue;
            }

            // Create safe response copy to prevent mutating managed JPA entity
            Tender responseItem = createResponseCopy(t);

            // Apply pricing confidentiality
            if (!canViewTpcPrice) {
                responseItem.setTpcPurchasePrice(null);
                responseItem.setAiDetailsSummary(null);
                responseItem.setAiHistorySummary(null);
            }

            filtered.add(responseItem);
        }

        // Dynamic Sorting
        String safeSortBy = (sortBy != null && List.of("scraped_at", "due_date", "estimated_cost").contains(sortBy)) ? sortBy : "scraped_at";
        boolean isAsc = "asc".equalsIgnoreCase(order);

        filtered.sort((a, b) -> {
            int cmp = 0;
            if ("due_date".equalsIgnoreCase(safeSortBy)) {
                String da = a.getDueDate() != null ? a.getDueDate() : "";
                String db = b.getDueDate() != null ? b.getDueDate() : "";
                cmp = da.compareTo(db);
            } else if ("estimated_cost".equalsIgnoreCase(safeSortBy)) {
                Double ca = a.getEstimatedCost() != null ? a.getEstimatedCost() : 0.0;
                Double cb = b.getEstimatedCost() != null ? b.getEstimatedCost() : 0.0;
                cmp = ca.compareTo(cb);
            } else {
                String sa = a.getScrapedAt() != null ? a.getScrapedAt() : "";
                String sb = b.getScrapedAt() != null ? b.getScrapedAt() : "";
                cmp = sa.compareTo(sb);
            }
            return isAsc ? cmp : -cmp;
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

    private Tender createResponseCopy(Tender source) {
        if (source == null) return null;
        Tender copy = new Tender();
        org.springframework.beans.BeanUtils.copyProperties(source, copy);
        return copy;
    }

    private Double parseDoubleSafe(String val) {
        if (val == null || val.isBlank()) return null;
        try {
            String cleaned = val.replaceAll("[^0-9.]", "");
            return cleaned.isEmpty() ? null : Double.parseDouble(cleaned);
        } catch (Exception e) {
            return null;
        }
    }

    private boolean isValidCalendarDate(String dateStr) {
        return isValidCalendarDate(dateStr, false);
    }

    private boolean isValidCalendarDate(String dateStr, boolean allowNoNA) {
        if (dateStr == null || dateStr.trim().isEmpty()) {
            return true;
        }
        String s = dateStr.trim();
        if (allowNoNA && ("No".equalsIgnoreCase(s) || "N/A".equalsIgnoreCase(s))) {
            return true;
        }

        // 1. Strict YYYY-MM-DD
        if (s.matches("^\\d{4}-\\d{2}-\\d{2}$")) {
            try {
                LocalDate.parse(s, DateTimeFormatter.ISO_LOCAL_DATE.withResolverStyle(ResolverStyle.STRICT));
                return true;
            } catch (DateTimeParseException e) {
                return false;
            }
        }

        // 2. Strict YYYY-MM-DD HH:mm:ss
        if (s.matches("^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$")) {
            try {
                DateTimeFormatter dtf = DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm:ss").withResolverStyle(ResolverStyle.STRICT);
                LocalDateTime.parse(s, dtf);
                return true;
            } catch (DateTimeParseException e) {
                return false;
            }
        }

        // 3. Strict ISO local date-time e.g. YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss
        if (s.matches("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?$")) {
            try {
                DateTimeFormatter dtf = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm[:ss]").withResolverStyle(ResolverStyle.STRICT);
                LocalDateTime.parse(s, dtf);
                return true;
            } catch (DateTimeParseException e) {
                return false;
            }
        }

        // 4. Legacy format: d MMM uuuu e.g. "8 Oct 2026" or "24 Sep 2026"
        if (s.matches("^\\d{1,2}\\s+[A-Za-z]{3}\\s+\\d{4}$")) {
            try {
                DateTimeFormatter dtf = DateTimeFormatter.ofPattern("d MMM uuuu", Locale.ENGLISH).withResolverStyle(ResolverStyle.STRICT);
                LocalDate.parse(s, dtf);
                return true;
            } catch (DateTimeParseException e) {
                return false;
            }
        }

        return false;
    }

    private Double parseAndValidateNumeric(Object rawInput, boolean isFee, Map<String, String> errors, String errorKey) {
        if (rawInput == null) return null;
        if (rawInput instanceof Number) {
            double d = ((Number) rawInput).doubleValue();
            if (d < 0) {
                errors.put(errorKey, isFee ? "Fee cannot be negative." : "Amount cannot be negative.");
                return null;
            }
            return d;
        }
        String s = rawInput.toString().trim();
        if (s.isEmpty() || "N/A".equalsIgnoreCase(s) || "null".equalsIgnoreCase(s)) {
            return null;
        }

        // Detect negative numbers e.g. -500, - 1,500, ₹ -500
        boolean isNegative = s.startsWith("-") || s.matches("^[^0-9]*-\\s*[0-9].*");

        // Strip valid currency symbol/prefix e.g. ₹, Rs, Rs., $, €, £, INR
        String numStr = s.replaceFirst("^(?i)(₹|Rs\\.?|INR|[$€£])\\s*", "").trim();
        if (numStr.startsWith("-")) {
            isNegative = true;
            numStr = numStr.substring(1).trim();
        }

        if (numStr.isEmpty()) {
            errors.put(errorKey, isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.");
            return null;
        }

        // Reject if any illegal character or multiple decimal points
        int dotCount = 0;
        for (int i = 0; i < numStr.length(); i++) {
            if (numStr.charAt(i) == '.') dotCount++;
        }
        if (dotCount > 1) {
            errors.put(errorKey, isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.");
            return null;
        }

        if (!numStr.matches("^[0-9,]+(\\.[0-9]+)?$")) {
            errors.put(errorKey, isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.");
            return null;
        }

        // If commas are present, validate strict Indian or Western grouping
        if (numStr.contains(",")) {
            boolean validWestern = numStr.matches("^\\d{1,3}(,\\d{3})+(\\.\\d+)?$");
            boolean validIndian = numStr.matches("^\\d{1,2}(,\\d{2})*,\\d{3}(\\.\\d+)?$");
            if (!validWestern && !validIndian) {
                errors.put(errorKey, isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.");
                return null;
            }
        }

        try {
            double val = Double.parseDouble(numStr.replace(",", ""));
            if (isNegative || val < 0) {
                errors.put(errorKey, isFee ? "Fee cannot be negative." : "Amount cannot be negative.");
                return null;
            }
            return val;
        } catch (NumberFormatException e) {
            errors.put(errorKey, isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.");
            return null;
        }
    }

    private Integer parseAndValidateInteger(Object rawInput, Map<String, String> errors, String errorKey) {
        if (rawInput == null) return null;
        if (rawInput instanceof Number) {
            double d = ((Number) rawInput).doubleValue();
            if (d < 0) {
                errors.put(errorKey, "Quantity cannot be negative.");
                return null;
            }
            if (Math.floor(d) != d) {
                errors.put(errorKey, "Quantity must be an integer.");
                return null;
            }
            return ((Number) rawInput).intValue();
        }
        String s = rawInput.toString().trim();
        if (s.isEmpty() || "null".equalsIgnoreCase(s) || "N/A".equalsIgnoreCase(s)) {
            return null;
        }
        if (s.contains(".")) {
            try {
                double d = Double.parseDouble(s);
                if (d < 0) {
                    errors.put(errorKey, "Quantity cannot be negative.");
                    return null;
                }
                if (Math.floor(d) != d) {
                    errors.put(errorKey, "Quantity must be an integer.");
                    return null;
                }
            } catch (NumberFormatException e) {
                errors.put(errorKey, "Enter a valid numeric quantity.");
                return null;
            }
        }
        try {
            int val = Integer.parseInt(s);
            if (val < 0) {
                errors.put(errorKey, "Quantity cannot be negative.");
                return null;
            }
            return val;
        } catch (NumberFormatException e) {
            errors.put(errorKey, "Enter a valid numeric quantity.");
            return null;
        }
    }

    private boolean isValidUrl(String urlStr) {
        if (urlStr == null || urlStr.trim().isEmpty()) {
            return true;
        }
        String s = urlStr.trim();
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            return false;
        }
        try {
            URI uri = new URI(s);
            return uri.getHost() != null && !uri.getHost().isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getTenderById(
            @PathVariable("id") String id,
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Admin") String userRole,
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "admin") String username) {

        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        userRole = resolveUserRole(userRole);
        username = resolveUsername(username);

        Optional<Tender> opt = tenderRepository.findById(id);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("success", false, "error", "Tender not found"));
        }

        Tender dbTender = opt.get();

        // Check role-based tender access
        if ("MIS Executive".equalsIgnoreCase(userRole) || "Tender Executive".equalsIgnoreCase(userRole)) {
            if (!username.equalsIgnoreCase(dbTender.getMisExecutive())) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("success", false, "error", "Access denied: Tender not assigned to you"));
            }
        } else if ("Clearance Team".equalsIgnoreCase(userRole) || "Specification Team".equalsIgnoreCase(userRole)) {
            boolean match = username.equalsIgnoreCase(dbTender.getAssignedMisMemberSpec())
                    || "clearance".equalsIgnoreCase(dbTender.getAssignedMisMemberSpec())
                    || "Clearance Team".equalsIgnoreCase(dbTender.getAssignedMisMemberSpec())
                    || "SPEC_CLEARANCE".equalsIgnoreCase(dbTender.getCurrentStage());
            if (!match) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("success", false, "error", "Access denied: Tender not assigned to Clearance Team"));
            }
        } else if ("TPC Pricing Team".equalsIgnoreCase(userRole) || "TPC Team".equalsIgnoreCase(userRole)) {
            boolean match = "TPC_PRICING".equalsIgnoreCase(dbTender.getCurrentStage())
                    || "REJECTED_TPC".equalsIgnoreCase(dbTender.getCurrentStage())
                    || (dbTender.getTpcPurchasePrice() != null && dbTender.getTpcPurchasePrice() > 0);
            if (!match) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("success", false, "error", "Access denied: Tender not available for TPC pricing"));
            }
        }

        Tender tender = createResponseCopy(dbTender);

        String todayIST = LocalDate.now().toString();
        tender.setStatus(resolveStatus(tender, todayIST));

        // Pricing Confidentiality
        if (!WorkflowPermissions.allowed(userRole, VIEW_TPC_PRICE)) {
            tender.setTpcPurchasePrice(null);
            tender.setAiDetailsSummary(null);
            tender.setAiHistorySummary(null);
        }

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

        // Field-level workflow authorization: reject attempts by unauthorized roles to modify workflow status, approval outcomes, payment fields, or confidential pricing
        if (!WorkflowPermissions.allowedPatch(body, tender.getCurrentStage(), userRole)) {
            return WorkflowPermissions.denied();
        }

        String requestedVerStatus = (String) (body.containsKey("verification_status") ? body.get("verification_status") : body.get("verificationStatus"));
        if (requestedVerStatus != null && List.of("Pending", "Approved").contains(requestedVerStatus) && !isBidDocsProvided(tender)) {
            return ResponseEntity.badRequest().body(Map.of("success", false,
                    "error", "Generated bid documents are required before submitting or approving document verification."));
        }

        // Field-specific validation for all editable parameters
        Map<String, String> fieldErrors = new LinkedHashMap<>();

        // 1. Mandatory text fields & length checks
        if (body.containsKey("title")) {
            Object val = body.get("title");
            if (val == null || val.toString().trim().isEmpty()) {
                fieldErrors.put("title", "Tender Brief / Description cannot be empty.");
            }
        }
        if (body.containsKey("ref_no") || body.containsKey("refNo")) {
            Object val = body.containsKey("ref_no") ? body.get("ref_no") : body.get("refNo");
            if (val == null || val.toString().trim().isEmpty()) {
                fieldErrors.put("ref_no", "Official Reference No cannot be empty.");
            } else if (val.toString().trim().length() > 255) {
                fieldErrors.put("ref_no", "Official Reference No cannot exceed 255 characters.");
            }
        }
        for (String fld : List.of("place", "state", "sector", "vertical_name", "source_id")) {
            if (body.containsKey(fld)) {
                Object val = body.get(fld);
                if (val != null && val.toString().trim().length() > 255) {
                    fieldErrors.put(fld, fld + " cannot exceed 255 characters.");
                }
            }
        }

        // 2. Monetary validation
        Double parsedDocFee = null;
        if (body.containsKey("document_fee_raw") || body.containsKey("documentFeeRaw")) {
            Object raw = body.containsKey("document_fee_raw") ? body.get("document_fee_raw") : body.get("documentFeeRaw");
            parsedDocFee = parseAndValidateNumeric(raw, true, fieldErrors, "document_fee_raw");
        } else if (body.containsKey("document_fee") || body.containsKey("documentFee")) {
            Object raw = body.containsKey("document_fee") ? body.get("document_fee") : body.get("documentFee");
            parsedDocFee = parseAndValidateNumeric(raw, true, fieldErrors, "document_fee");
        }

        Double parsedEstCost = null;
        if (body.containsKey("estimated_cost_raw") || body.containsKey("estimatedCostRaw")) {
            Object raw = body.containsKey("estimated_cost_raw") ? body.get("estimated_cost_raw") : body.get("estimatedCostRaw");
            parsedEstCost = parseAndValidateNumeric(raw, false, fieldErrors, "estimated_cost_raw");
        } else if (body.containsKey("estimated_cost") || body.containsKey("estimatedCost")) {
            Object raw = body.containsKey("estimated_cost") ? body.get("estimated_cost") : body.get("estimatedCost");
            parsedEstCost = parseAndValidateNumeric(raw, false, fieldErrors, "estimated_cost");
        }

        Double parsedEmd = null;
        if (body.containsKey("emd_raw") || body.containsKey("emdRaw")) {
            Object raw = body.containsKey("emd_raw") ? body.get("emd_raw") : body.get("emdRaw");
            parsedEmd = parseAndValidateNumeric(raw, false, fieldErrors, "emd_raw");
        } else if (body.containsKey("emd")) {
            Object raw = body.get("emd");
            parsedEmd = parseAndValidateNumeric(raw, false, fieldErrors, "emd");
        }

        // 3. Integer quantity validation
        Integer parsedBidQty = null;
        if (body.containsKey("bid_qty") || body.containsKey("bidQty")) {
            Object raw = body.containsKey("bid_qty") ? body.get("bid_qty") : body.get("bidQty");
            parsedBidQty = parseAndValidateInteger(raw, fieldErrors, "bid_qty");
        }

        Integer parsedQuotedQty = null;
        if (body.containsKey("quoted_qty") || body.containsKey("quotedQty")) {
            Object raw = body.containsKey("quoted_qty") ? body.get("quoted_qty") : body.get("quotedQty");
            parsedQuotedQty = parseAndValidateInteger(raw, fieldErrors, "quoted_qty");
        }

        // 4. Date validation
        String[] dateFields = {"opening_date", "publish_date", "start_date", "due_date", "entry_date", "pre_bid_date"};
        String[] dateFieldAliases = {"openingDate", "publishDate", "startDate", "dueDate", "entryDate", "preBidDate"};
        for (int i = 0; i < dateFields.length; i++) {
            String fld = dateFields[i];
            String alias = dateFieldAliases[i];
            if (body.containsKey(fld) || body.containsKey(alias)) {
                Object val = body.containsKey(fld) ? body.get(fld) : body.get(alias);
                boolean isPreBid = "pre_bid_date".equals(fld);
                if (val != null && !isValidCalendarDate(val.toString(), isPreBid)) {
                    if (isPreBid) {
                        fieldErrors.put(fld, "Enter a valid date or 'No'.");
                    } else {
                        fieldErrors.put(fld, "Enter a valid date.");
                    }
                }
            }
        }

        // 5. Time validation
        if (body.containsKey("time")) {
            Object val = body.get("time");
            if (val != null && !val.toString().trim().isEmpty() && !"N/A".equalsIgnoreCase(val.toString().trim())) {
                String s = val.toString().trim();
                if (!s.matches("^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$")) {
                    fieldErrors.put("time", "Enter a valid time (e.g. 15:00:00).");
                }
            }
        }

        // 6. URL validation
        if (body.containsKey("original_url") || body.containsKey("originalUrl")) {
            Object val = body.containsKey("original_url") ? body.get("original_url") : body.get("originalUrl");
            if (val != null && !val.toString().trim().isEmpty() && !isValidUrl(val.toString())) {
                fieldErrors.put("original_url", "Enter a valid URL (e.g. https://...).");
            }
        }

        // 7. Enum validation
        if (body.containsKey("tender_type") || body.containsKey("tenderType")) {
            Object val = body.containsKey("tender_type") ? body.get("tender_type") : body.get("tenderType");
            if (val != null && !val.toString().trim().isEmpty()) {
                String s = val.toString().trim();
                if (!s.equalsIgnoreCase("GeM") && !s.equalsIgnoreCase("Non GeM") && !s.equalsIgnoreCase("Custom")) {
                    fieldErrors.put("tender_type", "Tender type must be 'GeM', 'Non GeM', or 'Custom'.");
                }
            }
        }
        if (body.containsKey("source")) {
            Object val = body.get("source");
            if (val != null && !val.toString().trim().isEmpty()) {
                String s = val.toString().trim();
                if (!s.equalsIgnoreCase("GeM") && !s.equalsIgnoreCase("Tender247")) {
                    fieldErrors.put("source", "Source portal must be 'GeM' or 'Tender247'.");
                }
            }
        }
        if (body.containsKey("corrigendum_remark") || body.containsKey("corrigendumRemark")) {
            Object val = body.containsKey("corrigendum_remark") ? body.get("corrigendum_remark") : body.get("corrigendumRemark");
            if (val != null && !val.toString().trim().isEmpty()) {
                String s = val.toString().trim();
                if (!s.equalsIgnoreCase("Yes") && !s.equalsIgnoreCase("No")) {
                    fieldErrors.put("corrigendum_remark", "Corrigendum remark must be 'Yes' or 'No'.");
                }
            }
        }

        // 8. Participation decision validation: Participating requires an assigned executive
        if (body.containsKey("status") && "Participating".equalsIgnoreCase(String.valueOf(body.get("status")))) {
            String targetExec = null;
            if (body.containsKey("mis_executive")) {
                Object rawExec = body.get("mis_executive");
                if (rawExec != null && !rawExec.toString().trim().isEmpty()) {
                    targetExec = rawExec.toString().trim();
                }
            } else if (tender.getMisExecutive() != null && !tender.getMisExecutive().trim().isEmpty()) {
                targetExec = tender.getMisExecutive().trim();
            }

            if (targetExec == null) {
                fieldErrors.put("mis_executive", "Executive assignment is required to participate in this tender.");
            }
        }

        // If any validation errors exist, REJECT IMMEDIATELY without updating tender
        if (!fieldErrors.isEmpty()) {
            Map<String, Object> errResp = new LinkedHashMap<>();
            errResp.put("success", false);
            errResp.put("error", fieldErrors.values().iterator().next());
            errResp.put("errors", fieldErrors);
            return ResponseEntity.badRequest().body(errResp);
        }

        List<String> logDetails = new ArrayList<>();

        if (body.containsKey("status")) {
            String oldStatus = tender.getStatus();
            String newStatus = (String) body.get("status");
            tender.setStatus(newStatus);
            logDetails.add("status changed from '" + oldStatus + "' to '" + newStatus + "'");

            if ("Participating".equalsIgnoreCase(newStatus)) {
                if (tender.getCurrentStage() == null || "NEW".equalsIgnoreCase(tender.getCurrentStage()) || "INTAKE".equalsIgnoreCase(tender.getCurrentStage())) {
                    tender.setCurrentStage("SPEC_CLEARANCE");
                    logDetails.add("workflow stage auto-advanced to 'SPEC_CLEARANCE'");
                }
            } else if ("Awarded".equalsIgnoreCase(newStatus) || "Won".equalsIgnoreCase(newStatus)) {
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

        if (body.containsKey("quoted_qty") || body.containsKey("quotedQty")) {
            tender.setQuotedQty(parsedQuotedQty);
            logDetails.add("quoted quantity updated to " + parsedQuotedQty);
        }

        if (body.containsKey("bid_qty") || body.containsKey("bidQty")) {
            tender.setBidQty(parsedBidQty);
            logDetails.add("bid quantity updated to " + parsedBidQty);
        }

        if (body.containsKey("authority")) {
            String val = (String) body.get("authority");
            tender.setAuthority(val);
            logDetails.add("authority updated to '" + val + "'");
        }

        if (body.containsKey("ref_no") || body.containsKey("refNo")) {
            String val = (String) (body.containsKey("ref_no") ? body.get("ref_no") : body.get("refNo"));
            tender.setRefNo(val);
            logDetails.add("official reference number updated to '" + val + "'");
        }

        if (body.containsKey("estimated_cost_raw") || body.containsKey("estimatedCostRaw")) {
            String val = (String) (body.containsKey("estimated_cost_raw") ? body.get("estimated_cost_raw") : body.get("estimatedCostRaw"));
            tender.setEstimatedCostRaw(val);
            tender.setEstimatedCost(parsedEstCost);
            logDetails.add("estimated cost updated to '" + val + "'");
        } else if (body.containsKey("estimated_cost") || body.containsKey("estimatedCost")) {
            tender.setEstimatedCost(parsedEstCost);
            tender.setEstimatedCostRaw(parsedEstCost != null ? "₹ " + parsedEstCost : null);
        }

        if (body.containsKey("emd_raw") || body.containsKey("emdRaw")) {
            String val = (String) (body.containsKey("emd_raw") ? body.get("emd_raw") : body.get("emdRaw"));
            tender.setEmdRaw(val);
            tender.setEmd(parsedEmd);
            logDetails.add("EMD requirement updated to '" + val + "'");
        } else if (body.containsKey("emd")) {
            tender.setEmd(parsedEmd);
            tender.setEmdRaw(parsedEmd != null ? "₹ " + parsedEmd : null);
        }

        if (body.containsKey("document_fee_raw") || body.containsKey("documentFeeRaw")) {
            String val = (String) (body.containsKey("document_fee_raw") ? body.get("document_fee_raw") : body.get("documentFeeRaw"));
            tender.setDocumentFeeRaw(val);
            tender.setDocumentFee(parsedDocFee);
            logDetails.add("document fee updated to '" + val + "'");
        } else if (body.containsKey("document_fee") || body.containsKey("documentFee")) {
            tender.setDocumentFee(parsedDocFee);
            tender.setDocumentFeeRaw(parsedDocFee != null ? "₹ " + parsedDocFee : null);
        }

        if (body.containsKey("tender_type") || body.containsKey("tenderType")) {
            String val = (String) (body.containsKey("tender_type") ? body.get("tender_type") : body.get("tenderType"));
            tender.setTenderType(val);
            logDetails.add("tender type updated to '" + val + "'");
        }

        if (body.containsKey("source")) {
            String val = (String) body.get("source");
            tender.setSource(val);
            logDetails.add("source portal updated to '" + val + "'");
        }

        if (body.containsKey("source_id") || body.containsKey("sourceId")) {
            String val = (String) (body.containsKey("source_id") ? body.get("source_id") : body.get("sourceId"));
            tender.setSourceId(val);
            logDetails.add("source ID updated to '" + val + "'");
        }

        if (body.containsKey("location")) {
            String val = (String) body.get("location");
            tender.setLocation(val);
            logDetails.add("location updated to '" + val + "'");
        }

        if (body.containsKey("place")) {
            String val = (String) body.get("place");
            tender.setPlace(val);
            logDetails.add("place updated to '" + val + "'");
        }

        if (body.containsKey("state")) {
            String val = (String) body.get("state");
            tender.setState(val);
            logDetails.add("state updated to '" + val + "'");
        }

        if (body.containsKey("sector")) {
            String val = (String) body.get("sector");
            tender.setSector(val);
            logDetails.add("sector updated to '" + val + "'");
        }

        if (body.containsKey("vertical_name") || body.containsKey("verticalName")) {
            String val = (String) (body.containsKey("vertical_name") ? body.get("vertical_name") : body.get("verticalName"));
            tender.setVerticalName(val);
            logDetails.add("vertical name updated to '" + val + "'");
        }

        if (body.containsKey("publish_date") || body.containsKey("publishDate")) {
            String val = (String) (body.containsKey("publish_date") ? body.get("publish_date") : body.get("publishDate"));
            tender.setPublishDate(val);
            logDetails.add("publish date updated to '" + val + "'");
        }

        if (body.containsKey("start_date") || body.containsKey("startDate")) {
            String val = (String) (body.containsKey("start_date") ? body.get("start_date") : body.get("startDate"));
            tender.setStartDate(val);
            logDetails.add("start date updated to '" + val + "'");
        }

        if (body.containsKey("due_date") || body.containsKey("dueDate")) {
            String val = (String) (body.containsKey("due_date") ? body.get("due_date") : body.get("dueDate"));
            tender.setDueDate(val);
            logDetails.add("closing due date updated to '" + val + "'");
        }

        if (body.containsKey("opening_date") || body.containsKey("openingDate")) {
            String val = (String) (body.containsKey("opening_date") ? body.get("opening_date") : body.get("openingDate"));
            tender.setOpeningDate(val);
            logDetails.add("opening date updated to '" + val + "'");
        }

        if (body.containsKey("pre_bid_date") || body.containsKey("preBidDate")) {
            String val = (String) (body.containsKey("pre_bid_date") ? body.get("pre_bid_date") : body.get("preBidDate"));
            tender.setPreBidDate(val);
            logDetails.add("pre-bid meeting date updated to '" + val + "'");
        }

        if (body.containsKey("time")) {
            String val = (String) body.get("time");
            tender.setTime(val);
            logDetails.add("bid submission time updated to '" + val + "'");
        }

        if (body.containsKey("entry_date") || body.containsKey("entryDate")) {
            String val = (String) (body.containsKey("entry_date") ? body.get("entry_date") : body.get("entryDate"));
            tender.setEntryDate(val);
            logDetails.add("entry date updated to '" + val + "'");
        }

        if (body.containsKey("corrigendum_remark") || body.containsKey("corrigendumRemark")) {
            String val = (String) (body.containsKey("corrigendum_remark") ? body.get("corrigendum_remark") : body.get("corrigendumRemark"));
            tender.setCorrigendumRemark(val);
            logDetails.add("corrigendum remark updated to '" + val + "'");
        }

        if (body.containsKey("product_name_as_per_tender") || body.containsKey("productNameAsPerTender")) {
            String val = (String) (body.containsKey("product_name_as_per_tender") ? body.get("product_name_as_per_tender") : body.get("productNameAsPerTender"));
            tender.setProductNameAsPerTender(val);
            logDetails.add("product name as per tender updated to '" + val + "'");
        }

        if (body.containsKey("product_name_as_per_marken") || body.containsKey("productNameAsPerMarken")) {
            String val = (String) (body.containsKey("product_name_as_per_marken") ? body.get("product_name_as_per_marken") : body.get("productNameAsPerMarken"));
            tender.setProductNameAsPerMarken(val);
            logDetails.add("product name as per Marken updated to '" + val + "'");
        }

        if (body.containsKey("title")) {
            String val = (String) body.get("title");
            if (val != null && !val.trim().isEmpty()) {
                tender.setTitle(val.trim());
                logDetails.add("title / tender brief updated");
            }
        }

        if (body.containsKey("original_url") || body.containsKey("originalUrl")) {
            String val = (String) (body.containsKey("original_url") ? body.get("original_url") : body.get("originalUrl"));
            if (val != null && !val.trim().isEmpty()) {
                tender.setOriginalUrl(val.trim());
                logDetails.add("original URL updated");
            }
        }

        if (body.containsKey("mis_executive")) {
            String requestedStatus = body.containsKey("status") ? String.valueOf(body.get("status")) : tender.getStatus();
            boolean isMarkingNotParticipating = "Not Participating".equalsIgnoreCase(requestedStatus);
            if (!isMarkingNotParticipating) {
                String newExec = (String) body.get("mis_executive");
                String currentStatus = tender.getStatus();
                tender.setMisExecutive(newExec);
                tender.setAssignedBy(newExec != null && !newExec.trim().isEmpty() ? username : null);
                tender.setAssignedAt(newExec != null && !newExec.trim().isEmpty() ? new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()) : null);

                // Auto-participate if currently New, Issued, or Lapsed
                if (newExec != null && !newExec.trim().isEmpty()) {
                    if (currentStatus == null || "Issued".equalsIgnoreCase(currentStatus) || "New".equalsIgnoreCase(currentStatus) || "Lapsed".equalsIgnoreCase(currentStatus) || "Lapsed (Unreviewed)".equalsIgnoreCase(currentStatus)) {
                        tender.setStatus("Participating");
                        if (tender.getCurrentStage() == null || "NEW".equalsIgnoreCase(tender.getCurrentStage()) || "INTAKE".equalsIgnoreCase(tender.getCurrentStage())) {
                            tender.setCurrentStage("SPEC_CLEARANCE");
                        }
                        logDetails.add("status auto-changed to 'Participating' on executive assignment");
                    }
                }
                logDetails.add(newExec != null && !newExec.trim().isEmpty() ? "assigned to executive '" + newExec + "'" : "unassigned executive");
            }
        }

        if (body.containsKey("working_path") || body.containsKey("workingPath")) {
            String val = (String) (body.containsKey("working_path") ? body.get("working_path") : body.get("workingPath"));
            tender.setWorkingPath(val);
            logDetails.add("working path updated to '" + val + "'");
        }

        if (body.containsKey("downloaded_docs") || body.containsKey("downloadedDocs")) {
            String val = (String) (body.containsKey("downloaded_docs") ? body.get("downloaded_docs") : body.get("downloadedDocs"));
            tender.setDownloadedDocs(val);
            logDetails.add("downloaded docs updated");
        }

        if (body.containsKey("assigned_mis_member") || body.containsKey("assignedMisMember")) {
            String val = (String) (body.containsKey("assigned_mis_member") ? body.get("assigned_mis_member") : body.get("assignedMisMember"));
            tender.setAssignedMisMember(val);
            logDetails.add("assigned MIS member updated to '" + val + "'");
            if (tender.getAssignedMisMemberDocs() == null || tender.getAssignedMisMemberDocs().isBlank()) {
                syncPendingApprovalAssignee(tender.getId(), TenderWorkflowStage.DOC_VERIFICATION, val);
            }
            if (tender.getAssignedMisMemberEmd() == null || tender.getAssignedMisMemberEmd().isBlank()) {
                syncPendingApprovalAssignee(tender.getId(), TenderWorkflowStage.PAYMENT_APPROVAL, val);
            }
            if (tender.getAssignedMisMemberSubmission() == null || tender.getAssignedMisMemberSubmission().isBlank()) {
                syncPendingApprovalAssignee(tender.getId(), TenderWorkflowStage.SUBMISSION_PENDING, val);
                syncPendingApprovalAssignee(tender.getId(), TenderWorkflowStage.WIN_LOSS_PENDING, val);
            }
        }

        if (body.containsKey("assigned_mis_member_docs") || body.containsKey("assignedMisMemberDocs")) {
            String val = (String) (body.containsKey("assigned_mis_member_docs") ? body.get("assigned_mis_member_docs") : body.get("assignedMisMemberDocs"));
            tender.setAssignedMisMemberDocs(val);
            logDetails.add("assigned MIS docs member updated to '" + val + "'");
            syncPendingApprovalAssignee(tender.getId(), TenderWorkflowStage.DOC_VERIFICATION, val);
        }

        if (body.containsKey("assigned_mis_member_emd") || body.containsKey("assignedMisMemberEmd")) {
            String val = (String) (body.containsKey("assigned_mis_member_emd") ? body.get("assigned_mis_member_emd") : body.get("assignedMisMemberEmd"));
            tender.setAssignedMisMemberEmd(val);
            logDetails.add("assigned MIS EMD member updated to '" + val + "'");
            syncPendingApprovalAssignee(tender.getId(), TenderWorkflowStage.PAYMENT_APPROVAL, val);
        }

        if (body.containsKey("assigned_mis_member_submission") || body.containsKey("assignedMisMemberSubmission")) {
            String val = (String) (body.containsKey("assigned_mis_member_submission") ? body.get("assigned_mis_member_submission") : body.get("assignedMisMemberSubmission"));
            tender.setAssignedMisMemberSubmission(val);
            logDetails.add("assigned MIS submission member updated to '" + val + "'");
            syncPendingApprovalAssignee(tender.getId(), TenderWorkflowStage.SUBMISSION_PENDING, val);
            syncPendingApprovalAssignee(tender.getId(), TenderWorkflowStage.WIN_LOSS_PENDING, val);
        }

        if (body.containsKey("assigned_mis_member_spec") || body.containsKey("assignedMisMemberSpec")) {
            String val = (String) (body.containsKey("assigned_mis_member_spec") ? body.get("assigned_mis_member_spec") : body.get("assignedMisMemberSpec"));
            tender.setAssignedMisMemberSpec(val);
            logDetails.add("assigned Specification Team member updated to '" + val + "'");
            syncPendingApprovalAssignee(tender.getId(), TenderWorkflowStage.SPEC_CLEARANCE, val);
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
            if (List.of("Approved", "Rejected").contains(val)) {
                String targetAssignee = tender.getAssignedMisMemberEmd() != null && !tender.getAssignedMisMemberEmd().isBlank()
                        ? tender.getAssignedMisMemberEmd() : tender.getAssignedMisMember();
                if (!isUserAuthorizedForStage(userRole, username, targetAssignee, "misteam")) {
                    return ResponseEntity.status(HttpStatus.FORBIDDEN)
                            .body(Map.of("success", false, "error", "Access denied: EMD payment approval is assigned to " + targetAssignee + ". You have view-only access."));
                }
            }
            tender.setPaymentStatus(val);
            logDetails.add("payment status updated to '" + val + "'");
        }

        if (body.containsKey("verification_status") || body.containsKey("verificationStatus")) {
            String val = (String) (body.containsKey("verification_status") ? body.get("verification_status") : body.get("verificationStatus"));
            if (List.of("Approved", "Rejected").contains(val)) {
                String targetAssignee = tender.getAssignedMisMemberDocs() != null && !tender.getAssignedMisMemberDocs().isBlank()
                        ? tender.getAssignedMisMemberDocs() : tender.getAssignedMisMember();
                if (!isUserAuthorizedForStage(userRole, username, targetAssignee, "misteam")) {
                    return ResponseEntity.status(HttpStatus.FORBIDDEN)
                            .body(Map.of("success", false, "error", "Access denied: Document verification is assigned to " + targetAssignee + ". You have view-only access."));
                }
            }
            tender.setVerificationStatus(val);
            logDetails.add("verification status updated to '" + val + "'");
        }

        if (body.containsKey("submission_status") || body.containsKey("submissionStatus")) {
            String val = (String) (body.containsKey("submission_status") ? body.get("submission_status") : body.get("submissionStatus"));
            if (List.of("Approved", "Rejected").contains(val)) {
                String targetAssignee = tender.getAssignedMisMemberSubmission() != null && !tender.getAssignedMisMemberSubmission().isBlank()
                        ? tender.getAssignedMisMemberSubmission() : tender.getAssignedMisMember();
                if (!isUserAuthorizedForStage(userRole, username, targetAssignee, "misteam")) {
                    return ResponseEntity.status(HttpStatus.FORBIDDEN)
                            .body(Map.of("success", false, "error", "Access denied: Tender submission approval is assigned to " + targetAssignee + ". You have view-only access."));
                }
            }
            tender.setSubmissionStatus(val);
            logDetails.add("submission status updated to '" + val + "'");
        }

        if (body.containsKey("outcome_status") || body.containsKey("outcomeStatus")) {
            String val = (String) (body.containsKey("outcome_status") ? body.get("outcome_status") : body.get("outcomeStatus"));
            if (List.of("Won", "Lost").contains(val)) {
                String targetAssignee = tender.getAssignedMisMemberSubmission() != null && !tender.getAssignedMisMemberSubmission().isBlank()
                        ? tender.getAssignedMisMemberSubmission() : tender.getAssignedMisMember();
                if (!isUserAuthorizedForStage(userRole, username, targetAssignee, "misteam")) {
                    return ResponseEntity.status(HttpStatus.FORBIDDEN)
                            .body(Map.of("success", false, "error", "Access denied: Final outcome is assigned to " + targetAssignee + ". You have view-only access."));
                }
            }
            tender.setOutcomeStatus(val);
            logDetails.add("outcome status updated to '" + val + "'");
        }

        if (body.containsKey("spec_verification_status") || body.containsKey("specVerificationStatus")) {
            String val = (String) (body.containsKey("spec_verification_status") ? body.get("spec_verification_status") : body.get("specVerificationStatus"));
            if (List.of("Approved", "Rejected").contains(val)) {
                String targetAssignee = tender.getAssignedMisMemberSpec();
                if (!isUserAuthorizedForStage(userRole, username, targetAssignee, "clearance")) {
                    return ResponseEntity.status(HttpStatus.FORBIDDEN)
                            .body(Map.of("success", false, "error", "Access denied: Technical specification review is assigned to " + targetAssignee + ". You have view-only access."));
                }
            }
            tender.setSpecVerificationStatus(val);
            logDetails.add("spec verification status updated to '" + val + "'");

            if ("Approved".equalsIgnoreCase(val)) {
                tender.setCurrentStage("TPC_PRICING");
                logDetails.add("workflow stage auto-advanced to 'TPC_PRICING'");
                try {
                    List<TenderApprovalRequest> existingTpc = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tender.getId(), TenderWorkflowStage.TPC_PRICING);
                    if (existingTpc.isEmpty()) {
                        TenderApprovalRequest tpcReq = new TenderApprovalRequest(
                                tender.getId(),
                                TenderWorkflowStage.TPC_PRICING,
                                username,
                                "TPC Pricing Team",
                                "PENDING"
                        );
                        approvalRepository.save(tpcReq);
                    }
                } catch (Exception e) {}
            }
        }

        tender.setAiDetailsSummary(null);
        tender.setAiHistorySummary(null);
        tenderRepository.save(tender);

        // Audit Log
        try {
            ActivityLog log = new ActivityLog(
                    username, userRole, "Updated Tender", id,
                    new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()),
                    String.join(", ", logDetails)
            );
            activityLogRepository.save(log);
        } catch (Exception e) {
            System.err.println("[TenderController] Warning saving activity log for tender " + id + ": " + e.getMessage());
        }

        Map<String, Object> resp = new HashMap<>();
        resp.put("success", true);
        resp.put("message", "Tender updated successfully");
        resp.put("tender", createResponseCopy(tender));
        return ResponseEntity.ok(resp);
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
            // Generate PDF
            byte[] pdfBytes = documentGeneratorService.generatePdf(body);
            String pdfFileName = "Bid_Documents_" + id + ".pdf";
            String pdfDownloadUrl = "/documents/" + id + "/" + pdfFileName;
            persistDocument(id, pdfFileName, pdfBytes, "application/pdf");

            // Generate DOCX
            byte[] docxBytes = documentGeneratorService.generateDocx(body);
            String docFileName = "Bid_Documents_" + id + ".docx";
            String docDownloadUrl = "/documents/" + id + "/" + docFileName;
            persistDocument(id, docFileName, docxBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

            // Generate Technical Specification PDF
            byte[] techPdfBytes = documentGeneratorService.generateTechSpecPdf(body);
            String techPdfFileName = "Technical_Specification_Sheet_" + id + ".pdf";
            String techPdfDownloadUrl = "/documents/" + id + "/" + techPdfFileName;
            persistDocument(id, techPdfFileName, techPdfBytes, "application/pdf");

            // Generate Technical Specification DOCX
            byte[] techDocxBytes = documentGeneratorService.generateTechSpecDocx(body);
            String techDocFileName = "Technical_Specification_Sheet_" + id + ".docx";
            String techDocDownloadUrl = "/documents/" + id + "/" + techDocFileName;
            persistDocument(id, techDocFileName, techDocxBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

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

    private boolean isBidDocsProvided(Tender tender) {
        if (tender == null) return false;
        return tender.getWorkingPath() != null && !tender.getWorkingPath().trim().isEmpty();
    }

    @GetMapping("/{id}/tech-spec-progress")
    public ResponseEntity<?> getTechSpecProgress(@PathVariable("id") String id) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return WorkflowPermissions.denied();
        return ResponseEntity.ok(complianceProgressService.snapshot(id));
    }

    public ResponseEntity<?> uploadTechSpec(
            String userRole, String username, String id,
            org.springframework.web.multipart.MultipartFile file,
            String offeredModel, String offeredModelLegacy, String offeredMake,
            String scheduleNo, String productDescription) {
        return uploadTechSpec(userRole, username, id, file, offeredModel, offeredModelLegacy,
                offeredMake, scheduleNo, productDescription, null, null, null, null);
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
            @RequestParam(value = "productDescription", required = false) String productDescription,
            @RequestParam(value = "selected_model_id", required = false) Long selectedModelId,
            @RequestParam(value = "selectedModelId", required = false) Long selectedModelIdCamel,
            @RequestParam(value = "schedule_models", required = false) String scheduleModelsJson,
            @RequestParam(value = "scheduleModels", required = false) String scheduleModelsJsonCamel) {

        if (!WorkflowPermissions.allowed(UPLOAD_SPEC)) return WorkflowPermissions.denied();
        userRole = WorkflowPermissions.role();
        username = WorkflowPermissions.username();
        if (offeredModel == null || offeredModel.trim().isEmpty()) {
            offeredModel = offeredModelLegacy;
        }

        Long effectiveSelectedModelId = selectedModelId != null ? selectedModelId : selectedModelIdCamel;
        String effectiveScheduleModels = (scheduleModelsJson != null && !scheduleModelsJson.isBlank())
                ? scheduleModelsJson : scheduleModelsJsonCamel;

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
        if (file.getSize() > 50 * 1024 * 1024) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("success", false, "error", "File exceeds the maximum allowed size of 50MB."));
        }

        String originalFilename = file.getOriginalFilename() != null ? file.getOriginalFilename() : "specification.pdf";
        String lowerFilename = originalFilename.toLowerCase(Locale.ROOT);
        String ext = "";
        int dotIdx = lowerFilename.lastIndexOf('.');
        if (dotIdx >= 0) {
            ext = lowerFilename.substring(dotIdx);
        }
        if (!Set.of(".pdf", ".docx", ".doc", ".txt", ".xlsx", ".xls").contains(ext)) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                    "success", false,
                    "error", "Unsupported file format: " + (ext.isEmpty() ? "unknown" : ext) + ". Supported formats are PDF, DOCX, TXT, XLSX, and XLS."
            ));
        }

        byte[] uploadedBytes;
        try {
            uploadedBytes = file.getBytes();
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("success", false, "error", "Could not read uploaded file: " + e.getMessage()));
        }

        if (uploadedBytes == null || uploadedBytes.length == 0) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("success", false, "error", "Uploaded file is empty"));
        }
        if (uploadedBytes.length > 50 * 1024 * 1024) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("success", false, "error", "File exceeds the maximum allowed size of 50MB."));
        }

        // Validate actual file formats / magic bytes where practical
        if (ext.equals(".xlsx")) {
            boolean isZip = uploadedBytes.length >= 4 && uploadedBytes[0] == 0x50 && uploadedBytes[1] == 0x4B && uploadedBytes[2] == 0x03 && uploadedBytes[3] == 0x04;
            boolean isOle2 = uploadedBytes.length >= 8 && (uploadedBytes[0] & 0xFF) == 0xD0 && (uploadedBytes[1] & 0xFF) == 0xCF
                    && (uploadedBytes[2] & 0xFF) == 0x11 && (uploadedBytes[3] & 0xFF) == 0xE0;
            if (!isZip && !isOle2) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                        "success", false,
                        "error", "The uploaded file is not a valid Excel workbook. Please verify the file is a genuine .xlsx or .xls file."
                ));
            }
        } else if (ext.equals(".xls")) {
            boolean isOle2 = uploadedBytes.length >= 8 && (uploadedBytes[0] & 0xFF) == 0xD0 && (uploadedBytes[1] & 0xFF) == 0xCF
                    && (uploadedBytes[2] & 0xFF) == 0x11 && (uploadedBytes[3] & 0xFF) == 0xE0;
            if (!isOle2) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                        "success", false,
                        "error", "The uploaded file is not a valid Excel workbook. Please verify the file is a genuine .xlsx or .xls file."
                ));
            }
        } else if (ext.equals(".txt")) {
            if (uploadedBytes.length >= 4 && uploadedBytes[0] == 0x50 && uploadedBytes[1] == 0x4B && uploadedBytes[2] == 0x03 && uploadedBytes[3] == 0x04) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                        "success", false,
                        "error", "The file appears to be an Excel workbook renamed with a .txt extension. Please upload it as an .xlsx or .xls file."
                ));
            }
            if (uploadedBytes.length >= 8 && (uploadedBytes[0] & 0xFF) == 0xD0 && (uploadedBytes[1] & 0xFF) == 0xCF
                    && (uploadedBytes[2] & 0xFF) == 0x11 && (uploadedBytes[3] & 0xFF) == 0xE0) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                        "success", false,
                        "error", "The file appears to be an Excel workbook renamed with a .txt extension. Please upload it as an .xlsx or .xls file."
                ));
            }
        }

        complianceProgressService.start(id, originalFilename);
        ComplianceConversionMetrics conversionMetrics = complianceProgressService.metricsFor(id);

        try {
            Path docDir = Paths.get(uploadDir, id);
            Files.createDirectories(docDir);

            System.out.println("================================================================================");
            System.out.println("⚡ [TECH SPEC LOG] Upload Received for Tender ID: " + id);
            System.out.println("⚡ [TECH SPEC LOG] File Name: " + originalFilename + " (" + uploadedBytes.length + " bytes)");
            System.out.println("⚡ [TECH SPEC LOG] AI Model Targeted: Azure OpenAI (gpt-5-nano)");
            System.out.println("================================================================================");
            System.out.flush();

            String savedFilename = "specification" + (ext.isEmpty() ? ".pdf" : ext);
            String inputContentType = resolveContentTypeByExtension(savedFilename);
            String inputDownloadUrl = "/documents/" + id + "/" + savedFilename;
            persistDocument(id, savedFilename, uploadedBytes, inputContentType);
            complianceProgressService.update(id, "UPLOADED",
                    "Upload saved. Inspecting " + originalFilename + ".", 3, 0, 0, 0);

            // Save offeredModel on Tender entity if passed
            if (offeredModel != null && !offeredModel.trim().isEmpty()) {
                tender.setOfferedModel(offeredModel.trim());
            }
            if (effectiveSelectedModelId != null) {
                tender.setSelectedModelId(effectiveSelectedModelId);
            }
            if (effectiveScheduleModels != null && !effectiveScheduleModels.isBlank()) {
                tender.setScheduleProductModels(effectiveScheduleModels);
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
            data.put("signatoryName", "Shreedhar Shingare");
            data.put("signatoryDesignation", "Authorized Signatory (Tender manager)");
            data.put("signatoryAddress", "Nashik Maharashtra.");
            if (tender.getAuthority() != null && !tender.getAuthority().trim().isEmpty()) {
                data.put("recipientName", tender.getAuthority().trim());
            }
            if (tender.getLocation() != null && !tender.getLocation().trim().isEmpty()) {
                data.put("recipientAddress", tender.getLocation().trim());
            }
            if (tender.getBidQty() != null && tender.getBidQty() > 0) {
                data.put("qty", String.format(Locale.ROOT, "%02d", tender.getBidQty()));
            }

            // 3. Parse product compliance clauses from specification.pdf (with OCR fallback & tender context)
            List<String[]> extractedClauses = documentGeneratorService.parseSpecificationClauses(
                    uploadedBytes, originalFilename, data,
                    (stage, message, percent, completed, total, clauses) ->
                            complianceProgressService.update(id, stage, message, percent,
                                    completed, total, clauses), conversionMetrics);

            // 4. Evidence Matching: Match clauses against verified product specifications from catalogue
            if (productCatalogueService != null && extractedClauses != null && !extractedClauses.isEmpty() && !AISpecificationIntelligenceService.isCompletedEmpty(extractedClauses)) {
                complianceProgressService.update(id, "MATCHING_EVIDENCE",
                        "Matching requirements against verified product specifications.", 79, 0, 0, extractedClauses.size());
                extractedClauses = productCatalogueService.matchTenderClausesWithEvidence(tender, extractedClauses);
            }

            if (AISpecificationIntelligenceService.isCompletedEmpty(extractedClauses)) {
                String message = "No products found with applicable compliance requirements.";
                tender.setDownloadedDocs(appendOrUpdateDownloadedDocs(tender.getDownloadedDocs(),
                        List.of(Map.of("name", "Uploaded Input (" + originalFilename + ")", "filename", savedFilename,
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
            newDocs.add(Map.of("name", "Uploaded Input (" + originalFilename + ")", "filename", savedFilename,
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
            persistDocument(id, pdfFileName, pdfBytes, "application/pdf");
            persistDocument(id, docxFileName, docxBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            persistDocument(id, xlsxFileName, xlsxBytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
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
                    "Uploaded " + originalFilename + " and generated Technical Specification Sheet PDF, DOCX & XLSX outputs with " + extractedClauses.size() + " extracted clauses."
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

        } catch (IllegalArgumentException e) {
            complianceProgressService.fail(id, e.getMessage());
            Map<String, Object> failure = new LinkedHashMap<>();
            failure.put("success", false);
            failure.put("error", e.getMessage());
            failure.put("metrics", conversionMetrics != null ? conversionMetrics.snapshot() : Map.of());
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(failure);
        } catch (Exception e) {
            e.printStackTrace();
            complianceProgressService.fail(id, "Compliance creation failed: " + e.getMessage());
            Map<String, Object> failure = new LinkedHashMap<>();
            failure.put("success", false);
            failure.put("error", "Failed to upload technical specification: " + e.getMessage());
            failure.put("metrics", conversionMetrics != null ? conversionMetrics.snapshot() : Map.of());
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
            // Generate Technical Specification PDF
            byte[] pdfBytes = documentGeneratorService.generateTechSpecPdf(body);
            String pdfFileName = "Technical_Specification_Sheet_" + id + ".pdf";
            String pdfDownloadUrl = "/documents/" + id + "/" + pdfFileName;
            persistDocument(id, pdfFileName, pdfBytes, "application/pdf");

            // Generate Technical Specification DOCX
            byte[] docxBytes = documentGeneratorService.generateTechSpecDocx(body);
            String docFileName = "Technical_Specification_Sheet_" + id + ".docx";
            String docDownloadUrl = "/documents/" + id + "/" + docFileName;
            persistDocument(id, docFileName, docxBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

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

    /**
     * Delegates to the shared resolver. This copy previously returned the stored status verbatim
     * as its fallback, so a scraped tender - which GeMScraperService stores as "Issued" - matched
     * neither the "New" nor the "Lapsed" filter and the list came back empty for every status.
     * Its Lapsed branch was also unreachable, because scraped_at is written with
     * java.util.Date.toString() and LocalDate.parse("Sun") threw into an empty catch.
     */
    private String resolveStatus(Tender t, String todayIST) {
        return com.tenderpocket.services.TenderStatusResolver.resolve(t, todayIST);
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
    public ResponseEntity<?> downloadDocumentFile(
            @PathVariable("id") String id,
            @PathVariable("fileName") String fileName) {
        if (!WorkflowPermissions.allowed(VIEW_TENDERS)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();

        Path filePath = resolveSafeLocalPath(id, fileName);
        if (filePath == null) {
            return ResponseEntity.badRequest().build();
        }

        try {
            String objectKey = "tenders/" + id + "/" + fileName;

            // 1. If S3 is enabled, check if the object exists in S3
            if (awsS3Enabled && objectStorageService != null && objectStorageService.isRemote()) {
                try {
                    if (objectStorageService.exists(objectKey)) {
                        String presignedUrl = objectStorageService.generateDownloadUrl(objectKey);
                        return ResponseEntity.status(HttpStatus.FOUND)
                                .location(java.net.URI.create(presignedUrl))
                                .build();
                    }
                    // Object not in S3: Check existing local documents compatibility fallback
                    System.out.println("[TenderController] Object " + objectKey + " not in S3, checking local storage compatibility fallback...");
                } catch (Exception s3Ex) {
                    System.err.println("[TenderController] S3 error checking existence for key " + objectKey + ": " + s3Ex.getMessage());
                    File localFile = filePath.toFile();
                    if (!localFile.exists() || !localFile.isFile()) {
                        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                                .body(Map.of("success", false, "error", "S3 document storage error: " + s3Ex.getMessage()));
                    }
                    System.out.println("[TenderController] Serving historical local file for " + objectKey + " despite S3 failure.");
                }
            }

            // 2. Safe compatibility / local file serving
            File file = filePath.toFile();
            if (file.exists() && file.isFile()) {
                org.springframework.core.io.Resource resource = new org.springframework.core.io.UrlResource(filePath.toUri());
                String contentType = java.nio.file.Files.probeContentType(filePath);
                if (contentType == null) {
                    contentType = resolveContentTypeByExtension(fileName);
                }

                return ResponseEntity.ok()
                        .contentType(org.springframework.http.MediaType.parseMediaType(contentType))
                        .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + file.getName() + "\"")
                        .body(resource);
            }

            // 3. Not found in storage
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    private boolean isUserAuthorizedForStage(String userRole, String username, String assignedMember, String teamQueueName) {
        if ("Admin".equalsIgnoreCase(userRole)) return true;
        if (username == null || username.isBlank()) return false;
        if (assignedMember == null || assignedMember.isBlank() || assignedMember.equalsIgnoreCase(teamQueueName)
                || assignedMember.toLowerCase().contains("team")) {
            return true;
        }
        return assignedMember.equalsIgnoreCase(username);
    }

    private void syncPendingApprovalAssignee(String tenderId, TenderWorkflowStage stage, String assignee) {
        if (tenderId == null || stage == null) return;
        try {
            List<TenderApprovalRequest> requests = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, stage);
            for (TenderApprovalRequest req : requests) {
                if ("PENDING".equalsIgnoreCase(req.getStatus())) {
                    req.setAssignedTo(assignee != null && !assignee.isBlank() ? assignee : null);
                    req.setUpdatedAt(java.time.LocalDateTime.now());
                    approvalRepository.save(req);
                }
            }
        } catch (Exception ignored) {}
    }
}
