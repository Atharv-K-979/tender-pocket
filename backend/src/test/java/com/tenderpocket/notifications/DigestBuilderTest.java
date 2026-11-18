package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import static com.tenderpocket.notifications.NotifyTestData.*;
import static com.tenderpocket.notifications.PendingActionKey.*;
import static org.junit.jupiter.api.Assertions.*;

class DigestBuilderTest {

    private final LocalDate today = LocalDate.of(2026, 11, 12);
    private final RecipientDirectory dir = directory();
    private final DigestBuilder builder = new DigestBuilder(3, 3);

    private Tender due(Tender t, int daysFromToday) {
        t.setDueDate(today.plusDays(daysFromToday) + " 15:00:00");
        return t;
    }

    private ClockSnapshot.TenderEntry entry(Tender t, PendingActionKey key, List<String> owners, int waitingDays) {
        RecipientDirectory.Owner owner = dir.resolve(new PendingWork(key, owners));
        LocalDateTime since = today.minusDays(waitingDays).atTime(10, 0);
        return new ClockSnapshot.TenderEntry(t, List.of(new ClockSnapshot.WorkItem(key, owner, since)));
    }

    private List<DigestBuilder.TenderView> views(ClockSnapshot.TenderEntry... entries) {
        return builder.prepare(new ClockSnapshot(today.atTime(9, 0), List.of(entries), dir), today);
    }

    private static List<String> dueIds(Digest d) {
        return d.dueRows().stream().map(r -> r.tender().getId()).toList();
    }

    private static List<String> pendingIds(Digest d) {
        return d.pendingRows().stream().map(r -> r.tender().getId()).toList();
    }

    @Test
    void dueWindowIsTodayToThreeDaysAhead() {
        List<DigestBuilder.TenderView> v = views(
                entry(due(undecided("D0"), 0), DECIDE, List.of(), 1),
                entry(due(undecided("D3"), 3), DECIDE, List.of(), 1),
                entry(due(undecided("D4"), 4), DECIDE, List.of(), 1),
                entry(due(undecided("DM1"), -1), DECIDE, List.of(), 1));
        Digest mis = builder.buildDue(dir.find("misteam"), v, today);
        assertEquals(List.of("D0", "D3"), dueIds(mis));
        assertTrue(mis.missedRows().isEmpty(), "only Admin gets Missed yesterday");
        assertEquals(1, mis.dueTodayCount());
    }

    @Test
    void misAndAdminSeeEveryDueTenderButOthersOnlyTheirOwn() {
        List<DigestBuilder.TenderView> v = views(
                entry(due(undecided("U"), 1), DECIDE, List.of(), 0),
                entry(due(assigned("E1", "executive"), 2), SPEC_PREP, List.of("executive"), 0),
                entry(due(assigned("E2", "exec2"), 2), SPEC_PREP, List.of("exec2"), 0),
                entry(due(assigned("C", "exec2"), 3), SPEC_REVIEW, List.of(), 0));
        assertEquals(List.of("U", "E1", "E2", "C"), dueIds(builder.buildDue(dir.find("misteam"), v, today)));
        assertEquals(List.of("U", "E1", "E2", "C"), dueIds(builder.buildDue(dir.find("admin"), v, today)));
        assertEquals(List.of("E1"), dueIds(builder.buildDue(dir.find("executive"), v, today)));
        assertEquals(List.of("E2", "C"), dueIds(builder.buildDue(dir.find("exec2"), v, today)), "an executive sees their tenders even when someone else holds them");
        assertEquals(List.of("C"), dueIds(builder.buildDue(dir.find("clearance"), v, today)));
        assertTrue(builder.buildDue(dir.find("tpc"), v, today).isEmpty());
    }

    @Test
    void adminGetsTendersMissedYesterday() {
        List<DigestBuilder.TenderView> v = views(entry(due(assigned("M", "executive"), -1), SPEC_PREP, List.of("executive"), 5));
        Digest admin = builder.buildDue(dir.find("admin"), v, today);
        assertTrue(admin.dueRows().isEmpty());
        assertEquals(1, admin.missedRows().size());
        assertFalse(admin.isEmpty());
    }

    @Test
    void filedTendersAreNeverInTheDueMail() {
        Tender filed = due(atDualTrack("F", "executive"), 1);
        filed.setStatus("Submitted");
        filed.setSubmissionStatus("Pending");
        Digest mis = builder.buildDue(dir.find("misteam"), views(entry(filed, SUBMIT_CONFIRM, List.of(), 1)), today);
        assertTrue(mis.isEmpty());
    }

    @Test
    void pendingNeedsMoreThanThreeDays() {
        List<DigestBuilder.TenderView> v = views(
                entry(due(undecided("W3"), 10), DECIDE, List.of(), 3),
                entry(due(undecided("W4"), 10), DECIDE, List.of(), 4));
        assertEquals(List.of("W4"), pendingIds(builder.buildPending(dir.find("misteam"), v, today, List.of())));
    }

