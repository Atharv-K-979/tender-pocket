package com.tenderpocket.controllers;

import com.tenderpocket.config.WorkflowPermissions;
import com.tenderpocket.notifications.DailyDigestService;
import com.tenderpocket.notifications.Digest.DigestType;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Locale;
import java.util.Map;

/**
 * Admin tools for the daily mails.
 *
 *  GET  /api/notifications/summary                               what every login would get now, and the settings in use
 *  GET  /api/notifications/preview?user=misteam&type=due         the mail itself (HTML), or format=text; sends nothing
 *  GET  /api/notifications/preview-attachment?user=..&type=..    the Excel file that mail would carry (404 when none is needed)
 *  POST /api/notifications/send-test?user=..&type=..[&to=..]     sends that one mail now, marked as a test; no daily log
 *  POST /api/notifications/run                                   sends today's mails that have not been sent yet
 *
 * preview, preview-attachment and send-test accept idPrefix=NBULK- to use only tenders whose ID
 * starts with that text (the test data from backend/scripts/notification-bulk-seed.sql).
 */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final DailyDigestService digestService;

    public NotificationController(DailyDigestService digestService) {
        this.digestService = digestService;
    }

    @GetMapping("/summary")
    public ResponseEntity<?> summary() {
        if (!isAdmin()) return WorkflowPermissions.denied();
        return ResponseEntity.ok(digestService.summary());
    }

    @GetMapping("/preview")
    public ResponseEntity<?> preview(@RequestParam("user") String user,
                                     @RequestParam(value = "type", defaultValue = "due") String type,
                                     @RequestParam(value = "format", defaultValue = "html") String format,
                                     @RequestParam(value = "idPrefix", required = false) String idPrefix) {
        if (!isAdmin()) return WorkflowPermissions.denied();
        DigestType digestType = parseType(type);
        if (digestType == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "type must be 'due' or 'pending'"));
        }
        DailyDigestService.Preview preview = digestService.preview(user, digestType, idPrefix);
        if (preview == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("success", false, "error", "No login '" + user + "' with a known role"));
        }
        var mail = preview.mail();
        String excel = mail.attachment() == null ? "none (everything fits in the mail)"
                : mail.attachment().fileName() + " with all " + mail.attachment().rows() + " rows";
        if ("text".equalsIgnoreCase(format)) {
            String header = "Subject: " + mail.subject() + "\n"
                    + "Would send: " + (preview.empty() ? "no (nothing to report)" : "yes") + "\n"
                    + "Rows: " + mail.bodyRows() + " of " + mail.totalRows() + " in the mail body; Excel: " + excel + "\n"
                    + "Already today: " + preview.alreadyToday() + "\n\n";
            return ResponseEntity.ok().contentType(new MediaType("text", "plain", java.nio.charset.StandardCharsets.UTF_8))
                    .body(header + mail.text());
        }
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "html", java.nio.charset.StandardCharsets.UTF_8))
                .header("X-Digest-Subject", asciiHeader(mail.subject()))
                .header("X-Digest-Would-Send", String.valueOf(!preview.empty()))
                .header("X-Digest-Rows", mail.bodyRows() + "/" + mail.totalRows())
                .header("X-Digest-Excel", asciiHeader(excel))
                .header("X-Digest-Already-Today", preview.alreadyToday())
                .body(mail.html());
    }

    @GetMapping("/preview-attachment")
    public ResponseEntity<?> previewAttachment(@RequestParam("user") String user,
                                               @RequestParam(value = "type", defaultValue = "due") String type,
                                               @RequestParam(value = "idPrefix", required = false) String idPrefix) {
        if (!isAdmin()) return WorkflowPermissions.denied();
        DigestType digestType = parseType(type);
        if (digestType == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "type must be 'due' or 'pending'"));
        }
        DailyDigestService.Preview preview = digestService.preview(user, digestType, idPrefix);
        if (preview == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("success", false, "error", "No login '" + user + "' with a known role"));
        }
        var attachment = preview.mail().attachment();
        if (attachment == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("success", false, "error", "No Excel file needed: all " + preview.mail().totalRows() + " rows fit in the mail"));
        }
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(attachment.contentType()))
                .header("Content-Disposition", "attachment; filename=\"" + attachment.fileName() + "\"")
                .body(attachment.bytes());
    }

    @PostMapping("/send-test")
    public ResponseEntity<?> sendTest(@RequestParam("user") String user,
                                      @RequestParam(value = "type", defaultValue = "pending") String type,
                                      @RequestParam(value = "idPrefix", required = false) String idPrefix,
                                      @RequestParam(value = "to", required = false) String to) {
        if (!isAdmin()) return WorkflowPermissions.denied();
        DigestType digestType = parseType(type);
        if (digestType == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "type must be 'due' or 'pending'"));
        }
        return ResponseEntity.ok(digestService.sendTest(user, digestType, idPrefix, to).toMap());
    }

    @PostMapping("/run")
    public ResponseEntity<?> run() {
        if (!isAdmin()) return WorkflowPermissions.denied();
        // Always 200: "success" and "status" (DONE, DISABLED, BUSY) in the body say what happened,
        // so scripts using plain wget still see the explanation.
        return ResponseEntity.ok(digestService.run("manual").toMap());
    }

    static DigestType parseType(String type) {
        if (type == null) return null;
        return switch (type.trim().toLowerCase(Locale.ROOT)) {
            case "due" -> DigestType.DUE;
            case "pending" -> DigestType.PENDING;
            default -> null;
        };
    }

    private static boolean isAdmin() {
        return "Admin".equals(WorkflowPermissions.role());
    }

    /** HTTP headers must be ASCII; the subject uses a middle dot. */
    private static String asciiHeader(String value) {
        return value == null ? "" : value.replace('·', '-').replaceAll("[^\\x20-\\x7E]", "");
    }
}
