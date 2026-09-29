package com.tenderpocket.models;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "email_notification_logs",
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_email_logs_dedup", columnNames = {"recipient_username", "tender_id", "notification_type", "sent_date"})
    },
    indexes = {
        @Index(name = "idx_email_logs_dedup", columnList = "recipient_username, tender_id, notification_type, sent_date"),
        @Index(name = "idx_email_logs_sent_date", columnList = "sent_date"),
        @Index(name = "idx_email_logs_status", columnList = "status")
    }
)
public class EmailNotificationLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "recipient_username", nullable = false)
    private String recipientUsername;

    @Column(name = "recipient_email")
    private String recipientEmail;

    @Column(name = "tender_id", nullable = false)
    private String tenderId;

    @Column(name = "notification_type", nullable = false)
    private String notificationType;

    @Column(name = "sent_date", nullable = false)
    private LocalDate sentDate;

    @Column(name = "status", nullable = false)
    private String status; // SENT, FAILED

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    public EmailNotificationLog() {}

    public EmailNotificationLog(String recipientUsername, String recipientEmail, String tenderId,
                                String notificationType, LocalDate sentDate, String status, String errorMessage) {
        this.recipientUsername = recipientUsername;
        this.recipientEmail = recipientEmail;
        this.tenderId = tenderId;
        this.notificationType = notificationType;
        this.sentDate = sentDate;
        this.status = status;
        this.errorMessage = errorMessage;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getRecipientUsername() { return recipientUsername; }
    public void setRecipientUsername(String recipientUsername) { this.recipientUsername = recipientUsername; }

    public String getRecipientEmail() { return recipientEmail; }
    public void setRecipientEmail(String recipientEmail) { this.recipientEmail = recipientEmail; }

    public String getTenderId() { return tenderId; }
    public void setTenderId(String tenderId) { this.tenderId = tenderId; }

    public String getNotificationType() { return notificationType; }
    public void setNotificationType(String notificationType) { this.notificationType = notificationType; }

    public LocalDate getSentDate() { return sentDate; }
    public void setSentDate(LocalDate sentDate) { this.sentDate = sentDate; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
