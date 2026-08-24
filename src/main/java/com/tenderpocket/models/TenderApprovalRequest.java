package com.tenderpocket.models;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "tender_approval_requests")
public class TenderApprovalRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tender_id", nullable = false)
    private String tenderId;

    @Enumerated(EnumType.STRING)
    @Column(name = "stage", nullable = false)
    private TenderWorkflowStage stage;

    @Column(name = "requested_by", nullable = false)
    private String requestedBy;

    @Column(name = "assigned_to")
    private String assignedTo;

    @Column(name = "status", nullable = false)
    private String status; // PENDING, APPROVED, REJECTED, CHANGES_REQUESTED

    @Column(name = "working_path")
    private String workingPath;

    // Payment fields
    @Column(name = "emd_amount")
    private Double emdAmount;

    @Column(name = "transfer_mode")
    private String transferMode; // NEFT, RTGS, DD, BG

    @Column(name = "transfer_ref_no")
    private String transferRefNo;

    @Column(name = "receipt_file_url")
    private String receiptFileUrl;

    // Loss reason fields
    @Column(name = "loss_reason_executive", columnDefinition = "TEXT")
    private String lossReasonExecutive;

    @Column(name = "loss_reason_mis", columnDefinition = "TEXT")
    private String lossReasonMis;

    // Pricing privacy fields
    @Column(name = "tpc_purchase_price")
    private Double tpcPurchasePrice;

    @Column(name = "mis_final_price")
    private Double misFinalPrice;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    public TenderApprovalRequest() {}

    public TenderApprovalRequest(String tenderId, TenderWorkflowStage stage, String requestedBy, String assignedTo, String status) {
        this.tenderId = tenderId;
        this.stage = stage;
        this.requestedBy = requestedBy;
        this.assignedTo = assignedTo;
        this.status = status;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTenderId() { return tenderId; }
    public void setTenderId(String tenderId) { this.tenderId = tenderId; }

    public TenderWorkflowStage getStage() { return stage; }
    public void setStage(TenderWorkflowStage stage) { this.stage = stage; }

    public String getRequestedBy() { return requestedBy; }
    public void setRequestedBy(String requestedBy) { this.requestedBy = requestedBy; }

    public String getAssignedTo() { return assignedTo; }
    public void setAssignedTo(String assignedTo) { this.assignedTo = assignedTo; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getWorkingPath() { return workingPath; }
    public void setWorkingPath(String workingPath) { this.workingPath = workingPath; }

    public Double getEmdAmount() { return emdAmount; }
    public void setEmdAmount(Double emdAmount) { this.emdAmount = emdAmount; }

    public String getTransferMode() { return transferMode; }
    public void setTransferMode(String transferMode) { this.transferMode = transferMode; }

    public String getTransferRefNo() { return transferRefNo; }
    public void setTransferRefNo(String transferRefNo) { this.transferRefNo = transferRefNo; }

    public String getReceiptFileUrl() { return receiptFileUrl; }
    public void setReceiptFileUrl(String receiptFileUrl) { this.receiptFileUrl = receiptFileUrl; }

    public String getLossReasonExecutive() { return lossReasonExecutive; }
    public void setLossReasonExecutive(String lossReasonExecutive) { this.lossReasonExecutive = lossReasonExecutive; }

    public String getLossReasonMis() { return lossReasonMis; }
    public void setLossReasonMis(String lossReasonMis) { this.lossReasonMis = lossReasonMis; }

    public Double getTpcPurchasePrice() { return tpcPurchasePrice; }
    public void setTpcPurchasePrice(Double tpcPurchasePrice) { this.tpcPurchasePrice = tpcPurchasePrice; }

    public Double getMisFinalPrice() { return misFinalPrice; }
    public void setMisFinalPrice(Double misFinalPrice) { this.misFinalPrice = misFinalPrice; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
