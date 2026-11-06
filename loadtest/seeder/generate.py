#!/usr/bin/env python3
"""Generate COPY-ready CSVs per table per tier (Part 2).

    python3 seeder/generate.py --tiers 100,500,1000,5000,10000,25000,50000,75000,100000 --seed 42

Writes seeder/out/tier_<N>/<table>.csv.gz + manifest.json, and seeder/out/fixtures.json
(per-VU pre-staged tender ids, consumed by the k6 run config). Offline: no DB, no network.
Tier N contains universe tenders 0..N-1 (a strict prefix of every larger tier) plus the
identical fixture block. CSV NULL is written as \\N (COPY ... WITH (FORMAT csv, NULL '\\N')).
"""
from __future__ import annotations

import argparse
import collections
import csv
import gzip
import hashlib
import json
import os
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common.config import load_config, load_yaml, CONFIG_DIR  # noqa: E402
from seeder import model  # noqa: E402
from seeder.schema import TABLES, TABLE_ORDER  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "out"
NULL = r"\N"
GENERATOR_VERSION = "1"


def cell(v):
    if v is None:
        return NULL
    if isinstance(v, bool):
        return "t" if v else "f"
    if isinstance(v, float):
        return repr(v)
    return str(v)


class TierWriters:
    def __init__(self, tiers: list[int], out_dir: Path, level: int):
        self.tiers = sorted(tiers)
        self.files = {}
        self.writers = {}
        self.counts = {t: collections.Counter() for t in self.tiers}
        for t in self.tiers:
            d = out_dir / f"tier_{t}"
            d.mkdir(parents=True, exist_ok=True)
            for table in TABLE_ORDER:
                fh = gzip.open(d / f"{table}.csv.gz", "wt", encoding="utf-8", newline="", compresslevel=level)
                self.files[(t, table)] = fh
                self.writers[(t, table)] = csv.writer(fh, lineterminator="\n")

    def write(self, table: str, row: dict, min_tier_index: int | None):
        """Write to every tier that includes this row (fixtures: min_tier_index None = all)."""
        cols = [c for c, _ in TABLES[table]]
        values = [cell(row.get(c)) for c in cols]
        for t in self.tiers:
            if min_tier_index is None or min_tier_index < t:
                self.writers[(t, table)].writerow(values)
                self.counts[t][table] += 1

    def close(self):
        for fh in self.files.values():
            fh.close()


class Ids:
    def __init__(self):
        self.next = collections.defaultdict(lambda: 1)

    def take(self, table: str) -> int:
        v = self.next[table]
        self.next[table] = v + 1
        return v


def emit_bundle(b: model.Bundle, w: TierWriters, ids: Ids, idx: int | None, maxlen: dict):
    def put(table, row):
        if table != "tenders":
            row["id"] = ids.take(table)
        for k, v in row.items():
            if isinstance(v, str):
                ml = maxlen[table]
                if len(v) > ml.get(k, 0):
                    ml[k] = len(v)
        w.write(table, row, idx)
    put("tenders", b.tender)
    if b.state:
        put("tender_workflow_states", b.state)
    for a in b.approvals:
        put("tender_approval_requests", a)
    for c in b.comments:
        put("tender_comments", c)
    for c in b.wcomments:
        put("tender_workflow_comments", c)
    for h in b.history:
        put("status_history", h)
    for a in b.activity:
        put("activity_log", a)
    for m in b.manifest:
        put("tender_document_manifest", m)


def config_digest(seed_cfg: dict) -> str:
    return hashlib.sha256(json.dumps(seed_cfg, sort_keys=True).encode()).hexdigest()[:16]


