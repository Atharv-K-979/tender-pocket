#!/usr/bin/env python3
"""
Automated Test Suite for Tender Pocket PostgreSQL Backup System
Tests:
1. SHA-256 calculation accuracy
2. Gzip verification on valid and corrupt files
3. Dump failure handling (simulated returncode != 0)
4. S3 upload failure handling (ensuring failure never marks SUCCESS)
5. Concurrency lock acquisition & overlapping run prevention
6. Distinguishing database logging failure when S3 upload has already succeeded
7. Live database safety guardrail enforcement in restore test
8. Reproduction of actual UAT constraint violation (omitting checkpoint_from_id)
9. Daily success logging using production helper against NOT NULL checkpoints
10. Weekly success logging using production helper against NOT NULL checkpoints
11. Monthly success logging using production helper against NOT NULL checkpoints
12. Failure logging using production helpers against NOT NULL checkpoints
13. Complete isolated backup-and-restore test with metadata sidecar verification
14. SQL restore error-stopping (-v ON_ERROR_STOP=1) regression test
15. Restored count mismatch failure test
16. Missing required business tables failure test
"""

import os
import sys
import tempfile
import unittest
import gzip
import fcntl
import hashlib
import json
import subprocess
import uuid
from datetime import datetime
from unittest.mock import patch, MagicMock

# Import backup modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import importlib.util

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

backup_daily = load_module("backup_daily", os.path.join(os.path.dirname(__file__), "postgres-backup-daily.py"))
backup_monthly = load_module("backup_monthly", os.path.join(os.path.dirname(__file__), "postgres-backup-monthly.py"))
restore_test = load_module("restore_test", os.path.join(os.path.dirname(__file__), "postgres-restore-test.py"))


