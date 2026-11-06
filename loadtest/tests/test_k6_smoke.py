"""DEBUG smoke of the k6 VU logic WITHOUT k6: every VU body (k6/main.js apiVU) runs in its own
node process with k6 modules shimmed (tests/js/k6shim) against a local stub of the frontend
(tests/stub_frontend.py, 127.0.0.1 only). k6 is not installed on the development machine, so this
exercises the screen/journey/probe/Track-B logic, guards, tags and metrics — not k6 itself.
Skipped automatically if node is missing."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from common.config import load_config, load_yaml  # noqa: E402
from seeder import generate  # noqa: E402



def _render():
    import importlib.util
    spec = importlib.util.spec_from_file_location("render_config", ROOT / "k6" / "render_config.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@unittest.skipUnless(shutil.which("node"), "node not installed")
class K6Smoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import stub_frontend
        cls.tmp = tempfile.TemporaryDirectory()
        out = Path(cls.tmp.name)
        generate.generate(load_yaml(ROOT / "config" / "seed.yaml"), [100], 42, "pw", out, progress=False)
        cls.fixtures = out / "fixtures.json"
        cls.srv = stub_frontend.serve(json.loads(cls.fixtures.read_text()), 0)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        subprocess.run([sys.executable, str(ROOT / "k6" / "data" / "make_spec_pdfs.py")], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.tmp.cleanup()

    def config(self, profile, warmup=2, steady=16):
        cfg = load_config(require_env=False)
        cfg["env"] = {"target": {"frontend_url": self.base}, "ec2_1_denylist": ["203.0.113.9"]}
        cfg["run"]["durations"] = {"warmup_minutes": warmup / 60, "steady_minutes": steady / 60, "graceful_stop_seconds": 5}
        cfg["screen_time"]["dwell_seconds"] = [3, 5]
        cfg["screen_time"]["think_seconds"] = [0.05, 0.2]
        sc = cfg["screens"]
        sc["dashboard"]["interactions_per_visit"] = [1, 1]
        sc["paged_probe"]["every_n_dashboard_visits"] = 1
        sc["rbac_probe"]["every_n_visits"] = 1
        sc["spec_upload"]["think_between_uploads_s"] = [0.5, 1]
        sc["bidpack"]["think_between_s"] = [0.5, 1]
        sc["probe"]["double_approval_at_min"] = [0.15]
        sc["probe"]["dual_track_race_at_min"] = [0.25]
        rc = _render().render(cfg, profile, 100, "DEBUG", f"smoke_{profile}", self.fixtures, ["127.0.0.1"], ai_mode="stub")
        # probes look up ids 20 s before firing; in the smoke the steady phase starts almost at once
        return rc

    def run_vus(self, rc, slots=None):
        d = Path(self.tmp.name)
        cfg_path = d / f"{rc['run_id']}.json"
        cfg_path.write_text(json.dumps(rc))
        start = int(time.time() * 1000) + 1500
        procs = []
        for i in (slots if slots is not None else range(len(rc["profile"]["slots"]))):
            env = dict(os.environ, LT_RUN_CONFIG=str(cfg_path), LT_PASSWORD="pw", LT_SLOT=str(i), LT_START_MS=str(start))
            procs.append(subprocess.Popen(["node", "--no-warnings", "--import", str(ROOT / "tests/js/k6shim/register.mjs"),
                                           str(ROOT / "tests/js/run_vu.mjs")], env=env, cwd=str(ROOT),
                                          stdout=subprocess.PIPE, stderr=subprocess.PIPE))
        results = []
        for p in procs:
            out, err = p.communicate(timeout=180)
            self.assertTrue(out, f"no output; stderr={err.decode()[-2000:]}")
            results.append(json.loads(out))
        return results

    def common_asserts(self, results):
        for r in results:
            self.assertIsNone(r["error"], f"slot {r['slot']}: {r['error']}")
            self.assertIsNone(r["aborted"], f"slot {r['slot']} aborted: {r['aborted']}")
            self.assertTrue(r["reqs"], f"slot {r['slot']} made no requests")
            for q in r["reqs"]:
                self.assertTrue(q["url"].startswith(self.base), q["url"])
                ok = 200 <= q["status"] < 300 or (q["expect"] and q["status"] == 403)
                self.assertTrue(ok, f"slot {r['slot']} {q['method']} {q['url']} -> {q['status']}")
                for tag in ("service", "name", "role", "screen", "origin", "run_type", "tier", "phase"):
                    self.assertIn(tag, q["tags"])
            logins = [q for q in r["reqs"] if q["url"].endswith("/api/auth/login")]
            self.assertEqual(len(logins), 1, f"slot {r['slot']} must log in exactly once")

    @staticmethod
    def metric(results, name, field="n"):
        return sum((r["metrics"].get(name) or {}).get(field, 0) for r in results)

    def test_mix_profile_all_17_vus(self):
        rc = self.config("MIX")
        self.assertEqual(len(rc["profile"]["slots"]), 17)
        results = self.run_vus(rc)
        self.common_asserts(results)
        self.assertEqual(self.metric(results, "lt_correctness_failures"), 0,
                         json.dumps([r["metrics"].get("lt_correctness_failures") for r in results]))
        self.assertGreater(self.metric(results, "lt_poll_ticks"), 20)
        self.assertGreater(self.metric(results, "lt_pagination_ok", "trues"), 0)
        self.assertGreater(self.metric(results, "lt_workflow_step_ok", "trues"), 0)
        self.assertEqual(self.metric(results, "lt_denied_request_attempts"), 0)
        self.assertGreater(self.metric(results, "lt_probe_runs"), 0)
        services = {q["tags"]["service"] for r in results for q in r["reqs"]}
        for s in ("S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S10", "S11", "S16"):
            self.assertIn(s, services)
        phases = {q["tags"]["phase"] for r in results for q in r["reqs"]}
        self.assertEqual(phases, {"warmup", "steady"})

    def test_track_b_uploader_and_bidpack(self):
        ai = self.config("AI-1")
        up = [i for i, s in enumerate(ai["profile"]["slots"]) if s["behaviour"] == "spec_upload"]
        dg = self.config("DOCGEN-1")
        bp = [i for i, s in enumerate(dg["profile"]["slots"]) if s["behaviour"] == "bidpack"]
        res = self.run_vus(ai, up) + self.run_vus(dg, bp)
        self.common_asserts(res)
        self.assertGreater(self.metric(res, "lt_spec_upload_ok", "trues"), 0)
        self.assertGreater(self.metric(res, "lt_spec_durations_total_ms"), 0)
        self.assertGreater(self.metric(res, "lt_spec_api_attempts"), 0)
        self.assertGreater(self.metric(res, "lt_bidpack_ok", "trues"), 0)
        prog = [q for r in res for q in r["reqs"] if q["url"].endswith("/tech-spec-progress")]
        self.assertGreater(len(prog), 2, "progress polling must run during uploads")


if __name__ == "__main__":
    unittest.main()
