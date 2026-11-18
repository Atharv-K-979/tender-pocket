package com.tenderpocket.models;

import jakarta.persistence.*;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * One row per login, mail type and day. The unique key is what limits every login to one Due
 * mail and one Pending mail a day, however many times the job runs. Times are IST.
 */
@Entity
@Table(name = "email_digest_log",
        uniqueConstraints = @UniqueConstraint(name = "uk_email_digest_log", columnNames = {"recipient_username", "digest_type", "sent_date"}),
        indexes = @Index(name = "idx_email_digest_log_date", columnList = "sent_date"))
public class EmailDigestLog {

    public static final String SENDING = "SENDING";
    public static final String SENT = "SENT";
    public static final String FAILED = "FAILED";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "recipient_username", nullable = false)
    private String recipientUsername;

    @Column(name = "digest_type", nullable = false, length = 20)
    private String digestType;

    @Column(name = "sent_date", nullable = false)
    private LocalDate sentDate;

    @Column(name = "status", nullable = false, length = 20)
    private String status;

    @Column(name = "recipient_email")
    private String recipientEmail;

    @Column(name = "item_count")
    private Integer itemCount;

    @Column(name = "attempts")
    private Integer attempts;

    @Column(name = "subject", length = 500)
    private String subject;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    public EmailDigestLog() {}

    public EmailDigestLog(String recipientUsername, String digestType, LocalDate sentDate, String status, LocalDateTime now) {
        this.recipientUsername = recipientUsername;
        this.digestType = digestType;
        this.sentDate = sentDate;
        this.status = status;
        this.attempts = 0;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getRecipientUsername() { return recipientUsername; }
    public void setRecipientUsername(String recipientUsername) { this.recipientUsername = recipientUsername; }

    public String getDigestType() { return digestType; }
    public void setDigestType(String digestType) { this.digestType = digestType; }

    public LocalDate getSentDate() { return sentDate; }
    public void setSentDate(LocalDate sentDate) { this.sentDate = sentDate; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getRecipientEmail() { return recipientEmail; }
    public void setRecipientEmail(String recipientEmail) { this.recipientEmail = recipientEmail; }

    public Integer getItemCount() { return itemCount; }
    public void setItemCount(Integer itemCount) { this.itemCount = itemCount; }

    public Integer getAttempts() { return attempts; }
    public void setAttempts(Integer attempts) { this.attempts = attempts; }

    public String getSubject() { return subject; }
    public void setSubject(String subject) { this.subject = subject; }

    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
