#!/usr/bin/env python3
"""EC2-2 monitor agent — standard library ONLY (no pip on the app host, G8).

    python3 agent.py --out /var/tmp/tp-loadtest/monitor/<run_id> --interval 5 --duration 1260 \
        --pg-container tender-pocket-postgres --containers tender-pocket-backend,tender-pocket-frontend,tender-pocket-postgres \
        --pg-tables tenders,tender_approval_requests

Every interval it appends to CSVs in --out:
  host.csv        /proc/stat CPU % (user/system/iowait/steal/idle), loadavg, MemTotal/MemAvailable,
                  swap used + pswpin/pswpout deltas, disk I/O deltas (/proc/diskstats)
  containers.csv  `docker stats --no-stream` per container (CPU %, mem, net, block I/O, pids)
  pg_activity.csv pg_stat_activity by state and wait event, longest active query, blocked locks
  pg_db.csv       pg_stat_database deltas (commits, rollbacks, blks read/hit, tuples, deadlocks, temp bytes)
  pg_tables.csv   pg_stat_user_tables deltas (seq_scan, seq_tup_read, idx_scan, ins/upd/del) + n_dead_tup
  agent_self.csv  the agent's own CPU % and RSS
PostgreSQL is sampled SELECT-only in a read-only session (PGOPTIONS default_transaction_read_only=on, G6).
Stops on --duration, SIGTERM/SIGINT, or when <out>/STOP exists.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import signal
import subprocess
import threading
import time

CLK = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
STOP = threading.Event()


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class Writer:
    def __init__(self, path: str, header: list[str]):
        new = not os.path.exists(path)
        self.fh = open(path, "a", newline="", encoding="utf-8")
        self.w = csv.writer(self.fh)
        if new:
            self.w.writerow(header)
            self.fh.flush()

    def row(self, values: list):
        self.w.writerow(values)
        self.fh.flush()


def read_cpu():
    with open("/proc/stat") as fh:
        parts = fh.readline().split()[1:]
    vals = [int(x) for x in parts[:8]] + [0] * (8 - len(parts[:8]))
    user, nice, system, idle, iowait, irq, softirq, steal = vals
    return {"user": user + nice, "system": system + irq + softirq, "idle": idle, "iowait": iowait, "steal": steal,
            "total": sum(vals)}


def read_meminfo():
    out = {}
    with open("/proc/meminfo") as fh:
        for line in fh:
            k, v = line.split(":", 1)
            out[k] = int(v.split()[0])
    return out


def read_vmstat():
    out = {}
    with open("/proc/vmstat") as fh:
        for line in fh:
            k, v = line.split()
            if k in ("pswpin", "pswpout"):
                out[k] = int(v)
    return out


def read_disks():
    out = {}
    with open("/proc/diskstats") as fh:
        for line in fh:
            p = line.split()
            name = p[2]
            if name.startswith(("loop", "ram", "dm-")) or (name[-1].isdigit() and not name.startswith("nvme") and name[:-1] in out):
                continue
            if name.startswith("nvme") and "p" in name[4:]:
                continue
            out[name] = {"reads": int(p[3]), "rsect": int(p[5]), "writes": int(p[7]), "wsect": int(p[9]), "io_ms": int(p[12])}
    return out


def self_cpu():
    with open("/proc/self/stat") as fh:
        p = fh.read().rsplit(")", 1)[1].split()
    ticks = int(p[11]) + int(p[12])
    rss_kb = 0
    with open("/proc/self/status") as fh:
        for line in fh:
            if line.startswith("VmRSS:"):
                rss_kb = int(line.split()[1])
    return ticks, rss_kb


def docker_stats(containers: list[str]) -> list[dict]:
    try:
        res = subprocess.run(["docker", "stats", "--no-stream", "--format", "{{json .}}", *containers],
                             capture_output=True, text=True, timeout=30)
    except Exception as exc:  # noqa: BLE001
        return [{"Name": "error", "CPUPerc": str(exc)}]
    rows = []
    for line in res.stdout.splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows


PG_SQL = """
SELECT 'act', coalesce(state,'<none>'), coalesce(wait_event_type,'-'), coalesce(wait_event,'-'), count(*),
       coalesce(max(extract(epoch FROM now() - query_start)) FILTER (WHERE state = 'active'), 0)
FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() GROUP BY 2,3,4;
SELECT 'blk', count(*) FROM pg_locks WHERE NOT granted;
SELECT 'blkpids', count(*) FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;
SELECT 'db', xact_commit, xact_rollback, blks_read, blks_hit, tup_returned, tup_fetched, tup_inserted, tup_updated,
       tup_deleted, deadlocks, temp_bytes, numbackends FROM pg_stat_database WHERE datname = current_database();
SELECT 'tbl', relname, seq_scan, seq_tup_read, coalesce(idx_scan,0), n_tup_ins, n_tup_upd, n_tup_del, n_dead_tup, n_live_tup
FROM pg_stat_user_tables WHERE relname IN ({tables});
"""


def pg_sample(container: str, tables: list[str]) -> list[list[str]]:
    sql = PG_SQL.format(tables=", ".join("'" + t.replace("'", "") + "'" for t in tables) or "''")
    cmd = ["docker", "exec", "-i", "-e", "PGOPTIONS=-c default_transaction_read_only=on", container, "sh", "-c",
           'psql -X -q -A -t -F "\t" -v ON_ERROR_STOP=0 -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}"']
    try:
        res = subprocess.run(cmd, input=sql, capture_output=True, text=True, timeout=30)
    except Exception:  # noqa: BLE001
        return []
    return [line.split("\t") for line in res.stdout.splitlines() if line.strip()]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--interval", type=float, default=5)
    ap.add_argument("--duration", type=float, default=3600)
    ap.add_argument("--pg-container", default="tender-pocket-postgres")
    ap.add_argument("--containers", default="tender-pocket-backend,tender-pocket-frontend,tender-pocket-postgres")
    ap.add_argument("--pg-tables", default="tenders,tender_approval_requests")
    ap.add_argument("--no-pg", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    containers = [c for c in a.containers.split(",") if c]
    tables = [t for t in a.pg_tables.split(",") if t]

    host = Writer(os.path.join(a.out, "host.csv"),
                  ["ts", "cpu_user_pct", "cpu_system_pct", "cpu_iowait_pct", "cpu_steal_pct", "cpu_busy_pct", "load1", "load5",
                   "mem_total_mb", "mem_available_mb", "swap_used_mb", "pswpin_delta", "pswpout_delta",
                   "disk_reads_delta", "disk_writes_delta", "disk_read_kb_delta", "disk_write_kb_delta", "disk_io_ms_delta"])
    cont = Writer(os.path.join(a.out, "containers.csv"),
                  ["ts", "name", "cpu_pct", "mem_usage", "mem_pct", "net_io", "block_io", "pids"])
    act = Writer(os.path.join(a.out, "pg_activity.csv"),
                 ["ts", "state", "wait_event_type", "wait_event", "count", "max_active_s", "locks_not_granted", "blocked_backends"])
    pdb = Writer(os.path.join(a.out, "pg_db.csv"),
                 ["ts", "commit_d", "rollback_d", "blks_read_d", "blks_hit_d", "tup_returned_d", "tup_fetched_d",
                  "tup_inserted_d", "tup_updated_d", "tup_deleted_d", "deadlocks_d", "temp_bytes_d", "numbackends"])
    ptb = Writer(os.path.join(a.out, "pg_tables.csv"),
                 ["ts", "table", "seq_scan_d", "seq_tup_read_d", "idx_scan_d", "ins_d", "upd_d", "del_d", "n_dead_tup", "n_live_tup"])
    me = Writer(os.path.join(a.out, "agent_self.csv"), ["ts", "agent_cpu_pct", "agent_rss_kb"])
    with open(os.path.join(a.out, "agent_meta.json"), "w") as fh:
        json.dump({"started_at_utc": now_iso(), "interval_s": a.interval, "duration_s": a.duration,
                   "containers": containers, "pg_tables": tables, "pid": os.getpid()}, fh)

    prev_cpu, prev_vm, prev_disk = read_cpu(), read_vmstat(), read_disks()
    prev_self, prev_t = self_cpu()[0], time.monotonic()
    prev_db, prev_tbl = None, {}
    end = time.monotonic() + a.duration
    stats_result: list = []

    def stats_worker():
        stats_result[:] = docker_stats(containers)

    while not STOP.is_set() and time.monotonic() < end and not os.path.exists(os.path.join(a.out, "STOP")):
        t0 = time.monotonic()
        ts = now_iso()
        th = threading.Thread(target=stats_worker, daemon=True)
        th.start()
        cpu, vm, disks, mem = read_cpu(), read_vmstat(), read_disks(), read_meminfo()
        dt_total = max(1, cpu["total"] - prev_cpu["total"])
        pct = {k: round(100.0 * (cpu[k] - prev_cpu[k]) / dt_total, 2) for k in ("user", "system", "iowait", "steal", "idle")}
        load = open("/proc/loadavg").read().split()
        dsum = {k: sum(disks[d][k] - prev_disk.get(d, disks[d])[k] for d in disks) for k in ("reads", "writes", "rsect", "wsect", "io_ms")}
        host.row([ts, pct["user"], pct["system"], pct["iowait"], pct["steal"], round(100 - pct["idle"], 2), load[0], load[1],
                  mem.get("MemTotal", 0) // 1024, mem.get("MemAvailable", 0) // 1024,
                  (mem.get("SwapTotal", 0) - mem.get("SwapFree", 0)) // 1024,
                  vm.get("pswpin", 0) - prev_vm.get("pswpin", 0), vm.get("pswpout", 0) - prev_vm.get("pswpout", 0),
                  dsum["reads"], dsum["writes"], dsum["rsect"] // 2, dsum["wsect"] // 2, dsum["io_ms"]])
        prev_cpu, prev_vm, prev_disk = cpu, vm, disks

        if not a.no_pg:
            rows = pg_sample(a.pg_container, tables)
            blk = next((r[1] for r in rows if r[0] == "blk"), "")
            blkp = next((r[1] for r in rows if r[0] == "blkpids"), "")
            for r in rows:
                if r[0] == "act" and len(r) >= 6:
                    act.row([ts, r[1], r[2], r[3], r[4], r[5], blk, blkp])
                elif r[0] == "db" and len(r) >= 13:
                    vals = [int(float(x or 0)) for x in r[1:13]]
                    if prev_db is not None:
                        pdb.row([ts] + [vals[i] - prev_db[i] for i in range(11)] + [vals[11]])
                    prev_db = vals
                elif r[0] == "tbl" and len(r) >= 10:
                    vals = [int(float(x or 0)) for x in r[2:10]]
                    p = prev_tbl.get(r[1])
                    if p is not None:
                        ptb.row([ts, r[1]] + [vals[i] - p[i] for i in range(6)] + [vals[6], vals[7]])
                    prev_tbl[r[1]] = vals
        th.join(timeout=max(1.0, a.interval * 3))
        for s in stats_result:
            cont.row([ts, s.get("Name"), str(s.get("CPUPerc", "")).rstrip("%"), s.get("MemUsage"), str(s.get("MemPerc", "")).rstrip("%"),
                      s.get("NetIO"), s.get("BlockIO"), s.get("PIDs")])
        ticks, rss = self_cpu()
        el = max(1e-6, time.monotonic() - prev_t)
        me.row([ts, round(100.0 * (ticks - prev_self) / CLK / el, 2), rss])
        prev_self, prev_t = ticks, time.monotonic()
        STOP.wait(max(0.0, a.interval - (time.monotonic() - t0)))
    with open(os.path.join(a.out, "agent_meta.json"), "r+") as fh:
        meta = json.load(fh)
        meta["stopped_at_utc"] = now_iso()
        fh.seek(0)
        json.dump(meta, fh)
        fh.truncate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
