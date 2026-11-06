"""Safety + config tests: pre-flight rejects EC2-1, deny-list blocks (Python ↔ JS parity),
profile totals == 17, forbidden windows, --approved gate, pre-flight log parsers."""
import datetime as dt
import io
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common.config import ConfigError, assert_total_vus, load_profile, load_yaml, profile_vu_slots  # noqa: E402
from common.safety import (SafetyError, check_frontend_url, check_target_not_ec2_1, in_forbidden_window,  # noqa: E402
                           path_is_denied, preflight_target, require_approved)
from orchestrator import preflight as pf  # noqa: E402

DENY = load_yaml(ROOT / "config" / "safety.yaml")["endpoint_denylist"]
FAKE_DNS = {"ec2-2.internal": ["10.0.0.20"], "alias-of-ec2-1.example": ["10.0.0.10"], "ec2-1.example": ["10.0.0.10"]}


def resolver(h):
    return FAKE_DNS.get(h, [])


class TargetSafety(unittest.TestCase):
    def test_rejects_ec2_1_by_ip_name_and_alias(self):
        deny = ["10.0.0.10", "ec2-1.example"]
        with self.assertRaises(SafetyError):
            check_target_not_ec2_1("http://10.0.0.10:8085", deny, resolver)
        with self.assertRaises(SafetyError):
            check_target_not_ec2_1("http://ec2-1.example:8085", deny, resolver)
        with self.assertRaises(SafetyError):
            check_target_not_ec2_1("http://alias-of-ec2-1.example:8085", deny, resolver)   # resolves to EC2-1's IP
        info = check_target_not_ec2_1("http://ec2-2.internal:8085", deny, resolver)
        self.assertEqual(info["resolved"], ["10.0.0.20"])

    def test_empty_denylist_refused(self):
        with self.assertRaises(SafetyError):
            check_target_not_ec2_1("http://10.0.0.20:8085", [], resolver)

    def test_preflight_target_uses_env(self):
        cfg = {"env": {"target": {"frontend_url": "http://10.0.0.10:8085"}, "ec2_1_denylist": ["10.0.0.10"]},
               "safety": load_yaml(ROOT / "config" / "safety.yaml")}
        with self.assertRaises(SafetyError):
            preflight_target(cfg)

    def test_backend_port_blocked(self):
        with self.assertRaises(SafetyError):
            check_frontend_url("http://10.0.0.20:8090", [8090])


class DenyList(unittest.TestCase):
    BLOCK = ["/api/tenders/sync-gem", "/api/tenders/sync-emails", "/api/tenders/trigger-due-alerts", "/api/update/apply",
             "/api/update", "/api/noticedesk/x", "/api/products/models/upload", "/api/preview-doc", "/api/signatures/upload",
             "/api/tenders/A/generate-tech-specs", "/api/company-docs/1", "/documents/A/b.pdf", "/api/tenders/A/documents/b.pdf"]
    ALLOW = ["/api/tenders", "/api/tenders/A", "/api/tenders/stats", "/api/approvals/pending", "/api/approvals/3/review",
             "/api/tenders/A/generate-bid-docs", "/api/tenders/A/upload-tech-spec", "/api/v2/workflow/A/route-pricing"]

    def test_python_blocks(self):
        for p in self.BLOCK:
            self.assertIsNotNone(path_is_denied(p, DENY), p)
        for p in self.ALLOW:
            self.assertIsNone(path_is_denied(p, DENY), p)

    def test_js_fixture_in_sync_with_config(self):
        self.assertEqual(json.loads((ROOT / "tests" / "js" / "denylist.json").read_text()), DENY,
                         "regenerate tests/js/denylist.json from config/safety.yaml")

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_python_js_parity(self):
        paths = self.BLOCK + self.ALLOW + ["/api/update/", "/api/productsx", "/api/tenders/sync-gem?x=1", "/api/company-docs"]
        js = ("import {matchDeny} from './k6/lib/guards.js';"
              f"const D={json.dumps(DENY)};const P={json.dumps(paths)};"
              "console.log(JSON.stringify(P.map(p=>matchDeny(p,D)!==null)));")
        out = subprocess.run(["node", "--input-type=module", "-e", js], cwd=str(ROOT), capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(out.stdout), [path_is_denied(p, DENY) is not None for p in paths])


