package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;

import java.time.LocalDateTime;
import java.util.List;

/** The result of one pending-clock refresh: every candidate tender and what it is waiting on. */
public record ClockSnapshot(LocalDateTime now, List<TenderEntry> tenders, RecipientDirectory directory) {

    /** One action a tender waits on, who owns it, and since when (IST). */
    public record WorkItem(PendingActionKey key, RecipientDirectory.Owner owner, LocalDateTime pendingSince) {}

    public record TenderEntry(Tender tender, List<WorkItem> works) {}
}
