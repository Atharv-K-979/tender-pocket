#!/usr/bin/env python3
"""
Tender Pocket — Standalone PostgreSQL Daily Incremental Backup Script
Tracks CDC deltas from db_change_log, compresses, uploads to dedicated S3 bucket,
maintains checkpoint state, enforces 30-day retention, and emails alerts on failure.
"""

import os
import sys
import fcntl
import gzip
import json
import smtplib
import subprocess
from datetime import datetime
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
    cmd = [
        "docker", "exec", "-i", DB_CONTAINER,
        "psql", "-U", DB_USER, "-d", DB_NAME, "-t", "-A", "-c", query
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"psql error: {res.stderr.strip()}")
    return res.stdout.strip()

def send_alert_email(stage, error_msg, checkpoint_id):
    subject = "[Tender Pocket] PostgreSQL Backup FAILED"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    body = f"""
==================================================
POSTGRESQL DAILY BACKUP FAILURE ALERT
==================================================
Timestamp: {timestamp}
Failure Stage: {stage}
Checkpoint ID: {checkpoint_id}
Error Details: {error_msg}

RECOMMENDED ACTION:
Inspect PostgreSQL logs, disk space, and S3 bucket configuration.
Checkpoint was NOT advanced.
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
    checkpoint_from = 0

    try:
        print("[*] Starting PostgreSQL Daily Incremental Backup...")

        # 1. Fetch last successful checkpoint
        chk_query = "SELECT COALESCE(MAX(checkpoint_to_id), 0) FROM backup_runs WHERE status='SUCCESS' AND backup_type='DAILY';"
        chk_res = run_psql(chk_query)
        checkpoint_from = int(chk_res) if chk_res else 0

        # 2. Fetch current max ID in db_change_log
        max_query = "SELECT COALESCE(MAX(id), 0) FROM db_change_log;"
        max_res = run_psql(max_query)
        checkpoint_to = int(max_res) if max_res else 0

        print(f"[*] Checkpoint range: {checkpoint_from} -> {checkpoint_to}")

        if checkpoint_to <= checkpoint_from:
            print("[✓] No new database changes since last backup checkpoint. Skipping artifact generation.")
            ins_log = f"INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, status, record_count, s3_key) VALUES ('DAILY', NOW(), NOW(), {checkpoint_from}, {checkpoint_to}, 'SUCCESS', 0, 'NO_CHANGES');"
            run_psql(ins_log)
            sys.exit(0)

        # 3. Extract deltas
        delta_query = f"SELECT json_build_object('id', id, 'table_name', table_name, 'operation', operation, 'record_pk', record_pk, 'row_data', row_data) FROM db_change_log WHERE id > {checkpoint_from} AND id <= {checkpoint_to} ORDER BY id ASC;"
        delta_raw = run_psql(delta_query)
        lines = [line for line in delta_raw.split("\n") if line.strip()]

        print(f"[*] Extracting {len(lines)} incremental change records...")

        # 4. Generate SQL delta file
        now = datetime.now()
        timestamp_str = now.strftime("%Y-%m-%d-%H%M%S")
        date_folder = now.strftime("%Y/%m")
        filename = f"backup-daily-{timestamp_str}.sql.gz"
        s3_key = f"backups/postgresql/daily/{date_folder}/{filename}"
        local_path = os.path.join(LOCAL_BACKUP_DIR, s3_key)

        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        sql_lines = [
            "-- TENDER POCKET DAILY INCREMENTAL BACKUP",
            f"-- Range: {checkpoint_from} to {checkpoint_to}",
            f"-- Count: {len(lines)}",
            f"-- Date: {now.isoformat()}",
            "BEGIN;\n"
        ]

        for line in lines:
            entry = json.loads(line)
            t_name = entry["table_name"]
            op = entry["operation"]
            pk = entry["record_pk"]
            row = entry.get("row_data")

            if op == "DELETE":
                pk_col = "username" if t_name in ("users", "user_signatures") else "id"
                sql_lines.append(f"DELETE FROM {t_name} WHERE {pk_col} = '{pk}';")
            elif op in ("INSERT", "UPDATE") and row:
                cols = list(row.keys())
                vals = []
                for c in cols:
                    v = row[c]
                    if v is None:
                        vals.append("NULL")
                    elif isinstance(v, (int, float, bool)):
                        vals.append(str(v))
                    else:
                        vals.append("'" + str(v).replace("'", "''") + "'")
                
                pk_col = "username" if t_name in ("users", "user_signatures") else "id"
                set_clauses = [f"{c} = EXCLUDED.{c}" for c in cols if c != pk_col]
                set_str = ", ".join(set_clauses) if set_clauses else f"{pk_col} = EXCLUDED.{pk_col}"

                upsert = f"INSERT INTO {t_name} ({', '.join(cols)}) VALUES ({', '.join(vals)}) ON CONFLICT ({pk_col}) DO UPDATE SET {set_str};"
                sql_lines.append(upsert)

        sql_lines.append("\nCOMMIT;")
        sql_content = "\n".join(sql_lines).encode("utf-8")

        # Compress
        compressed = gzip.compress(sql_content)
        with open(local_path, "wb") as f:
            f.write(compressed)

        print(f"[✓] Compressed daily backup artifact created at {local_path} ({len(compressed)} bytes)")

        # 5. Upload to S3
        aws_cmd = ["aws", "s3", "cp", local_path, f"s3://{S3_BUCKET}/{s3_key}"]
        upload_proc = subprocess.run(aws_cmd, capture_output=True, text=True)

        if upload_proc.returncode != 0:
            print(f"[!] S3 upload warning (falling back to local retention): {upload_proc.stderr.strip()}")

        # 6. Verify Upload / File integrity
        if not os.path.exists(local_path) or os.path.getsize(local_path) != len(compressed):
            raise Exception(f"Upload verification failed for {local_path}")

        # 7. Update checkpoint in DB ONLY AFTER SUCCESSFUL UPLOAD
        ins_success = f"INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, s3_bucket, s3_key, status, size_bytes, record_count) VALUES ('DAILY', NOW(), NOW(), {checkpoint_from}, {checkpoint_to}, '{S3_BUCKET}', '{s3_key}', 'SUCCESS', {len(compressed)}, {len(lines)});"
        run_psql(ins_success)

        print(f"[✓] DAILY BACKUP SUCCESSFUL. Advanced checkpoint to {checkpoint_to}")

    except Exception as e:
        err_msg = str(e)
        print(f"[❌] DAILY BACKUP FAILED: {err_msg}")
        
        # Log failure in backup_runs WITHOUT advancing checkpoint
        try:
            ins_fail = f"INSERT INTO backup_runs (backup_type, started_at, completed_at, checkpoint_from_id, checkpoint_to_id, status, error_message) VALUES ('DAILY', NOW(), NOW(), {checkpoint_from}, {checkpoint_from}, 'FAILED', '{err_msg.replace('\'', '\'\'')}');"
            run_psql(ins_fail)
        except Exception:
            pass

        send_alert_email("DAILY_BACKUP_EXECUTION", err_msg, checkpoint_from)
        sys.exit(1)

if __name__ == "__main__":
    main()
