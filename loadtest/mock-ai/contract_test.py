#!/usr/bin/env python3
"""Contract test: reproduce the request the backend sends and check the mock's answer the
way the backend parses it.

    python3 mock-ai/contract_test.py            # starts the mock in-process on a free port
    python3 mock-ai/contract_test.py --url http://127.0.0.1:8800/v1   # test a running mock

Request shape = buildAzureResponsesPayload (AISpecificationIntelligenceService.java:824-967)
for COMPLIANCE_ROWS with a prompt built like callGenerativeLlmAi (:1372-1385). Checks mirror
parseLlmJsonResponse (:1763-1825) and coversComplianceSourceClauses (:1539-1574).
"""
from __future__ import annotations

import base64
import importlib.util
import json
import re
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("mock_ai_server", HERE / "server.py")
server = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(server)

ROW_FIELDS = ["clauseReference", "requirement", "requiredEvidence", "reviewerRemarks", "productCategory",
              "sourceReference", "rowType", "sectionReference", "sectionTitle", "scheduleReference"]
TEXT = """[SOURCE_PAGE pdf="1" printed="1"]
TECHNICAL SPECIFICATIONS
1. Multipara Patient Monitor
1.1 Display shall be 15 inch colour TFT with touch screen.
1.2 Shall monitor ECG, SpO2, NIBP, temperature and respiration.
2 each
[/SOURCE_PAGE]
[SOURCE_PAGE pdf="2" printed="2"]
1.3 Battery backup of minimum 4 hours.
2. Accessories
2.1 Five lead ECG cable
[/SOURCE_PAGE]"""


def sources_options(text: str) -> list[str]:
    """Port of sourceReferenceOptions (:1617-1637)."""
    pages = []
    for m in re.finditer(r'\[SOURCE_PAGE pdf="(\d+)"(?: printed="(\d+)")?]', text):
        ref = "PDF p. " + m.group(1) + ("" if m.group(2) is None else f" (Printed p. {m.group(2)})")
        if ref not in pages:
            pages.append(ref)
    if not pages or len(pages) > 4:
        return []
    out = []
    for mask in range(1, 1 << len(pages)):
        out.append("; ".join(p for i, p in enumerate(pages) if mask & (1 << i)))
    return out


def build_request(text: str = TEXT, known_products: list[str] | None = None, pdf: bytes = b"%PDF-1.4 mock") -> dict:
    prompt = "RULES ... (≈9k chars in production)\n\nEXTRACTED DOCUMENT TEXT:\n" + text
    anchors = server.source_clause_anchors(prompt)
    prompt += "\nNUMBERED SOURCE CLAUSES THAT MUST BE ACCOUNTED FOR: " + json.dumps(list(dict.fromkeys(v[0] for v in anchors.values())))
    prompt += "\nSOURCE CLAUSE KEYS: " + json.dumps(list(anchors)) + "\nALLOWED SOURCE REFERENCES: " + json.dumps(sources_options(text))
    row_props = {f: {"type": "string"} for f in ROW_FIELDS}
    row_props["rowType"]["enum"] = ["requirement", "continuation", "heading"]
    opts = sources_options(text)
    if opts:
        row_props["sourceReference"]["enum"] = opts
    if known_products:
        row_props["productCategory"]["enum"] = known_products
    schema = {"type": "object", "additionalProperties": False,
              "properties": {"readable": {"type": "boolean"},
                             "clauseDecisions": {"type": "object", "additionalProperties": False,
                                                 "properties": {k: {"type": "string", "enum": ["included", "excluded", "heading"]} for k in anchors},
                                                 "required": list(anchors)},
                             "rows": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                                                 "properties": row_props, "required": ROW_FIELDS}}},
              "required": ["readable", "clauseDecisions", "rows"]}
    return {"model": "gpt-5-nano", "reasoning": {"effort": "low"}, "store": False, "max_output_tokens": 32768,
            "input": [{"role": "user", "content": [
                {"type": "input_text", "text": prompt + "\nReturn the extracted array in the required rows property."},
                {"type": "input_file", "filename": "tender-batch.pdf",
                 "file_data": "data:application/pdf;base64," + base64.b64encode(pdf).decode()}]}],
            "text": {"format": {"type": "json_schema", "name": "compliance_rows", "strict": True, "schema": schema}}}


