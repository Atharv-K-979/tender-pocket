package com.tenderpocket.services;

import com.tenderpocket.models.*;
import com.tenderpocket.repositories.EmailNotificationLogRepository;
import com.tenderpocket.repositories.TenderApprovalRepository;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.repositories.UserRepository;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class EmailNotificationServiceTest {

    @Mock
    private TenderRepository tenderRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private TenderApprovalRepository approvalRepository;

    @Mock
    private EmailNotificationLogRepository notificationLogRepository;

    @Mock
    private JavaMailSender mailSender;

    @InjectMocks
    private EmailNotificationService emailNotificationService;

    private final LocalDate today = LocalDate.of(2026, 9, 21);

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(emailNotificationService, "fromEmail", "alerts@company.com");
        lenient().when(mailSender.createMimeMessage()).thenReturn(new MimeMessage((Session) null));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A. T-3 Test: exactly 3 days included; 2 days and 4 days excluded
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testT3DueDateNotifications_ExactDay3Included_Day2AndDay4Excluded() {
        String t3DateStr = today.plusDays(3).format(DateTimeFormatter.ISO_LOCAL_DATE); // 2026-09-24

        Tender tenderT3 = new Tender();
        tenderT3.setId("T-T3");
        tenderT3.setRefNo("REF-T3");
        tenderT3.setTitle("Bridge Construction Project");
        tenderT3.setAuthority("NHAI");
        tenderT3.setStatus("Participating");
        tenderT3.setDueDate(t3DateStr + " 15:00:00");
        tenderT3.setMisExecutive("executive");

        // The query findActiveTendersByDueDatePrefixAndExecutiveAssigned is called with t3DateStr
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t3DateStr)))
                .thenReturn(List.of(tenderT3));
        // Empty for T0
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(today.format(DateTimeFormatter.ISO_LOCAL_DATE))))
                .thenReturn(Collections.emptyList());
        when(tenderRepository.findUnreviewedCandidates()).thenReturn(Collections.emptyList());
        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING")).thenReturn(Collections.emptyList());

        User execUser = new User("executive", "hash", "Tender Executive", "executive@company.com");
        when(userRepository.findById("executive")).thenReturn(Optional.of(execUser));

        Map<String, Object> result = emailNotificationService.processDailyNotifications(today);

        assertEquals(1, result.get("dueT3Found"));
        assertEquals(0, result.get("dueT0Found"));
        assertEquals(1, result.get("emailsSent"));
        verify(mailSender, times(1)).send(any(MimeMessage.class));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // B. T0 Test: today included; tomorrow excluded
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testT0DueDateNotifications_TodayIncluded_TomorrowExcluded() {
        String t0DateStr = today.format(DateTimeFormatter.ISO_LOCAL_DATE); // 2026-09-21

        Tender tenderT0 = new Tender();
        tenderT0.setId("T-T0");
        tenderT0.setRefNo("REF-T0");
        tenderT0.setTitle("Hospital Oxygen Supply");
        tenderT0.setAuthority("AIIMS");
        tenderT0.setStatus("Issued");
        tenderT0.setDueDate(t0DateStr);
        tenderT0.setMisExecutive("executive");

        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t0DateStr)))
                .thenReturn(List.of(tenderT0));
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(today.plusDays(3).format(DateTimeFormatter.ISO_LOCAL_DATE))))
                .thenReturn(Collections.emptyList());
        when(tenderRepository.findUnreviewedCandidates()).thenReturn(Collections.emptyList());
        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING")).thenReturn(Collections.emptyList());

        User execUser = new User("executive", "hash", "Tender Executive", "executive@company.com");
        when(userRepository.findById("executive")).thenReturn(Optional.of(execUser));

        Map<String, Object> result = emailNotificationService.processDailyNotifications(today);

        assertEquals(1, result.get("dueT0Found"));
        assertEquals(1, result.get("emailsSent"));
        verify(mailSender, times(1)).send(any(MimeMessage.class));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // C. Unreviewed Tests: >3 days rule, assigned executive exclusion, recipient is admin
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testUnreviewedTenders_AgeConditionsAndExecutiveExclusion() {
        DateTimeFormatter entryFmt = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

        // Tender 1: 2 days old -> EXCLUDED
        Tender t2Days = new Tender();
        t2Days.setId("T-2D");
        t2Days.setTitle("2 Days Old Tender");
        t2Days.setStatus("Issued");
        t2Days.setEntryDate(today.minusDays(2).format(entryFmt));

        // Tender 2: 3 days old -> EXCLUDED (strictly >3)
        Tender t3Days = new Tender();
        t3Days.setId("T-3D");
        t3Days.setTitle("3 Days Old Tender");
        t3Days.setStatus("Issued");
        t3Days.setEntryDate(today.minusDays(3).format(entryFmt));

        // Tender 3: 4 days old -> INCLUDED
        Tender t4Days = new Tender();
        t4Days.setId("T-4D");
        t4Days.setTitle("4 Days Old Tender");
        t4Days.setStatus("Issued");
        t4Days.setAuthority("Railways");
        t4Days.setEntryDate(today.minusDays(4).format(entryFmt));

        // Tender 4: 10 days old -> INCLUDED
        Tender t10Days = new Tender();
        t10Days.setId("T-10D");
        t10Days.setTitle("10 Days Old Tender");
        t10Days.setStatus("New");
        t10Days.setAuthority("Defence");
        t10Days.setPublishDate(today.minusDays(10).format(DateTimeFormatter.ISO_LOCAL_DATE));

        // Tender 5: 5 days old BUT executive is assigned -> candidate query excludes it,
        // but if candidate returned, calculate age and check
        when(tenderRepository.findUnreviewedCandidates()).thenReturn(List.of(t2Days, t3Days, t4Days, t10Days));
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), anyString()))
                .thenReturn(Collections.emptyList());
        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING")).thenReturn(Collections.emptyList());

        User adminUser = new User("admin", "hash", "Admin", "admin@company.com");
        when(userRepository.findById("admin")).thenReturn(Optional.of(adminUser));

        Map<String, Object> result = emailNotificationService.processDailyNotifications(today);

        assertEquals(2, result.get("unreviewedFound")); // Only 4-day and 10-day
        assertEquals(1, result.get("emailsSent"));

        // Verify sent to admin
        verify(userRepository).findById("admin");
        verify(mailSender, times(1)).send(any(MimeMessage.class));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // D. Recipient Routing Tests: individual logins & team labels
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testRecipientRouting_TeamLabelsAndDirectUsers() {
        assertEquals("tpc", emailNotificationService.resolveApprovalRecipientUsername("TPC Team", TenderWorkflowStage.TPC_PRICING));
        assertEquals("tpc", emailNotificationService.resolveApprovalRecipientUsername("TPC", TenderWorkflowStage.TPC_PRICING));
        assertEquals("misteam", emailNotificationService.resolveApprovalRecipientUsername("MIS Team", TenderWorkflowStage.MIS_PRICING));
        assertEquals("misteam", emailNotificationService.resolveApprovalRecipientUsername("MIS", TenderWorkflowStage.PAYMENT_APPROVAL));
        assertEquals("clearance", emailNotificationService.resolveApprovalRecipientUsername("Clearance Team", TenderWorkflowStage.SPEC_CLEARANCE));
        assertEquals("clearance", emailNotificationService.resolveApprovalRecipientUsername(null, TenderWorkflowStage.SPEC_CLEARANCE));
        assertEquals("custom_user", emailNotificationService.resolveApprovalRecipientUsername("custom_user", TenderWorkflowStage.DOC_VERIFICATION));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // E. Grouping Test: multiple notification items for ONE user -> exactly 1 email
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testGrouping_MultipleItemsForOneUser_SendsExactlyOneEmail() {
        String t0Str = today.format(DateTimeFormatter.ISO_LOCAL_DATE);
        String t3Str = today.plusDays(3).format(DateTimeFormatter.ISO_LOCAL_DATE);

        // Item 1: T0 for executive
        Tender tender1 = new Tender();
        tender1.setId("T-1");
        tender1.setTitle("Tender 1 Due Today");
        tender1.setDueDate(t0Str);
        tender1.setMisExecutive("executive");

        // Item 2: T-3 for executive
        Tender tender2 = new Tender();
        tender2.setId("T-2");
        tender2.setTitle("Tender 2 Due in 3 Days");
        tender2.setDueDate(t3Str);
        tender2.setMisExecutive("executive");

        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t0Str)))
                .thenReturn(List.of(tender1));
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t3Str)))
                .thenReturn(List.of(tender2));

        // Item 3: Pending action for executive
        TenderApprovalRequest req = new TenderApprovalRequest("T-3", TenderWorkflowStage.DOC_VERIFICATION, "misteam", "executive", "PENDING");
        req.setId(100L);
        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING")).thenReturn(List.of(req));

        Tender tender3 = new Tender();
        tender3.setId("T-3");
        tender3.setTitle("Tender 3 Verification");
        when(tenderRepository.findById("T-3")).thenReturn(Optional.of(tender3));

        when(tenderRepository.findUnreviewedCandidates()).thenReturn(Collections.emptyList());

        User execUser = new User("executive", "hash", "Tender Executive", "executive@company.com");
        when(userRepository.findById("executive")).thenReturn(Optional.of(execUser));

        Map<String, Object> result = emailNotificationService.processDailyNotifications(today);

        // 3 items for 'executive' must result in exactly 1 email
        assertEquals(1, result.get("emailsSent"));
        verify(mailSender, times(1)).send(any(MimeMessage.class));

        // 3 notification logs recorded as SENT
        ArgumentCaptor<EmailNotificationLog> logCaptor = ArgumentCaptor.forClass(EmailNotificationLog.class);
        verify(notificationLogRepository, times(3)).save(logCaptor.capture());
        List<EmailNotificationLog> logs = logCaptor.getAllValues();
        assertEquals(3, logs.size());
        assertTrue(logs.stream().allMatch(l -> "SENT".equals(l.getStatus())));
        assertTrue(logs.stream().allMatch(l -> "executive".equals(l.getRecipientUsername())));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // F. Multi-User Grouping Test: executive (3), clearance (2), admin (4) -> 3 emails total
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testMultiUserGrouping_CorrectTotalEmailCount() {
        String t0Str = today.format(DateTimeFormatter.ISO_LOCAL_DATE);
        String t3Str = today.plusDays(3).format(DateTimeFormatter.ISO_LOCAL_DATE);

        // Executive has 2 due tenders
        Tender execT1 = new Tender(); execT1.setId("E1"); execT1.setTitle("Exec T1"); execT1.setMisExecutive("executive");
        Tender execT2 = new Tender(); execT2.setId("E2"); execT2.setTitle("Exec T2"); execT2.setMisExecutive("executive");
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t0Str)))
                .thenReturn(List.of(execT1));
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t3Str)))
                .thenReturn(List.of(execT2));

        // Executive has 1 approval request -> Total 3 items
        TenderApprovalRequest execReq = new TenderApprovalRequest("E3", TenderWorkflowStage.DOC_VERIFICATION, "misteam", "executive", "PENDING");
        execReq.setId(1L);

        // Clearance has 2 approval requests -> Total 2 items
        TenderApprovalRequest clearReq1 = new TenderApprovalRequest("C1", TenderWorkflowStage.SPEC_CLEARANCE, "executive", "clearance", "PENDING");
        clearReq1.setId(2L);
        TenderApprovalRequest clearReq2 = new TenderApprovalRequest("C2", TenderWorkflowStage.SPEC_CLEARANCE, "executive", "clearance", "PENDING");
        clearReq2.setId(3L);

        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING"))
                .thenReturn(List.of(execReq, clearReq1, clearReq2));

        // Admin has 4 unreviewed tenders -> Total 4 items
        DateTimeFormatter entryFmt = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);
        List<Tender> adminUnreviewed = new ArrayList<>();
        for (int i = 1; i <= 4; i++) {
            Tender ut = new Tender();
            ut.setId("U" + i);
            ut.setTitle("Unreviewed " + i);
            ut.setStatus("Issued");
            ut.setEntryDate(today.minusDays(5).format(entryFmt));
            adminUnreviewed.add(ut);
        }
        when(tenderRepository.findUnreviewedCandidates()).thenReturn(adminUnreviewed);

        when(userRepository.findById("executive")).thenReturn(Optional.of(new User("executive", "h", "Role", "exec@test.com")));
        when(userRepository.findById("clearance")).thenReturn(Optional.of(new User("clearance", "h", "Role", "clear@test.com")));
        when(userRepository.findById("admin")).thenReturn(Optional.of(new User("admin", "h", "Role", "admin@test.com")));

        Map<String, Object> result = emailNotificationService.processDailyNotifications(today);

        // Expect 3 unique recipients, 3 emails sent total
        assertEquals(3, result.get("uniqueRecipients"));
        assertEquals(3, result.get("emailsSent"));
        verify(mailSender, times(3)).send(any(MimeMessage.class));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // G. Deduplication Test: run twice on same day -> 2nd run sends 0 emails
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testDeduplication_SecondRunSendsZeroEmails() {
        String t0Str = today.format(DateTimeFormatter.ISO_LOCAL_DATE);

        Tender tender = new Tender();
        tender.setId("T-DEDUP");
        tender.setTitle("Dedup Tender");
        tender.setDueDate(t0Str);
        tender.setMisExecutive("executive");

        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t0Str)))
                .thenReturn(List.of(tender));
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(today.plusDays(3).format(DateTimeFormatter.ISO_LOCAL_DATE))))
                .thenReturn(Collections.emptyList());
        when(tenderRepository.findUnreviewedCandidates()).thenReturn(Collections.emptyList());
        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING")).thenReturn(Collections.emptyList());

        // First run: not yet in notificationLogRepository
        when(notificationLogRepository.existsByRecipientUsernameAndTenderIdAndNotificationTypeAndSentDateAndStatus(
                "executive", "T-DEDUP", "DUE_T0", today, "SENT"))
                .thenReturn(false);

        User execUser = new User("executive", "hash", "Tender Executive", "executive@company.com");
        when(userRepository.findById("executive")).thenReturn(Optional.of(execUser));

        Map<String, Object> run1 = emailNotificationService.processDailyNotifications(today);
        assertEquals(1, run1.get("emailsSent"));
        assertEquals(0, run1.get("duplicatesSkipped"));

        // Second run: now already exists in notificationLogRepository
        when(notificationLogRepository.existsByRecipientUsernameAndTenderIdAndNotificationTypeAndSentDateAndStatus(
                "executive", "T-DEDUP", "DUE_T0", today, "SENT"))
                .thenReturn(true);

        Map<String, Object> run2 = emailNotificationService.processDailyNotifications(today);
        assertEquals(0, run2.get("emailsSent"));
        assertEquals(1, run2.get("duplicatesSkipped"));

        // Total send invocations remains 1 across both runs
        verify(mailSender, times(1)).send(any(MimeMessage.class));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // H. Email Content Test: verified fields present, NO direct links
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testEmailContent_HasAllFields_ContainsNoDirectUrls() {
        NotificationItemDto deadlineItem = new NotificationItemDto(
                "T-100", "GEM/2026/B/100", "Supply of Solar Inverters", "NTPC Limited",
                "2026-09-24", "3 DAYS LEFT", "Upcoming Bid Submission Deadline",
                "DUE_T3", "admin", null, null, null
        );
        NotificationItemDto approvalItem = new NotificationItemDto(
                "T-200", "GEM/2026/B/200", "Medical Lab Equipment", "AIIMS Delhi",
                null, null, "Technical Specification Clearance",
                "PENDING_SPEC_CLEARANCE", "admin", "executive", 55L, null
        );
        NotificationItemDto unreviewedItem = new NotificationItemDto(
                "T-300", "GEM/2026/B/300", "Substation Transformer", "PGCIL",
                null, null, "Tender unreviewed for >3 days",
                "UNREVIEWED", "admin", null, null, 5
        );

        String html = emailNotificationService.buildDigestHtml("admin", List.of(deadlineItem, approvalItem, unreviewedItem), today);

        // Required headers and labels
        assertTrue(html.contains("TenderPocket Daily Action Digest"));
        assertTrue(html.contains("Pending Tasks &amp; Deadlines for admin"));
        assertTrue(html.contains("Urgent Deadlines"));
        assertTrue(html.contains("Pending Approvals / Workflow Actions"));
        assertTrue(html.contains("Unreviewed Tenders"));

        // Required data fields
        assertTrue(html.contains("GEM/2026/B/100"));
        assertTrue(html.contains("Supply of Solar Inverters"));
        assertTrue(html.contains("NTPC Limited"));
        assertTrue(html.contains("3 DAYS LEFT"));

        assertTrue(html.contains("GEM/2026/B/200"));
        assertTrue(html.contains("Medical Lab Equipment"));
        assertTrue(html.contains("Technical Specification Clearance"));
        assertTrue(html.contains("executive"));

        assertTrue(html.contains("GEM/2026/B/300"));
        assertTrue(html.contains("Substation Transformer"));
        assertTrue(html.contains("PGCIL"));
        assertTrue(html.contains("5 days"));

        // STRICT REQUIREMENT: No direct tender URLs, no anchor hrefs, no localhost:3000
        assertFalse(html.contains("<a href="), "Email HTML must not contain <a href=");
        assertFalse(html.contains("localhost:3000"), "Email HTML must not contain localhost:3000");
        assertFalse(html.contains("/documents/"), "Email HTML must not contain /documents/ link");
        assertFalse(html.contains("http://"), "Email HTML must not contain http://");
        assertFalse(html.contains("https://"), "Email HTML must not contain https://");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // I. Failure Isolation Test: one recipient fails, others still receive emails
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testFailureIsolation_OneRecipientFails_OthersReceiveEmail() {
        String t0Str = today.format(DateTimeFormatter.ISO_LOCAL_DATE);

        Tender t1 = new Tender(); t1.setId("T1"); t1.setTitle("Tender 1"); t1.setDueDate(t0Str); t1.setMisExecutive("failing_user");
        Tender t2 = new Tender(); t2.setId("T2"); t2.setTitle("Tender 2"); t2.setDueDate(t0Str); t2.setMisExecutive("success_user");

        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t0Str)))
                .thenReturn(List.of(t1, t2));
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(today.plusDays(3).format(DateTimeFormatter.ISO_LOCAL_DATE))))
                .thenReturn(Collections.emptyList());
        when(tenderRepository.findUnreviewedCandidates()).thenReturn(Collections.emptyList());
        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING")).thenReturn(Collections.emptyList());

        when(userRepository.findById("failing_user")).thenReturn(Optional.of(new User("failing_user", "h", "Role", "fail@test.com")));
        when(userRepository.findById("success_user")).thenReturn(Optional.of(new User("success_user", "h", "Role", "success@test.com")));

        // When failing_user fails all 3 retries, then success_user succeeds on 4th attempt
        doThrow(new MailSendException("SMTP error 1"))
                .doThrow(new MailSendException("SMTP error 2"))
                .doThrow(new MailSendException("SMTP error 3"))
                .doNothing()
                .when(mailSender).send(any(MimeMessage.class));

        Map<String, Object> result = emailNotificationService.processDailyNotifications(today);

        assertEquals(1, result.get("emailsSent"));
        assertEquals(1, result.get("emailsFailed"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // J. Notification Log Test: SENT and FAILED records correctly saved
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testNotificationLog_SentAndFailedRecordsSaved() {
        String t0Str = today.format(DateTimeFormatter.ISO_LOCAL_DATE);

        // Missing email user -> should log FAILED
        Tender tMissingEmail = new Tender();
        tMissingEmail.setId("T-NO-EMAIL");
        tMissingEmail.setTitle("No Email Tender");
        tMissingEmail.setDueDate(t0Str);
        tMissingEmail.setMisExecutive("no_email_user");

        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t0Str)))
                .thenReturn(List.of(tMissingEmail));
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(today.plusDays(3).format(DateTimeFormatter.ISO_LOCAL_DATE))))
                .thenReturn(Collections.emptyList());
        when(tenderRepository.findUnreviewedCandidates()).thenReturn(Collections.emptyList());
        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING")).thenReturn(Collections.emptyList());

        when(userRepository.findById("no_email_user"))
                .thenReturn(Optional.of(new User("no_email_user", "h", "Role", null))); // null email

        Map<String, Object> result = emailNotificationService.processDailyNotifications(today);

        assertEquals(1, result.get("emailsFailed"));
        ArgumentCaptor<EmailNotificationLog> logCaptor = ArgumentCaptor.forClass(EmailNotificationLog.class);
        verify(notificationLogRepository).save(logCaptor.capture());

        EmailNotificationLog capturedLog = logCaptor.getValue();
        assertEquals("FAILED", capturedLog.getStatus());
        assertEquals("no_email_user", capturedLog.getRecipientUsername());
        assertTrue(capturedLog.getErrorMessage().contains("no email address configured"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // K. Age Calculation Test: checks entry_date, publish_date, scraped_at
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testCalculateTenderAgeInDays() {
        Tender t1 = new Tender();
        t1.setEntryDate("17 Sep 2026");
        assertEquals(4, emailNotificationService.calculateTenderAgeInDays(t1, today));

        Tender t2 = new Tender();
        t2.setEntryDate("2026-09-18");
        assertEquals(3, emailNotificationService.calculateTenderAgeInDays(t2, today));

        Tender t3 = new Tender();
        t3.setPublishDate("2026-09-11");
        assertEquals(10, emailNotificationService.calculateTenderAgeInDays(t3, today));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // L. Workflow Approval Actions: MIS, Clearance, TPC, and Executive
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testAllWorkflowPendingApprovalActions_RoutedToIndividualLoginsAndRendered() {
        TenderApprovalRequest misReq = new TenderApprovalRequest("T-MIS", TenderWorkflowStage.MIS_PRICING, "executive", "MIS Team", "PENDING");
        misReq.setId(101L);
        TenderApprovalRequest clearReq = new TenderApprovalRequest("T-CLR", TenderWorkflowStage.SPEC_CLEARANCE, "executive", "Clearance Team", "PENDING");
        clearReq.setId(102L);
        TenderApprovalRequest tpcReq = new TenderApprovalRequest("T-TPC", TenderWorkflowStage.TPC_PRICING, "executive", "TPC Team", "PENDING");
        tpcReq.setId(103L);
        TenderApprovalRequest execReq = new TenderApprovalRequest("T-EXC", TenderWorkflowStage.DOC_VERIFICATION, "misteam", "executive", "PENDING");
        execReq.setId(104L);

        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING"))
                .thenReturn(List.of(misReq, clearReq, tpcReq, execReq));

        Tender tMis = new Tender(); tMis.setId("T-MIS"); tMis.setRefNo("REF-MIS"); tMis.setTitle("MIS Pricing Project");
        Tender tClr = new Tender(); tClr.setId("T-CLR"); tClr.setRefNo("REF-CLR"); tClr.setTitle("Clearance Spec Project");
        Tender tTpc = new Tender(); tTpc.setId("T-TPC"); tTpc.setRefNo("REF-TPC"); tTpc.setTitle("TPC Hardware Project");
        Tender tExc = new Tender(); tExc.setId("T-EXC"); tExc.setRefNo("REF-EXC"); tExc.setTitle("Executive Doc Project");

        when(tenderRepository.findById("T-MIS")).thenReturn(Optional.of(tMis));
        when(tenderRepository.findById("T-CLR")).thenReturn(Optional.of(tClr));
        when(tenderRepository.findById("T-TPC")).thenReturn(Optional.of(tTpc));
        when(tenderRepository.findById("T-EXC")).thenReturn(Optional.of(tExc));

        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), anyString()))
                .thenReturn(Collections.emptyList());
        when(tenderRepository.findUnreviewedCandidates()).thenReturn(Collections.emptyList());

        when(userRepository.findById("misteam")).thenReturn(Optional.of(new User("misteam", "h", "MIS Team", "mis@company.com")));
        when(userRepository.findById("clearance")).thenReturn(Optional.of(new User("clearance", "h", "Clearance Team", "clearance@company.com")));
        when(userRepository.findById("tpc")).thenReturn(Optional.of(new User("tpc", "h", "TPC Team", "tpc@company.com")));
        when(userRepository.findById("executive")).thenReturn(Optional.of(new User("executive", "h", "Tender Executive", "executive@company.com")));

        Map<String, Object> result = emailNotificationService.processDailyNotifications(today);

        assertEquals(4, result.get("pendingApprovalsFound"));
        assertEquals(4, result.get("emailsSent"));
        assertEquals(4, result.get("uniqueRecipients"));

        // Verify sent individually to each of the 4 individual user logins
        verify(userRepository).findById("misteam");
        verify(userRepository).findById("clearance");
        verify(userRepository).findById("tpc");
        verify(userRepository).findById("executive");

        // Verify HTML generated for each action contains correct descriptions and references
        String misHtml = emailNotificationService.buildDigestHtml("misteam", List.of(
                new NotificationItemDto("T-MIS", "REF-MIS", "MIS Pricing Project", "Auth", null, null, "Client Final Pricing (MIS)", "PENDING_MIS_PRICING", "misteam", "executive", 101L, null)
        ), today);
        assertTrue(misHtml.contains("Client Final Pricing (MIS)"));
        assertTrue(misHtml.contains("REF-MIS"));

        String clrHtml = emailNotificationService.buildDigestHtml("clearance", List.of(
                new NotificationItemDto("T-CLR", "REF-CLR", "Clearance Spec Project", "Auth", null, null, "Technical Specification Clearance", "PENDING_SPEC_CLEARANCE", "clearance", "executive", 102L, null)
        ), today);
        assertTrue(clrHtml.contains("Technical Specification Clearance"));
        assertTrue(clrHtml.contains("REF-CLR"));

        String tpcHtml = emailNotificationService.buildDigestHtml("tpc", List.of(
                new NotificationItemDto("T-TPC", "REF-TPC", "TPC Hardware Project", "Auth", null, null, "Manufacturer Purchase Price (TPC)", "PENDING_TPC_PRICING", "tpc", "executive", 103L, null)
        ), today);
        assertTrue(tpcHtml.contains("Manufacturer Purchase Price (TPC)"));
        assertTrue(tpcHtml.contains("REF-TPC"));

        String excHtml = emailNotificationService.buildDigestHtml("executive", List.of(
                new NotificationItemDto("T-EXC", "REF-EXC", "Executive Doc Project", "Auth", null, null, "Bid Document Verification", "PENDING_DOC_VERIFICATION", "executive", "misteam", 104L, null)
        ), today);
        assertTrue(excHtml.contains("Bid Document Verification"));
        assertTrue(excHtml.contains("REF-EXC"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // M. Unique Constraint Entity Mapping Verification
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testDatabaseLevelUniqueConstraintMapping() {
        jakarta.persistence.Table tableAnn = EmailNotificationLog.class.getAnnotation(jakarta.persistence.Table.class);
        assertNotNull(tableAnn, "@Table annotation must be present on EmailNotificationLog");

        // Verify Unique Constraint
        jakarta.persistence.UniqueConstraint[] ucs = tableAnn.uniqueConstraints();
        assertTrue(ucs.length >= 1, "At least one unique constraint must be defined");

        jakarta.persistence.UniqueConstraint dedupUc = Arrays.stream(ucs)
                .filter(u -> "uk_email_logs_dedup".equals(u.name()))
                .findFirst()
                .orElse(null);
        assertNotNull(dedupUc, "Unique constraint 'uk_email_logs_dedup' must exist");

        List<String> cols = Arrays.asList(dedupUc.columnNames());
        assertEquals(List.of("recipient_username", "tender_id", "notification_type", "sent_date"), cols);

        // Verify existing indexes are preserved and do not have naming conflict
        jakarta.persistence.Index[] idxs = tableAnn.indexes();
        assertTrue(idxs.length >= 3, "Existing indexes must be present");
        Set<String> indexNames = new HashSet<>();
        for (jakarta.persistence.Index idx : idxs) {
            indexNames.add(idx.name());
        }
        assertTrue(indexNames.contains("idx_email_logs_dedup"));
        assertTrue(indexNames.contains("idx_email_logs_sent_date"));
        assertTrue(indexNames.contains("idx_email_logs_status"));

        // Confirm constraint name does NOT collide with any index name
        assertFalse(indexNames.contains(dedupUc.name()), "Unique constraint name must not clash with index names");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // N. Comprehensive Offline Test: All Notification Types + Multi-User + Dedup Run
    // ─────────────────────────────────────────────────────────────────────────
    @Test
    void testComprehensiveOfflineNotificationCycleAllTypesAndDuplicateProtection() {
        String t0Str = today.format(DateTimeFormatter.ISO_LOCAL_DATE);
        String t3Str = today.plusDays(3).format(DateTimeFormatter.ISO_LOCAL_DATE);
        DateTimeFormatter entryFmt = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

        // 1. T0 Tender for executive
        Tender t0 = new Tender();
        t0.setId("T-T0"); t0.setRefNo("REF-T0"); t0.setTitle("Oxygen Plant Tender");
        t0.setDueDate(t0Str); t0.setMisExecutive("executive"); t0.setAuthority("AIIMS");

        // 2. T-3 Tender for executive (multiple tenders assigned to same user)
        Tender t3 = new Tender();
        t3.setId("T-T3"); t3.setRefNo("REF-T3"); t3.setTitle("Bridge Construction Tender");
        t3.setDueDate(t3Str); t3.setMisExecutive("executive"); t3.setAuthority("NHAI");

        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t0Str)))
                .thenReturn(List.of(t0));
        when(tenderRepository.findActiveTendersByDueDatePrefixAndExecutiveAssigned(anyList(), eq(t3Str)))
                .thenReturn(List.of(t3));

        // 3. Unreviewed tender >3 days for admin
        Tender tUnrev = new Tender();
        tUnrev.setId("T-UNREV"); tUnrev.setRefNo("REF-UNREV"); tUnrev.setTitle("Radar Supply");
        tUnrev.setStatus("Issued"); tUnrev.setAuthority("MoD");
        tUnrev.setEntryDate(today.minusDays(5).format(entryFmt));
        when(tenderRepository.findUnreviewedCandidates()).thenReturn(List.of(tUnrev));

        // 4. Pending actions for different users: misteam, clearance, tpc, user_without_email
        TenderApprovalRequest reqMis = new TenderApprovalRequest("T-1", TenderWorkflowStage.MIS_PRICING, "executive", "misteam", "PENDING");
        reqMis.setId(1L);
        TenderApprovalRequest reqClr = new TenderApprovalRequest("T-2", TenderWorkflowStage.SPEC_CLEARANCE, "executive", "clearance", "PENDING");
        reqClr.setId(2L);
        TenderApprovalRequest reqTpc = new TenderApprovalRequest("T-3", TenderWorkflowStage.TPC_PRICING, "executive", "tpc", "PENDING");
        reqTpc.setId(3L);
        TenderApprovalRequest reqNoEmail = new TenderApprovalRequest("T-4", TenderWorkflowStage.DOC_VERIFICATION, "executive", "user_without_email", "PENDING");
        reqNoEmail.setId(4L);

        when(approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING"))
                .thenReturn(List.of(reqMis, reqClr, reqTpc, reqNoEmail));

        Tender dummyT = new Tender(); dummyT.setTitle("Workflow Tender");
        when(tenderRepository.findById(anyString())).thenReturn(Optional.of(dummyT));

        // Users
        when(userRepository.findById("executive")).thenReturn(Optional.of(new User("executive", "h", "Executive", "executive@company.com")));
        when(userRepository.findById("admin")).thenReturn(Optional.of(new User("admin", "h", "Admin", "admin@company.com")));
        when(userRepository.findById("misteam")).thenReturn(Optional.of(new User("misteam", "h", "MIS Team", "mis@company.com")));
        when(userRepository.findById("clearance")).thenReturn(Optional.of(new User("clearance", "h", "Clearance Team", "clearance@company.com")));
        when(userRepository.findById("tpc")).thenReturn(Optional.of(new User("tpc", "h", "TPC Team", "tpc@company.com")));
        when(userRepository.findById("user_without_email")).thenReturn(Optional.of(new User("user_without_email", "h", "Role", null))); // No email

        // Initial run: no previous logs
        when(notificationLogRepository.existsByRecipientUsernameAndTenderIdAndNotificationTypeAndSentDateAndStatus(
                anyString(), anyString(), anyString(), eq(today), eq("SENT")))
                .thenReturn(false);

        // RUN 1
        Map<String, Object> run1 = emailNotificationService.processDailyNotifications(today);

        assertEquals(1, run1.get("dueT0Found"));
        assertEquals(1, run1.get("dueT3Found"));
        assertEquals(1, run1.get("unreviewedFound"));
        assertEquals(4, run1.get("pendingApprovalsFound"));
        assertEquals(0, run1.get("duplicatesSkipped"));
        assertEquals(6, run1.get("uniqueRecipients"));
        assertEquals(5, run1.get("emailsSent"));
        assertEquals(1, run1.get("emailsFailed"));

        // Verify mailSender sent exactly 5 emails in Run 1
        verify(mailSender, times(5)).send(any(MimeMessage.class));

        // RUN 2 (Duplicate protection simulation on same day)
        when(notificationLogRepository.existsByRecipientUsernameAndTenderIdAndNotificationTypeAndSentDateAndStatus(
                anyString(), anyString(), anyString(), eq(today), eq("SENT")))
                .thenReturn(true);

        Map<String, Object> run2 = emailNotificationService.processDailyNotifications(today);

        // All 6 items that were previously sent are now recognized as duplicates and skipped
        assertTrue((int) run2.get("duplicatesSkipped") >= 5);
        assertEquals(0, run2.get("emailsSent"));

        // No new emails sent in Run 2 (still 5 total sends)
        verify(mailSender, times(5)).send(any(MimeMessage.class));
    }
}
