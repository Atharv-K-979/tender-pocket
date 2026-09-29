package com.tenderpocket.services;

import com.tenderpocket.models.EmailNotificationLog;
import com.tenderpocket.models.NotificationItemDto;
import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.models.User;
import com.tenderpocket.repositories.EmailNotificationLogRepository;
import com.tenderpocket.repositories.TenderApprovalRepository;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.repositories.UserRepository;
import jakarta.mail.internet.MimeMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class EmailNotificationService {

    private static final List<String> ACTIVE_STATUSES = List.of(
            "Issued", "Participating", "New"
    );

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private TenderApprovalRepository approvalRepository;

    @Autowired
    private EmailNotificationLogRepository notificationLogRepository;

    @Autowired
    private JavaMailSender mailSender;

    @Value("${spring.mail.username:}")
    private String fromEmail;

    /**
     * Deterministic daily scheduler at 8:00 AM IST.
     */
    @Scheduled(cron = "0 0 8 * * *", zone = "Asia/Kolkata")
    public void sendDailyNotifications() {
        System.out.println("[EmailNotificationService] Starting daily scheduled notification run at 8:00 AM IST...");
        processDailyNotifications(LocalDate.now());
    }

    /**
     * Backward-compatible trigger method.
     */
    public void sendDueDateAlerts() {
        processDailyNotifications(LocalDate.now());
    }

    /**
     * Overloaded method for processing with default today date.
     */
    public Map<String, Object> processDailyNotifications() {
        return processDailyNotifications(LocalDate.now());
    }

    /**
     * Core daily notification processing engine.
     * Takes target reference date (today) to support testability.
     */
    public Map<String, Object> processDailyNotifications(LocalDate today) {
        Map<String, Object> metrics = new HashMap<>();
        int dueT0Found = 0;
        int dueT3Found = 0;
        int unreviewedFound = 0;
        int pendingApprovalsFound = 0;
        int duplicatesSkipped = 0;
        int emailsSent = 0;
        int emailsFailed = 0;

        DateTimeFormatter isoFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");
        String todayStr = today.format(isoFormatter);
        String t3Str = today.plusDays(3).format(isoFormatter);

        // Grouping map: recipientUsername -> List of NotificationItemDto
        Map<String, List<NotificationItemDto>> userItemsMap = new LinkedHashMap<>();

        // ── 1. Due Date Notifications (T0: today, T-3: today + 3 days) ───────────
        // A. T0 (Due Today)
        List<Tender> t0Tenders = tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(ACTIVE_STATUSES, todayStr);
        for (Tender t : t0Tenders) {
            dueT0Found++;
            String exec = t.getMisExecutive() != null ? t.getMisExecutive().trim() : "";
            if (exec.isEmpty()) continue;

            String tenderId = t.getId();
            String notifType = "DUE_T0";

            if (notificationLogRepository.existsByRecipientUsernameAndTenderIdAndNotificationTypeAndSentDateAndStatus(
                    exec, tenderId, notifType, today, "SENT")) {
                duplicatesSkipped++;
                continue;
            }

            NotificationItemDto item = new NotificationItemDto(
                    t.getId(), t.getRefNo(), t.getTitle(), t.getAuthority(),
                    t.getDueDate(), "DUE TODAY", "Final Bid Submission Deadline",
                    notifType, exec, null, null, null
            );
            userItemsMap.computeIfAbsent(exec, k -> new ArrayList<>()).add(item);
        }

        // B. T-3 (Due in exactly 3 days)
        List<Tender> t3Tenders = tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(ACTIVE_STATUSES, t3Str);
        for (Tender t : t3Tenders) {
            dueT3Found++;
            String exec = t.getMisExecutive() != null ? t.getMisExecutive().trim() : "";
            if (exec.isEmpty()) continue;

            String tenderId = t.getId();
            String notifType = "DUE_T3";

            if (notificationLogRepository.existsByRecipientUsernameAndTenderIdAndNotificationTypeAndSentDateAndStatus(
                    exec, tenderId, notifType, today, "SENT")) {
                duplicatesSkipped++;
                continue;
            }

            NotificationItemDto item = new NotificationItemDto(
                    t.getId(), t.getRefNo(), t.getTitle(), t.getAuthority(),
                    t.getDueDate(), "3 DAYS LEFT", "Upcoming Bid Submission Deadline",
                    notifType, exec, null, null, null
            );
            userItemsMap.computeIfAbsent(exec, k -> new ArrayList<>()).add(item);
        }

        // ── 2. Unreviewed Tenders (> 3 days old, unassigned executive) ───────────
        List<Tender> unreviewedCandidates = tenderRepository.findUnreviewedCandidates();
        for (Tender t : unreviewedCandidates) {
            long ageDays = calculateTenderAgeInDays(t, today);
            // Requirement strictly: MORE THAN 3 DAYS (ageDays > 3)
            if (ageDays > 3) {
                unreviewedFound++;
                String adminUser = "admin";
                String notifType = "UNREVIEWED";

                if (notificationLogRepository.existsByRecipientUsernameAndTenderIdAndNotificationTypeAndSentDateAndStatus(
                        adminUser, t.getId(), notifType, today, "SENT")) {
                    duplicatesSkipped++;
                    continue;
                }

                NotificationItemDto item = new NotificationItemDto(
                        t.getId(), t.getRefNo(), t.getTitle(), t.getAuthority(),
                        t.getDueDate(), null, "Tender unreviewed for >3 days",
                        notifType, adminUser, null, null, (int) ageDays
                );
                userItemsMap.computeIfAbsent(adminUser, k -> new ArrayList<>()).add(item);
            }
        }

        // ── 3. Pending Workflow / Approval Actions ────────────────────────────────
        List<TenderApprovalRequest> pendingRequests = approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING");
        for (TenderApprovalRequest req : pendingRequests) {
            pendingApprovalsFound++;
            String assignedUser = resolveApprovalRecipientUsername(req.getAssignedTo(), req.getStage());
            if (assignedUser == null || assignedUser.isEmpty()) continue;

            String stageName = req.getStage() != null ? req.getStage().name() : "GENERAL";
            String notifType = "PENDING_" + stageName;

            if (notificationLogRepository.existsByRecipientUsernameAndTenderIdAndNotificationTypeAndSentDateAndStatus(
                    assignedUser, req.getTenderId(), notifType, today, "SENT")) {
                duplicatesSkipped++;
                continue;
            }

            Optional<Tender> tOpt = tenderRepository.findById(req.getTenderId());
            String title = tOpt.map(Tender::getTitle).orElse("Tender " + req.getTenderId());
            String refNo = tOpt.map(Tender::getRefNo).orElse(null);
            String authority = tOpt.map(Tender::getAuthority).orElse(null);
            String actionDesc = mapStageToActionDescription(req.getStage());

            NotificationItemDto item = new NotificationItemDto(
                    req.getTenderId(), refNo, title, authority,
                    null, null, actionDesc,
                    notifType, assignedUser, req.getRequestedBy(), req.getId(), null
            );
            userItemsMap.computeIfAbsent(assignedUser, k -> new ArrayList<>()).add(item);
        }

        // ── 4. Group Emails & Dispatch per Individual User ─────────────────────────
        for (Map.Entry<String, List<NotificationItemDto>> entry : userItemsMap.entrySet()) {
            String username = entry.getKey();
            List<NotificationItemDto> items = entry.getValue();
            if (items.isEmpty()) continue;

            Optional<User> userOpt = userRepository.findById(username);
            if (userOpt.isEmpty()) {
                System.err.println("[EmailNotificationService] Recipient user '" + username + "' not found in database. Skipping dispatch.");
                recordLogs(items, username, null, today, "FAILED", "Recipient user '" + username + "' not found in database");
                emailsFailed++;
                continue;
            }

            User user = userOpt.get();
            String recipientEmail = user.getEmail();
            if (recipientEmail == null || recipientEmail.trim().isEmpty()) {
                System.err.println("[EmailNotificationService] User '" + username + "' has no email address configured. Skipping dispatch.");
                recordLogs(items, username, null, today, "FAILED", "User '" + username + "' has no email address configured");
                emailsFailed++;
                continue;
            }

            recipientEmail = recipientEmail.trim();
            boolean success = sendConsolidatedEmailWithRetry(username, recipientEmail, items, today);
            if (success) {
                recordLogs(items, username, recipientEmail, today, "SENT", null);
                emailsSent++;
                System.out.println("[EmailNotificationService] Successfully sent consolidated digest to " + username + " (" + recipientEmail + ") with " + items.size() + " items.");
            } else {
                recordLogs(items, username, recipientEmail, today, "FAILED", "Failed to send email after retry attempts");
                emailsFailed++;
                System.err.println("[EmailNotificationService] Failed to send consolidated digest to " + username + " (" + recipientEmail + ") after all retries.");
            }
        }

        metrics.put("date", todayStr);
        metrics.put("dueT0Found", dueT0Found);
        metrics.put("dueT3Found", dueT3Found);
        metrics.put("unreviewedFound", unreviewedFound);
        metrics.put("pendingApprovalsFound", pendingApprovalsFound);
        metrics.put("duplicatesSkipped", duplicatesSkipped);
        metrics.put("uniqueRecipients", userItemsMap.size());
        metrics.put("emailsSent", emailsSent);
        metrics.put("emailsFailed", emailsFailed);

        System.out.println("[EmailNotificationService] Notification run finished. Sent: " + emailsSent + ", Failed: " + emailsFailed + ", Skipped: " + duplicatesSkipped);
        return metrics;
    }

    /**
     * Resolves pending approval assignedTo strings to individual usernames.
     * Normalized rules:
     * - "TPC Team" -> "tpc"
     * - "MIS Team" -> "misteam"
     * - "Clearance Team" -> "clearance"
     * - Default fallbacks based on stage if assignedTo is empty or null.
     */
    public String resolveApprovalRecipientUsername(String rawAssignedTo, TenderWorkflowStage stage) {
        if (rawAssignedTo != null) {
            String trimmed = rawAssignedTo.trim();
            if ("TPC Team".equalsIgnoreCase(trimmed) || "TPC".equalsIgnoreCase(trimmed)) {
                return "tpc";
            }
            if ("MIS Team".equalsIgnoreCase(trimmed) || "MIS".equalsIgnoreCase(trimmed)) {
                return "misteam";
            }
            if ("Clearance Team".equalsIgnoreCase(trimmed) || "Clearance".equalsIgnoreCase(trimmed)) {
                return "clearance";
            }
            if (!trimmed.isEmpty()) {
                return trimmed;
            }
        }

        // Fallback based on stage when unassigned
        if (stage == null) return "misteam";
        return switch (stage) {
            case SPEC_CLEARANCE -> "clearance";
            case TPC_PRICING -> "tpc";
            case MIS_PRICING, PAYMENT_APPROVAL, DOC_VERIFICATION, SUBMISSION_PENDING, WIN_LOSS_PENDING -> "misteam";
            default -> "admin";
        };
    }

    /**
     * Map workflow stage to readable pending action text.
     */
    private String mapStageToActionDescription(TenderWorkflowStage stage) {
        if (stage == null) return "Action Pending";
        return switch (stage) {
            case SPEC_CLEARANCE -> "Technical Specification Clearance";
            case TPC_PRICING -> "Manufacturer Purchase Price (TPC)";
            case MIS_PRICING -> "Client Final Pricing (MIS)";
            case DOC_VERIFICATION -> "Bid Document Verification";
            case PAYMENT_APPROVAL -> "EMD Payment Approval";
            case SUBMISSION_PENDING -> "Portal Submission Confirmation";
            case WIN_LOSS_PENDING -> "Win/Loss Outcome Review";
            default -> stage.name().replace('_', ' ');
        };
    }

    /**
     * Calculates the age of a tender in days relative to the reference date.
     * Checks entry_date ("d MMM yyyy" or "yyyy-MM-dd"), publish_date, and scraped_at.
     */
    public long calculateTenderAgeInDays(Tender t, LocalDate today) {
        // 1. Try entryDate
        if (t.getEntryDate() != null && !t.getEntryDate().trim().isEmpty()) {
            LocalDate d = parseDateString(t.getEntryDate().trim());
            if (d != null) {
                return ChronoUnit.DAYS.between(d, today);
            }
        }

        // 2. Try publishDate
        if (t.getPublishDate() != null && !t.getPublishDate().trim().isEmpty() && !"N/A".equalsIgnoreCase(t.getPublishDate())) {
            LocalDate d = parseDateString(t.getPublishDate().trim());
            if (d != null) {
                return ChronoUnit.DAYS.between(d, today);
            }
        }

        // 3. Try scrapedAt
        if (t.getScrapedAt() != null && !t.getScrapedAt().trim().isEmpty()) {
            LocalDate d = parseDateString(t.getScrapedAt().trim());
            if (d != null) {
                return ChronoUnit.DAYS.between(d, today);
            }
        }

        return 0;
    }

    /**
     * Robust date string parser supporting multiple formats.
     */
    public LocalDate parseDateString(String dateStr) {
        if (dateStr == null || dateStr.trim().isEmpty()) return null;
        String clean = dateStr.trim();

        // 1. Try yyyy-MM-dd prefix
        if (clean.length() >= 10 && clean.charAt(4) == '-' && clean.charAt(7) == '-') {
            try {
                return LocalDate.parse(clean.substring(0, 10), DateTimeFormatter.ISO_LOCAL_DATE);
            } catch (Exception ignored) {}
        }

        // 2. Try "d MMM yyyy" e.g. "7 Jun 2026", "21 Sep 2026"
        try {
            DateTimeFormatter formatter = new DateTimeFormatterBuilder()
                    .parseCaseInsensitive()
                    .appendPattern("d MMM yyyy")
                    .toFormatter(Locale.ENGLISH);
            return LocalDate.parse(clean, formatter);
        } catch (Exception ignored) {}

        // 3. Try "dd-MM-yyyy"
        try {
            return LocalDate.parse(clean, DateTimeFormatter.ofPattern("dd-MM-yyyy"));
        } catch (Exception ignored) {}

        // 4. Try "dd/MM/yyyy"
        try {
            return LocalDate.parse(clean, DateTimeFormatter.ofPattern("dd/MM/yyyy"));
        } catch (Exception ignored) {}

        return null;
    }

    /**
     * Builds clean, responsive HTML email without any direct URLs.
     */
    public String buildDigestHtml(String username, List<NotificationItemDto> items, LocalDate date) {
        String formattedDate = date.format(DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.ENGLISH));

        List<NotificationItemDto> deadlines = items.stream()
                .filter(i -> "DUE_T0".equals(i.getNotificationType()) || "DUE_T3".equals(i.getNotificationType()))
                .toList();

        List<NotificationItemDto> approvals = items.stream()
                .filter(i -> i.getNotificationType() != null && i.getNotificationType().startsWith("PENDING_"))
                .toList();

        List<NotificationItemDto> unreviewed = items.stream()
                .filter(i -> "UNREVIEWED".equals(i.getNotificationType()))
                .toList();

        StringBuilder sb = new StringBuilder();
        sb.append("<!DOCTYPE html><html><head><meta charset='UTF-8'>")
          .append("<style>")
          .append("body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; color: #1e293b; margin: 0; padding: 24px; }")
          .append(".container { max-width: 680px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }")
          .append(".header { background: #1e3a8a; color: #ffffff; padding: 24px; text-align: left; }")
          .append(".header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }")
          .append(".header p { margin: 6px 0 0 0; font-size: 13px; color: #bfdbfe; }")
          .append(".content { padding: 24px; }")
          .append("h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.05em; margin: 24px 0 12px 0; padding-bottom: 6px; border-bottom: 2px solid #e2e8f0; }")
          .append(".h2-urgent { color: #dc2626; border-bottom-color: #fee2e2; }")
          .append(".h2-pending { color: #2563eb; border-bottom-color: #dbeafe; }")
          .append(".h2-unreviewed { color: #d97706; border-bottom-color: #fef3c7; }")
          .append("table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }")
          .append("th { background: #f8fafc; color: #475569; font-weight: 600; text-align: left; padding: 10px 12px; border-bottom: 1px solid #cbd5e1; font-size: 12px; }")
          .append("td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; vertical-align: top; word-break: break-word; }")
          .append(".badge-t0 { display: inline-block; background-color: #fee2e2; color: #dc2626; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 11px; }")
          .append(".badge-t3 { display: inline-block; background-color: #fef3c7; color: #d97706; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 11px; }")
          .append(".badge-age { display: inline-block; background-color: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11px; }")
          .append(".footer { background: #f8fafc; padding: 16px 24px; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; text-align: center; }")
          .append("</style></head><body>");

        sb.append("<div class='container'>");

        // Header & Subheader
        sb.append("<div class='header'>")
          .append("<h1>TenderPocket Daily Action Digest</h1>")
          .append("<p>Pending Tasks &amp; Deadlines for ").append(escapeHtml(username)).append(" — ").append(escapeHtml(formattedDate)).append("</p>")
          .append("</div>");

        sb.append("<div class='content'>");

        // Section 1: Urgent Deadlines
        if (!deadlines.isEmpty()) {
            sb.append("<h2 class='h2-urgent'>Urgent Deadlines</h2>")
              .append("<table><thead><tr>")
              .append("<th style='width: 25%;'>Tender ID / Bid Number</th>")
              .append("<th style='width: 35%;'>Tender Title</th>")
              .append("<th style='width: 20%;'>Authority</th>")
              .append("<th style='width: 10%;'>Due Date</th>")
              .append("<th style='width: 10%;'>Days Left</th>")
              .append("</tr></thead><tbody>");

            for (NotificationItemDto item : deadlines) {
                String badge = "DUE_T0".equals(item.getNotificationType())
                        ? "<span class='badge-t0'>DUE TODAY</span>"
                        : "<span class='badge-t3'>3 DAYS LEFT</span>";

                String idDisplay = item.getRefNo() != null && !item.getRefNo().isEmpty() ? item.getRefNo() : item.getTenderId();

                sb.append("<tr>")
                  .append("<td><strong>").append(escapeHtml(idDisplay)).append("</strong></td>")
                  .append("<td>").append(escapeHtml(item.getTitle())).append("</td>")
                  .append("<td>").append(escapeHtml(item.getAuthority() != null ? item.getAuthority() : "N/A")).append("</td>")
                  .append("<td>").append(escapeHtml(item.getDueDate() != null ? item.getDueDate().split(" ")[0] : "N/A")).append("</td>")
                  .append("<td>").append(badge).append("</td>")
                  .append("</tr>");
            }
            sb.append("</tbody></table>");
        }

        // Section 2: Pending Approvals / Workflow Actions
        if (!approvals.isEmpty()) {
            sb.append("<h2 class='h2-pending'>Pending Approvals / Workflow Actions</h2>")
              .append("<table><thead><tr>")
              .append("<th style='width: 25%;'>Tender ID / Bid Number</th>")
              .append("<th style='width: 35%;'>Tender Title</th>")
              .append("<th style='width: 25%;'>Stage / Action Required</th>")
              .append("<th style='width: 15%;'>Requested By</th>")
              .append("</tr></thead><tbody>");

            for (NotificationItemDto item : approvals) {
                String idDisplay = item.getRefNo() != null && !item.getRefNo().isEmpty() ? item.getRefNo() : item.getTenderId();
                sb.append("<tr>")
                  .append("<td><strong>").append(escapeHtml(idDisplay)).append("</strong></td>")
                  .append("<td>").append(escapeHtml(item.getTitle())).append("</td>")
                  .append("<td>").append(escapeHtml(item.getPendingAction())).append("</td>")
                  .append("<td>").append(escapeHtml(item.getRequestedBy() != null ? item.getRequestedBy() : "System")).append("</td>")
                  .append("</tr>");
            }
            sb.append("</tbody></table>");
        }

        // Section 3: Unreviewed Tenders (Only when recipient is admin and qualifying tenders exist)
        if ("admin".equalsIgnoreCase(username) && !unreviewed.isEmpty()) {
            sb.append("<h2 class='h2-unreviewed'>Unreviewed Tenders</h2>")
              .append("<table><thead><tr>")
              .append("<th style='width: 25%;'>Tender ID / Bid Number</th>")
              .append("<th style='width: 40%;'>Tender Title</th>")
              .append("<th style='width: 20%;'>Authority</th>")
              .append("<th style='width: 15%;'>Age / Days Unreviewed</th>")
              .append("</tr></thead><tbody>");

            for (NotificationItemDto item : unreviewed) {
                String idDisplay = item.getRefNo() != null && !item.getRefNo().isEmpty() ? item.getRefNo() : item.getTenderId();
                String ageDisplay = item.getDaysUnreviewed() != null ? item.getDaysUnreviewed() + " days" : "> 3 days";

                sb.append("<tr>")
                  .append("<td><strong>").append(escapeHtml(idDisplay)).append("</strong></td>")
                  .append("<td>").append(escapeHtml(item.getTitle())).append("</td>")
                  .append("<td>").append(escapeHtml(item.getAuthority() != null ? item.getAuthority() : "N/A")).append("</td>")
                  .append("<td><span class='badge-age'>").append(escapeHtml(ageDisplay)).append("</span></td>")
                  .append("</tr>");
            }
            sb.append("</tbody></table>");
        }

        sb.append("</div>"); // .content

        // Footer
        sb.append("<div class='footer'>")
          .append("This is an automated notification from TenderPocket. Please sign in to your dashboard to review and complete pending actions.")
          .append("</div>");

        sb.append("</div></body></html>");
        return sb.toString();
    }

    private boolean sendConsolidatedEmailWithRetry(String username, String recipientEmail,
                                                   List<NotificationItemDto> items, LocalDate date) {
        String subject = String.format("[TenderPocket] Daily Action Digest (%d Pending Items) - %s",
                items.size(), date.format(DateTimeFormatter.ofPattern("yyyy-MM-dd")));
        String htmlContent = buildDigestHtml(username, items, date);

        int maxRetries = 3;
        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                MimeMessage message = mailSender.createMimeMessage();
                MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

                if (fromEmail != null && !fromEmail.trim().isEmpty()) {
                    helper.setFrom(fromEmail.trim());
                }
                helper.setTo(recipientEmail);
                helper.setSubject(subject);
                helper.setText(htmlContent, true);

                mailSender.send(message);
                return true;
            } catch (Exception e) {
                System.err.println("[EmailNotificationService] Sending email to " + recipientEmail + " failed on attempt " + attempt + "/" + maxRetries + ": " + e.getMessage());
                if (attempt < maxRetries) {
                    try {
                        Thread.sleep(1000L * attempt);
                    } catch (InterruptedException ignored) {}
                }
            }
        }
        return false;
    }

    private void recordLogs(List<NotificationItemDto> items, String username, String email,
                            LocalDate date, String status, String error) {
        for (NotificationItemDto item : items) {
            try {
                EmailNotificationLog log = new EmailNotificationLog(
                        username, email, item.getTenderId(), item.getNotificationType(), date, status, error
                );
                notificationLogRepository.save(log);
            } catch (Exception ex) {
                System.err.println("[EmailNotificationService] Failed to record notification log for tender " + item.getTenderId() + ": " + ex.getMessage());
            }
        }
    }

    private String escapeHtml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
