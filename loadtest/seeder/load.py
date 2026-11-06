#!/usr/bin/env python3
"""Load one generated tier into the EC2-2 database in ONE transaction (Part 2, G6).

    python3 seeder/load.py --tier 1000 --approved

Steps (all printed before anything is written):
  1. pre-flight: target URL is not EC2-1, SSH alias is not EC2-1 (G2);
  2. live schema introspection (information_schema) validated against the generator —
     abort with a diff on mismatch;
  3. trigger detection (db_change_log / trg_track_*, review 07 §4) and choice of mode;
  4. backup check: a full backup from backup.sh must exist on EC2-2 (override with
     --skip-backup-check);
  5. stream: BEGIN; [SET LOCAL session_replication_role=replica]; TRUNCATE app tables;
     DELETE lt_* users; COPY each table FROM STDIN (csv, gzip over SSH); setval identity
     sequences; [TRUNCATE db_change_log]; ANALYZE; COMMIT.
No container is restarted. Non-lt users (including the 5 default accounts that
AuthController.java:73-87 re-creates on login) are preserved.
"""
from __future__ import annotations

import argparse
import gzip
import json
import subprocess
import sys
import time
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.config import load_config  # noqa: E402
from common.safety import SafetyError, preflight_ssh_alias, preflight_target, require_approved  # noqa: E402
from seeder.db import Db  # noqa: E402
from seeder.schema import (IDENTITY_TABLES, TABLE_ORDER, TABLES, format_diff,  # noqa: E402
                           live_schema_sql, parse_live_schema_tsv, validate_schema)

OUT_DIR = Path(__file__).resolve().parent / "out"
TRUNCATE_TABLES = [t for t in TABLE_ORDER if t != "users"]
OPTIONAL_TRUNCATE = ["email_notification_logs"]


def qi(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def choose_trigger_mode(configured: str, triggers: list[str], changelog_exists: bool, superuser: bool) -> dict:
    """Return {'replica': bool, 'truncate_changelog': bool, 'note': str} (documented in seed-design.md §5)."""
    if not triggers:
        return {"replica": False, "truncate_changelog": False,
                "note": "no trg_track_* triggers present; load runs without trigger handling"}
    if configured == "fire":
        return {"replica": False, "truncate_changelog": False,
                "note": f"{len(triggers)} tracking triggers FIRE during load; db_change_log keeps the rows"}
    if superuser:
        return {"replica": True, "truncate_changelog": changelog_exists,
                "note": f"{len(triggers)} tracking triggers suppressed via session_replication_role=replica; "
                        "db_change_log truncated so every run starts from the same size"}
    return {"replica": False, "truncate_changelog": changelog_exists,
            "note": f"{len(triggers)} tracking triggers fire (not superuser); db_change_log truncated "
                    "afterwards in the same transaction"}


def header_sql(mode: dict, extra_truncate: list[str], user_prefix: str) -> str:
    lines = ["\\set ON_ERROR_STOP on", "BEGIN;", "SET LOCAL statement_timeout = 0;"]
    if mode["replica"]:
        lines.append("SET LOCAL session_replication_role = replica;")
    lines.append("TRUNCATE " + ", ".join(qi(t) for t in TRUNCATE_TABLES + extra_truncate) + ";")
    lines.append(f"DELETE FROM users WHERE username LIKE '{user_prefix.replace('_', chr(92) + '_')}%';")
    return "\n".join(lines) + "\n"


def footer_sql(mode: dict) -> str:
    lines = []
    for t in IDENTITY_TABLES:
        lines.append(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), GREATEST((SELECT max(id) FROM {qi(t)}), 1));")
    if mode["truncate_changelog"]:
        lines.append("TRUNCATE db_change_log;")
    for t in TABLE_ORDER:
        lines.append(f"ANALYZE {qi(t)};")
    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


