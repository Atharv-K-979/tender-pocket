"""Seeder tests: proportions, consistency (reconcile fixed point), subset property, schema
validation with a fixture schema, password hashing, SQL stream shape. Offline only."""
import copy
import gzip
import hashlib
import json
import random
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from common.config import load_yaml  # noqa: E402
from seeder import generate, load, model, reconcile_sim, schema, validate  # noqa: E402

SEED_CFG = load_yaml(ROOT / "config" / "seed.yaml")
TIERS = [100, 500, 2000]


class GeneratedTiers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name)
        cls.manifests = generate.generate(SEED_CFG, TIERS, 42, "pw-for-tests", cls.out, progress=False)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def rows(self, tier, table):
        with gzip.open(self.out / f"tier_{tier}" / f"{table}.csv.gz", "rt", encoding="utf-8") as fh:
            return fh.read().splitlines()

    def test_proportions_identical_at_every_tier(self):
        tol = SEED_CFG["proportion_tolerance"]
        w = SEED_CFG["categories"]
        total = sum(w.values())
        for t in TIERS:
            shares = self.manifests[t]["universe_group_shares"]
            for g, members in SEED_CFG["groups"].items():
                target = sum(w[m] for m in members) / total
                self.assertLessEqual(abs(shares[g] - target), tol + 1 / t, f"tier {t} group {g}")
            cats = self.manifests[t]["universe_categories"]
            for c, wt in w.items():   # every category within one tender of exact
                self.assertLessEqual(abs(cats.get(c, 0) - t * wt / total), 1.0 + 1e-9, f"tier {t} cat {c}")

    def test_brief_bands(self):
        s = self.manifests[2000]["universe_group_shares"]
        self.assertTrue(0.60 <= s["new_unactioned"] <= 0.70)
        self.assertTrue(0.09 <= s["not_participating"] <= 0.11)
        self.assertTrue(0.10 <= s["active_workflow"] <= 0.15)
        self.assertTrue(0.09 <= s["submitted_won_lost"] <= 0.11)

    def test_subset_property(self):
        for table in schema.TABLE_ORDER:
            small, big = self.rows(100, table), self.rows(2000, table)
            self.assertEqual(big[:len(small)], small, f"{table}: tier 100 is not a prefix of tier 2000")
        fx_small = [r for r in self.rows(100, "tenders") if r.startswith("LTF-") or r.startswith("LTP-")]
        fx_big = [r for r in self.rows(2000, "tenders") if r.startswith("LTF-") or r.startswith("LTP-")]
        self.assertEqual(fx_small, fx_big, "fixture block differs between tiers")

    def test_deterministic(self):
        with tempfile.TemporaryDirectory() as d:
            generate.generate(SEED_CFG, [100], 42, "pw-for-tests", Path(d), progress=False)
            with gzip.open(Path(d) / "tier_100" / "tender_approval_requests.csv.gz", "rt") as fh:
                again = fh.read().splitlines()
        self.assertEqual(again, self.rows(100, "tender_approval_requests"))

    def test_validate_checks_pass_offline(self):
        for t in TIERS:
            tdir = self.out / f"tier_{t}"
            tenders = validate._num(validate.read_csv_table(tdir, "tenders", validate.TENDER_COLS))
            appr = validate._num(validate.read_csv_table(tdir, "tender_approval_requests", validate.APPROVAL_COLS))
            counts = {tb: len(self.rows(t, tb)) for tb in schema.TABLE_ORDER}
            res = validate.run_checks(tenders, appr, counts, self.manifests[t], SEED_CFG)
            for name, ok, detail in res:
                self.assertTrue(ok, f"tier {t} check {name}: {detail}")

    def test_fixtures_manifest(self):
        fx = json.loads((self.out / "fixtures.json").read_text())
        self.assertIn("lt_exec_01", fx["users"])
        self.assertEqual(len(fx["users"]["lt_exec_01"]["upload"]), SEED_CFG["fixtures"]["per_user"]["Tender Executive"]["upload"])
        self.assertEqual(len(fx["probe"]["double_approval"]), SEED_CFG["fixtures"]["probe"]["double_approval"])
        all_ids = [i for u in fx["users"].values() for v in u.values() for i in v]
        self.assertEqual(len(all_ids), len(set(all_ids)), "fixture ids must be unique")

    def test_one_pending_per_current_stage_assignee(self):
        tdir = self.out / "tier_2000"
        appr = validate.read_csv_table(tdir, "tender_approval_requests", validate.APPROVAL_COLS)
        pend = [a for a in appr if a["status"] == "PENDING" and a["tender_id"].startswith("LTF-CLEAR01-SC")]
        self.assertTrue(pend)
        self.assertTrue(all(a["assigned_to"] == "lt_clear_01" and a["stage"] == "SPEC_CLEARANCE" for a in pend))


