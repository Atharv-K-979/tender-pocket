#!/usr/bin/env python3
"""
Tender Pocket — Isolated PostgreSQL Restore Testing Script
Restores a verified full PostgreSQL backup into an isolated temporary test database
(tender_pocket_restore_test), runs integrity checks, verifies schema and row counts,
compares with active database, and cleans up.
"""

import os
import sys
import gzip
import smtplib
import subprocess
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

DB_CONTAINER = os.getenv("POSTGRES_CONTAINER_NAME", "tender-pocket-postgres")
DB_USER = os.getenv("POSTGRES_USER", "postgres")
SOURCE_DB = os.getenv("POSTGRES_DB", "tender_pocket")
TEST_DB = "tender_pocket_restore_test"
LOCAL_BACKUP_DIR = os.getenv("POSTGRES_BACKUP_LOCAL_DIR", "backups/postgresql")

SMTP_HOST = os.getenv("SPRING_MAIL_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SPRING_MAIL_PORT", "465"))
SMTP_USER = os.getenv("SPRING_MAIL_USERNAME", "")
SMTP_PASS = os.getenv("SPRING_MAIL_PASSWORD", "")
ALERT_EMAIL = os.getenv("BACKUP_ALERT_EMAIL", SMTP_USER if SMTP_USER else "admin@tenderpocket.com")

def validate_safety_guardrails(test_db_name, source_db_name):
    """Enforces safety guardrails ensuring test restore never targets or modifies live database."""
    protected_databases = {
        "tender_pocket",
        "postgres",
        "template0",
        "template1",
        source_db_name.strip().lower()
    }
    target = test_db_name.strip().lower()
    if target in protected_databases or target == source_db_name.strip().lower():
        raise RuntimeError(
            f"CRITICAL SAFETY VIOLATION: Isolated restore test cannot drop, recreate, or modify "
            f"protected database '{test_db_name}' (source live database: '{source_db_name}')."
        )

def run_psql(db, query):
    if os.getenv("USE_DIRECT_PSQL") == "1":
        host = os.getenv("POSTGRES_HOST", "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        cmd = ["psql", "-h", host, "-p", port, "-U", DB_USER, "-d", db, "-t", "-A", "-c", query]
    else:
        cmd = [
            "docker", "exec", "-i", DB_CONTAINER,
            "psql", "-U", DB_USER, "-d", db, "-t", "-A", "-c", query
        ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"psql error on {db}: {res.stderr.strip()}")
    return res.stdout.strip()

def find_latest_backup():
    """Finds the most recent local .sql.gz backup."""
    candidates = []
    for root, dirs, files in os.walk(LOCAL_BACKUP_DIR):
        for file in files:
            if file.endswith(".sql.gz") and not file.endswith(".tmp"):
                path = os.path.join(root, file)
                candidates.append((os.path.getmtime(path), path))
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]

def send_alert_email(stage, error_msg):
    subject = "[Tender Pocket] PostgreSQL Restore Verification FAILED"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    body = f"""
==================================================
POSTGRESQL RESTORE VERIFICATION FAILURE ALERT
==================================================
Timestamp: {timestamp}
Failure Stage: {stage}
Error Details: {error_msg}

RECOMMENDED ACTION:
Inspect backup artifacts for corruption or missing schema definitions.
==================================================
"""
    print(f"================ EMAIL ALERT ================\n{body}\n=============================================")
    if not SMTP_USER or not SMTP_PASS:
        return

    try:
        msg = MIMEMultipart()
        msg["From"] = SMTP_USER
        msg["To"] = ALERT_EMAIL
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))

        server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT)
        server.login(SMTP_USER, SMTP_PASS)
        server.sendmail(SMTP_USER, [ALERT_EMAIL], msg.as_string())
        server.quit()
        print(f"[✓] Restore failure alert email sent to {ALERT_EMAIL}")
    except Exception as e:
        print(f"[!] Failed to send alert email: {e}")

