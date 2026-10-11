package com.tenderpocket.models;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "backup_runs", indexes = {
    @Index(name = "idx_backup_runs_status", columnList = "status")
})
public class BackupRun {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "backup_type", nullable = false)
    private String backupType; // 'DAILY', 'MONTHLY'

    @Column(name = "started_at", nullable = false)
    private LocalDateTime startedAt = LocalDateTime.now();

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "checkpoint_from_id", nullable = false)
    private Long checkpointFromId;

    @Column(name = "checkpoint_to_id", nullable = false)
    private Long checkpointToId;

    @Column(name = "s3_bucket")
    private String s3Bucket;

    @Column(name = "s3_key")
    private String s3Key;

    @Column(name = "status", nullable = false)
    private String status; // 'IN_PROGRESS', 'SUCCESS', 'FAILED'

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(name = "record_count")
    private Long recordCount;

    public BackupRun() {}

    public BackupRun(String backupType, Long checkpointFromId, Long checkpointToId, String status) {
        this.backupType = backupType;
        this.checkpointFromId = checkpointFromId;
        this.checkpointToId = checkpointToId;
        this.status = status;
        this.startedAt = LocalDateTime.now();
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getBackupType() { return backupType; }
    public void setBackupType(String backupType) { this.backupType = backupType; }

    public LocalDateTime getStartedAt() { return startedAt; }
    public void setStartedAt(LocalDateTime startedAt) { this.startedAt = startedAt; }

    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }

    public Long getCheckpointFromId() { return checkpointFromId; }
    public void setCheckpointFromId(Long checkpointFromId) { this.checkpointFromId = checkpointFromId; }

    public Long getCheckpointToId() { return checkpointToId; }
    public void setCheckpointToId(Long checkpointToId) { this.checkpointToId = checkpointToId; }

    public String getS3Bucket() { return s3Bucket; }
    public void setS3Bucket(String s3Bucket) { this.s3Bucket = s3Bucket; }

    public String getS3Key() { return s3Key; }
    public void setS3Key(String s3Key) { this.s3Key = s3Key; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }

    public Long getSizeBytes() { return sizeBytes; }
    public void setSizeBytes(Long sizeBytes) { this.sizeBytes = sizeBytes; }

    public Long getRecordCount() { return recordCount; }
    public void setRecordCount(Long recordCount) { this.recordCount = recordCount; }
}
