package com.tenderpocket.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.LocalDateTime;

public class ApprovalSummaryDto {

    // Approval Request fields
    private Long id;
    private String tenderId;
    private TenderWorkflowStage stage;
    private String stageName;
    private String requestedBy;
    private String assignedTo;
    private String status;
    private String workingPath;
    private Double emdAmount;
    private String transferMode;
    private String transferRefNo;
    private String receiptFileUrl;
    private String lossReasonExecutive;
    private String lossReasonMis;
    private Double tpcPurchasePrice;
    private Double misFinalPrice;
    private String reviewedBy;
    private String reviewerComment;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    // Associated Tender fields
    private String tenderRefNo;
    private String tenderTitle;
    private String tenderAuthority;
    private String tenderDueDate;
    private Double tenderEstimatedCost;
    private Double tenderEmd;
    private String tenderLocation;
    private String tenderSector;
    private String tenderStatus;
    private String tenderCurrentStage;
    private String misExecutive;
    private Integer tenderBidQty;
    private Integer tenderQuotedQty;

    public ApprovalSummaryDto() {}

    public ApprovalSummaryDto(TenderApprovalRequest request, Tender tender) {
        if (request != null) {
            this.id = request.getId();
            this.tenderId = request.getTenderId();
            this.stage = request.getStage();
            this.stageName = request.getStage() != null ? request.getStage().name() : "";
            this.requestedBy = request.getRequestedBy();
            this.assignedTo = request.getAssignedTo();
            this.status = request.getStatus();
            this.workingPath = request.getWorkingPath();
            this.emdAmount = request.getEmdAmount();
            this.transferMode = request.getTransferMode();
            this.transferRefNo = request.getTransferRefNo();
            this.receiptFileUrl = request.getReceiptFileUrl();
            this.lossReasonExecutive = request.getLossReasonExecutive();
            this.lossReasonMis = request.getLossReasonMis();
            this.tpcPurchasePrice = request.getTpcPurchasePrice();
            this.misFinalPrice = request.getMisFinalPrice();
            this.reviewedBy = request.getReviewedBy();
            this.reviewerComment = request.getReviewerComment();
            this.createdAt = request.getCreatedAt();
            this.updatedAt = request.getUpdatedAt();
        }
        if (tender != null) {
            this.tenderRefNo = tender.getRefNo();
            this.tenderTitle = tender.getTitle();
            this.tenderAuthority = tender.getAuthority();
            this.tenderDueDate = tender.getDueDate();
            this.tenderEstimatedCost = tender.getEstimatedCost();
            this.tenderEmd = tender.getEmd();
            this.tenderLocation = tender.getLocation();
            this.tenderSector = tender.getSector();
            this.tenderStatus = tender.getStatus();
            this.tenderCurrentStage = tender.getCurrentStage();
            this.misExecutive = tender.getMisExecutive();
            this.tenderBidQty = tender.getBidQty();
            this.tenderQuotedQty = tender.getQuotedQty();
        }
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTenderId() { return tenderId; }
    public void setTenderId(String tenderId) { this.tenderId = tenderId; }

    public TenderWorkflowStage getStage() { return stage; }
    public void setStage(TenderWorkflowStage stage) { this.stage = stage; }

    public String getStageName() { return stageName; }
    public void setStageName(String stageName) { this.stageName = stageName; }

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

    public String getTenderRefNo() { return tenderRefNo; }
    public void setTenderRefNo(String tenderRefNo) { this.tenderRefNo = tenderRefNo; }

    public String getTenderTitle() { return tenderTitle; }
    public void setTenderTitle(String tenderTitle) { this.tenderTitle = tenderTitle; }

    public String getTenderAuthority() { return tenderAuthority; }
    public void setTenderAuthority(String tenderAuthority) { this.tenderAuthority = tenderAuthority; }

    public String getTenderDueDate() { return tenderDueDate; }
    public void setTenderDueDate(String tenderDueDate) { this.tenderDueDate = tenderDueDate; }

    public Double getTenderEstimatedCost() { return tenderEstimatedCost; }
    public void setTenderEstimatedCost(Double tenderEstimatedCost) { this.tenderEstimatedCost = tenderEstimatedCost; }

    public Double getTenderEmd() { return tenderEmd; }
    public void setTenderEmd(Double tenderEmd) { this.tenderEmd = tenderEmd; }

    public String getTenderLocation() { return tenderLocation; }
    public void setTenderLocation(String tenderLocation) { this.tenderLocation = tenderLocation; }

    public String getTenderSector() { return tenderSector; }
    public void setTenderSector(String tenderSector) { this.tenderSector = tenderSector; }

    public String getTenderStatus() { return tenderStatus; }
    public void setTenderStatus(String tenderStatus) { this.tenderStatus = tenderStatus; }

    public String getTenderCurrentStage() { return tenderCurrentStage; }
    public void setTenderCurrentStage(String tenderCurrentStage) { this.tenderCurrentStage = tenderCurrentStage; }

    public String getMisExecutive() { return misExecutive; }
    public void setMisExecutive(String misExecutive) { this.misExecutive = misExecutive; }

    public String getReviewedBy() { return reviewedBy; }
    public void setReviewedBy(String reviewedBy) { this.reviewedBy = reviewedBy; }

    public String getReviewerComment() { return reviewerComment; }
    public void setReviewerComment(String reviewerComment) { this.reviewerComment = reviewerComment; }

    @JsonProperty("tenderBidQty")
    public Integer getTenderBidQty() { return tenderBidQty; }
    @JsonProperty("tender_bid_qty")
    public Integer getTenderBidQtySnake() { return tenderBidQty; }
    @JsonProperty("bid_qty")
    public Integer getBidQty() { return tenderBidQty; }
    @JsonProperty("bidQty")
    public Integer getBidQtyCamel() { return tenderBidQty; }
    public void setTenderBidQty(Integer tenderBidQty) { this.tenderBidQty = tenderBidQty; }

    @JsonProperty("tenderQuotedQty")
    public Integer getTenderQuotedQty() { return tenderQuotedQty; }
    @JsonProperty("tender_quoted_qty")
    public Integer getTenderQuotedQtySnake() { return tenderQuotedQty; }
    @JsonProperty("quoted_qty")
    public Integer getQuotedQty() { return tenderQuotedQty; }
    @JsonProperty("quotedQty")
    public Integer getQuotedQtyCamel() { return tenderQuotedQty; }
    public void setTenderQuotedQty(Integer tenderQuotedQty) { this.tenderQuotedQty = tenderQuotedQty; }
}
