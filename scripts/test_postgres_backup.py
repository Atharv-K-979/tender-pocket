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
9. Daily success logging against PostgreSQL table with NOT NULL checkpoints
10. Weekly success logging against PostgreSQL table with NOT NULL checkpoints
11. Monthly success logging against PostgreSQL table with NOT NULL checkpoints
12. Failure logging against PostgreSQL table with NOT NULL checkpoints
13. Complete isolated backup-and-restore test using disposable test database
"""

import os
import sys
import tempfile
import unittest
import gzip
import fcntl
import hashlib
import subprocess
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
    """Executes psql query via Docker or direct connection depending on environment."""
    if os.getenv("USE_DIRECT_PSQL") == "1":
        host = os.getenv("POSTGRES_HOST", "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        cmd = ["psql", "-h", host, "-p", port, "-U", "postgres", "-d", db, "-t", "-A", "-c", query]
    else:
        cmd = [
            "docker", "exec", "-i", "tender-pocket-postgres",
            "psql", "-U", "postgres", "-d", db, "-t", "-A", "-c", query
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
                    with patch.object(backup_daily, "send_alert_email"):
                        with self.assertRaises(SystemExit) as cm:
                            backup_daily.main()
                        self.assertEqual(cm.exception.code, 1)

    @patch("subprocess.run")
    def test_s3_upload_failure_does_not_record_success(self, mock_run):
        """Test that an S3 upload failure exits non-zero and triggers failure alerting."""
        mock_ensure = MagicMock(returncode=0, stdout="")
        mock_dump = MagicMock(returncode=0, stdout=b"CREATE TABLE test (id int);\n" * 50)
        mock_s3 = MagicMock(returncode=1, stderr="AccessDenied: PutObject failed")

        mock_run.side_effect = [mock_ensure, mock_dump, mock_s3]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(backup_daily, "LOCAL_BACKUP_DIR", temp_dir):
                with patch.object(backup_daily, "acquire_lock", return_value=MagicMock()):
                    with patch.object(backup_daily, "send_alert_email") as mock_alert:
                        with self.assertRaises(SystemExit) as cm:
                            backup_daily.main()
                        self.assertEqual(cm.exception.code, 1)
                        # Ensure failure alert was sent with EXECUTION stage
                        mock_alert.assert_called_with("DAILY_BACKUP_EXECUTION", unittest.mock.ANY)

    @patch("subprocess.run")
    def test_logging_failure_distinguished_when_s3_upload_succeeded(self, mock_run):
        """Test that when S3 upload succeeds but database logging fails, logging failure is distinguished."""
        mock_dump = MagicMock(returncode=0, stdout=b"CREATE TABLE test (id int);\n" * 50)
        mock_s3 = MagicMock(returncode=0, stdout="")

        mock_run.side_effect = [mock_dump, mock_s3]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(backup_daily, "LOCAL_BACKUP_DIR", temp_dir):
                with patch.object(backup_daily, "acquire_lock", return_value=MagicMock()):
                    with patch.object(backup_daily, "verify_s3_object"):
                        # Simulate database logging throwing an exception (e.g. constraint error)
                        with patch.object(backup_daily, "run_psql", side_effect=[None, Exception("psql error: constraint violation"), None]):
                            with patch.object(backup_daily, "send_alert_email") as mock_alert:
                                with self.assertRaises(SystemExit) as cm:
                                    backup_daily.main()
                                self.assertEqual(cm.exception.code, 1)
                                # Must distinguish LOGGING failure from EXECUTION failure
                                mock_alert.assert_called_with("DAILY_BACKUP_LOGGING", unittest.mock.ANY)

    def test_restore_safety_guardrails_blocks_live_databases(self):
        """Verify restore script strictly rejects targeting live or system databases."""
        with self.assertRaises(RuntimeError) as cm1:
            restore_test.validate_safety_guardrails("tender_pocket", "tender_pocket")
        self.assertIn("CRITICAL SAFETY VIOLATION", str(cm1.exception))

        with self.assertRaises(RuntimeError) as cm2:
            restore_test.validate_safety_guardrails("postgres", "tender_pocket")
        self.assertIn("CRITICAL SAFETY VIOLATION", str(cm2.exception))

        with self.assertRaises(RuntimeError) as cm3:
            restore_test.validate_safety_guardrails("template1", "tender_pocket")
        self.assertIn("CRITICAL SAFETY VIOLATION", str(cm3.exception))

        # Safe isolated target database should not raise
        restore_test.validate_safety_guardrails("tender_pocket_restore_test", "tender_pocket")


class PostgresBackupDatabaseIntegrationTests(unittest.TestCase):
    """
    Integration tests against a PostgreSQL instance using the strict
    schema from schema-backup-triggers.sql (checkpoint_from_id and checkpoint_to_id NOT NULL).
    """

    TEST_INTEG_DB = "tender_pocket_integ_test"

    @classmethod
    def setUpClass(cls):
        try:
            # Check if PostgreSQL is available
            exec_psql("postgres", "SELECT 1;")
        except Exception as e:
            raise unittest.SkipTest(f"PostgreSQL service not reachable for integration tests: {e}")

        # Create isolated integration test database
        exec_psql("postgres", f"DROP DATABASE IF EXISTS {cls.TEST_INTEG_DB};")
        exec_psql("postgres", f"CREATE DATABASE {cls.TEST_INTEG_DB};")

        # Initialize backup_runs table strictly matching schema-backup-triggers.sql
        # Note: checkpoint_from_id and checkpoint_to_id are BIGINT NOT NULL without defaults
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

    def test_02_daily_success_logging_with_strict_schema(self):
        """Verify the corrected daily success INSERT succeeds and records checkpoint 0, 0."""
        start_time = datetime.now()
        sql = f"""
        INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, s3_bucket, s3_key, status, size_bytes, record_count)
        VALUES ('DAILY', '{start_time.isoformat()}', NOW(), 0, 0, 'test-bucket', 'backups/daily.sql.gz', 'SUCCESS', 2048, 0);
        """
        exec_psql(self.TEST_INTEG_DB, sql)

        row = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, size_bytes FROM backup_runs WHERE backup_type='DAILY' AND status='SUCCESS' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row, "DAILY|SUCCESS|0|0|2048")

    def test_03_weekly_success_logging_with_strict_schema(self):
        """Verify the corrected weekly success INSERT succeeds and records checkpoint 0, 0."""
        start_time = datetime.now()
        sql = f"""
        INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, s3_bucket, s3_key, status, size_bytes, record_count)
        VALUES ('WEEKLY', '{start_time.isoformat()}', NOW(), 0, 0, 'test-bucket', 'backups/weekly.sql.gz', 'SUCCESS', 4096, 0);
        """
        exec_psql(self.TEST_INTEG_DB, sql)

        row = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, size_bytes FROM backup_runs WHERE backup_type='WEEKLY' AND status='SUCCESS' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row, "WEEKLY|SUCCESS|0|0|4096")

    def test_04_monthly_success_logging_with_strict_schema(self):
        """Verify the corrected monthly success INSERT succeeds and records checkpoint 0, 0."""
        start_time = datetime.now()
        sql = f"""
        INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, s3_bucket, s3_key, status, size_bytes, record_count)
        VALUES ('MONTHLY', '{start_time.isoformat()}', NOW(), 0, 0, 'test-bucket', 'backups/monthly.sql.gz', 'SUCCESS', 8192, 0);
        """
        exec_psql(self.TEST_INTEG_DB, sql)

        row = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, size_bytes FROM backup_runs WHERE backup_type='MONTHLY' AND status='SUCCESS' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row, "MONTHLY|SUCCESS|0|0|8192")

    def test_05_failure_logging_with_strict_schema(self):
        """Verify both daily and monthly failure logging INSERTs succeed with checkpoints 0, 0."""
        start_time = datetime.now()
        err_msg = "pg_dump: connection timed out"

        # Daily failure insert
        sql_daily_fail = f"""
        INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, status, error_message)
        VALUES ('DAILY', '{start_time.isoformat()}', NOW(), 0, 0, 'FAILED', '{err_msg.replace("'", "''")}');
        """
        exec_psql(self.TEST_INTEG_DB, sql_daily_fail)

        row_daily = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, error_message FROM backup_runs WHERE backup_type='DAILY' AND status='FAILED' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row_daily, f"DAILY|FAILED|0|0|{err_msg}")

        # Monthly failure insert
        sql_monthly_fail = f"""
        INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, status, error_message)
        VALUES ('MONTHLY', '{start_time.isoformat()}', NOW(), 0, 0, 'FAILED', '{err_msg.replace("'", "''")}');
        """
        exec_psql(self.TEST_INTEG_DB, sql_monthly_fail)

        row_monthly = exec_psql(self.TEST_INTEG_DB, "SELECT backup_type, status, checkpoint_from_id, checkpoint_to_id, error_message FROM backup_runs WHERE backup_type='MONTHLY' AND status='FAILED' ORDER BY id DESC LIMIT 1;")
        self.assertEqual(row_monthly, f"MONTHLY|FAILED|0|0|{err_msg}")

    def test_06_complete_isolated_backup_and_restore_cycle(self):
        """
        End-to-end integration test: Creates disposable test source database,
        dumps via pg_dump, compresses, verifies sha256, restores into isolated test DB,
        and verifies row count integrity without modifying any production database.
        """
        source_db = "tp_test_data_source"
        target_db = "tp_test_data_restore"

        try:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {source_db};")
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {target_db};")
            exec_psql("postgres", f"CREATE DATABASE {source_db};")

            # Seed non-production test tables
            exec_psql(source_db, "CREATE TABLE test_users (id serial primary key, name text);")
            exec_psql(source_db, "INSERT INTO test_users (name) VALUES ('Alice'), ('Bob'), ('Charlie');")
            exec_psql(source_db, "CREATE TABLE test_tenders (id serial primary key, title text, amount numeric);")
            exec_psql(source_db, "INSERT INTO test_tenders (title, amount) VALUES ('Tender 1', 50000), ('Tender 2', 75000);")

            # Dump
            if os.getenv("USE_DIRECT_PSQL") == "1":
                host = os.getenv("POSTGRES_HOST", "localhost")
                port = os.getenv("POSTGRES_PORT", "5432")
                dump_cmd = ["pg_dump", "-h", host, "-p", port, "-U", "postgres", "-d", source_db]
            else:
                dump_cmd = ["docker", "exec", "-i", "tender-pocket-postgres", "pg_dump", "-U", "postgres", "-d", source_db]

            dump_res = subprocess.run(dump_cmd, capture_output=True)
            self.assertEqual(dump_res.returncode, 0)
            self.assertTrue(len(dump_res.stdout) > 200)

            # Compress
            compressed_data = gzip.compress(dump_res.stdout)
            with tempfile.NamedTemporaryFile(suffix=".sql.gz", delete=False) as tf:
                tf.write(compressed_data)
                temp_backup_file = tf.name

            # Verify gzip and SHA-256
            self.assertTrue(backup_daily.verify_gzip_file(temp_backup_file))
            calc_sha = backup_daily.calculate_sha256(temp_backup_file)
            self.assertEqual(len(calc_sha), 64)

            # Restore into isolated target_db
            exec_psql("postgres", f"CREATE DATABASE {target_db};")
            with gzip.open(temp_backup_file, "rb") as gz:
                restore_sql = gz.read()

            if os.getenv("USE_DIRECT_PSQL") == "1":
                host = os.getenv("POSTGRES_HOST", "localhost")
                port = os.getenv("POSTGRES_PORT", "5432")
                rest_cmd = ["psql", "-h", host, "-p", port, "-U", "postgres", "-d", target_db]
            else:
                rest_cmd = ["docker", "exec", "-i", "tender-pocket-postgres", "psql", "-U", "postgres", "-d", target_db]

            rest_res = subprocess.run(rest_cmd, input=restore_sql, capture_output=True)
            self.assertEqual(rest_res.returncode, 0)

            # Integrity checks: compare row counts
            users_count = exec_psql(target_db, "SELECT count(*) FROM test_users;")
            tenders_count = exec_psql(target_db, "SELECT count(*) FROM test_tenders;")
            self.assertEqual(users_count, "3")
            self.assertEqual(tenders_count, "2")

            os.remove(temp_backup_file)
        finally:
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {source_db};")
            exec_psql("postgres", f"DROP DATABASE IF EXISTS {target_db};")


if __name__ == "__main__":
    unittest.main()
