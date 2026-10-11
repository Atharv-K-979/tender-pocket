#!/usr/bin/env python3
"""
Tender Pocket — Standalone PostgreSQL Daily Backup Script
Takes a complete, restorable PostgreSQL dump via pg_dump, compresses it with gzip,
verifies integrity and SHA-256 checksum, uploads to dedicated S3 bucket,
optionally archives a weekly recovery point on Sundays, verifies S3 upload,
records run state in backup_runs, enforces local retention (14d daily, 8w weekly),
and alerts on failure.
"""

import os
import sys
import fcntl
import gzip
import hashlib
import json
import smtplib
import subprocess
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

LOCK_FILE = "/tmp/tender_pocket_pg_backup_daily.lock"
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
        print("[!] Another daily backup instance is already running. Exiting.")
        sys.exit(1)

def run_psql(query):
    """Executes a query against the PostgreSQL database."""
    cmd = [
        "docker", "exec", "-i", DB_CONTAINER,
        "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A", "-c", query
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"psql error: {res.stderr.strip()}")
    return res.stdout.strip()

def ensure_backup_runs_table():
    """Ensures the backup_runs table exists for tracking execution state."""
    create_sql = """
    CREATE TABLE IF NOT EXISTS backup_runs (
        id BIGSERIAL PRIMARY KEY,
        backup_type VARCHAR(20) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        checkpoint_from_id BIGINT DEFAULT 0,
        checkpoint_to_id BIGINT DEFAULT 0,
        s3_bucket VARCHAR(255),
        s3_key VARCHAR(512),
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        size_bytes BIGINT,
        record_count BIGINT
    );
    """
    try:
        run_psql(create_sql)
    except Exception as e:
        print(f"[!] Warning: Could not verify/create backup_runs table: {e}")

def calculate_sha256(filepath):
    """Calculates SHA-256 checksum of a file."""
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(65536), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def verify_gzip_file(filepath):
    """Verifies that a gzip file is valid and readable."""
    try:
        with gzip.open(filepath, "rb") as f:
            while f.read(65536):
                pass
        return True
    except Exception as e:
        print(f"[❌] Gzip verification failed for {filepath}: {e}")
        return False

def verify_s3_object(bucket, key, expected_size):
    """Verifies that an uploaded object exists in S3 and matches expected size."""
    cmd = ["aws", "s3api", "head-object", "--bucket", bucket, "--key", key]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"S3 head-object verification failed for s3://{bucket}/{key}: {res.stderr.strip()}")
    try:
        meta = json.loads(res.stdout)
        remote_size = meta.get("ContentLength", 0)
        if remote_size != expected_size:
            raise Exception(f"S3 size mismatch for s3://{bucket}/{key}: expected {expected_size}, got {remote_size}")
        return True
    except json.JSONDecodeError:
        raise Exception(f"Failed to parse S3 head-object response for s3://{bucket}/{key}")

def enforce_local_retention():
    """Retains daily backups for 14 days and weekly backups for 56 days (8 weeks)."""
    now = datetime.now()
    daily_cutoff = now - timedelta(days=14)
    weekly_cutoff = now - timedelta(days=56)

    daily_base = os.path.join(LOCAL_BACKUP_DIR, "daily")
    weekly_base = os.path.join(LOCAL_BACKUP_DIR, "weekly")

    # Clean daily backups older than 14 days
    if os.path.exists(daily_base):
        for root, dirs, files in os.walk(daily_base):
            for file in files:
                if file.startswith("backup-daily-") and file.endswith(".sql.gz"):
                    file_path = os.path.join(root, file)
                    try:
                        mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
                        if mtime < daily_cutoff:
                            os.remove(file_path)
                            print(f"[✓] Local retention: Removed aged daily backup {file_path}")
                    except Exception as e:
                        print(f"[!] Warning cleaning {file_path}: {e}")

    # Clean weekly backups older than 56 days
    if os.path.exists(weekly_base):
        for root, dirs, files in os.walk(weekly_base):
            for file in files:
                if file.startswith("backup-weekly-") and file.endswith(".sql.gz"):
                    file_path = os.path.join(root, file)
                    try:
                        mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
                        if mtime < weekly_cutoff:
                            os.remove(file_path)
                            print(f"[✓] Local retention: Removed aged weekly backup {file_path}")
                    except Exception as e:
                        print(f"[!] Warning cleaning {file_path}: {e}")

