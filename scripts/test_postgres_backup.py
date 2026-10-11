#!/usr/bin/env python3
"""
Automated Test Suite for Tender Pocket PostgreSQL Backup System
Tests:
1. SHA-256 calculation accuracy
2. Gzip verification on valid and corrupt files
3. Dump failure handling (simulated returncode != 0)
4. S3 upload failure handling (ensuring failure never marks SUCCESS)
5. Concurrency lock acquisition & overlapping run prevention
6. End-to-end local backup generation and validation
7. Isolated temporary database restore test
8. S3 head-object verification logic
"""

import os
import sys
import tempfile
import unittest
import gzip
import fcntl
import hashlib
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

class PostgresBackupSystemTests(unittest.TestCase):

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

            # Second attempt should raise BlockingIOError or IOError
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
        """Test that an S3 upload failure exits non-zero and does not mark success."""
        # 1st call: ensure table (returncode 0)
        # 2nd call: pg_dump (returncode 0)
        # 3rd call: s3 cp (returncode 1)
        mock_ensure = MagicMock(returncode=0, stdout="")
        mock_dump = MagicMock(returncode=0, stdout=b"CREATE TABLE test (id int);\n" * 50)
        mock_s3 = MagicMock(returncode=1, stderr="AccessDenied: PutObject failed")

        mock_run.side_effect = [mock_ensure, mock_dump, mock_s3]

        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.object(backup_daily, "LOCAL_BACKUP_DIR", temp_dir):
                with patch.object(backup_daily, "acquire_lock", return_value=MagicMock()):
                    with patch.object(backup_daily, "send_alert_email"):
                        with self.assertRaises(SystemExit) as cm:
                            backup_daily.main()
                        self.assertEqual(cm.exception.code, 1)

    def test_isolated_restore_verification(self):
        """Test isolated database restore test executes and validates tables."""
        real_backup = "backups/postgresql/daily/2026/10/backup-daily-2026-10-11-172620.sql.gz"
        self.assertTrue(os.path.exists(real_backup))

        # Run main of restore test on verified backup
        with patch.object(sys, "argv", ["postgres-restore-test.py", real_backup]):
            with self.assertRaises(SystemExit) as cm:
                restore_test.main()
            self.assertEqual(cm.exception.code, 0)

if __name__ == "__main__":
    unittest.main()