def post(url: str, payload: dict, timeout: float = 30):
    req = urllib.request.Request(url.rstrip("/") + "/responses", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "api-key": "dummy"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def extract_model_text(raw: bytes) -> str:
    """extractModelText (:1977-2012), Azure branch."""
    root = json.loads(raw)
    for item in root.get("output", []):
        for part in item.get("content", []):
            if isinstance(part.get("text"), str) and part.get("type", "") in ("output_text", ""):
                return part["text"]
    raise AssertionError("no output_text")


class _Base(unittest.TestCase):
    URL = None
    cfg_overrides: dict = {}

    @classmethod
    def setUpClass(cls):
        if cls.URL:
            cls.url, cls.srv = cls.URL, None
            return
        cfg = {"seed": 1, "max_concurrency": 8, "latency": {"default": {"kind": "fixed", "ms": 5}},
               "log_dir": str(Path(__import__("tempfile").mkdtemp()) / "logs"), "faults": {}, "content": {}}
        cfg.update(cls.cfg_overrides)
        cls.srv = server.make_server(cfg, "127.0.0.1", 0)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.srv.server_address[1]}/v1"

    @classmethod
    def tearDownClass(cls):
        if cls.srv:
            cls.srv.shutdown()
            cls.srv.server_close()


class ContractTest(_Base):
    def test_compliance_rows_contract(self):
        payload = build_request(known_products=["Multipara Patient Monitor"])
        code, headers, raw = post(self.url, payload)
        self.assertEqual(code, 200)
        env = json.loads(raw)
        self.assertEqual(env["status"], "completed")                           # :1767-1768
        for k in ("input_tokens", "output_tokens", "total_tokens"):
            self.assertGreater(env["usage"][k], 0)
        self.assertIn("cached_tokens", env["usage"]["input_tokens_details"])
        self.assertIn("reasoning_tokens", env["usage"]["output_tokens_details"])
        result = json.loads(extract_model_text(raw))
        self.assertIs(result["readable"], True)
        schema = payload["text"]["format"]["schema"]
        expected_keys = schema["properties"]["clauseDecisions"]["required"]
        prompt_keys = json.loads(re.search(r"SOURCE CLAUSE KEYS: (\[.*?\])", payload["input"][0]["content"][0]["text"]).group(1))
        self.assertEqual(expected_keys, prompt_keys)
        self.assertEqual(sorted(result["clauseDecisions"]), sorted(expected_keys))   # exactly the keys (:1544)
        self.assertTrue(set(result["clauseDecisions"].values()) <= {"included", "excluded", "heading"})
        allowed = schema["properties"]["rows"]["items"]["properties"]["sourceReference"]["enum"]
        for row in result["rows"]:
            self.assertEqual(sorted(row), sorted(ROW_FIELDS))                       # strict schema
            self.assertTrue(all(isinstance(v, str) for v in row.values()))          # :1792-1796
            self.assertIn(row["sourceReference"], allowed)
            self.assertIn(row["rowType"], ("requirement", "continuation", "heading"))
            self.assertTrue(row["requirement"].strip())
            self.assertEqual(row["productCategory"], "Multipara Patient Monitor")
        # coverage: every included key has a row with the clause number and its page (:1547-1556)
        for key, decision in result["clauseDecisions"].items():
            if decision != "included":
                continue
            page, number = key.split(":", 1)
            self.assertTrue(any(r["clauseReference"] == number and re.search(rf"PDF p\. {page[1:]}(?!\d)", r["sourceReference"])
                                for r in result["rows"]), key)

    def test_keys_parser_matches_java_rules(self):
        anchors = server.source_clause_anchors("x\n\nEXTRACTED DOCUMENT TEXT:\n" + TEXT)
        # "2 each" is a quantity (unit filter); "TECHNICAL SPECIFICATIONS" is not numbered.
        self.assertEqual(list(anchors), ["p1:1", "p1:1.1", "p1:1.2", "p2:1.3", "p2:2", "p2:2.1"])

    def test_no_keys_still_valid(self):
        payload = build_request(text="[SOURCE_PAGE pdf=\"3\"]\n[/SOURCE_PAGE]")
        code, _, raw = post(self.url, payload)
        self.assertEqual(code, 200)
        result = json.loads(extract_model_text(raw))
        self.assertEqual(result["clauseDecisions"], {})
        self.assertGreaterEqual(len(result["rows"]), 1)

    def test_products_schema(self):
        payload = build_request()
        payload["text"]["format"] = {"type": "json_schema", "name": "tender_products", "strict": True,
                                     "schema": {"type": "object", "properties": {"products": {"type": "array", "items": {"type": "string"}},
                                                                                 "readable": {"type": "boolean"}},
                                                "required": ["products", "readable"]}}
        code, _, raw = post(self.url, payload)
        self.assertEqual(code, 200)
        result = json.loads(extract_model_text(raw))
        self.assertTrue(result["products"] and result["readable"] is True)

    def test_health_and_log(self):
        with urllib.request.urlopen(self.url.replace("/v1", "") + "/health", timeout=5) as r:
            h = json.loads(r.read())
        self.assertEqual(h["label"], "simulated provider latency")
        if self.srv:
            post(self.url, build_request())
            lines = Path(self.srv.state.log_path).read_text().splitlines()
            self.assertTrue(lines[0].startswith("timestamp_utc"))
            self.assertGreaterEqual(len(lines), 2)
            self.assertTrue(lines[-1].endswith("simulated provider latency"))