class ReconcileSim(unittest.TestCase):
    def setUp(self):
        self.users = model.build_users(SEED_CFG, "pw")
        self.f = model.Factory(SEED_CFG, self.users)

    def bundle(self, cat, i=1):
        return self.f.build(f"T{i}", cat, random.Random(f"x:{i}:{cat}"))

    def test_every_category_is_fixed_point(self):
        for cat in model.ALL_CATEGORIES:
            for i in range(30):
                b = self.bundle(cat, i)
                acts = reconcile_sim.simulate({b.tender["id"]: b.tender}, b.approvals)
                self.assertEqual(acts, [], f"{cat}#{i}: {acts}")

    def test_detects_missing_pending(self):
        b = self.bundle("payment_approval")
        approvals = [a for a in b.approvals if a["status"] != "PENDING"]
        acts = reconcile_sim.simulate({b.tender["id"]: b.tender}, approvals)
        self.assertIn("insert_pending", [a[0] for a in acts])

    def test_detects_duplicate_and_alias(self):
        b = self.bundle("mis_pricing")
        dup = copy.deepcopy([a for a in b.approvals if a["status"] == "PENDING" and a["stage"] == "MIS_PRICING"][0])
        dup["created_at"] = "2000-01-01 00:00:00"
        acts = reconcile_sim.simulate({b.tender["id"]: b.tender}, b.approvals + [dup])
        self.assertIn("delete_duplicate", [a[0] for a in acts])
        for a in b.approvals:
            if a["stage"] == "MIS_PRICING" and a["status"] == "PENDING":
                a["assigned_to"] = "tpc"
        acts = reconcile_sim.simulate({b.tender["id"]: b.tender}, b.approvals)
        self.assertIn("reassign_mis", [a[0] for a in acts])

    def test_detects_stale_and_premature(self):
        b = self.bundle("spec_clearance_pending")
        b.tender["spec_verification_status"] = "Generated"
        acts = reconcile_sim.simulate({b.tender["id"]: b.tender}, b.approvals)
        self.assertIn("delete_premature_spec", [a[0] for a in acts])
        b = self.bundle("tpc_pricing")
        b.tender["tpc_purchase_price"] = 10.0
        acts = reconcile_sim.simulate({b.tender["id"]: b.tender}, b.approvals)
        self.assertIn("mark_stale_approved", [a[0] for a in acts])

    def test_payment_none_triggers_tender_write(self):
        b = self.bundle("payment_approval")
        b.tender["payment_status"] = "None"
        b.tender["current_stage"] = "PAYMENT_APPROVAL"
        acts = reconcile_sim.simulate({b.tender["id"]: b.tender}, b.approvals)
        self.assertIn("tender_save_payment_pending", [a[0] for a in acts])


