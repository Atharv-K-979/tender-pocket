package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderPendingAction;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.models.TenderWorkflowState;
import com.tenderpocket.repositories.TenderApprovalRepository;
import com.tenderpocket.repositories.TenderPendingActionRepository;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.repositories.TenderWorkflowStateRepository;
import com.tenderpocket.repositories.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionOperations;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Keeps the pending clock (tender_pending_actions) in step with the tenders.
 *
 * Each refresh works out every live tender's pending actions. A new action gets a row stamped
 * with PendingSinceEstimator's estimate. An action whose owner changed restarts at now. Rows
 * whose action is gone are deleted. "Waiting N days" in the mails is today minus that stamp.
 *
 * This avoids touching the many places in the workflow code that change a tender's stage.
 */
@Service
public class PendingClockService {

    private static final Logger log = LoggerFactory.getLogger(PendingClockService.class);

    static final List<String> CLOSED_STATUSES = List.of(
            "not participating", "non_participating", "awarded", "won", "not awarded", "lost",
            "missed opportunity", "submitted", "filed");
    static final List<String> CLOSED_STAGES = List.of("WON", "LOST", "UNABLE_TO_SUBMIT", "SUBMITTED", "WIN_LOSS_PENDING");

    private static final int ID_BATCH = 1000;

    private final TenderRepository tenderRepository;
    private final TenderApprovalRepository approvalRepository;
    private final TenderWorkflowStateRepository workflowStateRepository;
    private final UserRepository userRepository;
    private final TenderPendingActionRepository pendingActionRepository;
    private final NotificationSettings settings;
    private final TransactionOperations transactions;
    private final Object refreshLock = new Object();

    public PendingClockService(TenderRepository tenderRepository,
                               TenderApprovalRepository approvalRepository,
                               TenderWorkflowStateRepository workflowStateRepository,
                               UserRepository userRepository,
                               TenderPendingActionRepository pendingActionRepository,
                               NotificationSettings settings,
                               TransactionOperations transactions) {
        this.tenderRepository = tenderRepository;
        this.approvalRepository = approvalRepository;
        this.workflowStateRepository = workflowStateRepository;
        this.userRepository = userRepository;
        this.pendingActionRepository = pendingActionRepository;
        this.settings = settings;
        this.transactions = transactions;
    }

    /** Hourly, so "waiting since" is accurate to the hour. The 9 AM run refreshes again first. */
    public void scheduledRefresh() {
        try {
            ClockSnapshot snapshot = refresh(LocalDateTime.now(NotificationSettings.IST));
            int actions = snapshot.tenders().stream().mapToInt(e -> e.works().size()).sum();
            log.info("[Notifications] Pending clock refreshed: {} live tenders, {} pending actions", snapshot.tenders().size(), actions);
        } catch (Exception e) {
            log.error("[Notifications] Pending clock refresh failed: {}", e.getMessage(), e);
        }
    }

    /** Recalculates every pending action and saves the clock. Safe to call at any time. */
    public ClockSnapshot refresh(LocalDateTime nowIst) {
        synchronized (refreshLock) {
            return transactions.execute(status -> doRefresh(nowIst));
        }
    }

    private ClockSnapshot doRefresh(LocalDateTime now) {
        ZoneId serverZone = ZoneId.systemDefault();
        String fromDate = now.toLocalDate().minusDays(1).toString();
        List<Tender> tenders = tenderRepository.findNotificationCandidates(CLOSED_STATUSES, CLOSED_STAGES, fromDate);

        Map<String, Map<TenderWorkflowStage, TenderApprovalRequest>> pendingByTender = new HashMap<>();
        for (TenderApprovalRequest r : approvalRepository.findByStatusOrderByCreatedAtDesc("PENDING")) {
            if (r.getTenderId() == null || r.getStage() == null) continue;
            // newest first, so keep the first one seen per stage
            pendingByTender.computeIfAbsent(r.getTenderId(), k -> new EnumMap<>(TenderWorkflowStage.class))
                    .putIfAbsent(r.getStage(), r);
        }

        Map<String, TenderWorkflowState> stateByTender = loadStates(tenders);
        RecipientDirectory directory = new RecipientDirectory(userRepository.findAll(), settings::recipientOverride);

        Map<String, TenderPendingAction> existing = new HashMap<>();
        for (TenderPendingAction row : pendingActionRepository.findAll()) {
            existing.put(rowKey(row.getTenderId(), row.getActionKey()), row);
        }

        List<ClockSnapshot.TenderEntry> entries = new ArrayList<>();
        List<TenderPendingAction> toSave = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        for (Tender tender : tenders) {
            TenderWorkflowState state = stateByTender.get(tender.getId());
            List<PendingWork> works = PendingWorkResolver.resolve(tender, state, pendingByTender.get(tender.getId()));
            List<ClockSnapshot.WorkItem> items = new ArrayList<>();
            List<TenderApprovalRequest> history = null;

            for (PendingWork work : works) {
                RecipientDirectory.Owner owner = directory.resolve(work);
                String key = rowKey(tender.getId(), work.key().name());
                if (!seen.add(key)) continue;

                TenderPendingAction row = existing.get(key);
                if (row == null) {
                    if (history == null) history = approvalRepository.findByTenderIdOrderByCreatedAtDesc(tender.getId());
                    LocalDateTime since = PendingSinceEstimator.estimate(work.key(), tender, state, history, now, serverZone);
                    row = new TenderPendingAction(tender.getId(), work.key().name(), owner.ownerKey(), since, now);
                    toSave.add(row);
                } else if (!owner.ownerKey().equals(row.getOwnerKey())) {
                    row.setOwnerKey(owner.ownerKey());
                    row.setPendingSince(now);
                    toSave.add(row);
                }
                // Unchanged rows are not rewritten; markAllSeen below stamps them in one statement.
                items.add(new ClockSnapshot.WorkItem(work.key(), owner, row.getPendingSince()));
            }
            entries.add(new ClockSnapshot.TenderEntry(tender, List.copyOf(items)));
        }

        List<TenderPendingAction> stale = existing.entrySet().stream()
                .filter(e -> !seen.contains(e.getKey()))
                .map(Map.Entry::getValue)
                .toList();
        if (!stale.isEmpty()) pendingActionRepository.deleteAll(stale);
        if (!toSave.isEmpty()) pendingActionRepository.saveAll(toSave);
        pendingActionRepository.flush();
        pendingActionRepository.markAllSeen(now);

        return new ClockSnapshot(now, List.copyOf(entries), directory);
    }

    private Map<String, TenderWorkflowState> loadStates(List<Tender> tenders) {
        Map<String, TenderWorkflowState> byTender = new HashMap<>();
        List<String> ids = tenders.stream().map(Tender::getId).toList();
        for (int i = 0; i < ids.size(); i += ID_BATCH) {
            List<String> batch = ids.subList(i, Math.min(ids.size(), i + ID_BATCH));
            for (TenderWorkflowState s : workflowStateRepository.findByTenderIdIn(batch)) {
                byTender.put(s.getTenderId(), s);
            }
        }
        return byTender;
    }

    private static String rowKey(String tenderId, String actionKey) {
        return tenderId + "|" + actionKey;
    }
}