    @Test
    void aTenderDueSoonIsNeverAlsoInThePendingMail() {
        List<DigestBuilder.TenderView> v = views(
                entry(due(assigned("SOON", "executive"), 2), SPEC_PREP, List.of("executive"), 9),
                entry(due(assigned("LATER", "executive"), 4), SPEC_PREP, List.of("executive"), 9),
                entry(due(assigned("PAST", "executive"), -1), SPEC_PREP, List.of("executive"), 9));
        Digest exec = builder.buildPending(dir.find("executive"), v, today, List.of());
        assertEquals(List.of("LATER"), pendingIds(exec));
        assertEquals(List.of("SOON"), dueIds(builder.buildDue(dir.find("executive"), v, today)));
    }

    @Test
    void pendingRowsGoOnlyToTheOwner() {
        List<DigestBuilder.TenderView> v = views(
                entry(due(assigned("A", "executive"), 9), SPEC_PREP, List.of("executive"), 5),
                entry(due(assigned("B", "exec2"), 9), SPEC_REVIEW, List.of(), 5),
                entry(due(assigned("C", "exec2"), 9), EMD_APPROVE, List.of("mis2"), 5));
        assertEquals(List.of("A"), pendingIds(builder.buildPending(dir.find("executive"), v, today, List.of())));
        assertTrue(builder.buildPending(dir.find("exec2"), v, today, List.of()).isEmpty());
        assertEquals(List.of("B"), pendingIds(builder.buildPending(dir.find("clearance"), v, today, List.of())));
        assertEquals(List.of("C"), pendingIds(builder.buildPending(dir.find("mis2"), v, today, List.of())));
        assertTrue(builder.buildPending(dir.find("misteam"), v, today, List.of()).isEmpty(), "named member, not the queue");
        assertEquals(3, builder.buildPending(dir.find("admin"), v, today, List.of()).pendingTotal());
    }

    @Test
    void filedAwaitingConfirmationAndNoDueDateGoInTheirOwnBands() {
        Tender filed = due(atDualTrack("F", "executive"), -5);
        filed.setStatus("Submitted");
        filed.setSubmissionStatus("Pending");
        Tender noDue = undecided("N");
        List<DigestBuilder.TenderView> v = views(
                entry(filed, SUBMIT_CONFIRM, List.of(), 4),
                entry(noDue, DECIDE, List.of(), 6),
                entry(due(undecided("W"), 5), DECIDE, List.of(), 4));
        Digest mis = builder.buildPending(dir.find("misteam"), v, today, List.of());
        assertEquals(List.of("F", "N", "W"), pendingIds(mis), "priority: work under way, then rows that never reach the Due mail, then nearest deadline");
        MailComposer.MailView shown = MailComposer.view(mis, 3, null);
        assertEquals(List.of("W", "N", "F"), shown.pendingRows().stream().map(r -> r.tender().getId()).toList(), "displayed by due-date group");
        assertEquals(List.of(0, 3, 4), shown.pendingRows().stream().map(DigestBuilder::band).toList());
    }

    @Test
    void theBuilderNeverDropsRows() {
        List<ClockSnapshot.TenderEntry> entries = new ArrayList<>();
        for (int i = 0; i < 1000; i++) {
            entries.add(entry(due(undecided("T" + i), 4 + (i % 30)), DECIDE, List.of(), 5));
        }
        List<DigestBuilder.TenderView> v = builder.prepare(new ClockSnapshot(today.atTime(9, 0), entries, dir), today);
        Digest mis = builder.buildPending(dir.find("misteam"), v, today, List.of());
        assertEquals(1000, mis.pendingTotal());
        assertEquals(1000, mis.pendingRows().size());
        assertEquals(1000, mis.rowCount());
    }

    @Test
    void adminPendingHasOwnerSummaryRoutingNotesAndDelivery() {
        List<DigestBuilder.TenderView> v = views(
                entry(due(undecided("U1"), 9), DECIDE, List.of(), 5),
                entry(due(undecided("U2"), 9), DECIDE, List.of(), 8),
                entry(due(assigned("G", "ghost.exec"), 9), BID_DOCS, List.of("ghost.exec"), 6),
                entry(due(undecided("SOON"), 1), DECIDE, List.of(), 0));
        List<Digest.DeliveryLine> delivery = List.of(new Digest.DeliveryLine("tpc", "Due", "FAILED", "timeout"));
        Digest admin = builder.buildPending(dir.find("admin"), v, today, delivery);
        assertEquals(3, admin.pendingTotal());
        Digest.OwnerSummary mis = admin.ownerSummary().stream().filter(s -> s.ownerLabel().equals("MIS Team")).findFirst().orElseThrow();
        assertEquals(2, mis.waitingCount());
        assertEquals(8, mis.oldestDays());
        assertEquals(1, mis.dueSoonCount());
        assertEquals(1, admin.notes().size());
        assertTrue(admin.notes().get(0).contains("ghost.exec"));
        assertEquals(1, admin.delivery().size());
    }

    @Test
    void adminPendingWithOnlyAFailureIsStillSent() {
        Digest admin = builder.buildPending(dir.find("admin"), views(), today,
                List.of(new Digest.DeliveryLine("tpc", "Due", "FAILED", "timeout")));
        assertFalse(admin.isEmpty());
        Digest quiet = builder.buildPending(dir.find("admin"), views(), today,
                List.of(new Digest.DeliveryLine("tpc", "Due", "SENT", "to tpc@example.com")));
        assertTrue(quiet.isEmpty(), "a clean delivery report alone is not worth a mail");
    }
}