def send_alert_email(stage, error_msg):
    subject = "[Tender Pocket] PostgreSQL Backup FAILED"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    body = f"""
==================================================
POSTGRESQL DAILY BACKUP FAILURE ALERT
==================================================
Timestamp: {timestamp}
Failure Stage: {stage}
Error Details: {error_msg}

RECOMMENDED ACTION:
Inspect PostgreSQL logs, disk space, and S3 bucket permissions.
Backup run was marked FAILED.
==================================================
"""
    print(f"================ EMAIL ALERT ================\n{body}\n=============================================")
    if not SMTP_USER or not SMTP_PASS:
        print("[!] SMTP credentials not configured. Email logged to console.")
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
        print(f"[✓] Alert email sent to {ALERT_EMAIL}")
    except Exception as e:
        print(f"[!] Failed to send alert email: {e}")

def main():
    lock_fd = acquire_lock()
    start_time = datetime.now()
    now_str = start_time.strftime("%Y-%m-%d-%H%M%S")
    date_folder = start_time.strftime("%Y/%m")

    # Output file paths
    filename = f"backup-daily-{now_str}.sql.gz"
    s3_key = f"backups/postgresql/daily/{date_folder}/{filename}"
    local_path = os.path.join(LOCAL_BACKUP_DIR, "daily", date_folder, filename)
    temp_path = local_path + ".tmp"

    try:
        print(f"[*] Starting PostgreSQL Full Daily Backup for Tender Pocket ({now_str})...")
        ensure_backup_runs_table()

        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        # 1. Execute full pg_dump
        dump_cmd = [
            "docker", "exec", "-i", DB_CONTAINER,
            "pg_dump", "-U", DB_USER, "-d", DB_NAME,
            "--clean", "--if-exists", "--no-owner", "--no-privileges"
        ]
        print(f"[*] Executing pg_dump on container '{DB_CONTAINER}'...")
        dump_proc = subprocess.run(dump_cmd, capture_output=True)

        if dump_proc.returncode != 0:
            err_output = dump_proc.stderr.decode("utf-8", errors="ignore").strip()
            raise Exception(f"pg_dump execution failed with returncode {dump_proc.returncode}: {err_output}")

        raw_sql = dump_proc.stdout
        if not raw_sql or len(raw_sql) < 100:
            raise Exception("pg_dump generated empty or suspiciously small output (< 100 bytes)")

        # 2. Compress with gzip and write to temp file
        print(f"[*] Compressing {len(raw_sql)} bytes of SQL dump with gzip...")
        compressed = gzip.compress(raw_sql, compresslevel=9)
        with open(temp_path, "wb") as f:
            f.write(compressed)

        # 3. Verify gzip integrity
        if not verify_gzip_file(temp_path):
            raise Exception("Generated backup failed gzip integrity verification")

        # Atomically rename to final local path
        os.replace(temp_path, local_path)
        file_size = os.path.getsize(local_path)
        sha256_checksum = calculate_sha256(local_path)

        print(f"[✓] Daily backup created successfully: {local_path}")
        print(f"    Size: {file_size} bytes ({file_size / 1024:.2f} KB)")
        print(f"    SHA-256: {sha256_checksum}")

        # 4. Upload to S3
        print(f"[*] Uploading to s3://{S3_BUCKET}/{s3_key}...")
        aws_cmd = ["aws", "s3", "cp", local_path, f"s3://{S3_BUCKET}/{s3_key}"]
        upload_proc = subprocess.run(aws_cmd, capture_output=True, text=True)

        if upload_proc.returncode != 0:
            raise Exception(f"AWS S3 upload failed (code {upload_proc.returncode}): {upload_proc.stderr.strip()}")

        # 5. Verify upload in S3 via head-object
        print("[*] Verifying S3 object existence and size...")
        verify_s3_object(S3_BUCKET, s3_key, file_size)
        print(f"[✓] S3 upload verified: s3://{S3_BUCKET}/{s3_key} ({file_size} bytes)")

        # 6. Weekly recovery point: On Sundays (weekday == 6), archive a weekly copy
        # This reuses the exact verified daily dump without generating an extra database dump.
        is_sunday = start_time.weekday() == 6
        force_weekly = "--weekly" in sys.argv
        if is_sunday or force_weekly:
            week_date = start_time.strftime("%Y-%m-%d")
            weekly_year = start_time.strftime("%Y")
            weekly_filename = f"backup-weekly-{week_date}.sql.gz"
            weekly_s3_key = f"backups/postgresql/weekly/{weekly_year}/{weekly_filename}"
            weekly_local_path = os.path.join(LOCAL_BACKUP_DIR, "weekly", weekly_year, weekly_filename)

            os.makedirs(os.path.dirname(weekly_local_path), exist_ok=True)
            with open(local_path, "rb") as src, open(weekly_local_path, "wb") as dst:
                dst.write(src.read())

            print(f"[*] Archiving weekly recovery point to s3://{S3_BUCKET}/{weekly_s3_key}...")
            weekly_upload = subprocess.run(["aws", "s3", "cp", weekly_local_path, f"s3://{S3_BUCKET}/{weekly_s3_key}"], capture_output=True, text=True)
            if weekly_upload.returncode == 0:
                verify_s3_object(S3_BUCKET, weekly_s3_key, file_size)
                print(f"[✓] Weekly recovery point archived: s3://{S3_BUCKET}/{weekly_s3_key}")
                run_psql(f"INSERT INTO backup_runs (backup_type, started_at, completed_at, s3_bucket, s3_key, status, size_bytes) VALUES ('WEEKLY', NOW(), NOW(), '{S3_BUCKET}', '{weekly_s3_key}', 'SUCCESS', {file_size});")
            else:
                print(f"[!] Warning: Weekly copy upload failed: {weekly_upload.stderr.strip()}")

        # 7. Record SUCCESS in backup_runs
        ins_success = f"""
        INSERT INTO backup_runs (backup_type, started_at, completed_at, s3_bucket, s3_key, status, size_bytes, record_count)
        VALUES ('DAILY', '{start_time.isoformat()}', NOW(), '{S3_BUCKET}', '{s3_key}', 'SUCCESS', {file_size}, 0);
        """
        run_psql(ins_success)

        # 8. Local retention enforcement (14 days daily, 8 weeks weekly)
        enforce_local_retention()

        print(f"==================================================")
        print(f"[✓] DAILY BACKUP COMPLETED & VERIFIED: {filename}")
        print(f"    S3 Key : {s3_key}")
        print(f"    SHA-256: {sha256_checksum}")
        print(f"==================================================")
        sys.exit(0)

    except Exception as e:
        err_msg = str(e)
        print(f"[❌] DAILY BACKUP FAILED: {err_msg}")

        # Clean up temporary file if left behind
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

        try:
            ins_fail = f"""
            INSERT INTO backup_runs (backup_type, started_at, completed_at, status, error_message)
            VALUES ('DAILY', '{start_time.isoformat()}', NOW(), 'FAILED', '{err_msg.replace("'", "''")}');
            """
            run_psql(ins_fail)
        except Exception:
            pass

        send_alert_email("DAILY_BACKUP_EXECUTION", err_msg)
        sys.exit(1)

if __name__ == "__main__":
    main()
