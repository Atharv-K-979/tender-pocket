package com.tenderpocket.repositories;

import com.tenderpocket.models.StatusHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface StatusHistoryRepository extends JpaRepository<StatusHistory, Long> {
    List<StatusHistory> findByTenderId(String tenderId);
}
