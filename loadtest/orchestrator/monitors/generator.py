#!/usr/bin/env python3
"""Load-generator monitor (stdlib): host CPU/memory plus CPU/RSS of k6 and browser processes.

    python3 generator.py --out results/<run>/generator.csv --interval 5 --duration 1260

Feeds the validity rule "generator CPU > 80 % for > 10 % of the window" (validity.py).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import signal
import time

CLK = os.sysconf("SC_CLK_TCK")
STOP = False


def cpu_total():
    with open("/proc/stat") as fh:
        vals = [int(x) for x in fh.readline().split()[1:9]]
    return sum(vals), vals[3] + vals[4]


def procs(names: set[str]) -> dict[int, tuple[str, int, int]]:
    out = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/comm") as fh:
                comm = fh.read().strip()
            if not any(comm.startswith(n) for n in names):
                continue
            with open(f"/proc/{pid}/stat") as fh:
                p = fh.read().rsplit(")", 1)[1].split()
            rss = int(p[21]) * os.sysconf("SC_PAGE_SIZE") // 1024
            out[int(pid)] = (comm, int(p[11]) + int(p[12]), rss)
        except (OSError, ValueError, IndexError):
            continue
    return out


def main() -> int:
    global STOP
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--interval", type=float, default=5)
    ap.add_argument("--duration", type=float, default=3600)
    ap.add_argument("--names", default="k6,chrome,chromium,chromium-browser,headless_shell")
    a = ap.parse_args()
    names = {n for n in a.names.split(",") if n}
    signal.signal(signal.SIGTERM, lambda *_: globals().__setitem__("STOP", True))
    ncpu = os.cpu_count() or 1
    new = not os.path.exists(a.out)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    fh = open(a.out, "a", newline="")
    w = csv.writer(fh)
    if new:
        w.writerow(["ts", "host_cpu_pct", "mem_available_mb", "k6_cpu_pct", "k6_rss_mb", "browser_cpu_pct", "browser_rss_mb", "browser_procs"])
    pt, pi = cpu_total()
    pp = procs(names)
    t_prev = time.monotonic()
    end = time.monotonic() + a.duration
    while not STOP and time.monotonic() < end:
        time.sleep(a.interval)
        t, i = cpu_total()
        host = 100.0 * (1 - (i - pi) / max(1, t - pt))
        pt, pi = t, i
        cur = procs(names)
        el = max(1e-6, time.monotonic() - t_prev)
        t_prev = time.monotonic()
        k6c = k6r = bc = br = 0.0
        nb = 0
        for pid, (comm, ticks, rss) in cur.items():
            d = ticks - pp.get(pid, (comm, ticks, rss))[1]
            pct = 100.0 * d / CLK / el / ncpu
            if comm.startswith("k6"):
                k6c += pct
                k6r += rss / 1024
            else:
                bc += pct
                br += rss / 1024
                nb += 1
        pp = cur
        with open("/proc/meminfo") as m:
            avail = next((int(line.split()[1]) // 1024 for line in m if line.startswith("MemAvailable")), 0)
        w.writerow([dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), round(host, 2), avail,
                    round(k6c, 2), round(k6r, 1), round(bc, 2), round(br, 1), nb])
        fh.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
