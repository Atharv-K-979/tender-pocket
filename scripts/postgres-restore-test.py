#!/usr/bin/env python3
"""
Tender Pocket — Isolated PostgreSQL Restore Testing Script
Restores a verified full PostgreSQL backup into an isolated temporary test database
(tender_pocket_restore_test), runs integrity checks, verifies schema and row counts,
enforces SQL execution error-stopping (-v ON_ERROR_STOP=1), validates against
backup snapshot metadata, and cleans up strictly within disposable databases.
"""

import os
import sys
import gzip
import json
import smtplib
import subprocess
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

DB_CONTAINER = os.getenv("POSTGRES_CONTAINER_NAME", "tender-pocket-postgres")
DB_USER = os.getenv("POSTGRES_USER", "postgres")
SOURCE_DB = os.getenv("POSTGRES_DB", "tender_pocket")
TEST_DB = os.getenv("POSTGRES_RESTORE_TEST_DB", "tender_pocket_restore_test")
LOCAL_BACKUP_DIR = os.getenv("POSTGRES_BACKUP_LOCAL_DIR", "backups/postgresql")
S3_BUCKET = os.getenv("POSTGRES_BACKUP_S3_BUCKET", os.getenv("S3_BACKUP_BUCKET", "tender-pocket-postgres-backups"))

SMTP_HOST = os.getenv("SPRING_MAIL_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SPRING_MAIL_PORT", "465"))
SMTP_USER = os.getenv("SPRING_MAIL_USERNAME", "")
SMTP_PASS = os.getenv("SPRING_MAIL_PASSWORD", "")
ALERT_EMAIL = os.getenv("BACKUP_ALERT_EMAIL", SMTP_USER if SMTP_USER else "admin@tenderpocket.com")

REQUIRED_BUSINESS_TABLES = [
    "users", "user_signatures", "tenders", "activity_log",
    "status_history", "tender_approval_requests", "tender_comments",
    "tender_workflow_comments", "email_notification_logs"
]

DISPOSABLE_TEST_DB_PREFIXES = (
    "tender_pocket_restore_test",
    "tp_test_",
)

PROTECTED_SYSTEM_DATABASES = {
    "tender_pocket",
    "postgres",
    "template0",
    "template1",
}

def validate_safety_guardrails(test_db_name, source_db_name=SOURCE_DB):
    """
    Enforces strict safety guardrails ensuring test restore operations never target, drop,
    recreate, or modify live application or system databases.

    Strict Rules:
    1. test_db_name must be a non-empty string.
    2. Must NOT match any protected system database (postgres, template0, template1).
    3. Must NOT match the live source database (tender_pocket or source_db_name).
    4. Must strictly match approved disposable test naming conventions:
       - Starts with 'tender_pocket_restore_test'
       - Starts with 'tp_test_'
       Permissive substring matching (such as 'test' anywhere in the name) is strictly forbidden.
    """
    if not test_db_name or not isinstance(test_db_name, str):
        raise RuntimeError("CRITICAL SAFETY VIOLATION: Target database name must be a non-empty string.")

    target = test_db_name.strip().lower()
    source = (source_db_name or "").strip().lower()

    if target in PROTECTED_SYSTEM_DATABASES or (source and target == source):
        raise RuntimeError(
            f"CRITICAL SAFETY VIOLATION: Isolated restore test cannot drop, recreate, or modify "
            f"protected database '{test_db_name}' (source live database: '{source_db_name}')."
        )

    # Strictly check approved disposable test prefixes
    if not any(target.startswith(prefix) for prefix in DISPOSABLE_TEST_DB_PREFIXES):
        raise RuntimeError(
            f"CRITICAL SAFETY VIOLATION: Target database '{test_db_name}' is not an authorized disposable test database. "
            f"Must start with one of: {DISPOSABLE_TEST_DB_PREFIXES}"
        )

