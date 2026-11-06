import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orchestrator.validity import RestartEvent, RunFacts, evaluate  # noqa: E402

W0, W1 = "2026-11-10T10:03:00+00:00", "2026-11-10T10:18:00+00:00"
K0, K1 = "2026-11-10T10:00:00+00:00", "2026-11-10T10:19:00+00:00"


def facts(**kw):
    base = dict(run_type="BENCHMARK", vu_total=17, expected_vus=17, window_start=W0, window_end=W1, k6_start=K0, k6_end=K1,
                generator_cpu=[(f"2026-11-10T10:{m:02d}:00+00:00", 40.0) for m in range(3, 19)])
    base.update(kw)
    return RunFacts(**base)


class Validity(unittest.TestCase):
    def test_clean_run_valid(self):
        v = evaluate(facts())
        self.assertTrue(v["valid"], v)
        self.assertFalse(v["broken_by_load"])

    def test_generator_cpu_over_80_for_more_than_10pct(self):
        cpu = [(f"2026-11-10T10:{m:02d}:00+00:00", 95.0 if m < 6 else 30.0) for m in range(3, 19)]   # 3/16 = 19 %
        self.assertFalse(evaluate(facts(generator_cpu=cpu))["valid"])
        cpu = [(f"2026-11-10T10:{m:02d}:00+00:00", 95.0 if m == 3 else 30.0) for m in range(3, 19)]  # 1/16 = 6 %
        self.assertTrue(evaluate(facts(generator_cpu=cpu))["valid"])

    def test_samples_outside_window_ignored(self):
        cpu = [("2026-11-10T09:00:00+00:00", 99.0)] + [(f"2026-11-10T10:{m:02d}:00+00:00", 10.0) for m in range(3, 19)]
        self.assertTrue(evaluate(facts(generator_cpu=cpu))["valid"])

    def test_no_generator_samples_invalid(self):
        self.assertFalse(evaluate(facts(generator_cpu=[]))["valid"])

    def test_non_load_restart_invalid(self):
        r = RestartEvent("tender-pocket-backend", "2026-11-10T09:50:00+00:00", exit_code=1)
        self.assertFalse(evaluate(facts(restarts=[r]))["valid"])
        r = RestartEvent("tender-pocket-backend", "2026-11-10T10:10:00+00:00", exit_code=0, autoupdate_exit=True)
        v = evaluate(facts(restarts=[r]))
        self.assertFalse(v["valid"])
        self.assertIn("self-update", v["reasons"][0])

    def test_load_caused_oom_is_valid_broken(self):
        r = RestartEvent("tender-pocket-backend", "2026-11-10T10:10:00+00:00", oom_killed=True, exit_code=137)
        v = evaluate(facts(restarts=[r]))
        self.assertTrue(v["valid"])
        self.assertTrue(v["broken_by_load"])
        self.assertEqual(v["classification_hint"], "Broken")

    def test_scheduler_overlap_invalid(self):
        self.assertFalse(evaluate(facts(scheduler_lines=["x"]))["valid"])
        self.assertFalse(evaluate(facts(backup_runs_in_window=1))["valid"])

    def test_sqlite_invalid(self):
        self.assertFalse(evaluate(facts(datasource="sqlite"))["valid"])
        self.assertFalse(evaluate(facts(datasource="unknown"))["valid"])

    def test_forbidden_window_invalid(self):
        self.assertFalse(evaluate(facts(forbidden_windows_hit=["07:45-08:30 IST"]))["valid"])

    def test_vu_total(self):
        self.assertFalse(evaluate(facts(vu_total=16))["valid"])
        self.assertTrue(evaluate(facts(run_type="DEBUG", vu_total=3))["valid"])

    def test_mock_ai_required(self):
        self.assertFalse(evaluate(facts(requires_mock_ai=True, mock_ai_reachable=False))["valid"])
        self.assertTrue(evaluate(facts(requires_mock_ai=False, mock_ai_reachable=False))["valid"])


if __name__ == "__main__":
    unittest.main()
