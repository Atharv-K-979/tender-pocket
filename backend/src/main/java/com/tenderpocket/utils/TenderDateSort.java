package com.tenderpocket.utils;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns the date strings stored on a tender into a number that sorts in real time order.
 *
 * Tender dates are stored as text in several shapes, written by different code paths:
 * <ul>
 *   <li>ISO: "2026-11-18", "2026-11-18 17:00:00", "2026-11-18T17:00:00.123Z", "2026-11-18T17:00+05:30"</li>
 *   <li>java.util.Date.toString(): "Wed Nov 18 12:39:00 IST 2026" (scraped_at)</li>
 *   <li>"8 Oct 2026" (manual entry, entry_date)</li>
 *   <li>"18-11-2026" or "18/11/2026" (dates read from emails)</li>
 * </ul>
 * Comparing the raw text sorts "Wed Nov 18 ..." by weekday name, so the list's "newest first"
 * was not newest first. This class only computes a sort key: the stored values are not changed.
 *
 * Times without a zone are read as Asia/Kolkata. A value in no recognised shape gets
 * {@link #UNKNOWN}, which sorts before every real date (as an empty string did before).
 */
public final class TenderDateSort {

    private TenderDateSort() {}

    /** Sort key of a missing or unrecognised date: before every real date. */
    public static final long UNKNOWN = Long.MIN_VALUE;

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private static final Pattern ISO = Pattern.compile(
            "^(\\d{4}-\\d{2}-\\d{2})(?:[ T](\\d{1,2}:\\d{2}(?::\\d{2})?)(?:\\.\\d+)?)?\\s*(Z|[+-]\\d{2}:?\\d{2})?$");
    private static final Pattern DAY_FIRST_NUMERIC = Pattern.compile(
            "^(\\d{1,2})[-/](\\d{1,2})[-/](\\d{4})(?:\\s+(\\d{1,2}:\\d{2}(?::\\d{2})?))?$");
    private static final Pattern DAY_MONTH_NAME_YEAR = Pattern.compile(
            "^(\\d{1,2})\\s+([A-Za-z]{3,9})\\s+(\\d{4})(?:\\s+(\\d{1,2}:\\d{2}(?::\\d{2})?))?$");
    private static final Pattern DATE_TO_STRING = Pattern.compile(
            "^[A-Za-z]{3}\\s+([A-Za-z]{3})\\s+(\\d{1,2})\\s+(\\d{1,2}:\\d{2}:\\d{2})\\s+(\\S+)\\s+(\\d{4})$");

    private static final DateTimeFormatter MONTH_SHORT = DateTimeFormatter.ofPattern("MMM", Locale.ENGLISH);
    private static final DateTimeFormatter MONTH_LONG = DateTimeFormatter.ofPattern("MMMM", Locale.ENGLISH);

    /** @return epoch milliseconds of the stored date, or {@link #UNKNOWN}. */
    public static long key(String raw) {
        if (raw == null) return UNKNOWN;
        String s = raw.trim();
        if (s.isEmpty() || "N/A".equalsIgnoreCase(s)) return UNKNOWN;
        try {
            Matcher m = ISO.matcher(s);
            if (m.matches()) {
                LocalDate date = LocalDate.parse(m.group(1));
                LocalTime time = m.group(2) != null ? parseTime(m.group(2)) : LocalTime.MIDNIGHT;
                if (m.group(3) != null) {
                    ZoneOffset offset = "Z".equals(m.group(3)) ? ZoneOffset.UTC : ZoneOffset.of(normaliseOffset(m.group(3)));
                    return OffsetDateTime.of(date, time, offset).toInstant().toEpochMilli();
                }
                return LocalDateTime.of(date, time).atZone(IST).toInstant().toEpochMilli();
            }

            m = DATE_TO_STRING.matcher(s);
            if (m.matches()) {
                int month = monthNumber(m.group(1));
                LocalDate date = LocalDate.of(Integer.parseInt(m.group(5)), month, Integer.parseInt(m.group(2)));
                LocalTime time = parseTime(m.group(3));
                return LocalDateTime.of(date, time).atZone(zoneOfAbbreviation(m.group(4))).toInstant().toEpochMilli();
            }

            m = DAY_MONTH_NAME_YEAR.matcher(s);
            if (m.matches()) {
                LocalDate date = LocalDate.of(Integer.parseInt(m.group(3)), monthNumber(m.group(2)), Integer.parseInt(m.group(1)));
                LocalTime time = m.group(4) != null ? parseTime(m.group(4)) : LocalTime.MIDNIGHT;
                return LocalDateTime.of(date, time).atZone(IST).toInstant().toEpochMilli();
            }

            m = DAY_FIRST_NUMERIC.matcher(s);
            if (m.matches()) {
                LocalDate date = LocalDate.of(Integer.parseInt(m.group(3)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(1)));
                LocalTime time = m.group(4) != null ? parseTime(m.group(4)) : LocalTime.MIDNIGHT;
                return LocalDateTime.of(date, time).atZone(IST).toInstant().toEpochMilli();
            }
        } catch (RuntimeException ignored) {
            // an impossible date such as 31 Feb: treated as unknown
        }
        return UNKNOWN;
    }

    private static LocalTime parseTime(String t) {
        String[] parts = t.split(":");
        int hour = Integer.parseInt(parts[0]);
        int minute = Integer.parseInt(parts[1]);
        int second = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
        return LocalTime.of(hour, minute, second);
    }

    private static int monthNumber(String name) {
        String n = name.substring(0, 1).toUpperCase(Locale.ENGLISH) + name.substring(1).toLowerCase(Locale.ENGLISH);
        DateTimeFormatter formatter = n.length() <= 3 ? MONTH_SHORT : MONTH_LONG;
        return formatter.parse(n).get(java.time.temporal.ChronoField.MONTH_OF_YEAR);
    }

    private static String normaliseOffset(String offset) {
        // "+0530" -> "+05:30"
        return offset.length() == 5 ? offset.substring(0, 3) + ":" + offset.substring(3) : offset;
    }

    /** Zone abbreviations written by java.util.Date.toString(); unknown ones are read as India time. */
    private static ZoneId zoneOfAbbreviation(String abbreviation) {
        switch (abbreviation.toUpperCase(Locale.ENGLISH)) {
            case "GMT":
            case "UTC":
            case "Z":
                return ZoneOffset.UTC;
            default:
                return IST;
        }
    }
}
