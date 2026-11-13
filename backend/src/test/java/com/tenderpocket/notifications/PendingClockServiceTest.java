package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderPendingAction;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.repositories.TenderApprovalRepository;
import com.tenderpocket.repositories.TenderPendingActionRepository;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.repositories.TenderWorkflowStateRepository;
import com.tenderpocket.repositories.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionOperations;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static com.tenderpocket.notifications.NotifyTestData.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PendingClockServiceTest {

    private final LocalDateTime now = LocalDateTime.of(2026, 11, 12, 9, 0);
    private TenderRepository tenders;
    private TenderApprovalRepository approvals;
    private TenderPendingActionRepository clockRows;
    private PendingClockService service;

    @BeforeEach
    void setUp() {
        tenders = mock(TenderRepository.class);
        approvals = mock(TenderApprovalRepository.class);
        TenderWorkflowStateRepository states = mock(TenderWorkflowStateRepository.class);
        UserRepository users = mock(UserRepository.class);
        clockRows = mock(TenderPendingActionRepository.class);
        when(states.findByTenderIdIn(any(Collection.class))).thenReturn(List.of());
        when(users.findAll()).thenReturn(standardUsers());
        when(approvals.findByStatusOrderByCreatedAtDesc("PENDING")).thenReturn(List.of());
        when(approvals.findByTenderIdOrderByCreatedAtDesc(anyString())).thenReturn(List.of());
        service = new PendingClockService(tenders, approvals, states, users, clockRows,
                new NotificationSettings(), TransactionOperations.withoutTransaction());
    }

    @SuppressWarnings("unchecked")
    private Map<String, TenderPendingAction> saved() {
        ArgumentCaptor<List<TenderPendingAction>> captor = ArgumentCaptor.forClass(List.class);
        verify(clockRows).saveAll(captor.capture());
        return captor.getValue().stream().collect(Collectors.toMap(r -> r.getTenderId() + "|" + r.getActionKey(), Function.identity()));
    }

    @Test
    void newActionsAreBackfilledFromTheTenderData() {
        Tender undecided = undecided("T1");
        undecided.setEntryDate("7 Nov 2026");
        Tender spec = assigned("T2", "executive");
        spec.setAssignedAt("2026-11-05 10:00:00");
        Tender review = assigned("T3", "executive");
        review.setSpecVerificationStatus("Pending");
        TenderApprovalRequest req = pending("T3", TenderWorkflowStage.SPEC_CLEARANCE, "Clearance Team", LocalDateTime.of(2026, 11, 6, 6, 0));
        when(approvals.findByStatusOrderByCreatedAtDesc("PENDING")).thenReturn(List.of(req));
        when(approvals.findByTenderIdOrderByCreatedAtDesc("T3")).thenReturn(List.of(req));
        when(tenders.findNotificationCandidates(anyList(), anyList(), eq("2026-11-11"))).thenReturn(List.of(undecided, spec, review));
        when(clockRows.findAll()).thenReturn(List.of());

        ClockSnapshot snapshot = service.refresh(now);

        Map<String, TenderPendingAction> rows = saved();
        assertEquals(LocalDateTime.of(2026, 11, 7, 0, 0), rows.get("T1|DECIDE").getPendingSince());
        ZoneId server = ZoneId.systemDefault();
        assertEquals(NotifyDates.toIst(LocalDateTime.of(2026, 11, 5, 10, 0), server), rows.get("T2|SPEC_PREP").getPendingSince());
        assertEquals(NotifyDates.toIst(LocalDateTime.of(2026, 11, 6, 6, 0), server), rows.get("T3|SPEC_REVIEW").getPendingSince());
        assertEquals("team:MIS", rows.get("T1|DECIDE").getOwnerKey());
        assertEquals("user:executive", rows.get("T2|SPEC_PREP").getOwnerKey());
        assertEquals(3, snapshot.tenders().size());
        verify(clockRows, never()).deleteAll(any());
    }

    @Test
    void existingRowsKeepTheirClockUnlessTheOwnerChanged() {
        Tender same = assigned("T1", "executive");
        Tender moved = assigned("T2", "exec2");
        when(tenders.findNotificationCandidates(anyList(), anyList(), anyString())).thenReturn(List.of(same, moved));
        LocalDateTime old = LocalDateTime.of(2026, 11, 1, 12, 0);
        List<TenderPendingAction> existing = new ArrayList<>(List.of(
                new TenderPendingAction("T1", "SPEC_PREP", "user:executive", old, old),
                new TenderPendingAction("T2", "SPEC_PREP", "user:executive", old, old),
                new TenderPendingAction("T9", "DECIDE", "team:MIS", old, old)));
        when(clockRows.findAll()).thenReturn(existing);

        service.refresh(now);

        Map<String, TenderPendingAction> rows = saved();
        assertFalse(rows.containsKey("T1|SPEC_PREP"), "an unchanged row is not rewritten");
        assertEquals(old, existing.get(0).getPendingSince(), "same owner keeps waiting");
        assertEquals(now, rows.get("T2|SPEC_PREP").getPendingSince(), "reassigned to exec2, so the clock restarts");
        assertEquals("user:exec2", rows.get("T2|SPEC_PREP").getOwnerKey());
        verify(clockRows).markAllSeen(now);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Iterable<TenderPendingAction>> deleted = ArgumentCaptor.forClass(Iterable.class);
        verify(clockRows).deleteAll(deleted.capture());
        List<TenderPendingAction> gone = new ArrayList<>();
        deleted.getValue().forEach(gone::add);
        assertEquals(1, gone.size());
        assertEquals("T9", gone.get(0).getTenderId(), "the action that disappeared is removed");
    }

    @Test
    void estimateInTheFutureIsClampedToNow() {
        Tender t = undecided("T1");
        t.setEntryDate("2026-12-01");
        when(tenders.findNotificationCandidates(anyList(), anyList(), anyString())).thenReturn(List.of(t));
        when(clockRows.findAll()).thenReturn(List.of());
        service.refresh(now);
        assertEquals(now, saved().get("T1|DECIDE").getPendingSince());
    }
}