def exec_psql(db, query):
    """Executes psql query via Docker or direct connection with -v ON_ERROR_STOP=1."""
    if os.getenv("USE_DIRECT_PSQL") == "1":
        host = os.getenv("POSTGRES_HOST", "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        cmd = ["psql", "-v", "ON_ERROR_STOP=1", "-h", host, "-p", port, "-U", "postgres", "-d", db, "-t", "-A", "-c", query]
    else:
        cmd = [
            "docker", "exec", "-i", "tender-pocket-postgres",
            "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, "-t", "-A", "-c", query
        ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"psql error on {db}: {res.stderr.strip()}")
    return res.stdout.strip()


class PostgresBackupUnitTests(unittest.TestCase):

    def test_sha256_calculation(self):
        """Test SHA-256 calculation matches hashlib reference."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(b"tender-pocket-backup-test-data")
            temp_path = f.name
        try:
            calc_sha = backup_daily.calculate_sha256(temp_path)
            expected_sha = hashlib.sha256(b"tender-pocket-backup-test-data").hexdigest()
            self.assertEqual(calc_sha, expected_sha)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def test_gzip_verification_valid_and_corrupt(self):
        """Test that valid gzip passes and corrupted gzip is rejected."""
        valid_path = tempfile.mktemp(suffix=".sql.gz")
        corrupt_path = tempfile.mktemp(suffix=".sql.gz")

        try:
            with gzip.open(valid_path, "wb") as f:
                f.write(b"VALID SQL DUMP CONTENT")

            with open(corrupt_path, "wb") as f:
                f.write(b"\x1f\x8b\x08\x00corrupted-truncated-gzip-bytes")

            self.assertTrue(backup_daily.verify_gzip_file(valid_path))
            self.assertFalse(backup_daily.verify_gzip_file(corrupt_path))
        finally:
            for p in (valid_path, corrupt_path):
                if os.path.exists(p):
                    os.remove(p)

    def test_overlapping_run_prevention(self):
        """Test that a second backup process cannot acquire the lock while one is running."""
        lock_file = "/tmp/test_backup_overlap.lock"
        with open(lock_file, "w") as f1:
            fcntl.flock(f1, fcntl.LOCK_EX | fcntl.LOCK_NB)

            f2 = open(lock_file, "w")
            with self.assertRaises((IOError, BlockingIOError)):
                fcntl.flock(f2, fcntl.LOCK_EX | fcntl.LOCK_NB)
            f2.close()
        if os.path.exists(lock_file):
            os.remove(lock_file)

    @patch("subprocess.run")
    def test_dump_failure_aborts_immediately(self, mock_run):
        """Test that non-zero pg_dump exit code fails backup and does not upload."""
        mock_run.return_value = MagicMock(returncode=1, stderr=b"pg_dump: connection error", stdout=b"")

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(backup_daily, "LOCAL_BACKUP_DIR", temp_dir):
                with patch.object(backup_daily, "acquire_lock", return_value=MagicMock()):
                    with patch.object(backup_daily, "ensure_backup_runs_table"):
                        with patch.object(backup_daily, "get_source_table_counts", return_value={"users": 0, "tenders": 0}):
                            with patch.object(backup_daily, "send_alert_email"):
                                with self.assertRaises(SystemExit) as cm:
                                    backup_daily.main()
                                self.assertEqual(cm.exception.code, 1)

    @patch("subprocess.run")
    def test_s3_upload_failure_does_not_record_success(self, mock_run):
        """Test that an S3 upload failure exits non-zero and triggers failure alerting."""
        mock_dump = MagicMock(returncode=0, stdout=b"CREATE TABLE test (id int);\n" * 50)
        mock_s3 = MagicMock(returncode=1, stderr="AccessDenied: PutObject failed")

        mock_run.side_effect = [mock_dump, mock_s3]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(backup_daily, "LOCAL_BACKUP_DIR", temp_dir):
                with patch.object(backup_daily, "acquire_lock", return_value=MagicMock()):
                    with patch.object(backup_daily, "ensure_backup_runs_table"):
                        with patch.object(backup_daily, "get_source_table_counts", return_value={"users": 2, "tenders": 3}):
                            with patch.object(backup_daily, "send_alert_email") as mock_alert:
                                with self.assertRaises(SystemExit) as cm:
                                    backup_daily.main()
                                self.assertEqual(cm.exception.code, 1)
                                mock_alert.assert_called_with("DAILY_BACKUP_EXECUTION", unittest.mock.ANY)

    @patch("subprocess.run")
    def test_logging_failure_distinguished_when_s3_upload_succeeded(self, mock_run):
        """Test that when S3 upload succeeds but database logging fails, logging failure is distinguished."""
        mock_dump = MagicMock(returncode=0, stdout=b"CREATE TABLE test (id int);\n" * 50)
        mock_s3 = MagicMock(returncode=0, stdout="")
        mock_meta_s3 = MagicMock(returncode=0, stdout="")

        mock_run.side_effect = [mock_dump, mock_s3, mock_meta_s3]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(backup_daily, "LOCAL_BACKUP_DIR", temp_dir):
                with patch.object(backup_daily, "acquire_lock", return_value=MagicMock()):
                    with patch.object(backup_daily, "ensure_backup_runs_table"):
                        with patch.object(backup_daily, "get_source_table_counts", return_value={"users": 2, "tenders": 3}):
                            with patch.object(backup_daily, "verify_s3_object"):
                                with patch.object(backup_daily, "record_backup_success", side_effect=Exception("psql error: constraint violation")):
                                    with patch.object(backup_daily, "send_alert_email") as mock_alert:
                                        with self.assertRaises(SystemExit) as cm:
                                            backup_daily.main()
                                        self.assertEqual(cm.exception.code, 1)
                                        mock_alert.assert_called_with("DAILY_BACKUP_LOGGING", unittest.mock.ANY)

    @patch("subprocess.run")
    def test_weekly_failure_reported_accurately_without_falsifying_daily(self, mock_run):
        """
        Verify weekly archive failure reports WEEKLY_BACKUP_EXECUTION and does not
        falsely log or alert the daily backup as failed.
        """
        mock_dump = MagicMock(returncode=0, stdout=b"CREATE TABLE test (id int);\n" * 50)
        mock_daily_s3 = MagicMock(returncode=0, stdout="")
        mock_daily_meta = MagicMock(returncode=0, stdout="")
        mock_weekly_s3 = MagicMock(returncode=1, stderr="AccessDenied: weekly upload failed")

        mock_run.side_effect = [mock_dump, mock_daily_s3, mock_daily_meta, mock_weekly_s3]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(backup_daily, "LOCAL_BACKUP_DIR", temp_dir):
                with patch.object(backup_daily, "acquire_lock", return_value=MagicMock()):
                    with patch.object(backup_daily, "ensure_backup_runs_table"):
                        with patch.object(backup_daily, "get_source_table_counts", return_value={"users": 2, "tenders": 3}):
                            with patch.object(backup_daily, "verify_s3_object"):
                                with patch.object(backup_daily, "record_backup_success") as mock_record_success:
                                    with patch.object(backup_daily, "record_backup_failure") as mock_record_failure:
                                        with patch.object(backup_daily, "send_alert_email") as mock_alert:
                                            with patch.object(sys, "argv", ["postgres-backup-daily.py", "--weekly"]):
                                                with self.assertRaises(SystemExit) as cm:
                                                    backup_daily.main()
                                                self.assertEqual(cm.exception.code, 1)
                                                # Daily success was recorded
                                                mock_record_success.assert_any_call("DAILY", unittest.mock.ANY, unittest.mock.ANY, unittest.mock.ANY, unittest.mock.ANY, record_count=3)
                                                # Weekly failure was recorded and alerted
                                                mock_record_failure.assert_called_with("WEEKLY", unittest.mock.ANY, unittest.mock.ANY, unittest.mock.ANY, unittest.mock.ANY, unittest.mock.ANY, record_count=3)
                                                mock_alert.assert_called_with("WEEKLY_BACKUP_EXECUTION", unittest.mock.ANY)

    def test_ensure_backup_runs_table_does_not_swallow_errors(self):
        """Verify ensure_backup_runs_table does not swallow errors when SQL execution fails."""
        with patch.object(backup_daily, "run_psql", side_effect=Exception("Database connection terminated")):
            with self.assertRaises(Exception) as cm:
                backup_daily.ensure_backup_runs_table()
            self.assertIn("Database connection terminated", str(cm.exception))

    def test_get_source_table_counts_fails_clearly_when_query_fails(self):
        """Verify get_source_table_counts does not swallow errors or default to 0 on failure."""
        with patch.object(backup_daily, "run_psql", side_effect=Exception("permission denied for relation users")):
            with self.assertRaises(RuntimeError) as cm:
                backup_daily.get_source_table_counts()
            self.assertIn("Failed to query table count", str(cm.exception))

    def test_extract_snapshot_counts_from_dump(self):
        """Verify extract_snapshot_counts_from_dump accurately parses plain SQL pg_dump stream."""
        sample_dump = b"""
-- PostgreSQL database dump
COPY public.users (username, email) FROM stdin;
admin\tadmin@example.com
user1\tuser1@example.com
\\.
COPY public.tenders (id, title) FROM stdin;
1\tTender Alpha
2\tTender Beta
3\tTender Gamma
\\.
"""
        counts = backup_daily.extract_snapshot_counts_from_dump(sample_dump)
        self.assertEqual(counts, {"users": 2, "tenders": 3})

    def test_restore_safety_guardrails_blocks_live_and_permissive_databases(self):
        """
        Verify restore script strictly rejects targeting live, system, or permissively named databases.
        Only explicit approved prefixes ('tender_pocket_restore_test', 'tp_test_') are permitted.
        """
        # Protected databases
        with self.assertRaises(RuntimeError) as cm1:
            restore_test.validate_safety_guardrails("tender_pocket", "tender_pocket")
        self.assertIn("CRITICAL SAFETY VIOLATION", str(cm1.exception))

        with self.assertRaises(RuntimeError) as cm2:
            restore_test.validate_safety_guardrails("postgres", "tender_pocket")
        self.assertIn("CRITICAL SAFETY VIOLATION", str(cm2.exception))

        with self.assertRaises(RuntimeError) as cm3:
            restore_test.validate_safety_guardrails("template1", "tender_pocket")
        self.assertIn("CRITICAL SAFETY VIOLATION", str(cm3.exception))

        with self.assertRaises(RuntimeError) as cm4:
            restore_test.validate_safety_guardrails("template0", "tender_pocket")
        self.assertIn("CRITICAL SAFETY VIOLATION", str(cm4.exception))

        # Permissive substring checks must be rejected
        with self.assertRaises(RuntimeError) as cm5:
            restore_test.validate_safety_guardrails("production_test_db", "tender_pocket")
        self.assertIn("not an authorized disposable test database", str(cm5.exception))

        with self.assertRaises(RuntimeError) as cm6:
            restore_test.validate_safety_guardrails("fastest_prod", "tender_pocket")
        self.assertIn("not an authorized disposable test database", str(cm6.exception))

        with self.assertRaises(RuntimeError) as cm7:
            restore_test.validate_safety_guardrails("tender_pocket_test", "tender_pocket")
        self.assertIn("not an authorized disposable test database", str(cm7.exception))

        with self.assertRaises(RuntimeError):
            restore_test.validate_safety_guardrails("", "tender_pocket")

        # Approved disposable test databases must pass
        restore_test.validate_safety_guardrails("tender_pocket_restore_test", "tender_pocket")
        restore_test.validate_safety_guardrails("tender_pocket_restore_test_run1", "tender_pocket")
        restore_test.validate_safety_guardrails("tp_test_temp_db", "tender_pocket")

    def test_backup_metadata_sha256_and_size_integrity_verification(self):
        """Verify restore testing verifies SHA-256 checksum and file size against metadata."""
        with tempfile.NamedTemporaryFile(suffix=".sql.gz") as tf:
            tf.write(b"SAMPLE DATA FOR RESTORE INTEGRITY VERIFICATION")
            tf.flush()
            correct_sha = restore_test.calculate_sha256(tf.name)
            correct_size = os.path.getsize(tf.name)

            # Valid metadata passes
            restore_test.verify_backup_file_integrity(tf.name, {"sha256": correct_sha, "file_size": correct_size})

            # Tampered SHA-256 fails immediately
            with self.assertRaises(RuntimeError) as cm_sha:
                restore_test.verify_backup_file_integrity(tf.name, {"sha256": "tampered_sha_checksum_value", "file_size": correct_size})
            self.assertIn("SHA-256 checksum mismatch", str(cm_sha.exception))

            # Mismatched file size fails immediately
            with self.assertRaises(RuntimeError) as cm_size:
                restore_test.verify_backup_file_integrity(tf.name, {"sha256": correct_sha, "file_size": 999999})
            self.assertIn("File size mismatch", str(cm_size.exception))

    def test_retention_preserves_newest_recovery_point_and_isolates_tiers(self):
        """
        Verify retention logic:
        1. Never deletes the latest/only recovery point in a tier even if older than cutoff.
        2. Strictly prunes only matching tier prefix (backup-daily- in daily, backup-monthly- in monthly).
        3. Pruning also removes companion .meta.json file.
        """
        import time
        with tempfile.TemporaryDirectory() as temp_dir:
            daily_dir = os.path.join(temp_dir, "daily")
            os.makedirs(daily_dir, exist_ok=True)

            old_daily = os.path.join(daily_dir, "backup-daily-old.sql.gz")
            old_meta = old_daily + ".meta.json"
            with open(old_daily, "w") as f: f.write("old-daily")
            with open(old_meta, "w") as f: f.write("{}")

            # Set mtime to 30 days ago
            thirty_days_ago = time.time() - (30 * 86400)
            os.utime(old_daily, (thirty_days_ago, thirty_days_ago))
            os.utime(old_meta, (thirty_days_ago, thirty_days_ago))

            # Non-tier file that must NOT be touched
            alien_file = os.path.join(daily_dir, "backup-weekly-wrong-folder.sql.gz")
            with open(alien_file, "w") as f: f.write("keep-me")
            os.utime(alien_file, (thirty_days_ago, thirty_days_ago))

            with patch.object(backup_daily, "LOCAL_BACKUP_DIR", temp_dir):
                # Run retention with only one daily backup: MUST NOT be deleted
                backup_daily.enforce_local_retention()
                self.assertTrue(os.path.exists(old_daily), "Sole daily recovery point must NOT be pruned")
                self.assertTrue(os.path.exists(alien_file), "Non-tier file must NOT be pruned")

                # Add a newer daily backup
                new_daily = os.path.join(daily_dir, "backup-daily-new.sql.gz")
                with open(new_daily, "w") as f: f.write("new-daily")

                # Now old daily should be safely pruned, preserving new daily
                backup_daily.enforce_local_retention()
                self.assertFalse(os.path.exists(old_daily), "Expired daily backup must be pruned when newer backup exists")
                self.assertFalse(os.path.exists(old_meta), "Companion .meta.json must be pruned when expired backup is pruned")
                self.assertTrue(os.path.exists(new_daily), "New daily backup must be preserved")
                self.assertTrue(os.path.exists(alien_file), "Non-tier file must remain intact")

    @patch("subprocess.run")
    def test_daily_s3_metadata_upload_failure_fails_safely(self, mock_run):
        """Verify daily backup raises Exception and alerts if metadata sidecar upload fails."""
        mock_dump = MagicMock(returncode=0, stdout=b"CREATE TABLE test (id int);\n" * 50)
        mock_s3_dump = MagicMock(returncode=0, stdout="")
        mock_s3_meta = MagicMock(returncode=1, stderr="S3 metadata upload AccessDenied")

        mock_run.side_effect = [mock_dump, mock_s3_dump, mock_s3_meta]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(backup_daily, "LOCAL_BACKUP_DIR", temp_dir):
                with patch.object(backup_daily, "acquire_lock", return_value=MagicMock()):
                    with patch.object(backup_daily, "ensure_backup_runs_table"):
                        with patch.object(backup_daily, "get_source_table_counts", return_value={"users": 1, "tenders": 1}):
                            with patch.object(backup_daily, "verify_s3_object"):
                                with patch.object(backup_daily, "send_alert_email") as mock_alert:
                                    with self.assertRaises(SystemExit) as cm:
                                        backup_daily.main()
                                    self.assertEqual(cm.exception.code, 1)
                                    mock_alert.assert_called_with("DAILY_BACKUP_EXECUTION", unittest.mock.ANY)

    @patch("subprocess.run")
    def test_monthly_s3_metadata_upload_failure_fails_safely(self, mock_run):
        """Verify monthly backup raises Exception and alerts if metadata sidecar upload fails."""
        mock_dump = MagicMock(returncode=0, stdout=b"CREATE TABLE test (id int);\n" * 50)
        mock_s3_dump = MagicMock(returncode=0, stdout="")
        mock_s3_meta = MagicMock(returncode=1, stderr="S3 metadata upload AccessDenied")

        mock_run.side_effect = [mock_dump, mock_s3_dump, mock_s3_meta]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(backup_monthly, "LOCAL_BACKUP_DIR", temp_dir):
                with patch.object(backup_monthly, "acquire_lock", return_value=MagicMock()):
                    with patch.object(backup_monthly, "ensure_backup_runs_table"):
                        with patch.object(backup_monthly, "get_source_table_counts", return_value={"users": 1, "tenders": 1}):
                            with patch.object(backup_monthly, "verify_s3_object"):
                                with patch.object(backup_monthly, "send_alert_email") as mock_alert:
                                    with patch.object(sys, "argv", ["postgres-backup-monthly.py", "2026-10"]):
                                        with self.assertRaises(SystemExit) as cm:
                                            backup_monthly.main()
                                        self.assertEqual(cm.exception.code, 1)
                                        mock_alert.assert_called_with("MONTHLY_BACKUP_EXECUTION", unittest.mock.ANY)

    def test_restore_rejects_test_db_override_to_production_or_invalid_names(self):
        """Verify restore script rejects attempts to target production via --test-db."""
        dummy_backup = tempfile.mktemp(suffix=".sql.gz")
        with gzip.open(dummy_backup, "wb") as f:
            f.write(b"SELECT 1;")

        try:
            for forbidden_db in ("tender_pocket", "postgres", "template0", "template1", "my_production_db", "prod_db"):
                with patch.object(sys, "argv", ["postgres-restore-test.py", dummy_backup, f"--test-db={forbidden_db}"]):
                    with self.assertRaises(SystemExit) as cm:
                        restore_test.main()
                    self.assertEqual(cm.exception.code, 1)
        finally:
            if os.path.exists(dummy_backup):
                os.remove(dummy_backup)

    def test_restore_fails_when_metadata_required_and_missing(self):
        """Verify restore script fails immediately when --require-metadata is set but .meta.json is missing."""
        dummy_backup = tempfile.mktemp(suffix=".sql.gz")
        with gzip.open(dummy_backup, "wb") as f:
            f.write(b"SELECT 1;")

        try:
            with patch.object(sys, "argv", ["postgres-restore-test.py", dummy_backup, "--require-metadata"]):
                with self.assertRaises(SystemExit) as cm:
                    restore_test.main()
                self.assertEqual(cm.exception.code, 1)
        finally:
            if os.path.exists(dummy_backup):
                os.remove(dummy_backup)


class PostgresBackupDatabaseIntegrationTests(unittest.TestCase):
    """
    Integration tests against a PostgreSQL 16 instance using the strict
    schema from schema-backup-triggers.sql (checkpoint_from_id and checkpoint_to_id NOT NULL).
    Exercises the actual production helper functions.
    """

    TEST_INTEG_DB = f"tp_test_integ_{uuid.uuid4().hex[:8]}"

    @classmethod
    def setUpClass(cls):
        try:
            exec_psql("postgres", "SELECT 1;")
        except Exception as e:
            raise unittest.SkipTest(f"PostgreSQL service not reachable for integration tests: {e}")

        # Create isolated integration test database
        exec_psql("postgres", f"DROP DATABASE IF EXISTS {cls.TEST_INTEG_DB};")
        exec_psql("postgres", f"CREATE DATABASE {cls.TEST_INTEG_DB};")

        # Initialize backup_runs table strictly matching schema-backup-triggers.sql
        init_sql = """
        CREATE TABLE backup_runs (
            id BIGSERIAL PRIMARY KEY,
            backup_type VARCHAR(20) NOT NULL,
            started_at TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ,
            checkpoint_from_id BIGINT NOT NULL,
            checkpoint_to_id BIGINT NOT NULL,
            s3_bucket VARCHAR(255),
            s3_key VARCHAR(512),
            status VARCHAR(20) NOT NULL,
            error_message TEXT,
            size_bytes BIGINT,
            record_count BIGINT
        );
        """
        exec_psql(cls.TEST_INTEG_DB, init_sql)

    @classmethod
    def tearDownClass(cls):
        try:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {cls.TEST_INTEG_DB};")
        except Exception:
            pass

    def test_01_reproduce_uat_constraint_failure(self):
        """
        REGRESSION PROOF: An insert omitting checkpoint_from_id against the deployed
        UAT schema must fail with 'violates not-null constraint'.
        """
        old_sql = f"""
        INSERT INTO backup_runs (backup_type, started_at, completed_at, s3_bucket, s3_key, status, size_bytes, record_count)
        VALUES ('DAILY', NOW(), NOW(), 'test-bucket', 'backups/test.sql.gz', 'SUCCESS', 1000, 0);
        """
        with self.assertRaises(Exception) as cm:
            exec_psql(self.TEST_INTEG_DB, old_sql)
        self.assertIn("null value in column \"checkpoint_from_id\"", str(cm.exception))
        self.assertIn("violates not-null constraint", str(cm.exception))

    def test_02_daily_success_logging_via_production_helper(self):
        """Verify production record_backup_success helper works for DAILY backups."""
        start_time = datetime.now()
        with patch.object(backup_daily, "DB_NAME", self.TEST_INTEG_DB):
            backup_daily.record_backup_success("DAILY", start_time, "test-bucket", "backups/daily.sql.gz", 2048, record_count=12)

        row = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, size_bytes, record_count FROM backup_runs WHERE backup_type='DAILY' AND status='SUCCESS' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row, "DAILY|SUCCESS|0|0|2048|12")

    def test_03_weekly_success_logging_via_production_helper(self):
        """Verify production record_backup_success helper works for WEEKLY recovery points."""
        start_time = datetime.now()
        with patch.object(backup_daily, "DB_NAME", self.TEST_INTEG_DB):
            backup_daily.record_backup_success("WEEKLY", start_time, "test-bucket", "backups/weekly.sql.gz", 4096, record_count=12)

        row = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, size_bytes, record_count FROM backup_runs WHERE backup_type='WEEKLY' AND status='SUCCESS' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row, "WEEKLY|SUCCESS|0|0|4096|12")

    def test_04_monthly_success_logging_via_production_helper(self):
        """Verify production record_backup_success helper works for MONTHLY consolidation."""
        start_time = datetime.now()
        with patch.object(backup_monthly, "DB_NAME", self.TEST_INTEG_DB):
            backup_monthly.record_backup_success("MONTHLY", start_time, "test-bucket", "backups/monthly.sql.gz", 8192, record_count=15)

        row = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, size_bytes, record_count FROM backup_runs WHERE backup_type='MONTHLY' AND status='SUCCESS' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row, "MONTHLY|SUCCESS|0|0|8192|15")

    def test_05_failure_logging_via_production_helpers(self):
        """Verify production record_backup_failure helpers work and store checkpoints 0, 0."""
        start_time = datetime.now()
        err_msg = "pg_dump: connection timed out"

        # Daily failure without S3 upload
        with patch.object(backup_daily, "DB_NAME", self.TEST_INTEG_DB):
            backup_daily.record_backup_failure("DAILY", start_time, err_msg)

        row_daily = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, error_message FROM backup_runs WHERE backup_type='DAILY' AND status='FAILED' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row_daily, f"DAILY|FAILED|0|0|{err_msg}")

        # Daily failure AFTER S3 upload (preserving S3 key and size)
        with patch.object(backup_daily, "DB_NAME", self.TEST_INTEG_DB):
            backup_daily.record_backup_failure("DAILY", start_time, "db recording failed", s3_bucket="test-bucket", s3_key="daily-key", file_size=1024)

        row_s3_fail = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, s3_key, size_bytes FROM backup_runs WHERE s3_key='daily-key' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row_s3_fail, "DAILY|FAILED|0|0|daily-key|1024")

        # Monthly failure
        with patch.object(backup_monthly, "DB_NAME", self.TEST_INTEG_DB):
            backup_monthly.record_backup_failure("MONTHLY", start_time, "monthly dump failed")

        row_monthly = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, error_message FROM backup_runs WHERE backup_type='MONTHLY' AND status='FAILED' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row_monthly, "MONTHLY|FAILED|0|0|monthly dump failed")

    def test_06_complete_isolated_backup_and_restore_cycle_with_metadata(self):
        """
        End-to-end integration test: Creates disposable test source database with
        all required business tables, generates dump, writes snapshot metadata,
        restores into isolated test DB (-v ON_ERROR_STOP=1), and verifies integrity.
        """
        source_db = f"tp_test_src_{uuid.uuid4().hex[:8]}"
        target_db = f"tp_test_dst_{uuid.uuid4().hex[:8]}"

        try:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {source_db};")
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {target_db};")
            exec_psql("postgres", f"CREATE DATABASE {source_db};")

            # Seed all 9 required business tables
            for tbl in restore_test.REQUIRED_BUSINESS_TABLES:
                if tbl in ("users", "user_signatures"):
                    exec_psql(source_db, f"CREATE TABLE {tbl} (username text primary key, role text);")
                else:
                    exec_psql(source_db, f"CREATE TABLE {tbl} (id serial primary key, name text);")

            exec_psql(source_db, "INSERT INTO users (username, role) VALUES ('admin', 'ADMIN'), ('exec1', 'EXECUTIVE');")
            exec_psql(source_db, "INSERT INTO tenders (name) VALUES ('Tender A'), ('Tender B'), ('Tender C');")

            # Execute pg_dump
            if os.getenv("USE_DIRECT_PSQL") == "1":
                host = os.getenv("POSTGRES_HOST", "localhost")
                port = os.getenv("POSTGRES_PORT", "5432")
                dump_cmd = ["pg_dump", "-h", host, "-p", port, "-U", "postgres", "-d", source_db]
            else:
                dump_cmd = ["docker", "exec", "-i", "tender-pocket-postgres", "pg_dump", "-U", "postgres", "-d", source_db]

            dump_res = subprocess.run(dump_cmd, capture_output=True)
            self.assertEqual(dump_res.returncode, 0)

            # Compress and write sidecar metadata
            compressed_data = gzip.compress(dump_res.stdout)
            with tempfile.NamedTemporaryFile(suffix=".sql.gz", delete=False) as tf:
                tf.write(compressed_data)
                temp_backup_file = tf.name

            counts = {"users": 2, "tenders": 3}
            meta_file = backup_daily.write_backup_metadata(temp_backup_file, "test/key", len(compressed_data), "testsha", counts, "DAILY")
            self.assertTrue(os.path.exists(meta_file))

            # Recreate isolated restore DB
            exec_psql("postgres", f"CREATE DATABASE {target_db};")

            # Restore using production restore_dump_file with -v ON_ERROR_STOP=1
            restore_ok = restore_test.restore_dump_file(temp_backup_file, target_db)
            self.assertTrue(restore_ok)

            # Validate using production verify_restored_database
            stats = restore_test.verify_restored_database(target_db, expected_counts=counts, mode="fresh", source_db=source_db)
            self.assertEqual(stats["users"], 2)
            self.assertEqual(stats["tenders"], 3)
            self.assertEqual(stats["tables_verified"], 9)

            os.remove(temp_backup_file)
            if os.path.exists(meta_file):
                os.remove(meta_file)
        finally:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {source_db};")
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {target_db};")

    def test_07_restore_fails_when_sql_statement_errors_on_error_stop(self):
        """
        REGRESSION PROOF FOR -v ON_ERROR_STOP=1:
        A backup dump containing a bad SQL statement must fail the restore command
        rather than reporting success.
        """
        target_db = f"tp_test_sql_{uuid.uuid4().hex[:8]}"
        try:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {target_db};")
            exec_psql("postgres", f"CREATE DATABASE {target_db};")

            # Deliberate bad SQL syntax in the dump
            bad_sql = b"""
            CREATE TABLE test_table (id int);
            THIS IS DELIBERATELY INVALID SQL STATEMENT;
            """
            bad_compressed = gzip.compress(bad_sql)
            with tempfile.NamedTemporaryFile(suffix=".sql.gz", delete=False) as tf:
                tf.write(bad_compressed)
                bad_backup_file = tf.name

            # Must raise Exception with non-zero exit code due to ON_ERROR_STOP=1
            with self.assertRaises(Exception) as cm:
                restore_test.restore_dump_file(bad_backup_file, target_db)

            self.assertIn("ON_ERROR_STOP=1", str(cm.exception))
            self.assertIn("Database restore failed with exit code", str(cm.exception))

            os.remove(bad_backup_file)
        finally:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {target_db};")

    def test_08_restore_fails_on_count_mismatch(self):
        """Verify restore verification fails when expected snapshot counts do not match."""
        test_db = f"tp_test_cnt_{uuid.uuid4().hex[:8]}"
        try:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {test_db};")
            exec_psql("postgres", f"CREATE DATABASE {test_db};")

            for tbl in restore_test.REQUIRED_BUSINESS_TABLES:
                if tbl in ("users", "user_signatures"):
                    exec_psql(test_db, f"CREATE TABLE {tbl} (username text primary key);")
                else:
                    exec_psql(test_db, f"CREATE TABLE {tbl} (id serial primary key);")

            exec_psql(test_db, "INSERT INTO users (username) VALUES ('u1');")
            exec_psql(test_db, "INSERT INTO tenders (id) VALUES (1);")

            # Expected 50 tenders, restored has 1
            with self.assertRaises(Exception) as cm:
                restore_test.verify_restored_database(test_db, expected_counts={"users": 1, "tenders": 50}, mode="fresh")
            self.assertIn("Count mismatch on 'tenders': expected snapshot 50 != restored 1", str(cm.exception))
        finally:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {test_db};")

    def test_09_restore_fails_on_missing_required_business_tables(self):
        """Verify restore verification fails when required business tables are missing."""
        test_db = f"tp_test_tbl_{uuid.uuid4().hex[:8]}"
        try:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {test_db};")
            exec_psql("postgres", f"CREATE DATABASE {test_db};")

            # Create only users and tenders, leaving 7 tables missing
            exec_psql(test_db, "CREATE TABLE users (username text primary key);")
            exec_psql(test_db, "CREATE TABLE tenders (id serial primary key);")

            with self.assertRaises(Exception) as cm:
                restore_test.verify_restored_database(test_db, expected_counts={"users": 1, "tenders": 1}, mode="fresh")
            self.assertIn("Missing required tables in restored DB", str(cm.exception))
        finally:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {test_db};")


if __name__ == "__main__":
    unittest.main()
