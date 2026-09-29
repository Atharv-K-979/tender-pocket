package com.tenderpocket.models;

public class NotificationItemDto {

    private String tenderId;
    private String refNo;
    private String title;
    private String authority;
    private String dueDate;
    private String daysLeft;
    private String pendingAction;
    private String notificationType;
    private String recipientUsername;
    private String requestedBy;
    private Long approvalRequestId;
    private Integer daysUnreviewed;

    public NotificationItemDto() {}

    public NotificationItemDto(String tenderId, String refNo, String title, String authority,
                               String dueDate, String daysLeft, String pendingAction,
                               String notificationType, String recipientUsername, String requestedBy,
                               Long approvalRequestId, Integer daysUnreviewed) {
        this.tenderId = tenderId;
        this.refNo = refNo;
        this.title = title;
        this.authority = authority;
        this.dueDate = dueDate;
        this.daysLeft = daysLeft;
        this.pendingAction = pendingAction;
        this.notificationType = notificationType;
        this.recipientUsername = recipientUsername;
        this.requestedBy = requestedBy;
        this.approvalRequestId = approvalRequestId;
        this.daysUnreviewed = daysUnreviewed;
    }

    public String getTenderId() { return tenderId; }
    public void setTenderId(String tenderId) { this.tenderId = tenderId; }

    public String getRefNo() { return refNo; }
    public void setRefNo(String refNo) { this.refNo = refNo; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getAuthority() { return authority; }
    public void setAuthority(String authority) { this.authority = authority; }

    public String getDueDate() { return dueDate; }
    public void setDueDate(String dueDate) { this.dueDate = dueDate; }

    public String getDaysLeft() { return daysLeft; }
    public void setDaysLeft(String daysLeft) { this.daysLeft = daysLeft; }

    public String getPendingAction() { return pendingAction; }
    public void setPendingAction(String pendingAction) { this.pendingAction = pendingAction; }

    public String getNotificationType() { return notificationType; }
    public void setNotificationType(String notificationType) { this.notificationType = notificationType; }

    public String getRecipientUsername() { return recipientUsername; }
    public void setRecipientUsername(String recipientUsername) { this.recipientUsername = recipientUsername; }

    public String getRequestedBy() { return requestedBy; }
    public void setRequestedBy(String requestedBy) { this.requestedBy = requestedBy; }

    public Long getApprovalRequestId() { return approvalRequestId; }
    public void setApprovalRequestId(Long approvalRequestId) { this.approvalRequestId = approvalRequestId; }

    public Integer getDaysUnreviewed() { return daysUnreviewed; }
    public void setDaysUnreviewed(Integer daysUnreviewed) { this.daysUnreviewed = daysUnreviewed; }
}
