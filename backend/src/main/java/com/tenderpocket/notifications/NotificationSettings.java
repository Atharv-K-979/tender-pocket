package com.tenderpocket.notifications;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Component;

import java.time.ZoneId;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Settings for the daily Due / Pending mails, read from the NOTIFY_* environment variables
 * (see the "Daily tender mails" section of .env.example; docker-compose.yml passes them to
 * the backend).
 *
 * Values are read as text and parsed here, so an empty or mistyped value falls back to the
 * default (with a warning) instead of stopping the application from starting.
 */
@Component
public class NotificationSettings {

    private static final Logger log = LoggerFactory.getLogger(NotificationSettings.class);

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    public static final String DEFAULT_CRON = "0 0 9 * * *";
    public static final String DEFAULT_CLOCK_CRON = "0 30 * * * *";

    @Value("${notify.enabled:false}")
    private String enabled;

    @Value("${notify.pending-days:3}")
    private String pendingDays;

    @Value("${notify.due-window-days:3}")
    private String dueWindowDays;

    @Value("${notify.max-rows:200}")
    private String maxRows;

    @Value("${notify.app-url:}")
    private String appUrl;

    @Value("${notify.recipients:}")
    private String recipients;

    @Value("${notify.smtp.host:}")
    private String smtpHost;

    @Value("${notify.smtp.port:}")
    private String smtpPort;

    @Value("${notify.smtp.username:}")
    private String smtpUsername;

    @Value("${notify.smtp.password:}")
    private String smtpPassword;

    @Value("${notify.smtp.security:auto}")
    private String smtpSecurity;

    @Value("${spring.mail.host:smtp.gmail.com}")
    private String springMailHost;

    @Value("${spring.mail.port:465}")
    private String springMailPort;

    @Value("${spring.mail.username:}")
    private String springMailUsername;

    @Value("${spring.mail.password:}")
    private String springMailPassword;

    @Value("${notify.mail.from:}")
    private String fromAddress;

    @Value("${notify.mail.from-name:TenderPocket Alerts}")
    private String fromName;

    @Value("${notify.cron:" + DEFAULT_CRON + "}")
    private String cron;

    @Value("${notify.clock-cron:" + DEFAULT_CLOCK_CRON + "}")
    private String clockCron;

    private String parsedRecipientsSource;
    private Map<String, String> parsedRecipients = Map.of();

    public boolean isEnabled() {
        String v = trim(enabled).toLowerCase(Locale.ROOT);
        return v.equals("true") || v.equals("yes") || v.equals("1") || v.equals("on");
    }

    /** A pending action shows in the Pending mail once it has waited strictly more than this many days. */
    public int getPendingDays() { return number("NOTIFY_PENDING_DAYS", pendingDays, 3, 0, 365); }

    /** The Due mail covers tenders due today and up to this many days ahead. */
    public int getDueWindowDays() { return number("NOTIFY_DUE_WINDOW_DAYS", dueWindowDays, 3, 0, 60); }

    /**
     * Most rows shown in a mail body. When a mail has more (or they do not fit Gmail's size
     * limit), the body shows the most urgent ones and an Excel file with every row is attached.
     */
    public int getMaxRows() { return number("NOTIFY_MAX_ROWS", maxRows, 200, 1, 1000); }

    /**
     * Base address of the web app, used to link each tender as {@code <url>/tenders/<id>}.
     * Anything after "#" or "?" is dropped, so pasting the dashboard address
     * ("http://13.232.232.54:8085/#/dashboard") still gives working tender links.
     */
    public String getAppUrl() {
        String url = trim(appUrl);
        int cut = url.length();
        for (char c : new char[]{'#', '?'}) {
            int i = url.indexOf(c);
            if (i >= 0 && i < cut) cut = i;
        }
        url = url.substring(0, cut).trim();
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }

    /** NOTIFY_SMTP_HOST, or SPRING_MAIL_HOST when that is empty. */
    public String getSmtpHost() {
        String host = trim(smtpHost);
        if (host.isEmpty()) host = trim(springMailHost);
        return host.isEmpty() ? "smtp.gmail.com" : host;
    }

    /** NOTIFY_SMTP_PORT, or SPRING_MAIL_PORT when that is empty. */
    public int getSmtpPort() {
        String port = trim(smtpPort).isEmpty() ? trim(springMailPort) : trim(smtpPort);
        return number("NOTIFY_SMTP_PORT", port, 465, 1, 65535);
    }

    /** NOTIFY_SMTP_USERNAME, or SPRING_MAIL_USERNAME when that is empty. */
    public String getSmtpUsername() {
        String user = trim(smtpUsername);
        return user.isEmpty() ? trim(springMailUsername) : user;
    }

    /**
     * NOTIFY_SMTP_PASSWORD, or SPRING_MAIL_PASSWORD when that is empty. Gmail shows app
     * passwords in groups of four ("abcd efgh ijkl mnop"); the spaces are not part of it.
     */
    public String getSmtpPassword() {
        String pass = smtpPassword == null || smtpPassword.isBlank() ? springMailPassword : smtpPassword;
        return pass == null ? "" : pass.replaceAll("\\s+", "");
    }

