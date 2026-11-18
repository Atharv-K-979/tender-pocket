package com.tenderpocket.models;

import jakarta.persistence.*;

import java.time.LocalDateTime;

/**
 * Pending clock: one row per action a live tender is currently waiting on, stamped with when
 * it was first seen. Rows are created, kept and deleted by PendingClockService. Times are IST.
 */
@Entity
@Table(name = "tender_pending_actions",
        uniqueConstraints = @UniqueConstraint(name = "uk_tender_pending_action", columnNames = {"tender_id", "action_key"}),
        indexes = @Index(name = "idx_tender_pending_actions_tender", columnList = "tender_id"))
public class TenderPendingAction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tender_id", nullable = false)
    private String tenderId;

    @Column(name = "action_key", nullable = false, length = 40)
    private String actionKey;

    @Column(name = "owner_key", nullable = false)
    private String ownerKey;

    @Column(name = "pending_since", nullable = false)
    private LocalDateTime pendingSince;

    @Column(name = "last_seen_at", nullable = false)
    private LocalDateTime lastSeenAt;

    public TenderPendingAction() {}

    public TenderPendingAction(String tenderId, String actionKey, String ownerKey, LocalDateTime pendingSince, LocalDateTime lastSeenAt) {
        this.tenderId = tenderId;
        this.actionKey = actionKey;
        this.ownerKey = ownerKey;
        this.pendingSince = pendingSince;
        this.lastSeenAt = lastSeenAt;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTenderId() { return tenderId; }
    public void setTenderId(String tenderId) { this.tenderId = tenderId; }

    public String getActionKey() { return actionKey; }
    public void setActionKey(String actionKey) { this.actionKey = actionKey; }

    public String getOwnerKey() { return ownerKey; }
    public void setOwnerKey(String ownerKey) { this.ownerKey = ownerKey; }

    public LocalDateTime getPendingSince() { return pendingSince; }
    public void setPendingSince(LocalDateTime pendingSince) { this.pendingSince = pendingSince; }

    public LocalDateTime getLastSeenAt() { return lastSeenAt; }
    public void setLastSeenAt(LocalDateTime lastSeenAt) { this.lastSeenAt = lastSeenAt; }
}
