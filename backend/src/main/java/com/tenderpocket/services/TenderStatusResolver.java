package com.tenderpocket.services;

import com.tenderpocket.models.Tender;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Locale;

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
    public static String resolve(Tender t, String todayIST) {
        String stored = t.getStatus();

        boolean hasPassedDueDate = t.getDueDate() != null
                && !t.getDueDate().isBlank()
                && t.getDueDate().split(" ")[0].compareTo(todayIST) < 0;

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

        // "Lapsed" means nobody has picked the tender up, measured from when it was assigned or,
        // failing that, when it arrived. Deriving it from publish_date instead - as the dashboard
        // did - marks a tender neglected the moment it is imported, because GeM bids are routinely
        // published more than three days before they are scraped.
        String refDate = t.getAssignedAt() != null
                ? t.getAssignedAt()
                : (t.getScrapedAt() != null ? t.getScrapedAt() : t.getPublishDate());
        LocalDate ref = parseFlexibleDate(refDate);
        boolean unassigned = t.getMisExecutive() == null || t.getMisExecutive().isBlank();
        if (ref != null && unassigned
                && ChronoUnit.DAYS.between(ref, LocalDate.now()) >= LAPSE_AFTER_DAYS) {
            return "Lapsed";
        }

        // GeMScraperService stores "Issued" on every new tender. That is an internal marker, not
        // a status the UI offers: returning it verbatim meant a scraped tender matched neither the
        // "New" nor the "Lapsed" filter, and the tender list came back empty for every status
        // while the dashboard counted the same rows as New.
        if (stored == null || stored.isBlank() || eq(stored, "Issued")) return "New";

        return stored;
    }

    private static boolean eq(String value, String expected) {
        return value != null && value.equalsIgnoreCase(expected);
    }
}
