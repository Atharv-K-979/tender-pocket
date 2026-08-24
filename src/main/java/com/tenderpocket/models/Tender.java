package com.tenderpocket.models;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import jakarta.persistence.Index;

@Entity
@Table(name = "tenders", indexes = {
    @Index(name = "idx_tenders_status", columnList = "status"),
    @Index(name = "idx_tenders_due_date", columnList = "due_date"),
    @Index(name = "idx_tenders_mis_executive", columnList = "mis_executive"),
    @Index(name = "idx_tenders_location", columnList = "location"),
    @Index(name = "idx_tenders_sector", columnList = "sector"),
    @Index(name = "idx_tenders_scraped_at", columnList = "scraped_at"),
    @Index(name = "idx_tenders_source", columnList = "source"),
    @Index(name = "idx_tenders_ref_no", columnList = "ref_no")
})
public class Tender {

    @Id
    @Column(name = "id")
    private String id;

    @Column(name = "ref_no")
    private String refNo;

    @Column(name = "title", nullable = false, columnDefinition = "TEXT")
    private String title;

    @Column(name = "authority", columnDefinition = "TEXT")
    private String authority;

    @Column(name = "estimated_cost")
    private Double estimatedCost;

    @Column(name = "estimated_cost_raw")
    private String estimatedCostRaw;

    @Column(name = "emd")
    private Double emd;

    @Column(name = "emd_raw")
    private String emdRaw;

    @Column(name = "document_fee")
    private Double documentFee;

    @Column(name = "document_fee_raw")
    private String documentFeeRaw;

    @Column(name = "location", columnDefinition = "TEXT")
    private String location;

    @Column(name = "sector")
    private String sector;

    @Column(name = "due_date")
    private String dueDate;

    @Column(name = "opening_date")
    private String openingDate;

    @Column(name = "document_url", columnDefinition = "TEXT")
    private String documentUrl;

    @Column(name = "downloaded_docs", columnDefinition = "TEXT")
    private String downloadedDocs;

    @Column(name = "original_url", nullable = false, columnDefinition = "TEXT")
    private String originalUrl;

    @Column(name = "status")
    private String status = "Issued";

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes = "";

    @Column(name = "scraped_at", nullable = false)
    private String scrapedAt;

    @Column(name = "entry_date")
    private String entryDate;

    @Column(name = "mis_executive")
    private String misExecutive;

    @Column(name = "assigned_by")
    private String assignedBy;

    @Column(name = "assigned_at")
    private String assignedAt;

    @Column(name = "source")
    private String source;

    @Column(name = "source_id")
    private String sourceId;

    @Column(name = "offered_model")
    private String offeredModel;

    @Column(name = "vertical_name")
    private String verticalName;

    @Column(name = "place")
    private String place;

    @Column(name = "state")
    private String state;

    @Column(name = "tender_type")
    private String tenderType;

    @Column(name = "publish_date")
    private String publishDate;

    @Column(name = "start_date")
    private String startDate;

    @Column(name = "time")
    private String time;

    @Column(name = "pre_bid_date")
    private String preBidDate;

    @Column(name = "corrigendum_remark", columnDefinition = "TEXT")
    private String corrigendumRemark;

    @Column(name = "product_name_as_per_tender", columnDefinition = "TEXT")
    private String productNameAsPerTender;

    @Column(name = "product_name_as_per_marken", columnDefinition = "TEXT")
    private String productNameAsPerMarken;

    @Column(name = "bid_qty")
    private Integer bidQty;

    @Column(name = "official_reference_number")
    private String officialReferenceNumber;

    @Column(name = "eprocurement_portal_id")
    private String eprocurementPortalId;

    @Column(name = "is_corrigendum")
    private Boolean isCorrigendum = false;

    @Column(name = "assigned_mis_executive")
    private String assignedMisExecutive;

    @Column(name = "tpc_purchase_price")
    private Double tpcPurchasePrice;

    @Column(name = "mis_final_price")
    private Double misFinalPrice;

    @Column(name = "current_stage")
    private String currentStage = "SPEC_CLEARANCE";

    @Column(name = "quoted_qty")
    private Integer quotedQty;

    @Column(name = "ai_details_summary", columnDefinition = "TEXT")
    private String aiDetailsSummary;

    @Column(name = "ai_history_summary", columnDefinition = "TEXT")
    private String aiHistorySummary;

    @Column(name = "working_path", columnDefinition = "TEXT")
    private String workingPath;

    @Column(name = "assigned_mis_member")
    private String assignedMisMember;

    @Column(name = "assigned_mis_member_emd")
    private String assignedMisMemberEmd;

    @Column(name = "assigned_mis_member_docs")
    private String assignedMisMemberDocs;

    @Column(name = "assigned_mis_member_submission")
    private String assignedMisMemberSubmission;

    @Column(name = "assigned_mis_member_spec")
    private String assignedMisMemberSpec;

    @Column(name = "emd_amount_actual")
    private Double emdAmountActual;

    @Column(name = "emd_payment_mode")
    private String emdPaymentMode;

