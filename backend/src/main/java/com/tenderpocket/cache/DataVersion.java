package com.tenderpocket.cache;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Change counters for the data that the read caches depend on.
 *
 * Every committed insert, update or delete of a tracked entity (see {@link DataChangeListener})
 * increments a counter. A cache entry remembers the counter value it was built under and is
 * rebuilt as soon as the value moves on, so a cached read never shows data older than the last
 * committed change made through the application.
 *
 * The increment happens after the transaction commits: a reader that sees the new value is then
 * guaranteed to also see the new rows. Changes that are rolled back do not count.
 */
public final class DataVersion {

    private DataVersion() {}

    /** Tenders, approval requests and comments. */
    private static final AtomicLong TENDER_DATA = new AtomicLong();

    /** User accounts. */
    private static final AtomicLong USERS = new AtomicLong();

    /** Called after a committed change to a tender or an approval request. */
    private static final List<Runnable> WORKFLOW_LISTENERS = new CopyOnWriteArrayList<>();

    /** True while the current thread runs work whose own changes must not notify the workflow listeners. */
    private static final ThreadLocal<Boolean> QUIET = ThreadLocal.withInitial(() -> Boolean.FALSE);

    public static long tenderData() {
        return TENDER_DATA.get();
    }

    public static long users() {
        return USERS.get();
    }

    /** Registers a callback run after every committed tender or approval-request change. */
    public static void onWorkflowChange(Runnable listener) {
        WORKFLOW_LISTENERS.add(listener);
    }

    /**
     * Marks tender data as changed right now. For writes that bypass JPA entity events
     * (bulk JPQL updates); call it after the update has committed.
     */
    public static void tenderDataChanged() {
        TENDER_DATA.incrementAndGet();
        notifyWorkflowListeners();
    }

    /** Runs the task on this thread without notifying the workflow listeners about its own changes. */
    public static void runQuietly(Runnable task) {
        boolean previous = QUIET.get();
        QUIET.set(Boolean.TRUE);
        try {
            task.run();
        } finally {
            QUIET.set(previous);
        }
    }

    static void tenderDataChangedAfterCommit(boolean workflowEntity) {
        afterCommit(() -> {
            TENDER_DATA.incrementAndGet();
            if (workflowEntity) {
                notifyWorkflowListeners();
            }
        });
    }

    static void usersChangedAfterCommit() {
        afterCommit(USERS::incrementAndGet);
    }

    private static void notifyWorkflowListeners() {
        if (Boolean.TRUE.equals(QUIET.get())) {
            return;
        }
        for (Runnable listener : WORKFLOW_LISTENERS) {
            try {
                listener.run();
            } catch (RuntimeException e) {
                System.err.println("[DataVersion] Workflow change listener failed: " + e.getMessage());
            }
        }
    }

    private static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }
}
