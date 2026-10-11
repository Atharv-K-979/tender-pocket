package com.tenderpocket.services;

import jakarta.mail.internet.MimeMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@Service
public class BackupEmailService {

    @Autowired(required = false)
    private JavaMailSender mailSender;

    @Value("${spring.mail.username:admin@tenderpocket.com}")
    private String fromEmail;

    @Value("${app.backup.alert-email:admin@tenderpocket.com}")
    private String alertRecipientEmail;

    public boolean sendBackupFailureNotification(String backupType, String stage, String errorMessage, Long checkpointId) {
        String timestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        String subject = "[Tender Pocket] PostgreSQL Backup FAILED";

        StringBuilder html = new StringBuilder();
        html.append("<html><head><style>")
            .append("body { font-family: Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 20px; }")
            .append(".card { max-width: 600px; margin: 0 auto; background: #ffffff; border-left: 4px solid #ef4444; border-radius: 8px; padding: 25px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }")
            .append("h2 { color: #dc2626; font-size: 20px; margin-top: 0; }")
            .append(".detail-table { width: 100%; border-collapse: collapse; margin: 20px 0; }")
            .append(".detail-table td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }")
            .append(".label { font-weight: bold; color: #475569; width: 35%; }")
            .append(".value { color: #0f172a; word-break: break-word; }")
            .append(".action-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px; margin-top: 15px; font-size: 13px; color: #991b1b; }")
            .append("</style></head><body>");

        html.append("<div class='card'>")
            .append("<h2>⚠️ PostgreSQL Backup Alert: Failure Detected</h2>")
            .append("<p>An error occurred during the PostgreSQL database backup execution. Details below:</p>")
            .append("<table class='detail-table'>")
            .append(String.format("<tr><td class='label'>Backup Type:</td><td class='value'>%s</td></tr>", backupType))
            .append(String.format("<tr><td class='label'>Timestamp:</td><td class='value'>%s</td></tr>", timestamp))
            .append(String.format("<tr><td class='label'>Failure Stage:</td><td class='value'>%s</td></tr>", stage))
            .append(String.format("<tr><td class='label'>Checkpoint ID:</td><td class='value'>%s</td></tr>", checkpointId != null ? checkpointId : "N/A"))
            .append(String.format("<tr><td class='label'>Error Details:</td><td class='value'>%s</td></tr>", errorMessage != null ? errorMessage : "Unknown error"))
            .append("</table>")
            .append("<div class='action-box'>")
            .append("<strong>Recommended Action:</strong> Check database connectivity, disk space, and S3 backup bucket permissions. Checkpoint was NOT advanced.")
            .append("</div></div></body></html>");

        System.err.println("================ BACKUP FAILURE NOTIFICATION ================");
        System.err.println("Subject: " + subject);
        System.err.println("Type: " + backupType + " | Stage: " + stage + " | Checkpoint: " + checkpointId);
        System.err.println("Error: " + errorMessage);
        System.err.println("=============================================================");

        if (mailSender == null) {
            System.out.println("[BackupEmailService] JavaMailSender not configured. Email logged to console.");
            return false;
        }

        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(fromEmail);
            helper.setTo(alertRecipientEmail);
            helper.setSubject(subject);
            helper.setText(html.toString(), true);
            mailSender.send(message);
            System.out.println("[BackupEmailService] Alert email sent successfully to " + alertRecipientEmail);
            return true;
        } catch (Exception e) {
            System.err.println("[BackupEmailService] Failed to send email alert: " + e.getMessage());
            return false;
        }
    }
}
