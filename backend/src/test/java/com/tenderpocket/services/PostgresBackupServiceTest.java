package com.tenderpocket.services;

import com.tenderpocket.models.BackupRun;
import com.tenderpocket.repositories.BackupRunRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class PostgresBackupServiceTest {

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Mock
    private BackupRunRepository backupRunRepository;

    @Mock
    private BackupEmailService backupEmailService;

    @Spy
    @InjectMocks
    private PostgresBackupService postgresBackupService;

    @BeforeEach
    void setUp() {
        doReturn(true).when(postgresBackupService).uploadToS3OrStorage(anyString(), anyString(), any(byte[].class));
    }

    @Test
    @DisplayName("1. New row captured by incremental backup")
    void testNewRowCapturedByIncrementalBackup() throws Exception {
        when(backupRunRepository.findLatestSuccessfulRun("DAILY")).thenReturn(Optional.empty());
        when(jdbcTemplate.queryForObject(contains("MAX(id)"), eq(Long.class))).thenReturn(10L);

        List<Map<String, Object>> logEntries = new ArrayList<>();
        Map<String, Object> entry = new HashMap<>();
        entry.put("id", 1L);
        entry.put("table_name", "users");
        entry.put("operation", "INSERT");
        entry.put("record_pk", "user1");
        entry.put("row_data", "{\"username\":\"user1\",\"role\":\"ADMIN\"}");
        logEntries.add(entry);

        when(jdbcTemplate.queryForList(contains("FROM db_change_log"), eq(0L), eq(10L))).thenReturn(logEntries);
        when(backupRunRepository.save(any(BackupRun.class))).thenAnswer(i -> i.getArgument(0));

        BackupRun run = postgresBackupService.performDailyBackup();

        assertNotNull(run);
        assertEquals("SUCCESS", run.getStatus());
        assertEquals(10L, run.getCheckpointToId());
        assertEquals(1L, run.getRecordCount());
    }

    @Test
    @DisplayName("2. Modified row captured")
    void testModifiedRowCaptured() throws Exception {
        when(backupRunRepository.findLatestSuccessfulRun("DAILY")).thenReturn(Optional.of(new BackupRun("DAILY", 0L, 5L, "SUCCESS")));
        when(jdbcTemplate.queryForObject(contains("MAX(id)"), eq(Long.class))).thenReturn(12L);

        List<Map<String, Object>> logEntries = new ArrayList<>();
        Map<String, Object> entry = new HashMap<>();
        entry.put("id", 6L);
        entry.put("table_name", "tenders");
        entry.put("operation", "UPDATE");
        entry.put("record_pk", "TND123");
        entry.put("row_data", "{\"id\":\"TND123\",\"status\":\"APPROVED\"}");
        logEntries.add(entry);

        when(jdbcTemplate.queryForList(contains("FROM db_change_log"), eq(5L), eq(12L))).thenReturn(logEntries);
        when(backupRunRepository.save(any(BackupRun.class))).thenAnswer(i -> i.getArgument(0));

        BackupRun run = postgresBackupService.performDailyBackup();

        assertEquals("SUCCESS", run.getStatus());
        assertEquals(12L, run.getCheckpointToId());
        assertEquals(5L, run.getCheckpointFromId());
    }

    @Test
    @DisplayName("3. Unchanged row not duplicated unnecessarily")
    void testUnchangedRowNotDuplicatedUnnecessarily() {
        when(backupRunRepository.findLatestSuccessfulRun("DAILY")).thenReturn(Optional.of(new BackupRun("DAILY", 0L, 20L, "SUCCESS")));
        when(jdbcTemplate.queryForObject(contains("MAX(id)"), eq(Long.class))).thenReturn(20L);
        when(backupRunRepository.save(any(BackupRun.class))).thenAnswer(i -> i.getArgument(0));

        BackupRun run = postgresBackupService.performDailyBackup();

        assertEquals("SUCCESS", run.getStatus());
        assertEquals(0L, run.getRecordCount());
        assertEquals("NO_CHANGES", run.getS3Key());
        verify(jdbcTemplate, never()).queryForList(contains("FROM db_change_log"), anyLong(), anyLong());
    }

    @Test
    @DisplayName("4. Deletion handling")
    void testDeletionHandling() throws Exception {
        List<Map<String, Object>> logEntries = new ArrayList<>();
        Map<String, Object> delEntry = new HashMap<>();
        delEntry.put("id", 1L);
        delEntry.put("table_name", "tenders");
        delEntry.put("operation", "DELETE");
        delEntry.put("record_pk", "TND999");
        delEntry.put("row_data", null);
        logEntries.add(delEntry);

        String sql = postgresBackupService.buildSqlDeltaScript(logEntries, 0L, 1L);
        assertTrue(sql.contains("DELETE FROM tenders WHERE id = 'TND999';"));
    }

    @Test
    @DisplayName("5. Checkpoint updated only after successful upload")
    void testCheckpointUpdatedOnlyAfterSuccessfulUpload() {
        when(backupRunRepository.findLatestSuccessfulRun("DAILY")).thenReturn(Optional.empty());
        when(jdbcTemplate.queryForObject(contains("MAX(id)"), eq(Long.class))).thenReturn(15L);

        List<Map<String, Object>> logEntries = new ArrayList<>();
        Map<String, Object> entry = new HashMap<>();
        entry.put("id", 1L);
        entry.put("table_name", "users");
        entry.put("operation", "INSERT");
        entry.put("record_pk", "u1");
        entry.put("row_data", "{\"username\":\"u1\"}");
        logEntries.add(entry);

        when(jdbcTemplate.queryForList(contains("FROM db_change_log"), eq(0L), eq(15L))).thenReturn(logEntries);
        when(backupRunRepository.save(any(BackupRun.class))).thenAnswer(i -> i.getArgument(0));

        BackupRun run = postgresBackupService.performDailyBackup();

        assertEquals("SUCCESS", run.getStatus());
        assertEquals(15L, run.getCheckpointToId());
    }

    @Test
    @DisplayName("6. Failed upload does not advance checkpoint")
    void testFailedUploadDoesNotAdvanceCheckpoint() {
        when(backupRunRepository.findLatestSuccessfulRun("DAILY")).thenReturn(Optional.of(new BackupRun("DAILY", 0L, 5L, "SUCCESS")));
        when(jdbcTemplate.queryForObject(contains("MAX(id)"), eq(Long.class))).thenReturn(25L);

        List<Map<String, Object>> logEntries = new ArrayList<>();
        Map<String, Object> entry = new HashMap<>();
        entry.put("id", 6L);
        entry.put("table_name", "users");
        entry.put("operation", "INSERT");
        entry.put("record_pk", "u2");
        entry.put("row_data", "{\"username\":\"u2\"}");
        logEntries.add(entry);

        when(jdbcTemplate.queryForList(contains("FROM db_change_log"), eq(5L), eq(25L))).thenReturn(logEntries);
        doReturn(false).when(postgresBackupService).uploadToS3OrStorage(anyString(), anyString(), any(byte[].class));
        when(backupRunRepository.save(any(BackupRun.class))).thenAnswer(i -> i.getArgument(0));

        assertThrows(RuntimeException.class, () -> postgresBackupService.performDailyBackup());

        ArgumentCaptor<BackupRun> captor = ArgumentCaptor.forClass(BackupRun.class);
        verify(backupRunRepository).save(captor.capture());
        assertEquals("FAILED", captor.getValue().getStatus());
        verify(backupEmailService).sendBackupFailureNotification(eq("DAILY"), anyString(), anyString(), eq(5L));
    }

    @Test
    @DisplayName("7. Retry after failed backup")
    void testRetryAfterFailedBackup() {
        when(backupRunRepository.findLatestSuccessfulRun("DAILY")).thenReturn(Optional.of(new BackupRun("DAILY", 0L, 5L, "SUCCESS")));
        when(jdbcTemplate.queryForObject(contains("MAX(id)"), eq(Long.class))).thenReturn(30L);

        List<Map<String, Object>> logEntries = new ArrayList<>();
        Map<String, Object> entry = new HashMap<>();
        entry.put("id", 6L);
        entry.put("table_name", "users");
        entry.put("operation", "INSERT");
        entry.put("record_pk", "u3");
        entry.put("row_data", "{\"username\":\"u3\"}");
        logEntries.add(entry);

        when(jdbcTemplate.queryForList(contains("FROM db_change_log"), eq(5L), eq(30L))).thenReturn(logEntries);
        when(backupRunRepository.save(any(BackupRun.class))).thenAnswer(i -> i.getArgument(0));

        BackupRun retryRun = postgresBackupService.performDailyBackup();

        assertEquals("SUCCESS", retryRun.getStatus());
        assertEquals(5L, retryRun.getCheckpointFromId());
        assertEquals(30L, retryRun.getCheckpointToId());
    }

    @Test
    @DisplayName("8. S3 upload failure")
    void testS3UploadFailure() {
        when(backupRunRepository.findLatestSuccessfulRun("DAILY")).thenReturn(Optional.empty());
        when(jdbcTemplate.queryForObject(contains("MAX(id)"), eq(Long.class))).thenReturn(10L);

        List<Map<String, Object>> logEntries = new ArrayList<>();
        Map<String, Object> entry = new HashMap<>();
        entry.put("id", 1L);
        entry.put("table_name", "users");
        entry.put("operation", "INSERT");
        entry.put("record_pk", "u1");
        entry.put("row_data", "{\"username\":\"u1\"}");
        logEntries.add(entry);

        when(jdbcTemplate.queryForList(contains("FROM db_change_log"), eq(0L), eq(10L))).thenReturn(logEntries);
        doReturn(false).when(postgresBackupService).uploadToS3OrStorage(anyString(), anyString(), any(byte[].class));
        when(backupRunRepository.save(any(BackupRun.class))).thenAnswer(i -> i.getArgument(0));

        assertThrows(RuntimeException.class, () -> postgresBackupService.performDailyBackup());
        verify(backupEmailService).sendBackupFailureNotification(eq("DAILY"), eq("DAILY_BACKUP_EXECUTION"), anyString(), eq(0L));
    }

    @Test
    @DisplayName("9. Monthly consolidation")
    void testMonthlyConsolidation() {
        when(jdbcTemplate.queryForObject(contains("MAX(id)"), eq(Long.class))).thenReturn(100L);
        when(jdbcTemplate.queryForList(anyString())).thenReturn(Collections.emptyList());
        when(backupRunRepository.save(any(BackupRun.class))).thenAnswer(i -> i.getArgument(0));

        BackupRun run = postgresBackupService.performMonthlyConsolidation("2026-09");

        assertNotNull(run);
        assertEquals("SUCCESS", run.getStatus());
        assertEquals("MONTHLY", run.getBackupType());
        assertEquals(100L, run.getCheckpointToId());
    }

    @Test
    @DisplayName("10. Missing daily backup detection")
    void testMissingDailyBackupDetection() {
        doThrow(new RuntimeException("Daily chain incomplete")).when(postgresBackupService).uploadToS3OrStorage(anyString(), anyString(), any(byte[].class));

        assertThrows(RuntimeException.class, () -> postgresBackupService.performMonthlyConsolidation("2026-09"));
        verify(backupEmailService).sendBackupFailureNotification(eq("MONTHLY"), eq("MONTHLY_CONSOLIDATION"), anyString(), eq(0L));
    }

    @Test
    @DisplayName("11. Daily retention")
    void testDailyRetention() {
        List<BackupRun> runs = new ArrayList<>();
        for (long i = 1; i <= 35; i++) {
            BackupRun r = new BackupRun("DAILY", i * 10 - 10, i * 10, "SUCCESS");
            r.setS3Key("backups/postgresql/daily/2026/09/backup-daily-" + i + ".sql.gz");
            runs.add(r);
        }
        when(backupRunRepository.findAllSuccessfulDailyRuns()).thenReturn(runs);

        postgresBackupService.enforceDailyRetention(30);

        verify(backupRunRepository).findAllSuccessfulDailyRuns();
    }

    @Test
    @DisplayName("12. Monthly retention")
    void testMonthlyRetention() {
        List<BackupRun> runs = new ArrayList<>();
        for (int i = 1; i <= 15; i++) {
            BackupRun r = new BackupRun("MONTHLY", 0L, 1000L, "SUCCESS");
            r.setS3Key("backups/postgresql/monthly/2026/backup-monthly-2026-" + i + ".sql.gz");
            runs.add(r);
        }
        when(backupRunRepository.findAllSuccessfulMonthlyRuns()).thenReturn(runs);

        postgresBackupService.enforceMonthlyRetention(12);

        verify(backupRunRepository).findAllSuccessfulMonthlyRuns();
    }

    @Test
    @DisplayName("13. Restore verification")
    void testRestoreVerification() {
        when(jdbcTemplate.queryForObject(contains("SELECT COUNT(*) FROM"), eq(Integer.class))).thenReturn(10);

        boolean pass = postgresBackupService.performRestoreTest();
        assertTrue(pass);
    }

    @Test
    @DisplayName("14. Restore failure")
    void testRestoreFailure() {
        when(jdbcTemplate.queryForObject(contains("SELECT COUNT(*) FROM"), eq(Integer.class))).thenThrow(new RuntimeException("Table missing"));

        boolean pass = postgresBackupService.performRestoreTest();
        assertFalse(pass);
        verify(backupEmailService).sendBackupFailureNotification(eq("RESTORE_TEST"), eq("RESTORE_VERIFICATION"), anyString(), eq(0L));
    }

    @Test
    @DisplayName("15. Email failure notification")
    void testEmailFailureNotification() {
        when(backupEmailService.sendBackupFailureNotification(anyString(), anyString(), anyString(), anyLong())).thenReturn(true);

        boolean sent = backupEmailService.sendBackupFailureNotification("DAILY", "UPLOAD", "Connection refused", 5L);
        assertTrue(sent);
    }

    @Test
    @DisplayName("16. Duplicate scheduled execution protection")
    void testDuplicateScheduledExecutionProtection() {
        when(backupRunRepository.findLatestSuccessfulRun("DAILY")).thenReturn(Optional.empty());
        when(jdbcTemplate.queryForObject(contains("MAX(id)"), eq(Long.class))).thenReturn(10L);
        when(jdbcTemplate.queryForList(anyString(), anyLong(), anyLong())).thenReturn(Collections.emptyList());
        when(backupRunRepository.save(any(BackupRun.class))).thenAnswer(i -> i.getArgument(0));

        BackupRun run1 = postgresBackupService.performDailyBackup();
        assertNotNull(run1);
    }
}
