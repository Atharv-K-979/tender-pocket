package com.tenderpocket.notifications;

import com.tenderpocket.models.EmailDigestLog;
import com.tenderpocket.notifications.Digest.DeliveryLine;
import com.tenderpocket.notifications.Digest.DigestType;
import com.tenderpocket.repositories.EmailDigestLogRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Sends each login at most two mails a day: the Due mail and the Pending mail.
 *
 * Runs at 9:00 IST (NOTIFY_CRON), after the 8:00 tender sync. Team mails go first and Admin's
 * last, so Admin's Pending mail can carry the delivery report for the morning. The
 * email_digest_log unique key (login, mail type, day) guarantees a mail that was sent is never
 * sent again the same day, whether the job is re-run, triggered by hand or the server restarts.
 * A mail that failed may be retried by a later run.
 */
@Service
public class DailyDigestService {

    private static final Logger log = LoggerFactory.getLogger(DailyDigestService.class);
    private static final long STALE_SENDING_MINUTES = 30;

    private final NotificationSettings settings;
    private final PendingClockService clockService;
    private final NotificationMailer mailer;
    private final EmailDigestLogRepository digestLogRepository;
    private final ReentrantLock runLock = new ReentrantLock();

    public DailyDigestService(NotificationSettings settings, PendingClockService clockService,
                              NotificationMailer mailer, EmailDigestLogRepository digestLogRepository) {
        this.settings = settings;
        this.clockService = clockService;
        this.mailer = mailer;
        this.digestLogRepository = digestLogRepository;
    }

    /** Result of one mail in a run. */
    public record Outcome(String username, String team, String mail, String status, String email,
                          int items, String subject, String detail) {}

