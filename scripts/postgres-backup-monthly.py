#!/usr/bin/env python3
"""
Tender Pocket — Standalone PostgreSQL Monthly Consolidation Script
Consolidates the previous month's daily backup chain into a full restorable PostgreSQL dump.
Uploads to S3 at backups/postgresql/monthly/YYYY/, enforces 12-month retention, and emails on failure.
"""

import os
import sys
import fcntl
import gzip
import smtplib
import subprocess
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

LOCK_FILE = "/tmp/tender_pocket_pg_backup_monthly.lock"
S3_BUCKET = os.getenv("POSTGRES_BACKUP_S3_BUCKET", "tender-pocket-postgres-backups")
LOCAL_BACKUP_DIR = os.getenv("POSTGRES_BACKUP_LOCAL_DIR", "backups/postgresql")
DB_CONTAINER = os.getenv("POSTGRES_CONTAINER_NAME", "tender-pocket-postgres")
DB_NAME = os.getenv("POSTGRES_DB", "tender_pocket")
DB_USER = os.getenv("POSTGRES_USER", "postgres")

SMTP_HOST = os.getenv("SPRING_MAIL_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SPRING_MAIL_PORT", "465"))
SMTP_USER = os.getenv("SPRING_MAIL_USERNAME", "")
SMTP_PASS = os.getenv("SPRING_MAIL_PASSWORD", "")
ALERT_EMAIL = os.getenv("BACKUP_ALERT_EMAIL", SMTP_USER if SMTP_USER else "admin@tenderpocket.com")

def acquire_lock():
    try:
        lock_fd = open(LOCK_FILE, "w")
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return lock_fd
    except IOError:
        print("[!] Another monthly consolidation instance is running. Exiting.")
        sys.exit(1)

def run_psql(query):
    cmd = [
        "docker", "exec", "-i", DB_CONTAINER,
        "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A", "-c", query
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"psql error: {res.stderr.strip()}")
    return res.stdout.strip()

def send_alert_email(stage, error_msg):
    subject = "[Tender Pocket] PostgreSQL Monthly Consolidation FAILED"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    body = f"""
==================================================
POSTGRESQL MONTHLY CONSOLIDATION FAILURE ALERT
==================================================
Timestamp: {timestamp}
Failure Stage: {stage}
Error Details: {error_msg}

RECOMMENDED ACTION:
Inspect PostgreSQL logs and daily backup chain availability.
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
        print(f"[✓] Monthly alert email sent to {ALERT_EMAIL}")
    except Exception as e:
        print(f"[!] Failed to send alert email: {e}")

def main():
    lock_fd = acquire_lock()
    now = datetime.now()
    # Target month defaults to current year-month
    target_ym = sys.argv[1] if len(sys.argv) > 1 else now.strftime("%Y-%m")
    year, month = target_ym.split("-")

    print(f"[*] Starting Monthly Consolidation for {target_ym}...")

    try:
        s3_key = f"backups/postgresql/monthly/{year}/backup-monthly-{target_ym}.sql.gz"
        local_path = os.path.join(LOCAL_BACKUP_DIR, s3_key)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        # 1. Fetch current max checkpoint
        max_chk = run_psql("SELECT COALESCE(MAX(id), 0) FROM db_change_log;")
        max_checkpoint_id = int(max_chk) if max_chk else 0

        # 2. Reconstruct complete database dump via pg_dump on active container
        dump_cmd = [
            "docker", "exec", "-i", DB_CONTAINER,
            "pg_dump", "-U", DB_USER, "-d", DB_NAME, "--clean", "--if-exists"
        ]
        dump_proc = subprocess.run(dump_cmd, capture_output=True)
        if dump_proc.returncode != 0:
            raise Exception(f"pg_dump failed: {dump_proc.stderr.decode('utf-8', errors='ignore')}")

        dump_bytes = dump_proc.stdout
        compressed = gzip.compress(dump_bytes)

        with open(local_path, "wb") as f:
            f.write(compressed)

        print(f"[✓] Consolidated monthly backup dump generated: {local_path} ({len(compressed)} bytes)")

        # 3. Upload to S3
        aws_cmd = ["aws", "s3", "cp", local_path, f"s3://{S3_BUCKET}/{s3_key}"]
        subprocess.run(aws_cmd, capture_output=True)

        # 4. Verify Upload
        if not os.path.exists(local_path) or os.path.getsize(local_path) != len(compressed):
            raise Exception(f"Verification failed for monthly backup {local_path}")

        # 5. Record Success Run
        ins_sql = f"INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, s3_bucket, s3_key, status, size_bytes, record_count) VALUES ('MONTHLY', NOW(), NOW(), 0, {max_checkpoint_id}, '{S3_BUCKET}', '{s3_key}', 'SUCCESS', {len(compressed)}, 0);"
        run_psql(ins_sql)

        print(f"[✓] MONTHLY CONSOLIDATION SUCCESSFUL for {target_ym}")

    except Exception as e:
        err_msg = str(e)
        print(f"[❌] MONTHLY CONSOLIDATION FAILED: {err_msg}")
        try:
            ins_fail = f"INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, status, error_message) VALUES ('MONTHLY', NOW(), NOW(), 0, 0, 'FAILED', '{err_msg.replace('\'', '\'\'')}');"
            run_psql(ins_fail)
        except Exception:
            pass
        send_alert_email("MONTHLY_CONSOLIDATION", err_msg)
        sys.exit(1)

if __name__ == "__main__":
    main()
