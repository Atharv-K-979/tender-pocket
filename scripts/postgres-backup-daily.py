#!/usr/bin/env python3
"""
Tender Pocket — Standalone PostgreSQL Daily Backup Script
Takes a complete, restorable PostgreSQL dump via pg_dump, compresses it with gzip,
verifies integrity and SHA-256 checksum, uploads to dedicated S3 bucket,
optionally archives a weekly recovery point on Sundays, verifies S3 upload,
records run state in backup_runs, records snapshot verification metadata,
enforces local retention (14d daily, 8w weekly), and alerts on failure.
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
    """Executes a query against the PostgreSQL database with -v ON_ERROR_STOP=1."""
    if os.getenv("USE_DIRECT_PSQL") == "1":
        host = os.getenv("POSTGRES_HOST", "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        cmd = [
            "psql", "-v", "ON_ERROR_STOP=1",
            "-h", host, "-p", port, "-U", DB_USER, "-d", DB_NAME,
            "-t", "-A", "-c", query
        ]
    else:
        cmd = [
            "docker", "exec", "-i", DB_CONTAINER,
            "psql", "-v", "ON_ERROR_STOP=1",
            "-U", DB_USER, "-d", DB_NAME,
            "-t", "-A", "-c", query
        ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"psql error: {res.stderr.strip()}")
    return res.stdout.strip()

def ensure_backup_runs_table():
    """Ensures the backup_runs table exists for tracking execution state. Does not silently swallow errors."""
    create_sql = """
    CREATE TABLE IF NOT EXISTS backup_runs (
        id BIGSERIAL PRIMARY KEY,
        backup_type VARCHAR(20) NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ,
        checkpoint_from_id BIGINT NOT NULL DEFAULT 0,
        checkpoint_to_id BIGINT NOT NULL DEFAULT 0,
        s3_bucket VARCHAR(255),
        s3_key VARCHAR(512),
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        size_bytes BIGINT,
        record_count BIGINT
    );
    """
    res = run_psql(create_sql)
    return res

def record_backup_success(backup_type, start_time, s3_bucket, s3_key, file_size, record_count=0):
    """
    Records a SUCCESS run in backup_runs.
    For full snapshots (DAILY, WEEKLY), checkpoint_from_id=0 and checkpoint_to_id=0
    satisfy NOT NULL constraints while denoting non-incremental backups.
    """
    ins_sql = f"""
    INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, s3_bucket, s3_key, status, size_bytes, record_count)
    VALUES ('{backup_type}', '{start_time.isoformat()}', NOW(), 0, 0, '{s3_bucket}', '{s3_key}', 'SUCCESS', {file_size}, {record_count});
    """
    return run_psql(ins_sql)

def record_backup_failure(backup_type, start_time, err_msg, s3_bucket=None, s3_key=None, file_size=None, record_count=0):
    """
    Records a FAILED run in backup_runs.
    Populates checkpoint_from_id=0, checkpoint_to_id=0 to satisfy NOT NULL constraints.
    Preserves S3 bucket/key/size if upload succeeded before logging/retention failure.
    """
    escaped_err = str(err_msg).replace("'", "''")
    if s3_bucket and s3_key and file_size is not None:
        ins_sql = f"""
        INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, s3_bucket, s3_key, status, error_message, size_bytes, record_count)
        VALUES ('{backup_type}', '{start_time.isoformat()}', NOW(), 0, 0, '{s3_bucket}', '{s3_key}', 'FAILED', '{escaped_err}', {file_size}, {record_count});
        """
    else:
        ins_sql = f"""
        INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, status, error_message)
        VALUES ('{backup_type}', '{start_time.isoformat()}', NOW(), 0, 0, 'FAILED', '{escaped_err}');
        """
    return run_psql(ins_sql)

def get_source_table_counts():
    """
    Queries current counts of business tables to record backup snapshot metadata.
    Fails clearly if any query fails, rather than silently defaulting to zero.
    """
    counts = {}
    for tbl in ("users", "tenders"):
        try:
            res = run_psql(f"SELECT COUNT(*) FROM {tbl};")
            counts[tbl] = int(res.strip())
        except Exception as e:
            raise RuntimeError(f"Failed to query table count for '{tbl}': {e}")
    return counts

def extract_snapshot_counts_from_dump(raw_sql):
    """
    Parses table row counts directly from the pg_dump SQL stream (COPY public.<table> ... \\.).
    This guarantees that the recorded counts reflect the exact point-in-time snapshot
    captured in the backup dump, avoiding race conditions from concurrent modifications.
    """
    counts = {}
    target_tables = {"users", "tenders"}
    current_table = None
    table_lines = {tbl: 0 for tbl in target_tables}
    found_tables = set()

    for line in raw_sql.splitlines():
        if line.startswith(b"COPY public.") or line.startswith(b"COPY "):
            parts = line.split()
            if len(parts) >= 2:
                tbl_part = parts[1].decode("utf-8", errors="ignore").replace('"', '')
                if tbl_part.startswith("public."):
                    tbl_name = tbl_part.split(".", 1)[1]
                else:
                    tbl_name = tbl_part
                if tbl_name in target_tables:
                    current_table = tbl_name
                    found_tables.add(tbl_name)
                    continue
        elif current_table:
            if line.strip() == b"\\.":
                current_table = None
            else:
                table_lines[current_table] += 1

    for tbl in target_tables:
        if tbl in found_tables:
            counts[tbl] = table_lines[tbl]

    return counts

def write_backup_metadata(local_path, s3_key, file_size, sha256_checksum, counts, backup_type):
    """Writes sidecar JSON metadata recording table counts at backup time."""
    meta_path = local_path + ".meta.json"
    meta = {
        "backup_type": backup_type,
        "backup_file": os.path.basename(local_path),
        "s3_key": s3_key,
        "file_size": file_size,
        "sha256": sha256_checksum,
        "created_at": datetime.now().isoformat(),
        "counts": counts
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    return meta_path

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
    """Verifies that the object exists in S3 and its size matches the local file."""
    cmd = ["aws", "s3api", "head-object", "--bucket", bucket, "--key", key]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"S3 head-object verification failed for s3://{bucket}/{key}: {res.stderr.strip()}")

    obj_metadata = json.loads(res.stdout)
    s3_size = obj_metadata.get("ContentLength")
    if s3_size != expected_size:
        raise Exception(f"S3 size mismatch for s3://{bucket}/{key}: expected {expected_size} bytes, got {s3_size} bytes")

def enforce_local_retention():
    """
    Removes daily backups older than 14 days and weekly backups older than 56 days (8 weeks).
    Safety invariants:
    1. Only removes files strictly matching the tier filename prefix (backup-daily-* in daily/, backup-weekly-* in weekly/).
    2. NEVER deletes the latest known-good local recovery point in either tier, preserving disaster recovery capability.
    """
    now = datetime.now()
    daily_cutoff = now - timedelta(days=14)
    weekly_cutoff = now - timedelta(days=56)

    # 1. Prune daily backups (keeping at least the newest known-good recovery point)
    daily_dir = os.path.join(LOCAL_BACKUP_DIR, "daily")
    if os.path.exists(daily_dir):
        daily_files = []
        for root, dirs, files in os.walk(daily_dir):
            for file in files:
                if file.startswith("backup-daily-") and file.endswith(".sql.gz") and not file.endswith(".tmp"):
                    p = os.path.join(root, file)
                    daily_files.append((os.path.getmtime(p), p))
        daily_files.sort(reverse=True)

        if len(daily_files) > 1:
            for mtime_ts, path in daily_files[1:]:
                mtime = datetime.fromtimestamp(mtime_ts)
                if mtime < daily_cutoff:
                    print(f"[*] Removing expired daily backup: {path}")
                    try:
                        os.remove(path)
                        meta_f = path + ".meta.json"
                        if os.path.exists(meta_f):
                            os.remove(meta_f)
                    except Exception as e:
                        print(f"[!] Warning: Could not remove {path}: {e}")

    # 2. Prune weekly backups (keeping at least the newest known-good recovery point)
    weekly_dir = os.path.join(LOCAL_BACKUP_DIR, "weekly")
    if os.path.exists(weekly_dir):
        weekly_files = []
        for root, dirs, files in os.walk(weekly_dir):
            for file in files:
                if file.startswith("backup-weekly-") and file.endswith(".sql.gz") and not file.endswith(".tmp"):
                    p = os.path.join(root, file)
                    weekly_files.append((os.path.getmtime(p), p))
        weekly_files.sort(reverse=True)

        if len(weekly_files) > 1:
            for mtime_ts, path in weekly_files[1:]:
                mtime = datetime.fromtimestamp(mtime_ts)
                if mtime < weekly_cutoff:
                    print(f"[*] Removing expired weekly backup: {path}")
                    try:
                        os.remove(path)
                        meta_f = path + ".meta.json"
                        if os.path.exists(meta_f):
                            os.remove(meta_f)
                    except Exception as e:
                        print(f"[!] Warning: Could not remove {path}: {e}")

def send_alert_email(stage, error_msg):
    subject = f"[Tender Pocket] PostgreSQL Daily Backup FAILED ({stage})"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    body = f"""
