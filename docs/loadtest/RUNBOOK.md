# Load-test RUNBOOK (operator: you)

Hosts:

- **EC2-2**: the app host (target).
- **GEN**: the load generator, a separate EC2 instance in the same VPC (recommended: ≥ 8 vCPU, 16 GB).
- **EC2-1 is never touched.** Every tool resolves the target and aborts on a match with `ec2_1_denylist`.

Commands marked **(EC2-2)** run there; everything else runs on GEN inside `~/tp-loadtest/loadtest`. Nothing writes to the database without `--approved`.

---

## Step 1: Audit EC2-2 and send me the output

```bash
# from GEN (or your laptop) once the repo is cloned (step 4), or copy the single script:
scp loadtest/audit/env_audit.sh tp-ec2-2:/tmp/env_audit.sh
ssh tp-ec2-2 'bash /tmp/env_audit.sh --out ~/tp-audit'      # (EC2-2) read-only, ~1 min
scp 'tp-ec2-2:~/tp-audit/env-audit-*.txt' .
```

Send me the `env-audit-*.txt` file. Check first that it holds no secrets: only env names are printed, plus `JAVA_TOOL_OPTIONS`. Details: `audit-howto.md`.

---

## Step 2: Apply the safety configuration on EC2-2 (C1–C6)

C1–C6 is this runbook's own numbering. No earlier decisions file defined it.

Put the variables in the env file / compose override that `tender-pocket-backend` uses, then recreate **only** the backend: `docker compose up -d tender-pocket-backend`. Wait **≥ 20 min** before any run (startup GeM/IMAP sync, `SyncScheduler.java:22`).

| # | What | Exact change | Why |
|---|---|---|---|
| C1 | AI → mock | `AZURE_OPENAI_ENDPOINT=http://<GEN-PRIVATE-IP>:8800/v1`; `AZURE_OPENAI_API_KEY=loadtest-dummy-key`; **delete** the `GEMINI_API_KEY` line, and make sure no `gemini.api.key` is set in a properties override | 05 §17. Gemini cannot be mocked |
| C2 | No IMAP | `IMAP_USERNAME=` and `IMAP_PASSWORD=` (empty, or the lines removed) | `EmailSyncService.java:61` skips when they are empty |
| C3 | No real e-mail | `SPRING_MAIL_PASSWORD=` (empty). Optionally `SPRING_MAIL_HOST=127.0.0.1` and `SPRING_MAIL_PORT=2525` (nothing listens, so sends fail fast) | 01 §c. The seeded users have `@loadtest.invalid` addresses anyway |
| C4 | No S3 writes | `AWS_S3_ENABLED=false` (or the variable unset) | 01 §e |
| C5 | Block GeM / Tender247 / GitHub egress | see below | the scheduler and AutoUpdate cannot be disabled by config (01 §a, §f) |
| C6 | Mock reachable only from EC2-2 | GEN security group: inbound TCP **8800** from EC2-2's private IP only | |

**C5, option A (recommended): security group.** Edit EC2-2's outbound rules:

1. Remove `0.0.0.0/0`.
2. Allow the VPC CIDR (GEN, and RDS/S3 if they are used), plus TCP 443 to any AWS endpoints you actually need (e.g. SSM).

Revert by restoring the old outbound rule.

**C5, option B: iptables on EC2-2**, affecting containers only (`DOCKER-USER` chain):

```bash
# (EC2-2) allow traffic to private ranges (GEN mock AI, DNS in VPC), drop other container egress
sudo iptables -I DOCKER-USER 1 -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
sudo iptables -I DOCKER-USER 2 -d 10.0.0.0/8 -j RETURN
sudo iptables -I DOCKER-USER 3 -d 172.16.0.0/12 -j RETURN
sudo iptables -I DOCKER-USER 4 -d 192.168.0.0/16 -j RETURN
sudo iptables -I DOCKER-USER 5 -d 169.254.169.253/32 -j RETURN     # VPC DNS
sudo iptables -I DOCKER-USER 6 -j DROP
sudo iptables -L DOCKER-USER -n --line-numbers                      # verify
# check: GeM must now fail, mock must work
docker exec tender-pocket-backend sh -c 'wget -q -T5 -O /dev/null https://bidplus.gem.gov.in && echo REACHABLE || echo blocked'
docker exec tender-pocket-backend sh -c 'wget -q -T5 -O- http://<GEN-PRIVATE-IP>:8800/health'
# revert after the campaign
for i in 1 2 3 4 5 6; do sudo iptables -D DOCKER-USER 1; done
```

**Verify (names only):**

```bash
# (EC2-2)
docker exec tender-pocket-backend env | grep -E '^(AZURE_OPENAI_|GEMINI_|IMAP_|SPRING_MAIL_|AWS_S3_ENABLED)' | cut -d= -f1
docker logs tender-pocket-backend 2>&1 | grep -E 'Configured PostgreSQL DataSource|Falling back to SQLite' | tail -1
```

