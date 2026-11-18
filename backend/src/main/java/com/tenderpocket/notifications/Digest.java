package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;

import java.time.LocalDate;
import java.util.List;

/**
 * What one login receives in one mail on one day. Built by DigestBuilder with every row, in
 * priority order (most urgent first). MailComposer decides how many of them fit in the mail
 * body; whatever does not fit goes into the Excel attachment, which always holds every row.
 */
public record Digest(
        DigestType type,
        RecipientDirectory.Recipient recipient,
        LocalDate date,
        int pendingDays,
        int dueWindowDays,
        List<DueRow> dueRows,
        List<DueRow> missedRows,
        List<PendingRow> pendingRows,
        int pendingTotal,
        int pendingTenderCount,
        List<OwnerSummary> ownerSummary,
        List<String> notes,
        List<DeliveryLine> delivery) {

    public enum DigestType { DUE, PENDING }

    /** One action on a tender, with how long it has waited. */
    public record WorkLine(PendingActionKey key, Team team, String ownerLabel, long waitingDays) {}

    /** A tender in the Due mail. */
    public record DueRow(Tender tender, LocalDate dueDate, String dueTime, int daysLeft, List<WorkLine> works) {
        /** Someone is already working on it (an executive is assigned), as opposed to awaiting the MIS decision. */
        public boolean inProgress() {
            return !PendingWorkResolver.assignedExecutive(tender).isEmpty();
        }
    }

    /**
     * One overdue action in the Pending mail.
     *
     * @param daysLeft null when the tender has no usable due date
     */
    public record PendingRow(Tender tender, LocalDate dueDate, String dueTime, Integer daysLeft, boolean filed, WorkLine work) {
        /** Work already under way, as opposed to the MIS decision on a new tender. */
        public boolean inProgress() {
            return work.key() != PendingActionKey.DECIDE;
        }
    }

    /** Admin's per-owner overview at the top of its Pending mail. */
    public record OwnerSummary(String ownerLabel, Team team, int waitingCount, long oldestDays, int dueSoonCount, String topAction) {}

    /** One line of the delivery report in Admin's Pending mail. */
    public record DeliveryLine(String username, String mail, String status, String detail) {
        public boolean isFailure() { return "FAILED".equals(status); }
    }

    public boolean isAdmin() { return recipient != null && recipient.team() == Team.ADMIN; }

    public boolean isEmpty() {
        if (type == DigestType.DUE) return dueRows.isEmpty() && missedRows.isEmpty();
        boolean failures = delivery.stream().anyMatch(DeliveryLine::isFailure);
        return pendingRows.isEmpty() && notes.isEmpty() && !failures;
    }

    /** Every row this mail reports (body plus attachment). */
    public int rowCount() {
        return type == DigestType.DUE ? dueRows.size() + missedRows.size() : pendingRows.size();
    }

    /** Rows this mail reports, for the send log. */
    public int itemCount() { return rowCount(); }

    public long dueTodayCount() { return dueRows.stream().filter(r -> r.daysLeft() == 0).count(); }
}