class FaultTest(_Base):
    cfg_overrides = {"faults": {"rate_429": 1.0, "retry_after_s": 4}}

    def test_429_with_retry_after(self):
        if self.URL:
            self.skipTest("fault tests use the in-process mock")
        code, headers, _ = post(self.url, build_request())
        self.assertEqual(code, 429)
        self.assertEqual({k.lower(): v for k, v in headers.items()}["retry-after"], "4")


class FaultMatrix(unittest.TestCase):
    def test_each_fault(self):
        for fault, expect in (("rate_500", 500), ("rate_503", 503), ("rate_empty", 200), ("rate_unreadable", 200)):
            cfg = {"seed": 1, "latency": {"default": {"kind": "fixed", "ms": 1}}, "faults": {fault: 1.0},
                   "log_dir": str(Path(__import__("tempfile").mkdtemp()) / "l"), "content": {}}
            srv = server.make_server(cfg, "127.0.0.1", 0)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            try:
                code, _, raw = post(f"http://127.0.0.1:{srv.server_address[1]}/v1", build_request())
                self.assertEqual(code, expect, fault)
                if fault == "rate_empty":
                    self.assertEqual(raw, b"")
                if fault == "rate_unreadable":
                    self.assertIs(json.loads(extract_model_text(raw))["readable"], False)
            finally:
                srv.shutdown()
                srv.server_close()

    def test_latency_models(self):
        import random as _r
        rnd = _r.Random(3)
        self.assertEqual(server.sample_latency_ms({"kind": "fixed", "ms": 42}, rnd), 42)
        self.assertGreaterEqual(server.sample_latency_ms({"kind": "normal", "mean_ms": 10, "sd_ms": 50, "min_ms": 5}, rnd), 5)
        vals = [server.sample_latency_ms({"kind": "longtail", "median_ms": 100, "sigma": 1, "max_ms": 500}, rnd) for _ in range(500)]
        self.assertLessEqual(max(vals), 500)
        self.assertTrue(80 < sorted(vals)[250] < 125)

    def test_over_capacity_reject(self):
        cfg = {"seed": 1, "max_concurrency": 1, "over_capacity": "reject_429", "over_capacity_retry_after_s": 2,
               "latency": {"default": {"kind": "fixed", "ms": 400}}, "faults": {},
               "log_dir": str(Path(__import__("tempfile").mkdtemp()) / "l"), "content": {}}
        srv = server.make_server(cfg, "127.0.0.1", 0)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{srv.server_address[1]}/v1"
        try:
            results = []
            ts = [threading.Thread(target=lambda: results.append(post(url, build_request())[0])) for _ in range(3)]
            [t.start() for t in ts]
            [t.join() for t in ts]
            self.assertIn(429, results)
            self.assertIn(200, results)
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    if "--url" in sys.argv:
        i = sys.argv.index("--url")
        _Base.URL = sys.argv[i + 1]
        del sys.argv[i:i + 2]
    unittest.main()