def generate(seed_cfg: dict, tiers: list[int], seed: int, password: str, out_dir: Path,
             progress: bool = True) -> dict:
    seed_cfg = dict(seed_cfg)
    seed_cfg["seed"] = seed
    users = model.build_users(seed_cfg, password)
    factory = model.Factory(seed_cfg, users)
    max_tier = max(tiers)
    w = TierWriters(tiers, out_dir, int(seed_cfg.get("csv_gzip_level", 3)))
    ids = Ids()
    maxlen: dict[str, dict[str, int]] = collections.defaultdict(dict)
    fixtures: dict = {"users": {}, "probe": {}}
    t0 = time.time()

    for u in users.rows:
        w.write("users", u, None)

    # Fixture block first (identical ids at every tier).
    for tid, cat, assign, owner, kind in model.fixture_plan(seed_cfg, users):
        b = model.build_fixture(factory, seed, tid, cat, assign)
        emit_bundle(b, w, ids, None, maxlen)
        if owner == "probe":
            fixtures["probe"].setdefault(kind, []).append(tid)
        else:
            fixtures["users"].setdefault(owner, {}).setdefault(kind, []).append(tid)

    # Universe prefix.
    tier_cats = {t: collections.Counter() for t in tiers}
    prefix = seed_cfg.get("id_prefix_universe", "LTU-")
    for i, cat in enumerate(model.proportional_sequence(seed_cfg["categories"], max_tier)):
        b = factory.build(f"{prefix}{i:07d}", cat, random.Random(f"{seed}:u:{i}"))
        emit_bundle(b, w, ids, i, maxlen)
        for t in tiers:
            if i < t:
                tier_cats[t][cat] += 1
        if progress and i and i % 20000 == 0:
            print(f"  generated {i:,} universe tenders ({time.time() - t0:.0f}s)", flush=True)
    w.close()

    fixture_count = sum(len(v) for u in fixtures["users"].values() for v in u.values()) + \
        sum(len(v) for v in fixtures["probe"].values())
    with open(out_dir / "fixtures.json", "w", encoding="utf-8") as fh:
        json.dump({"seed": seed, "fixture_tenders": fixture_count, **fixtures}, fh, indent=1, sort_keys=True)

    groups = seed_cfg.get("groups", {})
    manifests = {}
    for t in tiers:
        cats = tier_cats[t]
        man = {
            "tier": t, "universe_tenders": t, "fixture_tenders": fixture_count,
            "total_tenders": w.counts[t]["tenders"], "row_counts": dict(w.counts[t]),
            "universe_categories": dict(cats),
            "universe_group_shares": {g: round(sum(cats[c] for c in members) / t, 6) for g, members in groups.items()},
            "seed": seed, "anchor_date": seed_cfg["anchor_date"], "generator_version": GENERATOR_VERSION,
            "config_digest": config_digest(seed_cfg), "max_lengths": maxlen,
            "users": {r: n for r, n in users.by_role.items()}, "inactive_executives": users.inactive_execs,
            "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        with open(out_dir / f"tier_{t}" / "manifest.json", "w", encoding="utf-8") as fh:
            json.dump(man, fh, indent=1, sort_keys=True)
        manifests[t] = man
    if progress:
        print(f"done in {time.time() - t0:.0f}s -> {out_dir}")
    return manifests


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiers", default=None, help="comma list (default: seed.yaml tiers)")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--password-env", default="LT_TEST_PASSWORD",
                    help="env var holding the test-user password if env.yaml is absent")
    args = ap.parse_args(argv)

    seed_cfg = load_yaml(CONFIG_DIR / "seed.yaml")
    cfg = load_config(require_env=False)
    password = (cfg.get("env") or {}).get("test_user_password") or os.environ.get(args.password_env)
    if not password or password.startswith("CHANGE-ME"):
        print("ERROR: set test_user_password in config/env.yaml (or $LT_TEST_PASSWORD)", file=sys.stderr)
        return 2
    tiers = [int(x) for x in (args.tiers.split(",") if args.tiers else seed_cfg["tiers"])]
    seed = args.seed if args.seed is not None else int(seed_cfg.get("seed", 42))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    print(f"generating tiers {tiers} seed={seed} -> {out}")
    generate(seed_cfg, tiers, seed, password, out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
