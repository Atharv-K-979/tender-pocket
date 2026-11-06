# EC2-2 environment audit — how to run it

`loadtest/audit/env_audit.sh` collects everything the review marked UNKNOWN about EC2-2.
It is **read-only**:

- `docker ps`, `inspect` and `logs`;
- `docker exec … env` (names only) and `which`;
- host stats;
- `psql` inside a `BEGIN TRANSACTION READ ONLY` block, with SELECT/SHOW only.

## Run

```bash
# on your laptop
scp loadtest/audit/env_audit.sh tp-ec2-2:/tmp/env_audit.sh
# on EC2-2
ssh tp-ec2-2
bash /tmp/env_audit.sh --out ~/tp-audit          # ≈ 1 minute
# optional: if the container names differ
BACKEND=my-backend FRONTEND=my-frontend POSTGRES=my-pg bash /tmp/env_audit.sh
# back on the laptop
scp 'tp-ec2-2:~/tp-audit/env-audit-*.txt' .
```

Some lines need `sudo`: `sudo crontab -l` and `nginx -T`. The script uses `sudo -n` and does not prompt. If a line says "needs a password", run that one command by hand.

## What it reports (and which review question it answers)

| Section | Answers |
|---|---|
| compose projects, containers, restarts, limits, image build time | 09 Q1, 01 open question 3 (image built from a modified tree?) |
| env var NAMES for mail/IMAP/AI/S3/JWT/DB, `JAVA_TOOL_OPTIONS` value | 01 Q2, 05 Q1, 09 Q2 |
| datasource line (PostgreSQL vs SQLite), last `[Scheduler]`/`AutoUpdate` lines | 07 §0.3, 01 §g |
| nproc, free, df, docker system df | 09 Q3 |
| crontab, sudo crontab, systemd timers | 01 §g Q4 |
| nginx timeouts/body limits | 09 Q6 |
| SHOW max_connections/shared_buffers…, extensions | 07 Q9, 11 Q5 |
| row counts; tenders by status×stage; approvals by stage×status; users by role; e-mails with `@` | 04, 07 Q5, 01 §c |
| triggers, `fn_track_db_changes`, `db_change_log` size | 07 §4 |
| indexes on key tables | 07 §3 |
| frontend tools: chromium, python3, pdftotext, tesseract | 06 Q2, 13 Q14 |

## Secrets

The script never prints an environment value. The one exception is `JAVA_TOOL_OPTIONS`, which the brief allows.

- Every other variable prints as `NAME=<set>` or `NAME=<empty>`.
- `AWS_S3_ENABLED` and `AZURE_OPENAI_ENDPOINT` are reduced to booleans, for example "points at *.azure.com: no".
- psql uses the postgres container's own `$POSTGRES_USER`/`$POSTGRES_DB` inside the container, so the values are never echoed.

## What to send back

Send the single file `env-audit-<UTC>.txt`. Skim it first: no line should contain a password or key.