def run_psql(db, query):
    """Executes a SQL query with -v ON_ERROR_STOP=1 so errors halt execution immediately."""
    if os.getenv("USE_DIRECT_PSQL") == "1":
        host = os.getenv("POSTGRES_HOST", "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        cmd = [
            "psql", "-v", "ON_ERROR_STOP=1",
            "-h", host, "-p", port, "-U", DB_USER, "-d", db,
            "-t", "-A", "-c", query
        ]
    else:
        cmd = [
            "docker", "exec", "-i", DB_CONTAINER,
            "psql", "-v", "ON_ERROR_STOP=1",
            "-U", DB_USER, "-d", db,
            "-t", "-A", "-c", query
        ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Exception(f"psql error on {db} (code {res.returncode}): {res.stderr.strip()}")
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

def calculate_sha256(filepath):
    """Calculates SHA-256 checksum of a file."""
    import hashlib
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(65536), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def read_backup_metadata(backup_path):
    """
    Attempts to read companion .meta.json sidecar file for expected snapshot counts,
    file size, and SHA-256 checksum. If not found locally, attempts to fetch from S3 if configured.
    """
    meta_path = backup_path + ".meta.json"
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r") as f:
                return json.load(f)
        except Exception as e:
            raise RuntimeError(f"Corrupt or unreadable metadata file {meta_path}: {e}")

    # Attempt fetch from S3 if configured
    rel_path = backup_path
    if backup_path.startswith("backups/postgresql/"):
        rel_path = backup_path
    elif "backups/postgresql/" in backup_path:
        rel_path = backup_path[backup_path.index("backups/postgresql/"):]
    else:
        try:
            rel_path = f"backups/postgresql/{os.path.relpath(backup_path, LOCAL_BACKUP_DIR)}"
        except Exception:
            rel_path = f"backups/postgresql/{os.path.basename(backup_path)}"
    s3_meta_key = f"{rel_path}.meta.json".replace("\\", "/")
    try:
        res = subprocess.run(["aws", "s3", "cp", f"s3://{S3_BUCKET}/{s3_meta_key}", meta_path], capture_output=True, text=True)
        if res.returncode == 0 and os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                return json.load(f)
    except Exception:
        pass

    return None

def verify_backup_file_integrity(backup_path, meta):
    """
    Verifies the backup file's SHA-256 checksum and file size against its metadata.
    Fails immediately if either check fails.
    """
    if not meta:
        return

    actual_size = os.path.getsize(backup_path)
    expected_size = meta.get("file_size")
    if expected_size is not None and actual_size != expected_size:
        raise RuntimeError(
            f"Backup integrity check FAILED: File size mismatch for '{backup_path}'. "
            f"Expected {expected_size} bytes from metadata, found {actual_size} bytes."
        )

    actual_sha = calculate_sha256(backup_path)
    expected_sha = meta.get("sha256")
    if expected_sha is not None and actual_sha.lower() != expected_sha.lower():
        raise RuntimeError(
            f"Backup integrity check FAILED: SHA-256 checksum mismatch for '{backup_path}'. "
            f"Expected {expected_sha} from metadata, calculated {actual_sha}."
        )

    print(f"[✓] Metadata Verification: SHA-256 ({actual_sha[:16]}...) and file size ({actual_size} bytes) match metadata.")

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

def restore_dump_file(backup_file, target_db):
    """
    Decompresses and applies a .sql.gz dump to target_db using -v ON_ERROR_STOP=1.
    Any SQL statement failure causes the restore to abort with non-zero exit code.
    Validates safety guardrails before executing restore.
    """
    validate_safety_guardrails(target_db, SOURCE_DB)
    with gzip.open(backup_file, "rb") as gz_in:
        decompressed_sql = gz_in.read()

    if os.getenv("USE_DIRECT_PSQL") == "1":
        host = os.getenv("POSTGRES_HOST", "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        restore_cmd = [
            "psql", "-v", "ON_ERROR_STOP=1",
            "-h", host, "-p", port, "-U", DB_USER, "-d", target_db
        ]
    else:
        restore_cmd = [
            "docker", "exec", "-i", DB_CONTAINER,
            "psql", "-v", "ON_ERROR_STOP=1",
            "-U", DB_USER, "-d", target_db
        ]

    restore_proc = subprocess.run(restore_cmd, input=decompressed_sql, capture_output=True)
    if restore_proc.returncode != 0:
        err_msg = restore_proc.stderr.decode("utf-8", errors="ignore").strip()
        raise Exception(f"Database restore failed with exit code {restore_proc.returncode} (-v ON_ERROR_STOP=1): {err_msg}")

    return True

def verify_restored_database(target_db, expected_counts=None, mode="fresh", source_db=SOURCE_DB):
    """
    Validates restored database schema, business tables, primary keys, and row counts.
    Ensures SQL statements succeeded, all 9 business tables exist, and counts match expectations.
    """
    # 1. Validate required business tables existence
    missing_tables = []
    for t in REQUIRED_BUSINESS_TABLES:
        res = run_psql(target_db, f"SELECT COUNT(*) FROM information_schema.tables WHERE table_name='{t}' AND table_schema='public';")
        if res != "1":
            missing_tables.append(t)

    if missing_tables:
        raise Exception(f"Schema validation failed: Missing required tables in restored DB: {missing_tables}")

    print(f"[✓] Schema Validation: All {len(REQUIRED_BUSINESS_TABLES)} business tables exist in restored database.")

    # 2. Validate structural integrity (Primary Keys on core tables)
    for pk_table in ("users", "tenders"):
        pk_check = run_psql(target_db, f"""
            SELECT count(*) FROM information_schema.table_constraints
            WHERE table_name='{pk_table}' AND constraint_type='PRIMARY KEY' AND table_schema='public';
        """)
        if pk_check != "1":
            raise Exception(f"Integrity check failed: Primary key missing on table '{pk_table}' in restored DB.")

    # 3. Retrieve restored table counts
    restored_user_cnt = int(run_psql(target_db, "SELECT COUNT(*) FROM users;"))
    restored_tender_cnt = int(run_psql(target_db, "SELECT COUNT(*) FROM tenders;"))

    if restored_user_cnt == 0:
        raise Exception("Integrity anomaly: Restored 'users' table has 0 records.")
    if restored_tender_cnt == 0:
        raise Exception("Integrity anomaly: Restored 'tenders' table has 0 records.")

    # 4. Count comparison against expected snapshot or live source
    if expected_counts:
        exp_users = expected_counts.get("users", restored_user_cnt)
        exp_tenders = expected_counts.get("tenders", restored_tender_cnt)
        print(f"[*] Comparing with Backup Snapshot Metadata:")
        print(f"    Users   — Expected Snapshot: {exp_users} | Restored: {restored_user_cnt}")
        print(f"    Tenders — Expected Snapshot: {exp_tenders} | Restored: {restored_tender_cnt}")

        if restored_user_cnt != exp_users:
            raise Exception(f"Count mismatch on 'users': expected snapshot {exp_users} != restored {restored_user_cnt}")
        if restored_tender_cnt != exp_tenders:
            raise Exception(f"Count mismatch on 'tenders': expected snapshot {exp_tenders} != restored {restored_tender_cnt}")
        print("[✓] Exact Match: Restored table counts match backup snapshot metadata exactly.")

    elif mode == "fresh":
        # Strict fresh-backup mode: compare against current source DB and require exact match
        source_user_cnt = int(run_psql(source_db, "SELECT COUNT(*) FROM users;"))
        source_tender_cnt = int(run_psql(source_db, "SELECT COUNT(*) FROM tenders;"))
        print(f"[*] Fresh Backup Strict Verification against Live Source '{source_db}':")
        print(f"    Users   — Live: {source_user_cnt} | Restored: {restored_user_cnt}")
        print(f"    Tenders — Live: {source_tender_cnt} | Restored: {restored_tender_cnt}")

        if restored_user_cnt != source_user_cnt:
            raise Exception(f"Fresh backup count mismatch on 'users': live {source_user_cnt} != restored {restored_user_cnt}")
        if restored_tender_cnt != source_tender_cnt:
            raise Exception(f"Fresh backup count mismatch on 'tenders': live {source_tender_cnt} != restored {restored_tender_cnt}")
        print("[✓] Exact Match: Restored counts match live database exactly.")

    elif mode == "historical":
        # Historical backup validation: verify point-in-time sanity (restored <= source)
        source_user_cnt = int(run_psql(source_db, "SELECT COUNT(*) FROM users;"))
        source_tender_cnt = int(run_psql(source_db, "SELECT COUNT(*) FROM tenders;"))
        print(f"[*] Historical Recovery Point Validation against Live Source '{source_db}':")
        print(f"    Users   — Live: {source_user_cnt} | Restored: {restored_user_cnt}")
        print(f"    Tenders — Live: {source_tender_cnt} | Restored: {restored_tender_cnt}")

        if restored_user_cnt > source_user_cnt:
            raise Exception(f"Integrity anomaly on 'users': restored ({restored_user_cnt}) exceeds live source ({source_user_cnt})")
        if restored_tender_cnt > source_tender_cnt:
            raise Exception(f"Integrity anomaly on 'tenders': restored ({restored_tender_cnt}) exceeds live source ({source_tender_cnt})")
        print(f"[✓] Historical Sanity Verified: Restored recovery point is consistent with live database bounds.")

    return {
        "users": restored_user_cnt,
        "tenders": restored_tender_cnt,
        "tables_verified": len(REQUIRED_BUSINESS_TABLES)
    }

def main():
    if "--help" in sys.argv or "-h" in sys.argv:
        print("""Usage: postgres-restore-test.py [BACKUP_FILE] [OPTIONS]

Options:
  --mode=fresh|historical    Verification mode (default: fresh).
                             'fresh': strictly compares restored counts to live DB counts or expected snapshot.
                             'historical': ensures restored counts are positive and <= live DB counts.
  --strict                   Alias for --mode=fresh.
  --historical               Alias for --mode=historical.
  --test-db=NAME             Target disposable test database (must match approved prefix).
  --require-metadata         Fail restore verification if companion .meta.json sidecar is missing.
  --expected-users=N         Explicit expected user count.
  --expected-tenders=N       Explicit expected tender count.
  -h, --help                 Show this help message.
""")
        sys.exit(0)

    backup_file = None
    mode = "fresh"
    target_db = TEST_DB
    require_metadata = os.getenv("POSTGRES_RESTORE_REQUIRE_METADATA", "0").lower() in ("1", "true", "yes")
    expected_users = None
    expected_tenders = None

    for arg in sys.argv[1:]:
        if arg.startswith("--mode="):
            mode = arg.split("=", 1)[1].strip().lower()
        elif arg == "--historical":
            mode = "historical"
        elif arg == "--strict" or arg == "--fresh":
            mode = "fresh"
        elif arg.startswith("--test-db="):
            target_db = arg.split("=", 1)[1].strip()
        elif arg == "--require-metadata":
            require_metadata = True
        elif arg.startswith("--expected-users="):
            expected_users = int(arg.split("=", 1)[1])
        elif arg.startswith("--expected-tenders="):
            expected_tenders = int(arg.split("=", 1)[1])
        elif not arg.startswith("--") and backup_file is None:
            backup_file = arg

    if not backup_file:
        backup_file = find_latest_backup()

    if not backup_file or not os.path.exists(backup_file):
        print(f"[❌] No backup file provided or found to restore: {backup_file}")
        sys.exit(1)

    try:
        # Immediately validate target database safety against production/protected targets
        validate_safety_guardrails(target_db, SOURCE_DB)

        print(f"[*] Starting Isolated PostgreSQL Restore Verification Test")
        print(f"    Backup Target : {backup_file}")
        print(f"    Isolated DB   : {target_db}")
        print(f"    Mode          : {mode}")
        print(f"    Require Meta  : {require_metadata}")

        # Check for companion metadata snapshot and verify SHA-256 & size integrity
        meta = read_backup_metadata(backup_file)
        if require_metadata and not meta:
            raise RuntimeError(f"Required metadata missing: Companion metadata sidecar (.meta.json) not found for '{backup_file}'.")
        if meta:
            verify_backup_file_integrity(backup_file, meta)

        expected_counts = None
        if expected_users is not None or expected_tenders is not None:
            expected_counts = {}
            if expected_users is not None:
                expected_counts["users"] = expected_users
            if expected_tenders is not None:
                expected_counts["tenders"] = expected_tenders
        elif meta and "counts" in meta:
            expected_counts = meta["counts"]
            print(f"[✓] Found companion backup metadata sidecar with snapshot counts: {expected_counts}")

        # 1. Ensure test database is clean and recreate
        validate_safety_guardrails(target_db, SOURCE_DB)
        run_psql("postgres", f"DROP DATABASE IF EXISTS {target_db};")
        validate_safety_guardrails(target_db, SOURCE_DB)
        run_psql("postgres", f"CREATE DATABASE {target_db};")
        print(f"[✓] Isolated test database '{target_db}' created.")

        # 2. Decompress and pipe dump into test DB with -v ON_ERROR_STOP=1
        print(f"[*] Decompressing and restoring {backup_file} into {target_db} (-v ON_ERROR_STOP=1)...")
        restore_dump_file(backup_file, target_db)
        print("[✓] Backup dump successfully applied to isolated test database (0 SQL errors).")

        # 3. Comprehensive verification
        validate_safety_guardrails(target_db, SOURCE_DB)
        stats = verify_restored_database(target_db, expected_counts=expected_counts, mode=mode, source_db=SOURCE_DB)

        # 4. Clean up temporary test database strictly with safety verification
        validate_safety_guardrails(target_db, SOURCE_DB)
        run_psql("postgres", f"DROP DATABASE IF EXISTS {target_db};")
        print(f"[✓] Destroyed isolated test database '{target_db}'.")

        print("==================================================")
        print("RESTORE VERIFICATION TEST: PASSED")
        print(f"Verified Backup : {os.path.basename(backup_file)}")
        print(f"Tables Verified : {stats['tables_verified']}")
        print(f"Data Counts     : Users={stats['users']}, Tenders={stats['tenders']}")
        print(f"SQL Error Stop  : Enforced (-v ON_ERROR_STOP=1)")
        print("==================================================")
        sys.exit(0)

    except Exception as e:
        err_msg = str(e)
        print(f"[❌] RESTORE VERIFICATION FAILED: {err_msg}")
        try:
            validate_safety_guardrails(target_db, SOURCE_DB)
            run_psql("postgres", f"DROP DATABASE IF EXISTS {target_db};")
        except Exception:
            pass
        send_alert_email("RESTORE_VERIFICATION", err_msg)
        sys.exit(1)

if __name__ == "__main__":
    main()
