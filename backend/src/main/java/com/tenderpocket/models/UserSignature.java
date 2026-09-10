package com.tenderpocket.models;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "user_signatures")
public class UserSignature {

    @Id
    @Column(name = "username")
    private String username;

    @Column(name = "signature_image_url", nullable = false)
    private String signatureImageUrl;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    public UserSignature() {}

    public UserSignature(String username, String signatureImageUrl) {
        this.username = username;
        this.signatureImageUrl = signatureImageUrl;
    }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getSignatureImageUrl() { return signatureImageUrl; }
    public void setSignatureImageUrl(String signatureImageUrl) { this.signatureImageUrl = signatureImageUrl; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
