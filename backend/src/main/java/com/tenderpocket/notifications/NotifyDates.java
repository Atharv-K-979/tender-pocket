package com.tenderpocket.notifications;

import com.tenderpocket.services.TenderStatusResolver;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses the date shapes stored across the schema. Text columns hold several formats:
 * due_date "2026-11-12" or "2026-11-12 14:00:00", entry_date "7 Nov 2026" or "2026-11-07",
 * scraped_at "Sat Nov 07 13:02:26 GMT 2026", assigned_at "2026-11-07 13:03:48", workflow
 * timestamps "2026-11-07T13:03:48.123", browser timestamps "2026-11-07T07:33:48.123Z".
 *
 * Timestamps without a zone were written by the server with LocalDateTime.now(), so they are
 * read in the server's zone and converted to IST, which is the zone all day counting uses.
 */
public final class NotifyDates {

    private NotifyDates() {}

    private static final DateTimeFormatter DAY_MONTH_YEAR = new DateTimeFormatterBuilder()
            .parseCaseInsensitive().appendPattern("d MMM yyyy").toFormatter(Locale.ENGLISH);
    private static final DateTimeFormatter DASHED = DateTimeFormatter.ofPattern("dd-MM-yyyy");
    private static final DateTimeFormatter SLASHED = DateTimeFormatter.ofPattern("dd/MM/yyyy");
    private static final Pattern TIME = Pattern.compile("(\\d{1,2}):(\\d{2})");

    /** The calendar date in a stored value, or null when absent or unrecognised. */
    public static LocalDate parseDate(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty() || "N/A".equalsIgnoreCase(s)) return null;

        LocalDateTime instant = parseZoned(s);
        if (instant != null) return instant.toLocalDate();

        LocalDate flexible = TenderStatusResolver.parseFlexibleDate(s);
        if (flexible != null) return flexible;

        for (DateTimeFormatter f : new DateTimeFormatter[]{DAY_MONTH_YEAR, DASHED, SLASHED}) {
            try {
                return LocalDate.parse(s, f);
            } catch (Exception ignored) {
                // try the next shape
            }
        }
        return null;
    }

    /**
     * A stored timestamp as IST date-time. Values with only a date become the start of that day.
     *
     * @param serverZone the zone naive server-written timestamps were recorded in
     */
    public static LocalDateTime parseDateTime(String raw, ZoneId serverZone) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty() || "N/A".equalsIgnoreCase(s)) return null;

        LocalDateTime zoned = parseZoned(s);
        if (zoned != null) return zoned;

        try {
            LocalDateTime naive = LocalDateTime.parse(s.replace(' ', 'T'));
            return toIst(naive, serverZone);
        } catch (Exception ignored) {
            // date-only or another shape
        }

        LocalDate date = parseDate(s);
        return date == null ? null : date.atStartOfDay();
    }

    /** Converts a naive server timestamp (such as an approval request's created_at) to IST. */
    public static LocalDateTime toIst(LocalDateTime naive, ZoneId serverZone) {
        if (naive == null) return null;
        ZoneId zone = serverZone == null ? ZoneId.systemDefault() : serverZone;
        return naive.atZone(zone).withZoneSameInstant(NotificationSettings.IST).toLocalDateTime();
    }

    /** "HH:mm" from a due date such as "2026-11-12 14:00:00", or from the separate time column. */
    public static String dueTime(String dueDate, String timeColumn) {
        String fromDue = extractTime(dueDate, true);
        if (fromDue != null) return fromDue;
        return extractTime(timeColumn, false);
    }

    private static String extractTime(String raw, boolean skipDatePart) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty() || "N/A".equalsIgnoreCase(s)) return null;
        if (skipDatePart) {
            String[] parts = s.split("[ T]", 2);
            if (parts.length < 2) return null;
            s = parts[1];
        }
        Matcher m = TIME.matcher(s);
        if (!m.find()) return null;
        int hour = Integer.parseInt(m.group(1));
        int minute = Integer.parseInt(m.group(2));
        if (hour > 23 || minute > 59) return null;
        if (skipDatePart && hour == 0 && minute == 0) return null;
        return LocalTime.of(hour, minute).toString();
    }

    private static LocalDateTime parseZoned(String s) {
        if (!(s.endsWith("Z") || s.matches(".*T.*[+-]\\d{2}:?\\d{2}$"))) return null;
        try {
            return Instant.parse(s).atZone(NotificationSettings.IST).toLocalDateTime();
        } catch (Exception ignored) {
            // fall through
        }
        try {
            return OffsetDateTime.parse(s).atZoneSameInstant(NotificationSettings.IST).toLocalDateTime();
        } catch (Exception ignored) {
            return null;
        }
    }
}