def main():
    backup_file = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else None
    if not backup_file:
        backup_file = find_latest_backup()

    if not backup_file or not os.path.exists(backup_file):
        print(f"[❌] No backup file provided or found to restore: {backup_file}")
        sys.exit(1)

    print(f"[*] Starting Isolated PostgreSQL Restore Verification Test using: {backup_file}")

    try:
        # Enforce safety guardrail against live database
        validate_safety_guardrails(TEST_DB, SOURCE_DB)

        # 1. Ensure test database is clean and recreate
        run_psql("postgres", f"DROP DATABASE IF EXISTS {TEST_DB};")
        run_psql("postgres", f"CREATE DATABASE {TEST_DB};")
        print(f"[✓] Isolated test database '{TEST_DB}' created.")

        # 2. Decompress and pipe dump into test DB
        print(f"[*] Decompressing and restoring {backup_file} into {TEST_DB}...")
        with gzip.open(backup_file, "rb") as gz_in:
            decompressed_sql = gz_in.read()

        if os.getenv("USE_DIRECT_PSQL") == "1":
            host = os.getenv("POSTGRES_HOST", "localhost")
            port = os.getenv("POSTGRES_PORT", "5432")
            restore_cmd = ["psql", "-h", host, "-p", port, "-U", DB_USER, "-d", TEST_DB]
        else:
            restore_cmd = [
                "docker", "exec", "-i", DB_CONTAINER,
                "psql", "-U", DB_USER, "-d", TEST_DB
            ]
        restore_proc = subprocess.run(restore_cmd, input=decompressed_sql, capture_output=True)

        if restore_proc.returncode != 0:
            err_msg = restore_proc.stderr.decode("utf-8", errors="ignore").strip()
            raise Exception(f"Database restore failed with exit code {restore_proc.returncode}: {err_msg}")

        print("[✓] Backup dump successfully applied to isolated test database.")

        # 3. Validate required business tables
        required_tables = [
            "users", "user_signatures", "tenders", "activity_log",
            "status_history", "tender_approval_requests", "tender_comments",
            "tender_workflow_comments", "email_notification_logs"
        ]

        missing_tables = []
        for t in required_tables:
            res = run_psql(TEST_DB, f"SELECT COUNT(*) FROM information_schema.tables WHERE table_name='{t}' AND table_schema='public';")
            if res != "1":
                missing_tables.append(t)

        if missing_tables:
            raise Exception(f"Schema validation failed: Missing required tables in restored DB: {missing_tables}")

        print(f"[✓] Schema Validation: All {len(required_tables)} business tables exist in restored database.")

        # 4. Compare non-sensitive aggregate checks with source DB
        source_user_cnt = run_psql(SOURCE_DB, "SELECT COUNT(*) FROM users;")
        restored_user_cnt = run_psql(TEST_DB, "SELECT COUNT(*) FROM users;")
        source_tender_cnt = run_psql(SOURCE_DB, "SELECT COUNT(*) FROM tenders;")
        restored_tender_cnt = run_psql(TEST_DB, "SELECT COUNT(*) FROM tenders;")

        print(f"[✓] Integrity Counts Check:")
        print(f"    Users   — Source: {source_user_cnt} | Restored: {restored_user_cnt}")
        print(f"    Tenders — Source: {source_tender_cnt} | Restored: {restored_tender_cnt}")

        is_strict = "--strict" in sys.argv
        if is_strict:
            if source_user_cnt != restored_user_cnt:
                raise Exception(f"Strict count mismatch on 'users': source {source_user_cnt} != restored {restored_user_cnt}")
            if source_tender_cnt != restored_tender_cnt:
                raise Exception(f"Strict count mismatch on 'tenders': source {source_tender_cnt} != restored {restored_tender_cnt}")
        else:
            if int(restored_user_cnt) == 0:
                raise Exception(f"Restored 'users' table is unexpectedly empty (0 records)")
            if int(restored_tender_cnt) == 0:
                raise Exception(f"Restored 'tenders' table is unexpectedly empty (0 records)")
            if int(restored_user_cnt) > int(source_user_cnt):
                raise Exception(f"Integrity anomaly on 'users': restored ({restored_user_cnt}) exceeds source ({source_user_cnt})")
            if int(restored_tender_cnt) > int(source_tender_cnt):
                raise Exception(f"Integrity anomaly on 'tenders': restored ({restored_tender_cnt}) exceeds source ({source_tender_cnt})")

        # 5. Clean up temporary test database
        run_psql("postgres", f"DROP DATABASE IF EXISTS {TEST_DB};")
        print(f"[✓] Destroyed isolated test database '{TEST_DB}'.")

        print("==================================================")
        print("RESTORE VERIFICATION TEST: PASSED")
        print(f"Verified Backup: {os.path.basename(backup_file)}")
        print("==================================================")
        sys.exit(0)

    except Exception as e:
        err_msg = str(e)
        print(f"[❌] RESTORE VERIFICATION FAILED: {err_msg}")
        try:
            run_psql("postgres", f"DROP DATABASE IF EXISTS {TEST_DB};")
        except Exception:
            pass
        send_alert_email("RESTORE_VERIFICATION", err_msg)
        sys.exit(1)

if __name__ == "__main__":
    main()
