package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

import static com.tenderpocket.notifications.NotifyTestData.*;
import static com.tenderpocket.notifications.PendingActionKey.*;
import static org.junit.jupiter.api.Assertions.*;

class DigestTemplatesTest {

    private final LocalDate today = LocalDate.of(2026, 11, 12);
    private final LocalDateTime now = today.atTime(9, 0);
    private final RecipientDirectory dir = directory();
    private final DigestBuilder builder = new DigestBuilder(3, 3);

    private ClockSnapshot.TenderEntry entry(Tender t, PendingActionKey key, List<String> owners, int waiting) {
        return new ClockSnapshot.TenderEntry(t, List.of(new ClockSnapshot.WorkItem(key, dir.resolve(new PendingWork(key, owners)),
                today.minusDays(waiting).atTime(10, 0))));
    }

    private Tender due(Tender t, int days) {
        t.setDueDate(today.plusDays(days) + " 15:00:00");
        return t;
    }

    private MailComposer.ComposedMail compose(Digest d, String appUrl) {
        return MailComposer.compose(d, appUrl, 200, now);
    }

    @Test
    void dueSubjectAndBodyNameTheDeadlinesAndOwners() {
        Tender risky = due(undecided("T<1>"), 0);
        risky.setTitle("Beds & \"ICU\" <script>");
        List<DigestBuilder.TenderView> v = builder.prepare(new ClockSnapshot(now, List.of(
                entry(risky, DECIDE, List.of(), 6),
                entry(due(assigned("T2", "executive"), 2), SPEC_PREP, List.of("executive"), 1)), dir), today);
        Digest d = builder.buildDue(dir.find("misteam"), v, today);
        MailComposer.ComposedMail mail = compose(d, "http://localhost:8085");

        assertEquals("Due soon: 1 today, 1 in next 3 days · TenderPocket · 12 Nov", mail.subject());
        assertNull(mail.attachment(), "two rows fit, so no Excel");
        assertTrue(mail.html().contains("Beds &amp; &quot;ICU&quot; &lt;script&gt;"));
        assertFalse(mail.html().contains("<script>"));
        assertTrue(mail.html().contains("http://localhost:8085/tenders/T%3C1%3E"));
        assertTrue(mail.html().contains("Due today · 1"));
        assertTrue(mail.html().contains("Assign &amp; Participate decision"));
        assertTrue(mail.html().contains("6 days"));
        assertTrue(mail.html().contains("12 Nov 2026, 15:00"));
        assertTrue(mail.text().contains("DUE TODAY"));
        assertTrue(mail.text().contains("waiting on MIS Team: Assign & Participate decision (6 days)"));
    }

    @Test
    void titlesAndAuthoritiesAreNeverShortened() {
        Tender t = due(undecided("LONG"), 1);
        String title = "Supply of " + "very long item description ".repeat(30) + "END-OF-TITLE";
        String authority = "Department of " + "Health ".repeat(30) + "END-OF-AUTHORITY";
        t.setTitle(title);
        t.setAuthority(authority);
        Digest d = builder.buildDue(dir.find("misteam"), builder.prepare(new ClockSnapshot(now, List.of(entry(t, DECIDE, List.of(), 1)), dir), today), today);
        MailComposer.ComposedMail mail = compose(d, "");
        assertTrue(mail.html().contains("END-OF-TITLE") && mail.html().contains("END-OF-AUTHORITY"));
        assertTrue(mail.text().contains(title) && mail.text().contains(authority));
    }

    @Test
    void noLinksWithoutAnAppAddress() {
        List<DigestBuilder.TenderView> v = builder.prepare(new ClockSnapshot(now,
                List.of(entry(due(undecided("T1"), 1), DECIDE, List.of(), 0)), dir), today);
        MailComposer.ComposedMail mail = compose(builder.buildDue(dir.find("misteam"), v, today), "");
        assertTrue(mail.subject().startsWith("Due soon"));
        assertFalse(mail.html().contains("/tenders/"));
    }

    @Test
    void pendingSubjectsForTeamAndAdmin() {
        List<DigestBuilder.TenderView> v = builder.prepare(new ClockSnapshot(now, List.of(
                entry(due(undecided("T1"), 10), DECIDE, List.of(), 5),
                entry(due(assigned("T2", "executive"), 9), BID_DOCS, List.of("executive"), 4)), dir), today);
        Digest exec = builder.buildPending(dir.find("executive"), v, today, List.of());
        assertEquals("Waiting on you: 1 tender over 3 days · TenderPocket · 12 Nov", compose(exec, "").subject());
        Digest admin = builder.buildPending(dir.find("admin"), v, today, List.of());
        MailComposer.ComposedMail mail = compose(admin, "");
        assertEquals("Waiting over 3 days: 2 tenders across 2 owners · TenderPocket · 12 Nov", mail.subject());
        assertTrue(mail.html().contains("By owner"));
        assertTrue(mail.html().contains("Generate bid package"));
    }
}
