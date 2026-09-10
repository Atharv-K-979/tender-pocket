package com.tenderpocket.repositories;

import com.tenderpocket.models.TenderComment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TenderCommentRepository extends JpaRepository<TenderComment, Long> {
    List<TenderComment> findByTenderIdOrderByCreatedAtAsc(String tenderId);
    List<TenderComment> findByTenderIdAndStageOrderByCreatedAtAsc(String tenderId, String stage);
}
