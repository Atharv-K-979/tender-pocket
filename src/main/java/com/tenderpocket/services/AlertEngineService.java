package com.tenderpocket.services;

import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import jakarta.mail.internet.MimeMessage;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

@Service
public class AlertEngineService {

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private JavaMailSender mailSender;

    @Value("${spring.mail.username}")
    private String fromEmail;

    public void checkAndSendAlerts() throws Exception {
        System.out.println("--- TenderPocket Alert Engine Checked ---");
        
        List<Tender> activeTenders = tenderRepository.findAll();
        List<Tender> slaAlerts = new ArrayList<>();
        List<Tender> dueIssuedAlerts = new ArrayList<>();
        List<Tender> dueReadyAlerts = new ArrayList<>();

        LocalDate today = LocalDate.now();
        DateTimeFormatter entryFormatter = DateTimeFormatter.ofPattern("d MMM yyyy");
        DateTimeFormatter dueFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");

        for (Tender t : activeTenders) {
            String status = t.getStatus();
            
            // 1. SLA Check (Issued for 3 days)
            if ("Issued".equalsIgnoreCase(status) && t.getEntryDate() != null) {
                try {
                    LocalDate entryDate = LocalDate.parse(t.getEntryDate(), entryFormatter);
                    long daysDiff = ChronoUnit.DAYS.between(entryDate, today);
                    if (daysDiff == 3) {
                        slaAlerts.add(t);
                    }
                } catch (Exception e) {}
            }

            // 2. Due Date Check (3 days before or today)
            if (t.getDueDate() != null && ("Issued".equalsIgnoreCase(status) || "Participating".equalsIgnoreCase(status))) {
                try {
                    String cleanDueDate = t.getDueDate().split(" ")[0];
                    LocalDate dueDate = LocalDate.parse(cleanDueDate, dueFormatter);
                    long daysToDue = ChronoUnit.DAYS.between(today, dueDate);
                    if (daysToDue == 3 || daysToDue == 0) {
                        if ("Issued".equalsIgnoreCase(status)) {
                            dueIssuedAlerts.add(t);
                        } else {
                            dueReadyAlerts.add(t);
                        }
                    }
                } catch (Exception e) {}
            }
        }

        if (slaAlerts.isEmpty() && dueIssuedAlerts.isEmpty() && dueReadyAlerts.isEmpty()) {
            System.out.println("No alerts triggered today.");
            return;
        }

        sendHtmlAlertEmail(slaAlerts, dueIssuedAlerts, dueReadyAlerts);
    }

    private void sendHtmlAlertEmail(List<Tender> sla, List<Tender> dueIssued, List<Tender> dueReady) throws Exception {
        MimeMessage message = mailSender.createMimeMessage();
        MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

        helper.setFrom(fromEmail);
        helper.setTo(fromEmail); // Sends to itself (Manager email defaults to SMTP user)
        helper.setSubject("[TenderPocket Alert] Action Required: Tender Deadlines & Pending SLA");

        StringBuilder html = new StringBuilder();
        html.append("<html><head><style>")
            .append("body { font-family: sans-serif; background-color: #0b0f19; color: #f8fafc; padding: 20px; }")
            .append(".container { max-width: 650px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 24px; }")
            .append("h1 { color: #818cf8; font-size: 24px; border-bottom: 2px solid rgba(129,140,248,0.2); padding-bottom: 12px; }")
            .append("table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }")
            .append("th { background-color: rgba(129,140,248,0.1); color: #818cf8; text-align: left; padding: 10px; font-size: 13px; }")
            .append("td { padding: 10px; font-size: 13px; border-bottom: 1px solid #1e293b; color: #cbd5e1; }")
            .append(".badge-alert { background: rgba(239,68,68,0.2); color: #f87171; font-weight: bold; padding: 2px 6px; border-radius: 4px; }")
            .append("</style></head><body>");

        html.append("<div class='container'>")
            .append("<h1>TenderPocket Action Alerts Digest</h1>")
            .append("<p>The following tenders require immediate attention.</p>");

        if (!sla.isEmpty()) {
            html.append("<h2 style='color:#f87171;'>⚠️ Action Required: Pending Accept (T+3)</h2>")
                .append("<table><thead><tr><th>ID</th><th>Title</th><th>Authority</th><th>Status</th></tr></thead><tbody>");
            for (Tender t : sla) {
                html.append(String.format("<tr><td><strong>%s</strong></td><td>%s</td><td>%s</td><td><span class='badge-alert'>Pending 3 Days</span></td></tr>", 
                        t.getRefNo() != null ? t.getRefNo() : t.getId(), t.getTitle(), t.getAuthority()));
            }
            html.append("</tbody></table>");
        }

        if (!dueIssued.isEmpty()) {
            html.append("<h2 style='color:#fbbf24;'>⏳ Issued Bids Nearing Due Date</h2>")
                .append("<table><thead><tr><th>ID</th><th>Title</th><th>Due Date</th></tr></thead><tbody>");
            for (Tender t : dueIssued) {
                html.append(String.format("<tr><td><strong>%s</strong></td><td>%s</td><td>%s</td></tr>", 
                        t.getRefNo() != null ? t.getRefNo() : t.getId(), t.getTitle(), t.getDueDate()));
            }
            html.append("</tbody></table>");
        }

        if (!dueReady.isEmpty()) {
            html.append("<h2 style='color:#a78bfa;'>📦 Participating Bids Nearing Due Date</h2>")
                .append("<table><thead><tr><th>ID</th><th>Title</th><th>Due Date</th></tr></thead><tbody>");
            for (Tender t : dueReady) {
                html.append(String.format("<tr><td><strong>%s</strong></td><td>%s</td><td>%s</td></tr>", 
                        t.getRefNo() != null ? t.getRefNo() : t.getId(), t.getTitle(), t.getDueDate()));
            }
            html.append("</tbody></table>");
        }

        html.append("</div></body></html>");

        helper.setText(html.toString(), true);
        
        int retries = 3;
        for (int i = 0; i < retries; i++) {
            try {
                mailSender.send(message);
                System.out.println("Alert email sent successfully.");
                break;
            } catch (Exception e) {
                if (i == retries - 1) throw e;
                System.out.println("[Network Retry] Failed to send email: " + e.getMessage() + ". Retrying in 10s...");
                Thread.sleep(10000);
            }
        }
    }
}