class Profiles(unittest.TestCase):
    def test_every_benchmark_profile_totals_17(self):
        for p in sorted((ROOT / "k6" / "profiles").glob("*.yaml")):
            prof = load_profile(p.stem)
            if prof.get("debug_only"):
                with self.assertRaises(ConfigError):
                    assert_total_vus(prof, "BENCHMARK", 17)
                continue
            self.assertEqual(assert_total_vus(prof, "BENCHMARK", 17), 17, p.stem)
            self.assertEqual(sum(1 for s in profile_vu_slots(prof) if s["kind"] == "browser"), 3, p.stem)

    def test_brief_allocations(self):
        def counts(name):
            out = {}
            for s in profile_vu_slots(load_profile(name)):
                out.setdefault(s["role"], [0, 0])
                out[s["role"]][0] += 1
                out[s["role"]][1] += s["kind"] == "browser"
            return out
        self.assertEqual(counts("MIX"), {"Tender Executive": [6, 1], "MIS Team": [4, 1], "Clearance Team": [3, 0], "TPC Team": [3, 0], "Admin": [1, 1]})
        self.assertEqual(counts("READ"), {"Tender Executive": [4, 1], "MIS Team": [5, 1], "Clearance Team": [2, 0], "TPC Team": [3, 0], "Admin": [3, 1]})
        self.assertEqual(counts("APPROVALS"), {"MIS Team": [6, 1], "Clearance Team": [5, 1], "TPC Team": [4, 1], "Admin": [2, 0]})
        self.assertEqual(counts("WORKFLOW"), {"Tender Executive": [6, 1], "MIS Team": [5, 1], "Clearance Team": [3, 1], "TPC Team": [3, 0]})

    def test_seeded_users_cover_profiles(self):
        seed = load_yaml(ROOT / "config" / "seed.yaml")
        for p in (ROOT / "k6" / "profiles").glob("*.yaml"):
            per = {}
            for s in profile_vu_slots(load_profile(p.stem)):
                per[s["role"]] = per.get(s["role"], 0) + 1
            for role, n in per.items():
                self.assertLessEqual(n, seed["users"]["roles"][role]["count"], f"{p.stem} {role}")


class WindowsAndGate(unittest.TestCase):
    def test_forbidden_windows(self):
        w = [["07:45", "08:30"], ["01:45", "05:30"]]
        utc = dt.timezone.utc
        # 02:00 UTC = 07:30 IST; 20-min run ends 07:50 IST → overlaps
        self.assertTrue(in_forbidden_window(dt.datetime(2026, 11, 10, 2, 0, tzinfo=utc), dt.datetime(2026, 11, 10, 2, 20, tzinfo=utc), w))
        # 06:00 UTC = 11:30 IST → clear
        self.assertFalse(in_forbidden_window(dt.datetime(2026, 11, 10, 6, 0, tzinfo=utc), dt.datetime(2026, 11, 10, 6, 20, tzinfo=utc), w))
        # 20:30 UTC = 02:00 IST next day → overlaps 01:45-05:30
        self.assertTrue(in_forbidden_window(dt.datetime(2026, 11, 10, 20, 30, tzinfo=utc), dt.datetime(2026, 11, 10, 20, 50, tzinfo=utc), w))

    def test_approved_gate(self):
        buf = io.StringIO()
        with self.assertRaises(SafetyError):
            require_approved(False, "TRUNCATE tenders", out=buf)
        self.assertIn("TRUNCATE tenders", buf.getvalue())
        require_approved(True, "TRUNCATE tenders", out=io.StringIO())


class PreflightParsers(unittest.TestCase):
    LOG = """2026-11-10T03:00:00.1Z [DatabaseConfig] Configured PostgreSQL DataSource successfully.
2026-11-10T03:00:16.0Z [Scheduler] Running automated startup/periodic Tender sync...
2026-11-10T03:00:20.0Z [Scheduler] Email sync skipped or failed (check IMAP credentials): x
2026-11-10T03:09:00.0Z [Scheduler] GeM Sync completed. Imported: 3
"""

    def test_datasource(self):
        self.assertEqual(pf.parse_datasource(self.LOG), "postgresql")
        self.assertEqual(pf.parse_datasource(self.LOG + "x [DatabaseConfig] PostgreSQL connection failed (y). Falling back to SQLite database tenders.db"), "sqlite")
        self.assertEqual(pf.parse_datasource(""), "unknown")

    def test_scheduler_state_and_next_sync(self):
        s = pf.parse_scheduler(self.LOG)
        self.assertFalse(s["in_progress"])
        running = pf.parse_scheduler(self.LOG + "2026-11-10T09:09:01.0Z [Scheduler] Running automated startup/periodic Tender sync...\n")
        self.assertTrue(running["in_progress"])
        utc = dt.timezone.utc
        # next sync 09:09 UTC; run 08:55–09:20 → conflict; run 06:00–06:20 → clear
        self.assertTrue(pf.next_sync_conflicts(s["ends"], dt.datetime(2026, 11, 10, 8, 55, tzinfo=utc), dt.datetime(2026, 11, 10, 9, 20, tzinfo=utc), 6, 20))
        self.assertFalse(pf.next_sync_conflicts(s["ends"], dt.datetime(2026, 11, 10, 6, 0, tzinfo=utc), dt.datetime(2026, 11, 10, 6, 20, tzinfo=utc), 6, 20))
        # two intervals later (15:09) still predicted
        self.assertTrue(pf.next_sync_conflicts(s["ends"], dt.datetime(2026, 11, 10, 15, 0, tzinfo=utc), dt.datetime(2026, 11, 10, 15, 20, tzinfo=utc), 6, 20))

    def test_env_presence_cmd_never_echoes_values(self):
        cmd = pf.env_presence_cmd("tender-pocket-backend", ["GEMINI_API_KEY"])
        self.assertIn("GEMINI_API_KEY=set", cmd)
        self.assertNotIn("echo $GEMINI_API_KEY", cmd)
        self.assertNotIn("env |", cmd)


if __name__ == "__main__":
    unittest.main()
