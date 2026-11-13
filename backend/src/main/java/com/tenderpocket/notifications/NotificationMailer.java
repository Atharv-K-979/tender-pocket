package com.tenderpocket.notifications;

import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Properties;

/**
 * Sends the daily mails over SMTP using the NOTIFY_SMTP_* settings (falling back to
 * SPRING_MAIL_*). Each mail is tried up to three times, 1 s, 2 s and 4 s apart.
 */
@Component
public class NotificationMailer {

    private static final Logger log = LoggerFactory.getLogger(NotificationMailer.class);
    static final int ATTEMPTS = 3;

    private final NotificationSettings settings;
    private volatile JavaMailSenderImpl sender;

    public NotificationMailer(NotificationSettings settings) {
        this.settings = settings;
    }

    /** Thrown when a mail could not be delivered after every attempt. */
    public static class SendFailure extends Exception {
        private final int attempts;

        public SendFailure(String message, int attempts) {
            super(message);
            this.attempts = attempts;
        }

        public int getAttempts() { return attempts; }
    }

    /** Null when sending can work, otherwise what is missing. */
    public String configurationProblem() {
        String host = settings.getSmtpHost();
        if (host.isEmpty()) return "SMTP host is not set (NOTIFY_SMTP_HOST)";
        if (host.contains("@") || host.matches(".*\\s.*")) {
            return "NOTIFY_SMTP_HOST is '" + host + "' but must be the mail server, such as smtp.gmail.com."
                    + " The sending Gmail address goes in NOTIFY_SMTP_USERNAME";
        }
        if (settings.getSmtpUsername().isEmpty() && settings.getFromAddress().isEmpty()) {
            return "Sender is not set (NOTIFY_SMTP_USERNAME and NOTIFY_SMTP_PASSWORD)";
        }
        if (!settings.getSmtpUsername().isEmpty() && settings.getSmtpPassword().isEmpty()) {
            return "Sender password is not set (NOTIFY_SMTP_PASSWORD)";
        }
        if (!RecipientDirectory.isEmail(settings.getFromAddress())) {
            if (!settings.hasOwnFromAddress()) {
                return "NOTIFY_SMTP_USERNAME is '" + settings.getSmtpUsername() + "' but must be the sending email address,"
                        + " such as you@gmail.com (it is also used as the From address while NOTIFY_MAIL_FROM is empty)."
                        + " Put a display name in NOTIFY_MAIL_FROM_NAME";
            }
            return "Sender address '" + settings.getFromAddress() + "' is not a valid email (NOTIFY_MAIL_FROM)";
        }
        return null;
    }

    public String describe() {
        return settings.getSmtpHost() + ":" + settings.getSmtpPort() + " (" + settings.getSmtpSecurity() + ") as "
                + (settings.getSmtpUsername().isEmpty() ? "(no login)" : settings.getSmtpUsername())
                + ", from " + settings.getFromAddress();
    }

    /** @return the number of attempts it took */
    public int send(String to, String subject, String html, String text) throws SendFailure {
        return send(to, subject, html, text, null);
    }

    /**
     * Sends one mail, with the Excel file attached when {@code attachment} is not null.
     *
     * @return the number of attempts it took
     */
    public int send(String to, String subject, String html, String text, MailComposer.Attachment attachment) throws SendFailure {
        String problem = configurationProblem();
        if (problem != null) throw new SendFailure(problem, 0);

        String lastError = "unknown error";
        for (int attempt = 1; attempt <= ATTEMPTS; attempt++) {
            try {
                JavaMailSenderImpl mail = sender();
                MimeMessage message = mail.createMimeMessage();
                MimeMessageHelper helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
                helper.setFrom(new InternetAddress(settings.getFromAddress(), settings.getFromName(), StandardCharsets.UTF_8.name()));
                helper.setTo(to);
                helper.setSubject(subject);
                helper.setText(text, html);
                if (attachment != null) {
                    helper.addAttachment(attachment.fileName(),
                            new org.springframework.core.io.ByteArrayResource(attachment.bytes()), attachment.contentType());
                }
                mail.send(message);
                return attempt;
            } catch (Exception e) {
                lastError = rootMessage(e);
                log.warn("[Notifications] Sending to {} failed on attempt {}/{}: {}", to, attempt, ATTEMPTS, lastError);
                if (attempt < ATTEMPTS) pause(1000L << (attempt - 1));
            }
        }
        throw new SendFailure(lastError, ATTEMPTS);
    }

    /** Waits between attempts. Overridden in tests. */
    protected void pause(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    protected JavaMailSenderImpl sender() {
        JavaMailSenderImpl current = sender;
        if (current != null) return current;
        synchronized (this) {
            if (sender == null) sender = build();
            return sender;
        }
    }

    private JavaMailSenderImpl build() {
        JavaMailSenderImpl mail = new JavaMailSenderImpl();
        mail.setHost(settings.getSmtpHost());
        mail.setPort(settings.getSmtpPort());
        mail.setUsername(settings.getSmtpUsername());
        mail.setPassword(settings.getSmtpPassword());
        mail.setDefaultEncoding(StandardCharsets.UTF_8.name());

        Properties props = mail.getJavaMailProperties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.auth", String.valueOf(!settings.getSmtpUsername().isEmpty()));
        props.put("mail.smtp.connectiontimeout", "15000");
        props.put("mail.smtp.timeout", "20000");
        props.put("mail.smtp.writetimeout", "20000");
        switch (settings.getSmtpSecurity()) {
            case "ssl" -> {
                props.put("mail.smtp.ssl.enable", "true");
                props.put("mail.smtp.ssl.checkserveridentity", "true");
            }
            case "starttls" -> {
                props.put("mail.smtp.starttls.enable", "true");
                props.put("mail.smtp.starttls.required", "true");
            }
            default -> { }
        }
        return mail;
    }

    private static String rootMessage(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        String message = root.getMessage();
        if (message == null || message.isBlank()) message = root.getClass().getSimpleName();
        String top = e.getMessage();
        if (top != null && !top.isBlank() && !top.equals(message) && top.length() < 200) {
            return top + " (" + message + ")";
        }
        return message;
    }
}