    /** Result of a whole run. */
    public record RunReport(String status, String message, LocalDate date, List<Outcome> outcomes) {
        public long count(String outcomeStatus) {
            return outcomes.stream().filter(o -> o.status().equals(outcomeStatus)).count();
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("success", !"BUSY".equals(status) && !"DISABLED".equals(status));
            m.put("status", status);
            m.put("message", message);
            m.put("date", date == null ? null : date.toString());
            m.put("sent", count("SENT"));
            m.put("failed", count("FAILED"));
            m.put("already_sent_today", count("ALREADY_SENT"));
            m.put("nothing_to_report", count("NOTHING_TO_REPORT"));
            List<Map<String, Object>> list = new ArrayList<>();
            for (Outcome o : outcomes) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("login", o.username());
                row.put("team", o.team());
                row.put("mail", o.mail());
                row.put("result", o.status());
                row.put("to", o.email());
                row.put("items", o.items());
                row.put("subject", o.subject());
                row.put("detail", o.detail());
                list.add(row);
            }
            m.put("mails", list);
            return m;
        }
    }

    public void scheduledRun() {
        if (!settings.isEnabled()) {
            log.info("[Notifications] Daily mails are switched off (NOTIFY_ENABLED=false); skipping the scheduled run.");
            return;
        }
        try {
            RunReport report = run("scheduled");
            log.info("[Notifications] Scheduled run finished: {}", report.message());
        } catch (Exception e) {
            log.error("[Notifications] Scheduled run failed: {}", e.getMessage(), e);
        }
    }

    /** Sends today's mails that have not been sent yet. Respects NOTIFY_ENABLED. */
    public RunReport run(String trigger) {
        if (!settings.isEnabled()) {
            return new RunReport("DISABLED", "Daily mails are switched off. Set NOTIFY_ENABLED=true to send.", null, List.of());
        }
        if (!runLock.tryLock()) {
            return new RunReport("BUSY", "A run is already in progress. Try again in a minute.", null, List.of());
        }
        try {
            LocalDateTime now = LocalDateTime.now(NotificationSettings.IST);
            LocalDate today = now.toLocalDate();
            log.info("[Notifications] Starting {} run for {} via {}", trigger, today, mailer.describe());

            ClockSnapshot snapshot = clockService.refresh(now);
            DigestBuilder builder = builder();
            List<DigestBuilder.TenderView> views = builder.prepare(snapshot, today);
            List<RecipientDirectory.Recipient> recipients = snapshot.directory().all();

            List<Outcome> outcomes = new ArrayList<>();
            for (RecipientDirectory.Recipient r : recipients) {
                if (r.team() == Team.ADMIN) continue;
                outcomes.add(deliver(builder.buildDue(r, views, today), now));
                outcomes.add(deliver(builder.buildPending(r, views, today, List.of()), now));
            }
            List<DeliveryLine> report = deliveryReport(today, snapshot.directory());
            for (RecipientDirectory.Recipient r : recipients) {
                if (r.team() != Team.ADMIN) continue;
                outcomes.add(deliver(builder.buildDue(r, views, today), now));
                outcomes.add(deliver(builder.buildPending(r, views, today, report), now));
            }

            RunReport counted = new RunReport("DONE", null, today, outcomes);
            String message = counted.count("SENT") + " sent, " + counted.count("FAILED") + " failed, "
                    + counted.count("ALREADY_SENT") + " already sent today, "
                    + counted.count("NOTHING_TO_REPORT") + " skipped with nothing to report";
            for (Outcome o : outcomes) {
                if ("SENT".equals(o.status()) || "FAILED".equals(o.status())) {
                    log.info("[Notifications] {} {} -> {}: {} ({} items){}", o.mail(), o.username(), o.email(), o.status(),
                            o.items(), o.detail() == null ? "" : " " + o.detail());
                }
            }
            return new RunReport("DONE", message, today, outcomes);
        } finally {
            runLock.unlock();
        }
    }

    /** What every login would get right now, plus the settings in use. Sends nothing. */
    public Map<String, Object> summary() {
        LocalDateTime now = LocalDateTime.now(NotificationSettings.IST);
        LocalDate today = now.toLocalDate();
        ClockSnapshot snapshot = clockService.refresh(now);
        DigestBuilder builder = builder();
        List<DigestBuilder.TenderView> views = builder.prepare(snapshot, today);

        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("enabled", settings.isEnabled());
        config.put("schedule", settings.getCron() + " (Asia/Kolkata)");
        config.put("smtp", mailer.describe());
        String problem = mailer.configurationProblem();
        config.put("smtp_problem", problem == null ? "none" : problem);
        config.put("logins_in_notify_recipients", settings.recipientCount());
        config.put("pending_days", settings.getPendingDays());
        config.put("due_window_days", settings.getDueWindowDays());
        config.put("max_rows", settings.getMaxRows());
        config.put("app_url", settings.getAppUrl());
        out.put("settings", config);
        out.put("date", today.toString());
        out.put("live_tenders", views.size());
        out.put("pending_actions", views.stream().mapToInt(v -> v.items().size()).sum());

        List<Map<String, Object>> logins = new ArrayList<>();
        for (RecipientDirectory.Recipient r : snapshot.directory().all()) {
            Digest due = builder.buildDue(r, views, today);
            Digest pending = builder.buildPending(r, views, today,
                    r.team() == Team.ADMIN ? deliveryReport(today, snapshot.directory()) : List.of());
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("login", r.username());
            row.put("team", r.team().getLabel());
            row.put("email", r.hasEmail() ? r.email() : "(none)");
            row.put("email_source", r.emailSource());
            row.put("due_mail_rows", due.dueRows().size());
            row.put("missed_yesterday_rows", due.missedRows().size());
            row.put("pending_mail_rows", pending.pendingTotal());
            row.put("due_mail_today", statusToday(r.username(), DigestType.DUE, today, due));
            row.put("pending_mail_today", statusToday(r.username(), DigestType.PENDING, today, pending));
            row.put("due_tender_ids", due.dueRows().stream().map(x -> x.tender().getId()).toList());
            row.put("pending_tender_ids", pending.pendingRows().stream().map(x -> x.tender().getId() + ":" + x.work().key().name()).toList());
            logins.add(row);
        }
        out.put("logins", logins);
        return out;
    }

    private String statusToday(String username, DigestType type, LocalDate today, Digest digest) {
        Optional<EmailDigestLog> row = digestLogRepository.findByRecipientUsernameAndDigestTypeAndSentDate(username, type.name(), today);
        if (row.isPresent()) return row.get().getStatus();
        return digest.isEmpty() ? "NOTHING_TO_REPORT" : "WILL_SEND";
    }

    private Outcome deliver(Digest digest, LocalDateTime now) {
        RecipientDirectory.Recipient r = digest.recipient();
        String mail = digest.type().name();
        if (digest.isEmpty()) {
            return new Outcome(r.username(), r.team().getLabel(), mail, "NOTHING_TO_REPORT", r.email(), 0, null, null);
        }

        EmailDigestLog claim = claim(r.username(), mail, digest.date(), now);
        if (claim == null) {
            return new Outcome(r.username(), r.team().getLabel(), mail, "ALREADY_SENT", r.email(), digest.itemCount(), null,
                    "This mail was already sent (or is being sent) today");
        }

        String to = r.email();
        claim.setRecipientEmail(to);
        claim.setItemCount(digest.itemCount());
        try {
            if (to == null || to.isBlank()) {
                throw new NotificationMailer.SendFailure("No email address for login '" + r.username()
                        + "'. Set it in users.email or add " + r.username() + "=<email> to NOTIFY_RECIPIENTS", 0);
            }
            MailComposer.ComposedMail composed = MailComposer.compose(digest, settings.getAppUrl(), settings.getMaxRows(), now);
            claim.setSubject(truncate(composed.subject(), 500));
            int attempts = mailer.send(to, composed.subject(), composed.html(), composed.text(), composed.attachment());
            finish(claim, EmailDigestLog.SENT, attempts, null);
            String detail = composed.attachment() == null ? null
                    : composed.bodyRows() + " rows in the mail, all " + composed.totalRows() + " in " + composed.attachment().fileName();
            return new Outcome(r.username(), r.team().getLabel(), mail, "SENT", to, digest.itemCount(), composed.subject(), detail);
        } catch (NotificationMailer.SendFailure e) {
            finish(claim, EmailDigestLog.FAILED, e.getAttempts(), e.getMessage());
            return new Outcome(r.username(), r.team().getLabel(), mail, "FAILED", to, digest.itemCount(), claim.getSubject(), e.getMessage());
        } catch (RuntimeException e) {
            String error = e.getClass().getSimpleName() + ": " + e.getMessage();
            log.error("[Notifications] Could not build or send {} mail for {}: {}", mail, r.username(), error, e);
            finish(claim, EmailDigestLog.FAILED, 0, error);
            return new Outcome(r.username(), r.team().getLabel(), mail, "FAILED", to, digest.itemCount(), claim.getSubject(), error);
        }
    }

    /**
     * Reserves today's (login, mail) slot. Returns null when it is already sent or another run
     * is sending it right now. A FAILED slot, or one stuck in SENDING after a crash, is reused.
     */
    EmailDigestLog claim(String username, String mail, LocalDate date, LocalDateTime now) {
        Optional<EmailDigestLog> existing = digestLogRepository.findByRecipientUsernameAndDigestTypeAndSentDate(username, mail, date);
        if (existing.isPresent()) {
            EmailDigestLog row = existing.get();
            if (EmailDigestLog.SENT.equals(row.getStatus())) return null;
            if (EmailDigestLog.SENDING.equals(row.getStatus()) && row.getUpdatedAt() != null
                    && row.getUpdatedAt().isAfter(now.minusMinutes(STALE_SENDING_MINUTES))) {
                return null;
            }
            row.setStatus(EmailDigestLog.SENDING);
            row.setErrorMessage(null);
            row.setUpdatedAt(now);
            return digestLogRepository.saveAndFlush(row);
        }
        try {
            return digestLogRepository.saveAndFlush(new EmailDigestLog(username, mail, date, EmailDigestLog.SENDING, now));
        } catch (DataIntegrityViolationException e) {
            return null;
        }
    }

    private void finish(EmailDigestLog row, String status, int attempts, String error) {
        row.setStatus(status);
        row.setAttempts((row.getAttempts() == null ? 0 : row.getAttempts()) + Math.max(attempts, 0));
        row.setErrorMessage(error == null ? null : truncate(error, 2000));
        row.setUpdatedAt(LocalDateTime.now(NotificationSettings.IST));
        try {
            digestLogRepository.saveAndFlush(row);
        } catch (RuntimeException e) {
            log.error("[Notifications] Could not record {} for {} {}: {}", status, row.getRecipientUsername(), row.getDigestType(), e.getMessage());
        }
    }

    /** Today's team mails from the send log, for Admin's Pending mail. */
    private List<DeliveryLine> deliveryReport(LocalDate today, RecipientDirectory directory) {
        List<DeliveryLine> lines = new ArrayList<>();
        for (EmailDigestLog row : digestLogRepository.findBySentDateOrderByIdAsc(today)) {
            RecipientDirectory.Recipient r = directory.find(row.getRecipientUsername());
            if (r != null && r.team() == Team.ADMIN) continue;
            String mail = "DUE".equals(row.getDigestType()) ? "Due" : "Pending";
            String detail = EmailDigestLog.FAILED.equals(row.getStatus())
                    ? row.getErrorMessage()
                    : (row.getRecipientEmail() == null ? "" : "to " + row.getRecipientEmail())
                      + (row.getItemCount() == null ? "" : ", " + row.getItemCount() + " rows");
            lines.add(new DeliveryLine(row.getRecipientUsername(), mail, row.getStatus(), detail));
        }
        return lines;
    }

    private DigestBuilder builder() {
        return new DigestBuilder(settings.getPendingDays(), settings.getDueWindowDays());
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