class SchemaValidation(unittest.TestCase):
    def fixture(self):
        return schema.expected_schema_json()

    def write(self, data):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(data, f)
        f.close()
        return schema.load_schema_json(f.name)

    def test_matching_fixture_passes(self):
        errors, warnings = schema.validate_schema(self.write(self.fixture()))
        self.assertEqual(errors, [])

    def test_missing_column_fails_with_diff(self):
        data = self.fixture()
        data["tenders"] = [c for c in data["tenders"] if c["name"] != "current_stage"]
        errors, _ = schema.validate_schema(self.write(data))
        self.assertTrue(any("current_stage" in e and "missing" in e for e in errors), errors)
        self.assertIn("FAILED", schema.format_diff(errors, []))

    def test_type_mismatch_fails(self):
        data = self.fixture()
        for c in data["tender_approval_requests"]:
            if c["name"] == "created_at":
                c["data_type"] = "character varying"
        errors, _ = schema.validate_schema(self.write(data))
        self.assertTrue(any("created_at" in e for e in errors))

    def test_extra_columns(self):
        data = self.fixture()
        data["tenders"].append({"name": "legacy_col", "data_type": "text", "nullable": True})
        errors, warnings = schema.validate_schema(self.write(data))
        self.assertEqual(errors, [])
        self.assertTrue(any("legacy_col" in w for w in warnings))
        data["tenders"].append({"name": "must_fill", "data_type": "text", "nullable": False})
        errors, _ = schema.validate_schema(self.write(data))
        self.assertTrue(any("must_fill" in e for e in errors))

    def test_varchar_limit(self):
        data = self.fixture()
        for c in data["tender_workflow_comments"]:
            if c["name"] == "comment":
                c["max_len"] = 255
        errors, _ = schema.validate_schema(self.write(data), {"tender_workflow_comments": {"comment": 300}})
        self.assertTrue(any("comment" in e for e in errors))

    def test_live_tsv_parser(self):
        tsv = "tenders\tid\tcharacter varying\tNO\t\t255\tNO\nusers\tusername\tcharacter varying\tNO\t\t255\tNO\n"
        live = schema.parse_live_schema_tsv(tsv)
        self.assertEqual(live["tenders"]["id"].max_len, 255)
        self.assertFalse(live["users"]["username"].nullable)


class Misc(unittest.TestCase):
    def test_password_hash_matches_security_config(self):
        # SecurityConfig.java:29-56 — unsalted SHA-256 hex, lower case, zero padded.
        self.assertEqual(model.sha256_hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        self.assertEqual(model.sha256_hex("abc"), hashlib.sha256(b"abc").hexdigest())

    def test_usernames_and_roles(self):
        u = model.build_users(SEED_CFG, "pw")
        self.assertEqual({r["role"] for r in u.rows},
                         {"Tender Executive", "MIS Team", "Clearance Team", "TPC Team", "Admin"})
        self.assertEqual(len(u.owners), 15)
        self.assertTrue(all(r["email"].endswith(".invalid") for r in u.rows))

    def test_sql_stream_shape(self):
        mode = {"replica": True, "truncate_changelog": True}
        head = load.header_sql(mode, ["email_notification_logs"], "lt_")
        self.assertIn("BEGIN;", head)
        self.assertIn("session_replication_role = replica", head)
        self.assertIn('TRUNCATE "tenders"', head)
        self.assertIn("LIKE 'lt\\_%'", head)
        foot = load.footer_sql(mode)
        self.assertTrue(foot.strip().endswith("COMMIT;"))
        self.assertIn("TRUNCATE db_change_log;", foot)
        self.assertIn("setval(pg_get_serial_sequence('tender_approval_requests', 'id')", foot)

    def test_trigger_mode_choice(self):
        self.assertFalse(load.choose_trigger_mode("auto", [], False, True)["replica"])
        m = load.choose_trigger_mode("auto", ["trg_track_tenders@tenders"], True, True)
        self.assertTrue(m["replica"] and m["truncate_changelog"])
        m = load.choose_trigger_mode("auto", ["trg_track_tenders@tenders"], True, False)
        self.assertFalse(m["replica"])
        self.assertTrue(m["truncate_changelog"])
        self.assertFalse(load.choose_trigger_mode("fire", ["x"], True, True)["truncate_changelog"])


if __name__ == "__main__":
    unittest.main()
