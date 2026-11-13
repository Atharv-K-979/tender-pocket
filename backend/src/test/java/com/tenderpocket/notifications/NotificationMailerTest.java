package com.tenderpocket.notifications;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.*;

class NotificationMailerTest {

    private NotificationSettings settings(String host, String user, String password, String from) {
        NotificationSettings s = new NotificationSettings();
        ReflectionTestUtils.setField(s, "smtpHost", host);
        ReflectionTestUtils.setField(s, "smtpUsername", user);
        ReflectionTestUtils.setField(s, "smtpPassword", password);
        ReflectionTestUtils.setField(s, "fromAddress", from);
        return s;
    }

    private String problem(String host, String user, String password, String from) {
        return new NotificationMailer(settings(host, user, password, from)).configurationProblem();
    }

    @Test
    void correctGmailSetupHasNoProblem() {
        assertNull(problem("smtp.gmail.com", "sender@gmail.com", "abcd efgh ijkl mnop", ""));
        assertNull(problem("smtp.gmail.com", "sender@gmail.com", "abcdefghijklmnop", "Tender Pocket <sender@gmail.com>"));
    }

    @Test
    void emailAddressInTheHostLineIsExplained() {
        String p = problem("sender@gmail.com", "sender@gmail.com", "pw", "");
        assertTrue(p.contains("NOTIFY_SMTP_HOST") && p.contains("smtp.gmail.com"), p);
    }

    @Test
    void displayNameInTheUsernameLineIsExplained() {
        String p = problem("smtp.gmail.com", "Tender Pocket Test", "pw", "");
        assertTrue(p.startsWith("NOTIFY_SMTP_USERNAME is 'Tender Pocket Test'"), p);
        assertTrue(p.contains("NOTIFY_MAIL_FROM_NAME"), p);
    }

    @Test
    void theExcelFileIsAttachedToTheSentMail() throws Exception {
        java.util.List<jakarta.mail.internet.MimeMessage> sent = new java.util.ArrayList<>();
        NotificationMailer mailer = new NotificationMailer(settings("smtp.gmail.com", "sender@gmail.com", "pw", "")) {
            @Override
            protected org.springframework.mail.javamail.JavaMailSenderImpl sender() {
                return new org.springframework.mail.javamail.JavaMailSenderImpl() {
                    @Override
                    protected void doSend(jakarta.mail.internet.MimeMessage[] messages, Object[] original) {
                        sent.addAll(java.util.List.of(messages));
                    }
                };
            }
        };
        byte[] bytes = {1, 2, 3, 4};
        mailer.send("mis@example.com", "subject", "<p>html</p>", "text",
                new MailComposer.Attachment("TenderPocket_misteam_Pending_2026-11-12.xlsx", DigestExcel.CONTENT_TYPE, bytes, 480));
        assertEquals(1, sent.size());
        jakarta.mail.internet.MimeMessage m = sent.get(0);
        m.saveChanges();
        java.io.ByteArrayOutputStream raw = new java.io.ByteArrayOutputStream();
        m.writeTo(raw);
        String mime = raw.toString(java.nio.charset.StandardCharsets.UTF_8);
        assertTrue(mime.contains("TenderPocket_misteam_Pending_2026-11-12.xlsx"), "attachment file name");
        assertTrue(mime.contains(DigestExcel.CONTENT_TYPE), "attachment content type");
        assertTrue(mime.contains("Content-Disposition: attachment"), "sent as an attachment");
        assertTrue(mime.contains("text/html") && mime.contains("text/plain"), "both body parts");
    }

    @Test
    void missingPasswordAndBadFromAreReported() {
        assertTrue(problem("smtp.gmail.com", "sender@gmail.com", "", "").contains("NOTIFY_SMTP_PASSWORD"));
        assertTrue(problem("smtp.gmail.com", "sender@gmail.com", "pw", "alerts@gmail").contains("NOTIFY_MAIL_FROM"));
    }
}
