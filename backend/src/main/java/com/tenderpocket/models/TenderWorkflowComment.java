package com.tenderpocket.models;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "tender_workflow_comments")
public class TenderWorkflowComment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "tender_id", nullable = false)
    private String tenderId;

    @Column(name = "phase", nullable = false)
    private String phase;

    @Column(name = "author", nullable = false)
    private String author;

    @Column(name = "author_role", nullable = false)
    private String authorRole;

    @Column(name = "comment", nullable = false)
    private String comment;

    @Column(name = "created_at", nullable = false)
    private String createdAt;

    public TenderWorkflowComment() {}

    public TenderWorkflowComment(String tenderId, String phase, String author, String authorRole, String comment, String createdAt) {
        this.tenderId = tenderId;
        this.phase = phase;
        this.author = author;
        this.authorRole = authorRole;
        this.comment = comment;
        this.createdAt = createdAt;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTenderId() { return tenderId; }
    public void setTenderId(String tenderId) { this.tenderId = tenderId; }

    public String getPhase() { return phase; }
    public void setPhase(String phase) { this.phase = phase; }

    public String getAuthor() { return author; }
    public void setAuthor(String author) { this.author = author; }

    public String getAuthorRole() { return authorRole; }
    public void setAuthorRole(String authorRole) { this.authorRole = authorRole; }

    public String getComment() { return comment; }
    public void setComment(String comment) { this.comment = comment; }

    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }
}
