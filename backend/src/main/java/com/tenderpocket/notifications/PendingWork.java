package com.tenderpocket.notifications;

import java.util.List;
import java.util.Objects;

/**
 * One action a live tender is waiting on.
 *
 * @param preferredOwners usernames that may name a specific person for this action, most
 *                        authoritative first (the PENDING approval request's assignee, then the
 *                        tender's assigned member fields). Queue names are allowed; nulls and
 *                        blanks are dropped. RecipientDirectory decides which, if any, is a real
 *                        person.
 */
public record PendingWork(PendingActionKey key, List<String> preferredOwners) {
    public PendingWork {
        preferredOwners = preferredOwners == null ? List.of() : preferredOwners.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }
}
