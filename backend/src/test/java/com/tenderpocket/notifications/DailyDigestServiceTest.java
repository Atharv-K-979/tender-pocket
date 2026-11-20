package com.tenderpocket.notifications;

import com.tenderpocket.models.EmailDigestLog;
import com.tenderpocket.models.Tender;
import com.tenderpocket.models.User;
import com.tenderpocket.repositories.EmailDigestLogRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static com.tenderpocket.notifications.NotifyTestData.*;
import static com.tenderpocket.notifications.PendingActionKey.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DailyDigestServiceTest {

    private final LocalDate today = LocalDate.now(NotificationSettings.IST);
    private NotificationSettings settings;
    private PendingClockService clock;
    private NotificationMailer mailer;
    private EmailDigestLogRepository logRepo;
    private DailyDigestService service;
    private final List<EmailDigestLog> rows = new ArrayList<>();
    private long nextId = 1;

    @BeforeEach
    void setUp() throws Exception {
        settings = new NotificationSettings();
        ReflectionTestUtils.setField(settings, "enabled", "true");
        clock = mock(PendingClockService.class);
        mailer = mock(NotificationMailer.class);
        when(mailer.describe()).thenReturn("test smtp");
        when(mailer.send(anyString(), anyString(), anyString(), anyString(), any())).thenReturn(1);
        logRepo = mock(EmailDigestLogRepository.class);
        when(logRepo.findByRecipientUsernameAndDigestTypeAndSentDate(anyString(), anyString(), any()))
                .thenAnswer(inv -> rows.stream()
                        .filter(r -> r.getRecipientUsername().equals(inv.getArgument(0))
                                && r.getDigestType().equals(inv.getArgument(1))
                                && r.getSentDate().equals(inv.getArgument(2)))
                        .findFirst());
        when(logRepo.saveAndFlush(any(EmailDigestLog.class))).thenAnswer(inv -> {
            EmailDigestLog r = inv.getArgument(0);
            if (r.getId() == null) {
                boolean clash = rows.stream().anyMatch(x -> x.getRecipientUsername().equals(r.getRecipientUsername())
                        && x.getDigestType().equals(r.getDigestType()) && x.getSentDate().equals(r.getSentDate()));
                if (clash) throw new DataIntegrityViolationException("uk_email_digest_log");
                r.setId(nextId++);
                rows.add(r);
            }
            return r;
        });
        when(logRepo.findBySentDateOrderByIdAsc(any())).thenAnswer(inv -> rows.stream()
                .filter(r -> r.getSentDate().equals(inv.getArgument(0))).toList());
        service = new DailyDigestService(settings, clock, mailer, logRepo);
    }

    private ClockSnapshot snapshot(List<User> users) {
        RecipientDirectory dir = new RecipientDirectory(users, settings::recipientOverride);
        List<ClockSnapshot.TenderEntry> entries = new ArrayList<>();
        entries.add(entry(dir, due(undecided("U-SOON"), 1), DECIDE, List.of(), 0));
        entries.add(entry(dir, due(undecided("U-OLD"), 10), DECIDE, List.of(), 6));
        entries.add(entry(dir, due(assigned("E-SOON", "executive"), 0), SPEC_PREP, List.of("executive"), 1));
        entries.add(entry(dir, due(assigned("E-OLD", "executive"), 12), SPEC_PREP, List.of("executive"), 5));
        return new ClockSnapshot(LocalDateTime.now(NotificationSettings.IST), entries, dir);
    }

    private Tender due(Tender t, int days) {
        t.setDueDate(today.plusDays(days).toString());
        return t;
    }

    private ClockSnapshot.TenderEntry entry(RecipientDirectory dir, Tender t, PendingActionKey key, List<String> owners, int waiting) {
        return new ClockSnapshot.TenderEntry(t, List.of(new ClockSnapshot.WorkItem(key, dir.resolve(new PendingWork(key, owners)),
                today.minusDays(waiting).atTime(8, 0))));
    }

    private List<User> users() {
        return List.of(
                new User("admin", "x", "Admin", "admin@example.com"),
                new User("misteam", "x", "MIS Team", "mis@example.com"),
                new User("executive", "x", "Tender Executive", "exec@example.com"),
                new User("clearance", "x", "Clearance Team", "clr@example.com"),
                new User("tpc", "x", "TPC Team", "tpc@example.com"));
    }

    private List<String> sentTo() throws Exception {
        ArgumentCaptor<String> to = ArgumentCaptor.forClass(String.class);
        verify(mailer, atLeast(0)).send(to.capture(), anyString(), anyString(), anyString(), any());
        return to.getAllValues();
    }

    @Test
    void sendsOneMailPerLoginWithBothSectionsAndAdminLast() throws Exception {
        when(clock.refresh(any())).thenReturn(snapshot(users()));
        DailyDigestService.RunReport report = service.run("test");

        assertEquals("DONE", report.status());
        assertEquals(List.of("mis@example.com", "exec@example.com", "admin@example.com"), sentTo());
        assertEquals(3, report.count("SENT"));
        assertEquals(2, report.count("NOTHING_TO_REPORT"), "Clearance and TPC have nothing, so they get no mail");
        assertTrue(rows.stream().allMatch(r -> "DAILY".equals(r.getDigestType())));

        ArgumentCaptor<String> html = ArgumentCaptor.forClass(String.class);
        verify(mailer).send(eq("mis@example.com"), anyString(), html.capture(), anyString(), any());
        assertTrue(html.getValue().contains("REF-U-SOON") && html.getValue().contains("REF-U-OLD"),
                "the one MIS mail has both the due-soon tender and the long-waiting tender");
        assertTrue(html.getValue().contains("Due in the next 3 days") && html.getValue().contains("Waiting on you over 3 days"));
        assertTrue(rows.stream().allMatch(r -> EmailDigestLog.SENT.equals(r.getStatus())));
    }

    @Test
    void neverMoreThanOneMailPerLoginPerDay() throws Exception {
        when(clock.refresh(any())).thenReturn(snapshot(users()));
        service.run("first");
        DailyDigestService.RunReport second = service.run("second");
        DailyDigestService.RunReport third = service.run("third");

        verify(mailer, times(3)).send(anyString(), anyString(), anyString(), anyString(), any());
        assertEquals(0, second.count("SENT"));
        assertEquals(3, second.count("ALREADY_SENT"));
        assertEquals(3, third.count("ALREADY_SENT"));
        assertEquals(3, rows.size());
    }

    @Test
    void failedMailIsReportedToAdminAndRetriedOnTheNextRun() throws Exception {
        when(clock.refresh(any())).thenReturn(snapshot(users()));
        when(mailer.send(eq("exec@example.com"), anyString(), anyString(), anyString(), any()))
                .thenThrow(new NotificationMailer.SendFailure("Connection timed out", 3))
                .thenReturn(1);

        DailyDigestService.RunReport first = service.run("first");
        assertEquals(1, first.count("FAILED"));
        ArgumentCaptor<String> adminHtml = ArgumentCaptor.forClass(String.class);
        verify(mailer).send(eq("admin@example.com"), startsWith("Daily tenders"), adminHtml.capture(), anyString(), any());
        assertTrue(adminHtml.getValue().contains("Delivery report for today"));
        assertTrue(adminHtml.getValue().contains("Connection timed out"));

        DailyDigestService.RunReport second = service.run("retry");
        assertEquals(1, second.count("SENT"), "the failed executive mail is retried");
        assertEquals(2, second.count("ALREADY_SENT"));
        EmailDigestLog execDue = rows.stream().filter(r -> r.getRecipientUsername().equals("executive") && r.getDigestType().equals("DAILY")).findFirst().orElseThrow();
        assertEquals(EmailDigestLog.SENT, execDue.getStatus());
        assertEquals(4, execDue.getAttempts());
    }

    @Test
    void switchedOffSendsNothing() throws Exception {
        ReflectionTestUtils.setField(settings, "enabled", "false");
        DailyDigestService.RunReport report = service.run("test");
        assertEquals("DISABLED", report.status());
        verifyNoInteractions(clock);
        verify(mailer, never()).send(anyString(), anyString(), anyString(), anyString(), any());
    }

    @Test
    void loginWithoutAnAddressFailsClearlyWithoutCallingSmtp() throws Exception {
        List<User> users = new ArrayList<>(users());
        users.set(2, new User("executive", "x", "Tender Executive", ""));
        when(clock.refresh(any())).thenReturn(snapshot(users));
        DailyDigestService.RunReport report = service.run("test");
        verify(mailer, never()).send(eq(""), anyString(), anyString(), anyString(), any());
        assertTrue(report.outcomes().stream().noneMatch(o -> o.username().equals("executive") && o.status().equals("SENT")));
        // the executive's tenders fall back to MIS, so MIS still hears about them
        ArgumentCaptor<String> misHtml = ArgumentCaptor.forClass(String.class);
        verify(mailer, atLeastOnce()).send(eq("mis@example.com"), anyString(), misHtml.capture(), anyString(), any());
        assertTrue(misHtml.getAllValues().stream().anyMatch(h -> h.contains("REF-E-OLD")));
    }

    @Test
    void claimIsRefusedWhileAnotherRunIsSending() {
        LocalDateTime now = LocalDateTime.now(NotificationSettings.IST);
        assertNotNull(service.claim("misteam", "DUE", today, now));
        assertNull(service.claim("misteam", "DUE", today, now.plusMinutes(1)), "still SENDING");
        assertNotNull(service.claim("misteam", "DUE", today, now.plusMinutes(31)), "a stale SENDING slot is reused");
        assertEquals(Optional.of(1L), rows.stream().map(EmailDigestLog::getId).findFirst());
    }
}