def stream_tier(tier_dir: Path, mode: dict, extra_truncate: list[str], user_prefix: str):
    """Yield the SQL+data stream as bytes chunks."""
    yield header_sql(mode, extra_truncate, user_prefix).encode()
    for table in TABLE_ORDER:
        cols = ", ".join(qi(c) for c, _ in TABLES[table])
        yield f"COPY {qi(table)} ({cols}) FROM STDIN WITH (FORMAT csv, NULL '\\N');\n".encode()
        with gzip.open(tier_dir / f"{table}.csv.gz", "rb") as fh:
            while True:
                chunk = fh.read(1 << 20)
                if not chunk:
                    break
                yield chunk
        yield b"\\.\n"
        yield f"\\echo loaded {table}\n".encode()
    yield footer_sql(mode).encode()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tier", type=int, required=True)
    ap.add_argument("--approved", action="store_true", help="required: this writes the EC2-2 database (G6)")
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--local", action="store_true", help="docker is local (generator-on-target)")
    ap.add_argument("--skip-backup-check", action="store_true")
    ap.add_argument("--print-sql-header", action="store_true", help="print header/footer SQL and exit (no DB access)")
    args = ap.parse_args(argv)

    tier_dir = Path(args.out) / f"tier_{args.tier}"
    manifest = json.loads((tier_dir / "manifest.json").read_text())
    cfg = load_config(require_env=not args.print_sql_header)
    seed_cfg = cfg["seed"]
    user_prefix = seed_cfg["users"]["prefix"]

    if args.print_sql_header:
        demo = {"replica": True, "truncate_changelog": True}
        print(header_sql(demo, OPTIONAL_TRUNCATE, user_prefix) + "...COPY blocks...\n" + footer_sql(demo))
        return 0

    try:
        info = preflight_target(cfg)
        preflight_ssh_alias(cfg)
    except SafetyError as exc:
        print(f"PRE-FLIGHT FAILED: {exc}", file=sys.stderr)
        return 3
    print(f"pre-flight ok: target {info['host']} -> {info['resolved']} (not EC2-1)")

    db = Db(cfg, local=args.local)
    live = parse_live_schema_tsv(db.query_raw(live_schema_sql()))
    errors, warnings = validate_schema(live, manifest.get("max_lengths"))
    print(format_diff(errors, warnings))
    if errors:
        print("ABORT: live schema does not match the generator (see diff above)", file=sys.stderr)
        return 4

    triggers = db.tracking_triggers()
    changelog = db.table_exists("db_change_log")
    superuser = db.is_superuser()
    mode = choose_trigger_mode(seed_cfg.get("triggers_mode", "auto"), triggers, changelog, superuser)
    extra = [t for t in OPTIONAL_TRUNCATE if db.table_exists(t)]

    workdir = (cfg["env"].get("remote") or {}).get("workdir", "/var/tmp/tp-loadtest")
    if not args.skip_backup_check:
        has_backup = db.remote.text(f"ls -1 {workdir}/backups/*.dump 2>/dev/null | head -n 1", check=False).strip()
        if not has_backup:
            print(f"ABORT: no full backup found in {workdir}/backups on EC2-2. Run seeder/backup.sh --approved first "
                  "(or pass --skip-backup-check).", file=sys.stderr)
            return 5

    current = db.query("SELECT 'tenders', count(*) FROM tenders UNION ALL SELECT 'tender_approval_requests', count(*) "
                       "FROM tender_approval_requests UNION ALL SELECT 'users', count(*) FROM users")
    plan = f"""
Tier {args.tier}: {manifest['universe_tenders']} universe + {manifest['fixture_tenders']} fixture tenders
  (total {manifest['total_tenders']} tenders) from {tier_dir}
Current rows: {', '.join(f'{r[0]}={r[1]}' for r in current)}
Will, in ONE transaction:
  TRUNCATE {', '.join(TRUNCATE_TABLES + extra)}
  DELETE FROM users WHERE username LIKE '{user_prefix}%'   (other users are preserved)
  COPY {', '.join(f'{t}={manifest['row_counts'].get(t, 0)}' for t in TABLE_ORDER)}
  setval identity sequences; ANALYZE all loaded tables
Triggers: {mode['note']}
No container restart. Postgres container: {db.container}
"""
    try:
        require_approved(args.approved, plan)
    except SafetyError as exc:
        print(str(exc), file=sys.stderr)
        return 6

    t0 = time.time()
    proc = db.remote.popen(f"gunzip -c | {db.rw_cmd()}", stdout=subprocess.PIPE, stdin=subprocess.PIPE)
    comp = zlib.compressobj(6, zlib.DEFLATED, 31)
    sent = 0
    try:
        for chunk in stream_tier(tier_dir, mode, extra, user_prefix):
            data = comp.compress(chunk)
            if data:
                proc.stdin.write(data)
            sent += len(chunk)
        proc.stdin.write(comp.flush())
        proc.stdin.close()
    except BrokenPipeError:
        pass
    out, err = proc.communicate()
    sys.stdout.write((out or b"").decode("utf-8", "replace"))
    if proc.returncode != 0:
        sys.stderr.write((err or b"").decode("utf-8", "replace"))
        print(f"LOAD FAILED (rc={proc.returncode}); the transaction was rolled back.", file=sys.stderr)
        return 7
    record = {"tier": args.tier, "loaded_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "seconds": round(time.time() - t0, 1), "bytes_uncompressed": sent, "trigger_mode": mode,
              "row_counts": manifest["row_counts"], "config_digest": manifest["config_digest"]}
    (tier_dir / "load_record.json").write_text(json.dumps(record, indent=1))
    db.remote.run(f"mkdir -p {workdir}/state && cat > {workdir}/state/current_tier.json",
                  input_bytes=json.dumps(record).encode(), check=False)
    print(f"loaded tier {args.tier} in {record['seconds']}s. Next: python3 seeder/validate.py --tier {args.tier}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
