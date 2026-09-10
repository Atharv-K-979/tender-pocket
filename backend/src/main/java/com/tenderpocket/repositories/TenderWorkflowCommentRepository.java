package com.tenderpocket.repositories;

import com.tenderpocket.models.TenderWorkflowComment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TenderWorkflowCommentRepository extends JpaRepository<TenderWorkflowComment, Long> {
    List<TenderWorkflowComment> findByTenderIdOrderByCreatedAtAsc(String tenderId);
}
