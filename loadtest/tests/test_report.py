import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common.config import load_yaml  # noqa: E402
from report import build_report, classify as C  # noqa: E402

SLO = load_yaml(ROOT / "config" / "slo.yaml")


def stats(svc, durations, statuses=None, **kw):
    s = C.ServiceStats(svc)
    statuses = statuses or [200] * len(durations)
    for d, st in zip(durations, statuses):
        s.add_request(d, st, "ok", "1050" if st == 0 else "")
    for k, v in kw.items():
        setattr(s, k, v)
    return s.summary()


class Classification(unittest.TestCase):
    def test_s1_healthy_and_degraded(self):
        self.assertEqual(C.classify(stats("S1", [500] * 100), SLO)[0], "Healthy")
        st, why = C.classify(stats("S1", [500] * 90 + [3000] * 10), SLO)       # p95 3 s > 2 s
        self.assertEqual(st, "Degraded")
        self.assertTrue(any("p95" in w for w in why))

    def test_s1_success_threshold(self):
        # 0.6 % errors: below Broken (1 %) but above the approved 0.5 % → Degraded
        s = stats("S1", [100] * 1000, [200] * 994 + [500] * 6)
        self.assertEqual(C.classify(s, SLO)[0], "Degraded")

    def test_broken_rules(self):
        self.assertEqual(C.classify(stats("S7", [100] * 98 + [100] * 2, [200] * 98 + [500] * 2), SLO)[0], "Broken")   # 2 %
        self.assertEqual(C.classify(stats("S7", [100] * 99 + [300000], [200] * 99 + [0]), SLO)[0], "Broken")          # timeout
        self.assertEqual(C.classify(stats("S8", [61000] * 50), SLO)[0], "Broken")                                     # p95 > 60 s
        self.assertEqual(C.classify(stats("S9", [100] * 50, correctness_failures=1), SLO)[0], "Broken")

    def test_expected_403_excluded(self):
        s = C.ServiceStats("S16")
        for _ in range(30):
            s.add_request(50, 403, "rbac_403")
        s.add_request(50, 200, "ok")
        summ = s.summary()
        self.assertEqual(summ["n"], 1)
        self.assertEqual(summ["expected_4xx_excluded"], 30)
        self.assertEqual(summ["error_rate"], 0)

    def test_pagination(self):
        s = stats("S2", [100] * 50, pagination_checks=10, pagination_failures=1)
        self.assertEqual(C.classify(s, SLO)[0], "Broken")

    def test_track_b(self):
        s = stats("S18", [60000] * 30, trackb_attempts=30, trackb_failures=2)    # 6.7 % > 5 %
        self.assertEqual(C.classify(s, SLO)[0], "Broken")
        s = stats("S18", [60000] * 30, trackb_attempts=30, trackb_failures=1)
        self.assertEqual(C.classify(s, SLO)[0], "Healthy")
        s = stats("S18", [60000] * 30, trackb_attempts=30, stuck_jobs=1)
        self.assertEqual(C.classify(s, SLO)[0], "Broken")
        s = stats("S19", [9000] * 30, trackb_attempts=30)
        self.assertEqual(C.classify(s, SLO, restart_or_oom=True)[0], "Broken")

    def test_system_wide(self):
        self.assertEqual(C.classify(stats("S1", [10] * 100), SLO, ["connection-pool exhaustion"])[0], "Broken")

    def test_min_samples(self):
        self.assertEqual(C.classify(stats("S12", [10] * 3), SLO)[0], "n/a")

    def test_aggregate_and_breaking_point(self):
        self.assertEqual(C.aggregate_cell(["Broken", "Broken"]), "Broken")
        self.assertEqual(C.aggregate_cell(["Broken", "Healthy"]), "Broken?")
        self.assertEqual(C.aggregate_cell(["Healthy", "Degraded"]), "Degraded")
        by = {1000: ["Healthy", "Healthy"], 5000: ["Broken", "Healthy"], 10000: ["Broken", "Broken"], 25000: ["Broken", "Broken"]}
        self.assertEqual(C.breaking_point(by), {"tier": 10000, "status": "confirmed", "note": "Broken in 2 repeats; next tier 25000 Broken"})
        # recovered at the next tier → not a breaking point there
        by = {1000: ["Broken", "Broken"], 5000: ["Healthy", "Healthy"], 10000: ["Broken", "Broken"], 25000: ["Broken", "Broken"]}
        self.assertEqual(C.breaking_point(by)["tier"], 10000)
        # single repeat → candidate only
        self.assertEqual(C.breaking_point({100: ["Broken"], 500: ["Broken"]})["status"], "candidate")
        # last measured tier → candidate
        self.assertEqual(C.breaking_point({100: ["Healthy"] * 2, 500: ["Broken"] * 2})["status"], "candidate")
        self.assertEqual(C.breaking_point({100: ["Healthy"]})["status"], "none")

    def test_poll_overrun_marker(self):
        self.assertEqual(C.poll_overrun_tier({100: 200, 1000: 900, 5000: 1600, 10000: 4000}), 5000)
        self.assertIsNone(C.poll_overrun_tier({100: 200}))


class EndToEnd(unittest.TestCase):
    def test_build_report_from_synthetic_runs(self):
        with tempfile.TemporaryDirectory() as d:
            res = Path(d) / "results"
            for tier, rep, slow in ((1000, 1, 300), (1000, 2, 320), (5000, 1, 3000), (5000, 2, 70000), (10000, 1, 80000), (10000, 2, 90000)):
                rd = res / f"r_{tier}_{rep}"
                rd.mkdir(parents=True)
                (rd / "manifest.json").write_text(json.dumps({
                    "run_id": rd.name, "profile": "MIX", "tier": tier, "repeat": rep, "vu_total": 17, "poll_mode": "faithful",
                    "ai_mode": "mock", "validity": {"valid": True, "reasons": [], "broken_by_load": False}, "anomalies": []}))
                with gzip.open(rd / "raw.jsonl.gz", "wt") as fh:
                    for i in range(60):
                        for svc, ms in (("S1", slow), ("S5", 40)):
                            fh.write(json.dumps({"type": "Point", "metric": "http_req_duration", "data": {
                                "value": ms, "tags": {"service": svc, "status": "200", "phase": "steady", "expected": "ok"}}}) + "\n")
                        fh.write(json.dumps({"type": "Point", "metric": "http_req_duration", "data": {
                            "value": 99999, "tags": {"service": "S1", "status": "200", "phase": "warmup"}}}) + "\n")
                        fh.write(json.dumps({"type": "Point", "metric": "lt_pagination_ok", "data": {"value": 1, "tags": {"phase": "steady"}}}) + "\n")
            out = Path(d) / "rep"
            self.assertEqual(build_report.main(["--results", str(res), "--out", str(out)]), 0)
            md = (out / "report.md").read_text()
            self.assertIn("Matrix — MIX", md)
            rows = (out / "matrix_MIX.csv").read_text().splitlines()
            s1 = next(r for r in rows if r.startswith("S1,"))
            self.assertIn("Healthy", s1)
            self.assertIn("Broken?", s1)                 # 5000: one repeat Broken
            self.assertIn(",10000,", s1)                  # breaking point (last tier → candidate)
            self.assertTrue((out / "charts" / "p95_MIX.svg").read_text().startswith("<svg"))
            self.assertIn("first tier with median > 1.5 s = 5,000", md)


if __name__ == "__main__":
    unittest.main()