    /** ssl, starttls or none. "auto" picks ssl for port 465, starttls for 587 and none otherwise. */
    public String getSmtpSecurity() {
        String mode = trim(smtpSecurity).toLowerCase(Locale.ROOT);
        if (mode.equals("ssl") || mode.equals("starttls") || mode.equals("none")) return mode;
        int port = getSmtpPort();
        if (port == 465) return "ssl";
        if (port == 587) return "starttls";
        return "none";
    }

    /**
     * The sender address. NOTIFY_MAIL_FROM may hold an address, "Name &lt;address&gt;", or just a
     * name; when it holds no address the SMTP login is used (Gmail only sends as that account
     * or its verified aliases anyway). A value with an "@" that is not a valid address is
     * returned as is so the configuration check reports the typo.
     */
    public String getFromAddress() {
        String from = trim(fromAddress);
        String[] parts = splitNameAndAddress(from);
        if (parts != null) return parts[1];
        if (from.contains("@")) return from;
        return getSmtpUsername();
    }

    /** True when NOTIFY_MAIL_FROM supplies an address itself (rather than falling back to the SMTP login). */
    public boolean hasOwnFromAddress() {
        String from = trim(fromAddress);
        return splitNameAndAddress(from) != null || from.contains("@");
    }

    /** The sender name: a name given in NOTIFY_MAIL_FROM wins, then NOTIFY_MAIL_FROM_NAME. */
    public String getFromName() {
        String from = trim(fromAddress);
        String[] parts = splitNameAndAddress(from);
        if (parts != null && !parts[0].isEmpty()) return parts[0];
        if (!from.isEmpty() && !from.contains("@")) return from.replaceAll("^\"|\"$", "").trim();
        String name = trim(fromName);
        return name.isEmpty() ? "TenderPocket Alerts" : name;
    }

    /** The daily send schedule, or null when switched off with "-" or "off". */
    public String getCron() { return cronOrDefault("NOTIFY_CRON", cron, DEFAULT_CRON); }

    /** The pending-clock refresh schedule, or null when switched off. */
    public String getClockCron() { return cronOrDefault("NOTIFY_CLOCK_CRON", clockCron, DEFAULT_CLOCK_CRON); }

    /**
     * The address given for a login in NOTIFY_RECIPIENTS, or "" when it has none (users.email
     * is used then). NOTIFY_RECIPIENTS lists "login=email" pairs separated by commas, for
     * example {@code admin=admin@company.com,MIS1=mis1@company.com}. Login names are matched
     * ignoring case.
     */
    public String recipientOverride(String username) {
        if (username == null || username.isBlank()) return "";
        return recipientMap().getOrDefault(username.trim().toLowerCase(Locale.ROOT), "");
    }

    /** Number of logins with an address in NOTIFY_RECIPIENTS. */
    public int recipientCount() { return recipientMap().size(); }

    private synchronized Map<String, String> recipientMap() {
        String source = trim(recipients);
        if (source.equals(parsedRecipientsSource)) return parsedRecipients;
        Map<String, String> map = new HashMap<>();
        for (String entry : source.split("[,;\\n]")) {
            String e = entry.trim();
            if (e.isEmpty()) continue;
            int sep = e.indexOf('=');
            if (sep < 0) sep = e.indexOf(':');
            String login = sep < 0 ? "" : e.substring(0, sep).trim();
            String email = sep < 0 ? "" : e.substring(sep + 1).trim();
            if (login.isEmpty() || !RecipientDirectory.isEmail(email)) {
                log.warn("[Notifications] Ignoring NOTIFY_RECIPIENTS entry '{}': expected login=email", e);
                continue;
            }
            map.put(login.toLowerCase(Locale.ROOT), email);
        }
        parsedRecipientsSource = source;
        parsedRecipients = Map.copyOf(map);
        return parsedRecipients;
    }

    /** "Name &lt;a@b.c&gt;" to {name, address}; null when the value is not in that form. */
    private static String[] splitNameAndAddress(String value) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^\\s*\"?([^\"<]*?)\"?\\s*<\\s*([^<>\\s]+)\\s*>\\s*$").matcher(value);
        if (!m.matches()) return null;
        return new String[]{m.group(1).trim(), m.group(2).trim()};
    }

    private static String cronOrDefault(String name, String raw, String fallback) {
        String value = trim(raw);
        if (value.equals("-") || value.equalsIgnoreCase("off")) return null;
        if (value.isEmpty()) return fallback;
        if (CronExpression.isValidExpression(value)) return value;
        log.warn("[Notifications] {}='{}' is not a valid cron expression (6 fields, seconds first); using '{}'", name, value, fallback);
        return fallback;
    }

    private static int number(String name, String raw, int fallback, int min, int max) {
        String value = trim(raw);
        if (value.isEmpty()) return fallback;
        try {
            int n = Integer.parseInt(value);
            if (n >= min && n <= max) return n;
        } catch (NumberFormatException ignored) {
            // fall through to the warning
        }
        log.warn("[Notifications] {}='{}' is not a number between {} and {}; using {}", name, value, min, max, fallback);
        return fallback;
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
