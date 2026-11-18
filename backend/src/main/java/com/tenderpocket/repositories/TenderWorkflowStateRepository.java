package com.tenderpocket.repositories;

import com.tenderpocket.models.TenderWorkflowState;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.List;

@Repository
public interface TenderWorkflowStateRepository extends JpaRepository<TenderWorkflowState, Long> {
    Optional<TenderWorkflowState> findByTenderId(String tenderId);
    List<TenderWorkflowState> findByCurrentStep(Integer currentStep);
    List<TenderWorkflowState> findByAssignedExecutive(String assignedExecutive);
    void deleteByTenderId(String tenderId);
    List<TenderWorkflowState> findByTenderIdIn(java.util.Collection<String> tenderIds);
}
