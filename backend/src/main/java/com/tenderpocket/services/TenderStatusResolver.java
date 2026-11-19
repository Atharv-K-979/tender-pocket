package com.tenderpocket.services;

import com.tenderpocket.models.Tender;
import com.tenderpocket.utils.TenderDateSort;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The single definition of a tender's displayed status.
 *
 * This used to be implemented twice - once in TenderController for the tender list and once in
 * AnalyticsController for the dashboard - and the two copies had drifted apart. The dashboard
 * derived "Lapsed" from publish_date while the list derived it from scraped_at, so the Control
 * Desk reported 68 New / 130 Lapsed while filtering the list by either value returned nothing.
 *
 * Both controllers now delegate here. Keep it that way: if the rule needs to change, change it
 * once.
 */
public final class TenderStatusResolver {

    private TenderStatusResolver() {}

    /** Days a tender may sit unassigned before it counts as Lapsed. */
    private static final int LAPSE_AFTER_DAYS = 3;

    private static final DateTimeFormatter LEGACY_DATE =
            DateTimeFormatter.ofPattern("MMM d yyyy", Locale.ENGLISH);

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /** A value that starts with an ISO day: "2026-12-13", "2026-12-13 17:00:00", "2026-12-13T17:00". */
    private static final Pattern STARTS_WITH_ISO_DAY = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}");

    /**
     * Parses the several date shapes stored across the schema.
     *
     * due_date and publish_date are written as ISO ("2026-10-08", optionally with a time), but
     * GeMScraperService writes scraped_at with java.util.Date.toString() - for example
     * "Sun Oct 11 19:12:57 GMT 2026". The previous code did LocalDate.parse(raw.split(" ")[0]),
     * which on that value attempts to parse "Sun", throws, and was swallowed by an empty catch.
     * The Lapsed branch could therefore never run for a scraped tender.
     *
     * @return the date, or null when the value is absent, "N/A", or in no recognised shape.
     */
    public static LocalDate parseFlexibleDate(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty() || "N/A".equalsIgnoreCase(s)) return null;

        // ISO: 2026-10-08, 2026-10-08 13:00:00, 2026-10-08T13:00:00Z
        try {
            return LocalDate.parse(s.split("[ T]")[0]);
        } catch (Exception ignored) {
            // fall through to the legacy shape
        }

        // java.util.Date.toString(): "Sun Oct 11 19:12:57 GMT 2026". Read by position so that no
        // timezone abbreviation has to be resolved - those are ambiguous and locale-dependent.
        try {
            String[] parts = s.split("\\s+");
            if (parts.length >= 6) {
                return LocalDate.parse(
                        parts[1] + " " + parts[2] + " " + parts[parts.length - 1], LEGACY_DATE);
            }
        } catch (Exception ignored) {
            // unrecognised
        }

        return null;
    }

    /**
     * @param todayIST today's date in Asia/Kolkata, as an ISO string, used for the due-date
     *                 comparison so that "overdue" follows the client's working day.
     */
    public static String resolve(String stored, String dueDate, String assignedAt, String scrapedAt, String publishDate, String misExecutive, String todayIST) {
        boolean hasPassedDueDate = hasPassedDueDate(dueDate, todayIST);

        if (eq(stored, "Awarded") || eq(stored, "Won")) return "Won";
        if (eq(stored, "Not Awarded") || eq(stored, "Lost")) return "Lost";
        if (eq(stored, "Filed") || eq(stored, "Submitted")) return "Submitted";

        if (hasPassedDueDate) {
            if (eq(stored, "Not Participating") || eq(stored, "NON_PARTICIPATING")) {
                return "Missed Opportunity";
            }
            if (eq(stored, "Issued") || eq(stored, "Participating") || eq(stored, "New")
                    || stored == null) {
                return "Missed Deadline";
            }
        }

        if (eq(stored, "Not Participating") || eq(stored, "NON_PARTICIPATING")) {
            return "Not Participating";
        }
        if (eq(stored, "Participating")) return "Participating";

        String refDate = assignedAt != null
                ? assignedAt
                : (scrapedAt != null ? scrapedAt : publishDate);
        LocalDate ref = parseFlexibleDate(refDate);
        boolean unassigned = misExecutive == null || misExecutive.isBlank();
        if (ref != null && unassigned
                && ChronoUnit.DAYS.between(ref, LocalDate.now()) >= LAPSE_AFTER_DAYS) {
            return "Lapsed";
        }

        if (stored == null || stored.isBlank() || eq(stored, "Issued")) return "New";

        return stored;
    }

    /**
     * True when the due date lies before today (Asia/Kolkata).
     *
     * Due dates that start with an ISO day ("2026-12-13", optionally with a time) are compared as
     * text, exactly as before: for that shape a text comparison is a date comparison. Due dates in
     * other shapes ("13 Dec 2026", "13-12-2026") went through the same text comparison, which reads
     * them wrongly: "13 Dec 2026" sorts before "2026-11-19", so a tender due next month showed as
     * Missed Deadline, while "25 Oct 2026" sorts after it, so an overdue tender never did. Those
     * are now read as dates. A shape that cannot be read keeps the old comparison.
     */
    static boolean hasPassedDueDate(String dueDate, String todayIST) {
        if (dueDate == null || dueDate.isBlank()) return false;
        String firstWord = dueDate.split(" ")[0];
        if (!STARTS_WITH_ISO_DAY.matcher(firstWord).lookingAt()) {
            long dueMillis = TenderDateSort.key(dueDate);
            if (dueMillis != TenderDateSort.UNKNOWN) {
                try {
                    LocalDate due = Instant.ofEpochMilli(dueMillis).atZone(IST).toLocalDate();
                    return due.isBefore(LocalDate.parse(todayIST));
                } catch (Exception ignored) {
                    // today not in ISO form: keep the old comparison below
                }
            }
        }
        return firstWord.compareTo(todayIST) < 0;
    }

    public static String resolve(Tender t, String todayIST) {
        if (t == null) return "New";
        return resolve(t.getStatus(), t.getDueDate(), t.getAssignedAt(), t.getScrapedAt(), t.getPublishDate(), t.getMisExecutive(), todayIST);
    }

    public static String resolve(com.tenderpocket.repositories.TenderRepository.TenderAnalyticsProjection p, String todayIST) {
        if (p == null) return "New";
        return resolve(p.getStatus(), p.getDueDate(), p.getAssignedAt(), p.getScrapedAt(), p.getPublishDate(), p.getMisExecutive(), todayIST);
    }

    private static boolean eq(String value, String expected) {
        return value != null && value.equalsIgnoreCase(expected);
    }
}
