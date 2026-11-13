package com.tenderpocket.repositories;

import com.tenderpocket.models.TenderPendingAction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;

@Repository
public interface TenderPendingActionRepository extends JpaRepository<TenderPendingAction, Long> {

    /** Stamps every row as seen in one statement, instead of one update per row. */
    @Modifying
    @Query("UPDATE TenderPendingAction a SET a.lastSeenAt = :now")
    int markAllSeen(@Param("now") LocalDateTime now);
}