`orchestrator/run.py` re-checks all of this before every run and refuses a BENCHMARK run if any check fails.

Two points I cannot settle from code:

- Tell me if EC2-2's DB holds real user e-mails or production tenders. The backup in step 5 keeps them, and seeding replaces the tenders.
- Tell me if you prefer a code-level scheduler switch instead of C5.

---

## Step 3: Set up the generator (GEN)

```bash
sudo apt-get update && sudo apt-get install -y python3 python3-venv git gnupg ca-certificates curl
# k6 (Grafana apt repo)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install -y k6
k6 version            # must be v1.x; send me the output
# Chromium for the browser VUs (k6/browser)
curl -fsSLO https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y ./google-chrome-stable_current_amd64.deb
echo 'export K6_BROWSER_EXECUTABLE_PATH=/usr/bin/google-chrome' >> ~/.bashrc
# SSH alias to EC2-2 used by every tool
cat >> ~/.ssh/config <<'EOF'
Host tp-ec2-2
  HostName <EC2-2-PRIVATE-IP>
  User ubuntu
  IdentityFile ~/.ssh/<key>.pem
EOF
ssh tp-ec2-2 'docker ps --format "{{.Names}}"'      # must list the three tender-pocket containers
ssh tp-ec2-2 'python3 --version'                   # the monitor agent needs python3 (stdlib only) on EC2-2
```

---

## Step 4: Clone `load-testing` into `~/tp-loadtest`

Use a directory separate from any app checkout.

```bash
git clone --branch load-testing git@github.com:Atharv-K-979/tender-pocket.git ~/tp-loadtest
cd ~/tp-loadtest/loadtest
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
cp config/env.example.yaml config/env.yaml && chmod 600 config/env.yaml
$EDITOR config/env.yaml
# Fill in: target.frontend_url, ec2_1_denylist (ALL EC2-1 names and IPs), remote.ssh_alias,
# postgres.user/db (or leave PG_USER/PG_DB to use the container's own env), test_user_password
# (long random), mock_ai.endpoint_for_backend, instance types.
./run_tests.sh                                     # local tests, no network
```

The branch must be pushed first; ask me to push it. Until then, use `git bundle` from my machine.

---

## Step 5: Backup, then seed and dump every tier (`--approved`)

```bash
# (EC2-2) full backup BEFORE the first seed — load.py refuses to seed without one
ssh tp-ec2-2 'mkdir -p /var/tmp/tp-loadtest/seeder'
scp seeder/_pg_common.sh seeder/backup.sh seeder/dump_tier.sh seeder/reset.sh seeder/restore_backup.sh tp-ec2-2:/var/tmp/tp-loadtest/seeder/
ssh tp-ec2-2 'bash /var/tmp/tp-loadtest/seeder/backup.sh --approved'

# (GEN) generate all tiers once (~2 min, ~0.5 GB gz in seeder/out/)
python3 seeder/generate.py --tiers 100,500,1000,5000,10000,25000,50000,75000,100000 --seed 42

# (GEN→EC2-2) per tier: load (one transaction), validate (read-only), dump (data-only)
for T in 100 500 1000 5000 10000 25000 50000 75000 100000; do
  python3 seeder/load.py --tier $T --approved || break
  python3 seeder/validate.py --tier $T || break
  ssh tp-ec2-2 "bash /var/tmp/tp-loadtest/seeder/dump_tier.sh --tier $T --approved" || break
done
```

- `load.py` prints its plan (rows, TRUNCATE list, trigger mode) and a schema diff. If the schema validation fails, **stop and send me the diff**.
- `validate.py` must print PASS for counts, enums, one_pending, fixed_point and proportions.
- Tiers above 100K (the +25K extension up to 200K) need `generate.py --tiers 125000,…` first.

---

## Step 6: Start the mock AI (GEN)

```bash
nohup python3 mock-ai/server.py --config config/mock_ai.yaml > mock-ai.out 2>&1 &
curl -s localhost:8800/health
ssh tp-ec2-2 "docker exec tender-pocket-backend wget -qO- http://<GEN-PRIVATE-IP>:8800/health"
python3 mock-ai/contract_test.py --url http://127.0.0.1:8800/v1     # optional
```

---

## Step 7: DEBUG runs (results go to `results/debug/`)

```bash
python3 orchestrator/run.py --profile DEBUG --tier 100 --run-type DEBUG --approved-reset --dry-run   # pre-flight only
python3 orchestrator/run.py --profile DEBUG --tier 100 --run-type DEBUG --approved-reset
python3 orchestrator/run.py --profile MIX   --tier 100 --run-type DEBUG --approved-reset             # full 17-VU mix
python3 orchestrator/run.py --profile AI-1  --tier 100 --run-type DEBUG --approved-reset
python3 report/build_report.py --include-debug
```

