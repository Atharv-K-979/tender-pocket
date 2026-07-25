package com.tenderpocket.services;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.User;
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
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

@Service
public class EmailNotificationService {

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private JavaMailSender mailSender;

    @Value("${spring.mail.username}")
    private String fromEmail;

    // Run 30 seconds after startup, then daily (every 24 hours)
    @Scheduled(initialDelay = 30000, fixedDelay = 86400000)
    public void sendDueDateAlerts() {
        System.out.println("=== Starting Scheduled Due-Date Alert Job ===");
        try {
            List<Tender> tenders = tenderRepository.findAll();
            LocalDate today = LocalDate.now();
            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");

            for (Tender t : tenders) {
                String status = t.getStatus();
                // Only alert on active tenders
                if (t.getMisExecutive() != null && t.getDueDate() != null &&
                        ("Issued".equalsIgnoreCase(status) || "Participating".equalsIgnoreCase(status) || "Draft".equalsIgnoreCase(status))) {
                    
                    try {
                        String cleanDueDate = t.getDueDate().split(" ")[0];
                        LocalDate dueDate = LocalDate.parse(cleanDueDate, formatter);
                        long daysDiff = ChronoUnit.DAYS.between(today, dueDate);

                        // If due date is in exactly 3 days or today, alert the executive
                        if (daysDiff == 3 || daysDiff == 0) {
                            sendEmailToExecutive(t, daysDiff);
                        }
                    } catch (Exception e) {
                        System.err.println("Failed to process due date alert for tender " + t.getId() + ": " + e.getMessage());
                    }
                }
            }
        } catch (Exception ex) {
            System.err.println("Scheduled alerts execution error: " + ex.getMessage());
        }
    }

    private void sendEmailToExecutive(Tender t, long daysDiff) {
        String execUsername = t.getMisExecutive();
        Optional<User> opt = userRepository.findById(execUsername);
        if (opt.isEmpty()) {
            System.out.println("Could not send alert for tender " + t.getId() + " - executive user " + execUsername + " not found.");
            return;
        }

        User exec = opt.get();
        String toEmail = exec.getEmail();
        if (toEmail == null || toEmail.trim().isEmpty()) {
            System.out.println("Could not send alert for tender " + t.getId() + " - executive " + execUsername + " has no email configured.");
            return;
        }

        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

            helper.setFrom(fromEmail);
            helper.setTo(toEmail);
            
            String subjectTime = daysDiff == 0 ? "TODAY" : "in 3 days";
            helper.setSubject(String.format("[TenderPocket Alert] URGENT: Bid Deadline %s - Tender Ref %s", subjectTime, t.getRefNo() != null ? t.getRefNo() : t.getId()));

            StringBuilder html = new StringBuilder();
            html.append("<html><head><style>")
                .append("body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f5f7; color: #1f2937; padding: 20px; margin: 0; }")
                .append(".container { max-width: 550px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 30px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }")
                .append("h2 { color: #1e3a8a; font-size: 20px; margin-top: 0; margin-bottom: 20px; }")
                .append(".link-box { background-color: #f3f4f6; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 0 4px 4px 0; }")
                .append(".tender-link { font-size: 16px; font-weight: bold; color: #2563eb; text-decoration: none; }")
                .append(".tender-link:hover { text-decoration: underline; }")
                .append(".footer { margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 15px; font-size: 12px; color: #6b7280; }")
                .append("</style></head><body>");

            html.append("<div class='container'>")
                .append("<h2>Tender Submission Deadline Alert</h2>")
                .append(String.format("<p>Dear %s,</p>", execUsername))
                .append(String.format("<p>This is a formal notification that a tender assigned to you is nearing its submission deadline and is closing <strong>%s</strong>.</p>", subjectTime))
                .append("<div class='link-box'>")
                .append(String.format("<strong>Tender:</strong> <a class='tender-link' href='http://localhost:3000/tenders/%s'>%s</a>", t.getId(), t.getId()))
                .append("</div>")
                .append("<p>Please ensure all EMD payments and document verification tasks are completed.</p>")
                .append("<div class='footer'>")
                .append("This is an automated notification from the TenderPocket NoticeDesk.")
                .append("</div>")
                .append("</div></body></html>");

            helper.setText(html.toString(), true);
            mailSender.send(message);
            System.out.println("Successfully sent due date alert email to executive " + execUsername + " (" + toEmail + ") for Tender " + t.getId());

        } catch (Exception e) {
            System.err.println("Failed to send due date email to " + toEmail + ": " + e.getMessage());
        }
    }
}
