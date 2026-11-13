package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.*;

class NotifyDatesAndSettingsTest {

    @Test
    void parsesEveryDateShapeInTheSchema() {
        assertEquals(LocalDate.of(2026, 11, 12), NotifyDates.parseDate("2026-11-12"));
        assertEquals(LocalDate.of(2026, 11, 12), NotifyDates.parseDate("2026-11-12 14:00:00"));
        assertEquals(LocalDate.of(2026, 11, 7), NotifyDates.parseDate("7 Nov 2026"));
        assertEquals(LocalDate.of(2026, 11, 7), NotifyDates.parseDate("Sat Nov 07 13:02:26 GMT 2026"));
        assertEquals(LocalDate.of(2026, 11, 7), NotifyDates.parseDate("07-11-2026"));
        assertEquals(LocalDate.of(2026, 11, 7), NotifyDates.parseDate("07/11/2026"));
        assertNull(NotifyDates.parseDate("N/A"));
        assertNull(NotifyDates.parseDate(""));
        assertNull(NotifyDates.parseDate("soon"));
    }

    @Test
    void timestampsBecomeIst() {
        // browser ISO with Z
        assertEquals(LocalDateTime.of(2026, 11, 7, 13, 3), NotifyDates.parseDateTime("2026-11-07T07:33:00.000Z", ZoneOffset.UTC));
        // naive server timestamp written in UTC
        assertEquals(LocalDateTime.of(2026, 11, 7, 13, 3, 48), NotifyDates.parseDateTime("2026-11-07 07:33:48", ZoneOffset.UTC));
        assertEquals(LocalDateTime.of(2026, 11, 7, 13, 3, 48), NotifyDates.parseDateTime("2026-11-07T07:33:48.000", ZoneOffset.UTC));
        // naive server timestamp written in IST stays as is
        assertEquals(LocalDateTime.of(2026, 11, 7, 7, 33, 48), NotifyDates.parseDateTime("2026-11-07 07:33:48", ZoneId.of("Asia/Kolkata")));
        // date only: start of the day
        assertEquals(LocalDateTime.of(2026, 11, 7, 0, 0), NotifyDates.parseDateTime("7 Nov 2026", ZoneOffset.UTC));
    }

    @Test
    void dueTimeComesFromTheDueDateOrTheTimeColumn() {
        assertEquals("14:00", NotifyDates.dueTime("2026-11-12 14:00:00", "N/A"));
        assertEquals("15:00", NotifyDates.dueTime("2026-11-12", "15:00"));
        assertEquals("15:30", NotifyDates.dueTime("2026-11-12 00:00:00", "15:30"));
        assertNull(NotifyDates.dueTime("2026-11-12", "N/A"));
    }

    @Test
    void blankOrBadSettingsFallBackToDefaultsInsteadOfFailing() {
        NotificationSettings s = new NotificationSettings(null);
        ReflectionTestUtils.setField(s, "enabled", "");
        ReflectionTestUtils.setField(s, "pendingDays", "");
        ReflectionTestUtils.setField(s, "dueWindowDays", "abc");
        ReflectionTestUtils.setField(s, "smtpPort", "");
        ReflectionTestUtils.setField(s, "cron", "every morning");
        ReflectionTestUtils.setField(s, "clockCron", "-");
        ReflectionTestUtils.setField(s, "smtpPassword", "abcd efgh ijkl mnop");
        ReflectionTestUtils.setField(s, "appUrl", "http://localhost:8085/");
        assertFalse(s.isEnabled());
        assertEquals(3, s.getPendingDays());
        assertEquals(3, s.getDueWindowDays());
        assertEquals(465, s.getSmtpPort());
        assertEquals("ssl", s.getSmtpSecurity());
        assertEquals(NotificationSettings.DEFAULT_CRON, s.getCron());
        assertNull(s.getClockCron());
        assertEquals("abcdefghijklmnop", s.getSmtpPassword());
        assertEquals("http://localhost:8085", s.getAppUrl());
        assertEquals("smtp.gmail.com", s.getSmtpHost());

        ReflectionTestUtils.setField(s, "smtpPort", "587");
        ReflectionTestUtils.setField(s, "enabled", "TRUE");
        assertEquals("starttls", s.getSmtpSecurity());
        assertTrue(s.isEnabled());
    }

    @Test
    void appUrlKeepsOnlyTheBaseSoTenderLinksWork() {
        NotificationSettings s = new NotificationSettings(null);
        for (String pasted : new String[]{"http://13.232.232.54:8085/#/dashboard", "http://13.232.232.54:8085/",
                "http://13.232.232.54:8085", " http://13.232.232.54:8085/?tab=1 "}) {
            ReflectionTestUtils.setField(s, "appUrl", pasted);
            assertEquals("http://13.232.232.54:8085", s.getAppUrl(), pasted);
        }
        Tender t = new Tender();
        t.setId("gem-7458129");
        assertEquals("http://13.232.232.54:8085/tenders/gem-7458129", DigestTemplates.link(s.getAppUrl(), t));
    }

    @Test
    void recipientOverrideKeyIsUpperCasedUsername() {
        MockEnvironment env = new MockEnvironment()
                .withProperty("NOTIFY_RECIPIENT_MISTEAM", " me@example.com ")
                .withProperty("NOTIFY_RECIPIENT_RAHUL_K", "rahul@example.com");
        NotificationSettings s = new NotificationSettings(env);
        assertEquals("me@example.com", s.recipientOverride("misteam"));
        assertEquals("rahul@example.com", s.recipientOverride("rahul.k"));
        assertEquals("", s.recipientOverride("tpc"));
    }

    @Test
    void fromAddressDefaultsToTheSmtpLogin() {
        NotificationSettings s = new NotificationSettings(null);
        ReflectionTestUtils.setField(s, "smtpUsername", "sender@gmail.com");
        assertEquals("sender@gmail.com", s.getFromAddress());
        ReflectionTestUtils.setField(s, "fromAddress", "alerts@company.in");
        assertEquals("alerts@company.in", s.getFromAddress());
    }

    @Test
    void aNameInMailFromBecomesTheSenderName() {
        NotificationSettings s = new NotificationSettings(null);
        ReflectionTestUtils.setField(s, "smtpUsername", "sender@gmail.com");
        ReflectionTestUtils.setField(s, "fromName", "TenderPocket Alerts");

        ReflectionTestUtils.setField(s, "fromAddress", "Tender Pocket Test");
        assertEquals("sender@gmail.com", s.getFromAddress());
        assertEquals("Tender Pocket Test", s.getFromName());

        ReflectionTestUtils.setField(s, "fromAddress", "\"Tender Pocket\" <alerts@company.in>");
        assertEquals("alerts@company.in", s.getFromAddress());
        assertEquals("Tender Pocket", s.getFromName());

        ReflectionTestUtils.setField(s, "fromAddress", "");
        assertEquals("sender@gmail.com", s.getFromAddress());
        assertEquals("TenderPocket Alerts", s.getFromName());

        ReflectionTestUtils.setField(s, "fromAddress", "alerts@gmail");
        assertEquals("alerts@gmail", s.getFromAddress(), "a mistyped address is kept so the check reports it");
        assertFalse(RecipientDirectory.isEmail(s.getFromAddress()));
    }
}