Before going further, confirm:

- `k6.log` shows no `SAFETY ABORT`;
- `manifest.json` shows `poll_mode: faithful`;
- the browser VUs logged in (`lt_page_load_ms{page:dashboard_after_login}` in `summary.json`);
- `drift.txt` lists only the run's own writes.

For a shorter smoke run, set `config/run.yaml` durations to 1 + 3 minutes temporarily.

---

## Step 8: Baseline at tier 100

```bash
python3 orchestrator/run.py --profile MIX       --tier 100 --repeat 2 --approved-reset
python3 orchestrator/run.py --profile READ      --tier 100 --repeat 2 --approved-reset
python3 orchestrator/run.py --profile APPROVALS --tier 100 --repeat 2 --approved-reset
python3 orchestrator/run.py --profile WORKFLOW  --tier 100 --repeat 1 --approved-reset
python3 report/build_report.py
```

Send me the report. The PROPOSED SLO placeholders (`config/slo.yaml`) get finalised from this baseline.

---

## Step 9: Sweep (you approve each tier)

```bash
python3 orchestrator/sweep.py --tiers 500,1000,5000,10000,25000,50000,75000,100000 --approved-reset
# then the +25K extension while not broken (generate + load + dump those tiers first):
python3 orchestrator/sweep.py --tiers 125000,150000,175000,200000 --approved-reset
```

- Runs per tier come from `config/run.yaml runs_per_tier` (MIX×2, READ×1, APPROVALS×1, WORKFLOW×1; READ/APPROVALS ×2 at 100, 50K and 100K).
- Each run takes about 25 min.
- Pre-flight refuses runs that would cross 07:45–08:30 IST, 01:45–05:30 IST or the predicted 6-hourly sync. Plan the day around that.

---

## Step 10: Track B at the reference tier (10,000)

```bash
python3 orchestrator/sweep.py --tiers 10000 --profiles AI-1,AI-3,AI-6,AI-10 --repeat 1 --approved-reset
python3 orchestrator/sweep.py --tiers 10000 --profiles DOCGEN-1,DOCGEN-3,DOCGEN-6 --repeat 1 --approved-reset
```

All S18 numbers are "simulated provider latency".

---

## Step 11: Build the report

```bash
python3 report/build_report.py            # -> results/report/<UTC>/report.md, matrix_*.csv, runs.csv, charts/*.svg
```

## How to read the results

- **Per run**, `results/<run_id>/`:
  - `manifest.json`: validity, anomalies, commits, times in UTC and IST;
  - `summary.json`: k6 aggregates;
  - `raw.jsonl.gz`: every request;
  - `agent/*.csv`: EC2-2 host, containers, Postgres;
  - `generator.csv`;
  - `logs/*.log` and `log_findings.json`;
  - `drift.txt`.
- **Invalid runs** (R1–R7, `orchestrator/validity.py`) are listed in the report but excluded from the matrix. Re-run them.
- **Matrix cells:** Healthy, Degraded, Broken, Broken? (some repeats only). The value in brackets is the median of the repeats' p95. Breaking point = the first tier Broken in both repeats **and** at the next tier. "candidate" means not yet confirmed.
- **Poll-overrun marker:** the first tier where the median of a polled service exceeds 1.5 s, from which in-flight requests accumulate in real browsers.
- A container crash or OOM caused by the load is a **valid Broken** result, not an invalid run.

## What to send back to me

1. Step 1: `env-audit-*.txt`. Step 3: `k6 version`.
2. Any `load.py` schema diff or `validate.py` FAIL output.
3. After step 7 and after each sweep day: `results/report/<UTC>/` (whole folder) and, for every run, `manifest.json`, `summary.json`, `drift.txt` and `log_findings.json` (`tar czf runs.tgz results/*/manifest.json results/*/summary.json results/*/drift.txt results/*/log_findings.json`).
4. For any Broken or invalid run, also its `logs/` and `agent/` folders.

Do not send `config/env.yaml`, `seeder/out/` or `raw.jsonl.gz` unless I ask. `raw.jsonl.gz` is large, but it holds no secrets.

## Emergency

| Situation | Action |
|---|---|
| Stop a run | Ctrl-C `run.py` (k6 stops), then `ssh tp-ec2-2 'touch /var/tmp/tp-loadtest/monitor/<run_id>/STOP'` |
| Restore the pre-seed DB | `(EC2-2) bash /var/tmp/tp-loadtest/seeder/restore_backup.sh --file /var/tmp/tp-loadtest/backups/full-<UTC>.dump --approved` |
| Undo C1–C6 | restore the backend env file, `docker compose up -d tender-pocket-backend`, revert the SG / iptables |