==================================================
POSTGRESQL DAILY BACKUP EXECUTION FAILURE ALERT
==================================================
Timestamp: {timestamp}
Failure Stage: {stage}
Error Details: {error_msg}

RECOMMENDED ACTION:
1. Check disk space on server.
2. Verify AWS IAM permissions on bucket: {S3_BUCKET}.
3. Inspect PostgreSQL container status: {DB_CONTAINER}.
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
    uploaded_to_s3 = False
    counts = {}

    try:
        print(f"[*] Starting PostgreSQL Full Daily Backup for Tender Pocket ({now_str})...")
        ensure_backup_runs_table()

        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        # 1. Execute full pg_dump
        if os.getenv("USE_DIRECT_PSQL") == "1":
            host = os.getenv("POSTGRES_HOST", "localhost")
            port = os.getenv("POSTGRES_PORT", "5432")
            dump_cmd = [
                "pg_dump", "-h", host, "-p", port, "-U", DB_USER, "-d", DB_NAME,
                "--clean", "--if-exists", "--no-owner", "--no-privileges"
            ]
            print(f"[*] Executing pg_dump on host '{host}:{port}'...")
        else:
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

        # 2. Extract snapshot table counts directly from dump for 100% point-in-time consistency
        dump_counts = extract_snapshot_counts_from_dump(raw_sql)
        if len(dump_counts) == 2:
            counts = dump_counts
            print(f"[*] Consistent point-in-time snapshot counts extracted from dump: {counts}")
        else:
            counts = get_source_table_counts()
            print(f"[*] Pre-backup snapshot counts queried from database: {counts}")

        # 3. Compress with gzip and write to temp file
        print(f"[*] Compressing {len(raw_sql)} bytes of SQL dump with gzip...")
        compressed = gzip.compress(raw_sql, compresslevel=9)
        with open(temp_path, "wb") as f:
            f.write(compressed)

        # 4. Verify gzip integrity
        if not verify_gzip_file(temp_path):
            raise Exception("Generated backup failed gzip integrity verification")

        # Atomically rename to final local path
        os.replace(temp_path, local_path)
        file_size = os.path.getsize(local_path)
        sha256_checksum = calculate_sha256(local_path)

        # Write sidecar snapshot verification metadata
        meta_path = write_backup_metadata(local_path, s3_key, file_size, sha256_checksum, counts, "DAILY")

        print(f"[✓] Daily backup created successfully: {local_path}")
        print(f"    Size: {file_size} bytes ({file_size / 1024:.2f} KB)")
        print(f"    SHA-256: {sha256_checksum}")

        # 5. Upload backup and metadata sidecar to S3
        print(f"[*] Uploading to s3://{S3_BUCKET}/{s3_key}...")
        aws_cmd = ["aws", "s3", "cp", local_path, f"s3://{S3_BUCKET}/{s3_key}"]
        upload_proc = subprocess.run(aws_cmd, capture_output=True, text=True)

        if upload_proc.returncode != 0:
            raise Exception(f"AWS S3 upload failed (code {upload_proc.returncode}): {upload_proc.stderr.strip()}")

        # Verify upload in S3 via head-object
        print("[*] Verifying S3 object existence and size...")
        verify_s3_object(S3_BUCKET, s3_key, file_size)

        # Upload metadata sidecar to S3 and verify
        meta_s3_key = f"{s3_key}.meta.json"
        meta_upload_proc = subprocess.run(["aws", "s3", "cp", meta_path, f"s3://{S3_BUCKET}/{meta_s3_key}"], capture_output=True, text=True)
        if meta_upload_proc.returncode != 0:
            raise Exception(f"AWS S3 metadata sidecar upload failed (code {meta_upload_proc.returncode}): {meta_upload_proc.stderr.strip()}")
        verify_s3_object(S3_BUCKET, meta_s3_key, os.path.getsize(meta_path))
        print(f"[✓] Metadata sidecar stored and verified in S3: s3://{S3_BUCKET}/{meta_s3_key}")

        uploaded_to_s3 = True
        print(f"[✓] S3 upload verified: s3://{S3_BUCKET}/{s3_key} ({file_size} bytes)")

        # 6. Record DAILY SUCCESS in backup_runs using production helper
        record_backup_success("DAILY", start_time, S3_BUCKET, s3_key, file_size, record_count=counts.get("tenders", 0))

        # 7. Weekly recovery point: On Sundays (weekday == 6), archive a weekly copy
        is_sunday = start_time.weekday() == 6
        force_weekly = "--weekly" in sys.argv
        weekly_failed = False
        if is_sunday or force_weekly:
            try:
                week_date = start_time.strftime("%Y-%m-%d")
                weekly_year = start_time.strftime("%Y")
                weekly_filename = f"backup-weekly-{week_date}.sql.gz"
                weekly_s3_key = f"backups/postgresql/weekly/{weekly_year}/{weekly_filename}"
                weekly_local_path = os.path.join(LOCAL_BACKUP_DIR, "weekly", weekly_year, weekly_filename)

                os.makedirs(os.path.dirname(weekly_local_path), exist_ok=True)
                with open(local_path, "rb") as src, open(weekly_local_path, "wb") as dst:
                    dst.write(src.read())
                weekly_meta_path = write_backup_metadata(weekly_local_path, weekly_s3_key, file_size, sha256_checksum, counts, "WEEKLY")

                print(f"[*] Archiving weekly recovery point to s3://{S3_BUCKET}/{weekly_s3_key}...")
                weekly_upload = subprocess.run(["aws", "s3", "cp", weekly_local_path, f"s3://{S3_BUCKET}/{weekly_s3_key}"], capture_output=True, text=True)
                if weekly_upload.returncode != 0:
                    raise Exception(f"AWS S3 upload for weekly backup failed (code {weekly_upload.returncode}): {weekly_upload.stderr.strip()}")

                verify_s3_object(S3_BUCKET, weekly_s3_key, file_size)

                # Upload weekly metadata sidecar
                weekly_meta_s3_key = f"{weekly_s3_key}.meta.json"
                weekly_meta_proc = subprocess.run(["aws", "s3", "cp", weekly_meta_path, f"s3://{S3_BUCKET}/{weekly_meta_s3_key}"], capture_output=True, text=True)
                if weekly_meta_proc.returncode != 0:
                    raise Exception(f"AWS S3 weekly metadata sidecar upload failed (code {weekly_meta_proc.returncode}): {weekly_meta_proc.stderr.strip()}")
                verify_s3_object(S3_BUCKET, weekly_meta_s3_key, os.path.getsize(weekly_meta_path))

                record_backup_success("WEEKLY", start_time, S3_BUCKET, weekly_s3_key, file_size, record_count=counts.get("tenders", 0))
                print(f"[✓] Weekly recovery point archived & verified: s3://{S3_BUCKET}/{weekly_s3_key}")
            except Exception as e_weekly:
                weekly_failed = True
                err_weekly = str(e_weekly)
                print(f"[❌] WEEKLY BACKUP FAILED: {err_weekly}")
                try:
                    record_backup_failure("WEEKLY", start_time, err_weekly, S3_BUCKET, weekly_s3_key if 'weekly_s3_key' in locals() else None, file_size, record_count=counts.get("tenders", 0))
                except Exception as e_wf:
                    print(f"[!] Warning: Failed to record weekly backup failure in DB: {e_wf}")
                send_alert_email("WEEKLY_BACKUP_EXECUTION", err_weekly)

        # 8. Local retention enforcement (14 days daily, 8 weeks weekly)
        enforce_local_retention()

        if weekly_failed:
            print(f"[!] Daily backup completed, but weekly archival failed. Exiting with status 1.")
            sys.exit(1)

        print(f"==================================================")
        print(f"[✓] DAILY BACKUP COMPLETED & VERIFIED: {filename}")
        print(f"    S3 Key : {s3_key}")
        print(f"    SHA-256: {sha256_checksum}")
        print(f"==================================================")
        sys.exit(0)

    except Exception as e:
        err_msg = str(e)

        # Clean up temporary in-progress file if left behind
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

        if uploaded_to_s3:
            # S3 upload succeeded; failure occurred during database recording or retention
            print(f"[❌] DAILY BACKUP LOGGING FAILED: Backup verified in S3 ({s3_key}), but post-backup recording failed: {err_msg}")
            try:
                record_backup_failure("DAILY", start_time, err_msg, S3_BUCKET, s3_key, file_size, record_count=counts.get("tenders", 0))
            except Exception:
                pass
            send_alert_email("DAILY_BACKUP_LOGGING", f"Backup verified in S3 ({s3_key}) but recording failed: {err_msg}")
        else:
            print(f"[❌] DAILY BACKUP FAILED: {err_msg}")
            try:
                record_backup_failure("DAILY", start_time, err_msg)
            except Exception:
                pass
            send_alert_email("DAILY_BACKUP_EXECUTION", err_msg)

        sys.exit(1)

if __name__ == "__main__":
    main()
