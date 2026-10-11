package com.tenderpocket.repositories;

import com.tenderpocket.models.BackupRun;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface BackupRunRepository extends JpaRepository<BackupRun, Long> {

    @Query("SELECT b FROM BackupRun b WHERE b.status = 'SUCCESS' AND b.backupType = :backupType ORDER BY b.checkpointToId DESC limit 1")
    Optional<BackupRun> findLatestSuccessfulRun(@Param("backupType") String backupType);

    @Query("SELECT b FROM BackupRun b WHERE b.status = 'SUCCESS' AND b.backupType = 'DAILY' ORDER BY b.id DESC")
    List<BackupRun> findAllSuccessfulDailyRuns();

    @Query("SELECT b FROM BackupRun b WHERE b.status = 'SUCCESS' AND b.backupType = 'MONTHLY' ORDER BY b.id DESC")
    List<BackupRun> findAllSuccessfulMonthlyRuns();
}
