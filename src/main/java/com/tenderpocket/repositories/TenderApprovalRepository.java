package com.tenderpocket.repositories;

import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderWorkflowStage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TenderApprovalRepository extends JpaRepository<TenderApprovalRequest, Long> {
    List<TenderApprovalRequest> findByTenderIdOrderByCreatedAtDesc(String tenderId);
    List<TenderApprovalRequest> findByAssignedToAndStatus(String assignedTo, String status);
    List<TenderApprovalRequest> findByTenderIdAndStageOrderByCreatedAtDesc(String tenderId, TenderWorkflowStage stage);
}
