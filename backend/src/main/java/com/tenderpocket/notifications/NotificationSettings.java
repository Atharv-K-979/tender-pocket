package com.tenderpocket.notifications;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Component;

import java.time.ZoneId;
import java.util.Locale;

/**
 * Settings for the daily Due / Pending mails.
 *
 * Every value can be set from the environment or from the optional {@code .env.notification}
 * file that application.properties imports. See {@code .env.notification.example} at the
 * repository root for the full list with explanations.
 *
 * Values are read as text and parsed here, so an empty or mistyped line falls back to the
 * default (with a warning) instead of stopping the application from starting.
 */
@Component
public class NotificationSettings {

    private static final Logger log = LoggerFactory.getLogger(NotificationSettings.class);

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    public static final String DEFAULT_CRON = "0 0 9 * * *";
    public static final String DEFAULT_CLOCK_CRON = "0 30 * * * *";

    private final Environment environment;

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

    @Value("${notify.redirect-all-to:}")
    private String redirectAllTo;

    @Value("${notify.smtp.host:smtp.gmail.com}")
    private String smtpHost;

    @Value("${notify.smtp.port:465}")
    private String smtpPort;

    @Value("${notify.smtp.username:}")
    private String smtpUsername;

    @Value("${notify.smtp.password:}")
    private String smtpPassword;

    @Value("${notify.smtp.security:auto}")
    private String smtpSecurity;

    @Value("${notify.mail.from:}")
    private String fromAddress;

    @Value("${notify.mail.from-name:TenderPocket Alerts}")
    private String fromName;

    @Value("${notify.cron:" + DEFAULT_CRON + "}")
    private String cron;

    @Value("${notify.clock-cron:" + DEFAULT_CLOCK_CRON + "}")
    private String clockCron;

    public NotificationSettings(Environment environment) {
        this.environment = environment;
    }

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

    /** When set, every mail goes to this one address instead of the real recipient (test mode). */
    public String getRedirectAllTo() { return trim(redirectAllTo); }

    public String getSmtpHost() {
        String host = trim(smtpHost);
        return host.isEmpty() ? "smtp.gmail.com" : host;
    }

    public int getSmtpPort() { return number("NOTIFY_SMTP_PORT", smtpPort, 465, 1, 65535); }

    public String getSmtpUsername() { return trim(smtpUsername); }

    /** Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces are not part of it. */
    public String getSmtpPassword() { return smtpPassword == null ? "" : smtpPassword.replaceAll("\\s+", ""); }

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

    /** "Name &lt;a@b.c&gt;" to {name, address}; null when the value is not in that form. */
    private static String[] splitNameAndAddress(String value) {
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^\\s*\"?([^\"<]*?)\"?\\s*<\\s*([^<>\\s]+)\\s*>\\s*$").matcher(value);
        if (!m.matches()) return null;
        return new String[]{m.group(1).trim(), m.group(2).trim()};
    }

    /** The daily send schedule, or null when switched off with "-" or "off". */
    public String getCron() { return cronOrDefault("NOTIFY_CRON", cron, DEFAULT_CRON); }

    /** The pending-clock refresh schedule, or null when switched off. */
    public String getClockCron() { return cronOrDefault("NOTIFY_CLOCK_CRON", clockCron, DEFAULT_CLOCK_CRON); }

    /**
     * Optional per-login address that replaces users.email, read from
     * NOTIFY_RECIPIENT_&lt;USERNAME&gt; (username upper-cased, anything other than A-Z and 0-9
     * turned into "_"), for example NOTIFY_RECIPIENT_MISTEAM.
     */
    public String recipientOverride(String username) {
        if (username == null || username.isBlank() || environment == null) return "";
        String key = "NOTIFY_RECIPIENT_" + username.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "_");
        return trim(environment.getProperty(key, ""));
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