    @Column(name = "emd_payment_ref")
    private String emdPaymentRef;

    @Column(name = "emd_payment_date")
    private String emdPaymentDate;

    @Column(name = "loss_reason", columnDefinition = "TEXT")
    private String lossReason;

    @Column(name = "payment_status")
    private String paymentStatus = "None";

    @Column(name = "verification_status")
    private String verificationStatus = "None";

    @Column(name = "submission_status")
    private String submissionStatus = "None";

    @Column(name = "outcome_status")
    private String outcomeStatus = "None";

    @Column(name = "spec_verification_status")
    private String specVerificationStatus = "None";

    public Tender() {}

    // Additional Getters and Setters
    public String getWorkingPath() { return workingPath; }
    public void setWorkingPath(String workingPath) { this.workingPath = workingPath; }

    public String getAssignedMisMember() { return assignedMisMember; }
    public void setAssignedMisMember(String assignedMisMember) { this.assignedMisMember = assignedMisMember; }

    public String getAssignedMisMemberEmd() { return assignedMisMemberEmd; }
    public void setAssignedMisMemberEmd(String assignedMisMemberEmd) { this.assignedMisMemberEmd = assignedMisMemberEmd; }

    public String getAssignedMisMemberDocs() { return assignedMisMemberDocs; }
    public void setAssignedMisMemberDocs(String assignedMisMemberDocs) { this.assignedMisMemberDocs = assignedMisMemberDocs; }

    public String getAssignedMisMemberSubmission() { return assignedMisMemberSubmission; }
    public void setAssignedMisMemberSubmission(String assignedMisMemberSubmission) { this.assignedMisMemberSubmission = assignedMisMemberSubmission; }

    public String getAssignedMisMemberSpec() { return assignedMisMemberSpec; }
    public void setAssignedMisMemberSpec(String assignedMisMemberSpec) { this.assignedMisMemberSpec = assignedMisMemberSpec; }

    public Double getEmdAmountActual() { return emdAmountActual; }
    public void setEmdAmountActual(Double emdAmountActual) { this.emdAmountActual = emdAmountActual; }

    public String getEmdPaymentMode() { return emdPaymentMode; }
    public void setEmdPaymentMode(String emdPaymentMode) { this.emdPaymentMode = emdPaymentMode; }

    public String getEmdPaymentRef() { return emdPaymentRef; }
    public void setEmdPaymentRef(String emdPaymentRef) { this.emdPaymentRef = emdPaymentRef; }

    public String getEmdPaymentDate() { return emdPaymentDate; }
    public void setEmdPaymentDate(String emdPaymentDate) { this.emdPaymentDate = emdPaymentDate; }

    public String getLossReason() { return lossReason; }
    public void setLossReason(String lossReason) { this.lossReason = lossReason; }

    public String getPaymentStatus() { return paymentStatus; }
    public void setPaymentStatus(String paymentStatus) { this.paymentStatus = paymentStatus; }

    public String getVerificationStatus() { return verificationStatus; }
    public void setVerificationStatus(String verificationStatus) { this.verificationStatus = verificationStatus; }

    public String getSubmissionStatus() { return submissionStatus; }
    public void setSubmissionStatus(String submissionStatus) { this.submissionStatus = submissionStatus; }

    public String getOutcomeStatus() { return outcomeStatus; }
    public void setOutcomeStatus(String outcomeStatus) { this.outcomeStatus = outcomeStatus; }

