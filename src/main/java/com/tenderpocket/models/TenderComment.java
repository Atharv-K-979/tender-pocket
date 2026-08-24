package com.tenderpocket.models;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "tender_comments")
public class TenderComment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tender_id", nullable = false)
    private String tenderId;

    @Column(name = "stage")
    private String stage;

    @Column(name = "author_username", nullable = false)
    private String authorUsername;

    @Column(name = "author_role", nullable = false)
    private String authorRole;

    @Column(name = "comment_text", columnDefinition = "TEXT", nullable = false)
    private String commentText;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    public TenderComment() {}

    public TenderComment(String tenderId, String stage, String authorUsername, String authorRole, String commentText) {
        this.tenderId = tenderId;
        this.stage = stage;
        this.authorUsername = authorUsername;
        this.authorRole = authorRole;
        this.commentText = commentText;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTenderId() { return tenderId; }
    public void setTenderId(String tenderId) { this.tenderId = tenderId; }

    public String getStage() { return stage; }
    public void setStage(String stage) { this.stage = stage; }

    public String getAuthorUsername() { return authorUsername; }
    public void setAuthorUsername(String authorUsername) { this.authorUsername = authorUsername; }

    public String getAuthorRole() { return authorRole; }
    public void setAuthorRole(String authorRole) { this.authorRole = authorRole; }

    public String getCommentText() { return commentText; }
    public void setCommentText(String commentText) { this.commentText = commentText; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
