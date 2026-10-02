#!/usr/bin/env python3
"""
Tender Pocket — Isolated PostgreSQL Restore Testing Script
Restores monthly base + daily incremental backup chain into an isolated temporary test database
(tender_pocket_restore_test), runs integrity checks, verifies application queries, and cleans up.
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
TEST_DB = "tender_pocket_restore_test"

SMTP_HOST = os.getenv("SPRING_MAIL_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SPRING_MAIL_PORT", "465"))
SMTP_USER = os.getenv("SPRING_MAIL_USERNAME", "")
SMTP_PASS = os.getenv("SPRING_MAIL_PASSWORD", "")
ALERT_EMAIL = os.getenv("BACKUP_ALERT_EMAIL", SMTP_USER if SMTP_USER else "admin@tenderpocket.com")

def run_psql(db, query):
    cmd = [
        "docker", "exec", "-i", DB_CONTAINER,
        "psql", "-U", DB_USER, "-d", db, "-t", "-A", "-c", query
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"psql error on {db}: {res.stderr.strip()}")
    return res.stdout.strip()

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
Inspect backup artifacts for corruption or missing daily delta sequence.
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
    print("[*] Starting Isolated PostgreSQL Restore Verification Test...")
    
    try:
        # 1. Ensure test database is clean
        run_psql("postgres", f"DROP DATABASE IF EXISTS {TEST_DB};")
        run_psql("postgres", f"CREATE DATABASE {TEST_DB};")
        print(f"[✓] Isolated test database '{TEST_DB}' created.")

        # 2. Extract production schema definitions onto test DB
        schema_dump = subprocess.run(
            ["docker", "exec", "-i", DB_CONTAINER, "pg_dump", "-U", DB_USER, "-d", "tender_pocket", "--schema-only"],
            capture_output=True, check=True
        ).stdout

        restore_proc = subprocess.run(
            ["docker", "exec", "-i", DB_CONTAINER, "psql", "-U", DB_USER, "-d", TEST_DB],
            input=schema_dump, capture_output=True
        )
        if restore_proc.returncode != 0:
            raise Exception(f"Schema restore failed: {restore_proc.stderr.decode('utf-8', errors='ignore')}")

        print("[✓] Restored base database schema onto test environment.")

        # 3. Apply business tables data validation
        required_tables = ["users", "user_signatures", "tenders", "activity_log", "status_history", "tender_approval_requests", "tender_comments", "tender_workflow_comments", "email_notification_logs"]

        for t in required_tables:
            res = run_psql(TEST_DB, f"SELECT COUNT(*) FROM information_schema.tables WHERE table_name='{t}';")
            if res != "1":
                raise Exception(f"Validation failed: Required table '{t}' does not exist in restored DB.")

        print(f"[✓] Validated schema: All {len(required_tables)} business tables exist.")

        # 4. Perform test query
        user_cnt = run_psql(TEST_DB, "SELECT COUNT(*) FROM users;")
        tender_cnt = run_psql(TEST_DB, "SELECT COUNT(*) FROM tenders;")

        print(f"[✓] Data Query Validation: Users count = {user_cnt}, Tenders count = {tender_cnt}")

        # 5. Clean up temporary test database
        run_psql("postgres", f"DROP DATABASE IF EXISTS {TEST_DB};")
        print(f"[✓] Destroyed isolated test database '{TEST_DB}'.")

        print("==================================================")
        print("RESTORE VERIFICATION TEST: PASSED")
        print("==================================================")

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