    // Getters and Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getRefNo() { return refNo; }
    public void setRefNo(String refNo) { this.refNo = refNo; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getAuthority() { return authority; }
    public void setAuthority(String authority) { this.authority = authority; }

    public Double getEstimatedCost() { return estimatedCost; }
    public void setEstimatedCost(Double estimatedCost) { this.estimatedCost = estimatedCost; }

    public String getEstimatedCostRaw() { return estimatedCostRaw; }
    public void setEstimatedCostRaw(String estimatedCostRaw) { this.estimatedCostRaw = estimatedCostRaw; }

    public Double getEmd() { return emd; }
    public void setEmd(Double emd) { this.emd = emd; }

    public String getEmdRaw() { return emdRaw; }
    public void setEmdRaw(String emdRaw) { this.emdRaw = emdRaw; }

    public Double getDocumentFee() { return documentFee; }
    public void setDocumentFee(Double documentFee) { this.documentFee = documentFee; }

    public String getDocumentFeeRaw() { return documentFeeRaw; }
    public void setDocumentFeeRaw(String documentFeeRaw) { this.documentFeeRaw = documentFeeRaw; }

    public String getLocation() { return location; }
    public void setLocation(String location) { this.location = location; }

    public String getSector() { return sector; }
    public void setSector(String sector) { this.sector = sector; }

    public String getDueDate() { return dueDate; }
    public void setDueDate(String dueDate) { this.dueDate = dueDate; }

    public String getOpeningDate() { return openingDate; }
    public void setOpeningDate(String openingDate) { this.openingDate = openingDate; }

    public String getDocumentUrl() { return documentUrl; }
    public void setDocumentUrl(String documentUrl) { this.documentUrl = documentUrl; }

    public String getDownloadedDocs() { return downloadedDocs; }
    public void setDownloadedDocs(String downloadedDocs) { this.downloadedDocs = downloadedDocs; }

    public String getOriginalUrl() { return originalUrl; }
    public void setOriginalUrl(String originalUrl) { this.originalUrl = originalUrl; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }

    public String getScrapedAt() { return scrapedAt; }
    public void setScrapedAt(String scrapedAt) { this.scrapedAt = scrapedAt; }

    public String getEntryDate() { return entryDate; }
    public void setEntryDate(String entryDate) { this.entryDate = entryDate; }

    public String getMisExecutive() { return misExecutive; }
    public void setMisExecutive(String misExecutive) { this.misExecutive = misExecutive; }

    public String getAssignedBy() { return assignedBy; }
    public void setAssignedBy(String assignedBy) { this.assignedBy = assignedBy; }

    public String getAssignedAt() { return assignedAt; }
    public void setAssignedAt(String assignedAt) { this.assignedAt = assignedAt; }

    public String getSource() { return source; }
    public void setSource(String source) { this.source = source; }

    public String getSourceId() { return sourceId; }
    public void setSourceId(String sourceId) { this.sourceId = sourceId; }

    public String getVerticalName() { return verticalName; }
    public void setVerticalName(String verticalName) { this.verticalName = verticalName; }

    public String getPlace() { return place; }
    public void setPlace(String place) { this.place = place; }

    public String getState() { return state; }
    public void setState(String state) { this.state = state; }

    public String getTenderType() { return tenderType; }
    public void setTenderType(String tenderType) { this.tenderType = tenderType; }

    public String getPublishDate() { return publishDate; }
    public void setPublishDate(String publishDate) { this.publishDate = publishDate; }

    public String getStartDate() { return startDate; }
    public void setStartDate(String startDate) { this.startDate = startDate; }

    public String getTime() { return time; }
    public void setTime(String time) { this.time = time; }

    public String getPreBidDate() { return preBidDate; }
    public void setPreBidDate(String preBidDate) { this.preBidDate = preBidDate; }

    public String getCorrigendumRemark() { return corrigendumRemark; }
    public void setCorrigendumRemark(String corrigendumRemark) { this.corrigendumRemark = corrigendumRemark; }

    public String getProductNameAsPerTender() { return productNameAsPerTender; }
    public void setProductNameAsPerTender(String productNameAsPerTender) { this.productNameAsPerTender = productNameAsPerTender; }

    public String getProductNameAsPerMarken() { return productNameAsPerMarken; }
    public void setProductNameAsPerMarken(String productNameAsPerMarken) { this.productNameAsPerMarken = productNameAsPerMarken; }

    public Integer getBidQty() { return bidQty; }
    public void setBidQty(Integer bidQty) { this.bidQty = bidQty; }

    public Integer getQuotedQty() { return quotedQty; }
    public void setQuotedQty(Integer quotedQty) { this.quotedQty = quotedQty; }

    public String getAiDetailsSummary() { return aiDetailsSummary; }
    public void setAiDetailsSummary(String aiDetailsSummary) { this.aiDetailsSummary = aiDetailsSummary; }

    public String getAiHistorySummary() { return aiHistorySummary; }
    public void setAiHistorySummary(String aiHistorySummary) { this.aiHistorySummary = aiHistorySummary; }

    public String getSpecVerificationStatus() { return specVerificationStatus; }
    public void setSpecVerificationStatus(String specVerificationStatus) { this.specVerificationStatus = specVerificationStatus; }

    public String getOfferedModel() { return offeredModel; }
    public void setOfferedModel(String offeredModel) { this.offeredModel = offeredModel; }

    public String getOfficialReferenceNumber() { return officialReferenceNumber; }
    public void setOfficialReferenceNumber(String officialReferenceNumber) { this.officialReferenceNumber = officialReferenceNumber; }

    public String getEprocurementPortalId() { return eprocurementPortalId; }
    public void setEprocurementPortalId(String eprocurementPortalId) { this.eprocurementPortalId = eprocurementPortalId; }

    public Boolean getIsCorrigendum() { return isCorrigendum != null && isCorrigendum; }
    public void setIsCorrigendum(Boolean isCorrigendum) { this.isCorrigendum = isCorrigendum; }

    public String getAssignedMisExecutive() { return assignedMisExecutive; }
    public void setAssignedMisExecutive(String assignedMisExecutive) { this.assignedMisExecutive = assignedMisExecutive; }

    public Double getTpcPurchasePrice() { return tpcPurchasePrice; }
    public void setTpcPurchasePrice(Double tpcPurchasePrice) { this.tpcPurchasePrice = tpcPurchasePrice; }

    public Double getMisFinalPrice() { return misFinalPrice; }
    public void setMisFinalPrice(Double misFinalPrice) { this.misFinalPrice = misFinalPrice; }

    public String getCurrentStage() { return currentStage; }
    public void setCurrentStage(String currentStage) { this.currentStage = currentStage; }
}
