#!/usr/bin/env python3
"""Mock Azure OpenAI Responses API for Tender Pocket load tests (Part 3).

    python3 mock-ai/server.py [--config config/mock_ai.yaml] [--port 8800]

Contract (review 05 §6, §9, §17; AISpecificationIntelligenceService.java at main 09129d2a):
  request   POST <base>/responses, header api-key, body from buildAzureResponsesPayload
            (:824-967): {model, reasoning, store, max_output_tokens, input:[{role:user,
            content:[{type:input_text,text}, {type:input_file|input_image,...}]}],
            text:{format:{type:json_schema,name,strict,schema}}}
  response  {"status":"completed","output":[{"content":[{"type":"output_text","text":<JSON>}]}],
             "usage":{input_tokens, input_tokens_details.cached_tokens, output_tokens,
                      output_tokens_details.reasoning_tokens, total_tokens}}
            parsed by extractModelText (:1977-2012) and parseLlmJsonResponse (:1763-1825);
            usage read by ComplianceConversionMetrics.java:132-150.
  compliance_rows: clauseDecisions has EXACTLY the keys of the schema's clauseDecisions
            properties (= SOURCE CLAUSE KEYS in the prompt, :1384, :919-929); every included
            key gets a row whose clauseReference is the clause number and whose
            sourceReference is an ALLOWED SOURCE REFERENCE for that page (:1539-1574, :1617-1637).
Stdlib only (PyYAML is optional, used only to read a .yaml config). Every call is logged to
CSV. All results produced with this mock are "simulated provider latency".
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import os
import random
import re
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE.parent / "config" / "mock_ai.yaml"

# ----------------------------------------------------------------- prompt parsing (port)
_NUMBERED = re.compile(r"^[ \t]*(\d{1,3}(?:\.\d{1,3})*)[.)]?(?:[ \t]+(.*)|[ \t]*)$")
_MARKER = re.compile(r'\[SOURCE_PAGE pdf="(\d+)"')
_UNIT = re.compile(r"(?i)^(?:each|nos?\.?|qty|total|per\b.*|kg|mm|cm|ah|v|volts?|litres?|liters?)$")
_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def source_clause_anchors(prompt: str) -> dict[str, tuple[str, str]]:
    """Port of sourceClauseAnchors (AISpecificationIntelligenceService.java:1643-1677).
    Returns {key: (clause_number, body)}; key = "<page>:<number>", page = "pN" or "text"."""
    anchors: dict[str, tuple[str, str]] = {}
    page = "text"
    source = prompt or ""
    head = "\n\nEXTRACTED DOCUMENT TEXT:\n"
    start = source.find(head)
    if start >= 0:
        source = source[start + len(head):]
        end = source.find("\nNUMBERED SOURCE CLAUSES THAT MUST BE ACCOUNTED FOR:")
        if end < 0:
            end = source.find("\nSOURCE CLAUSE KEYS:")
        if end >= 0:
            source = source[:end]
    marked = "[SOURCE_PAGE " in source
    in_page = not marked
    lines = re.split(r"\r\n|\r|\n", source)
    for i, line in enumerate(lines):
        m = _MARKER.search(line)
        if m:
            page, in_page = "p" + m.group(1), True
            continue
        if marked and "[/SOURCE_PAGE]" in line:
            in_page = False
            continue
        if not in_page:
            continue
        ref = _NUMBERED.match(line)
        if not ref:
            continue
        body = (ref.group(2) or "").strip()
        if not body and "." not in ref.group(1):
            continue
        if not body and i + 1 < len(lines) and not lines[i + 1].startswith("["):
            body = lines[i + 1].strip()
        if not _LETTER.search(body) or _UNIT.match(body):
            continue
        anchors[f"{page}:{ref.group(1)}"] = (ref.group(1), body)
    return anchors


def json_array_after(prompt: str, label: str) -> list:
    i = prompt.rfind(label)
    if i < 0:
        return []
    rest = prompt[i + len(label):].lstrip()
    try:
        val, _ = json.JSONDecoder().raw_decode(rest)
        return val if isinstance(val, list) else []
    except ValueError:
        return []


def product_hints(prompt: str) -> list[str]:
    m = re.search(r"\[PRODUCT_NAME_HINTS\](.*?)(?:\[/PRODUCT_NAME_HINTS\]|\n\n)", prompt or "", re.S)
    if not m:
        return []
    return [h.strip(" -•\t") for h in m.group(1).splitlines() if h.strip(" -•\t")][:5]


# ----------------------------------------------------------------- schema-driven output
def instance_for(schema: dict, rnd: random.Random, depth: int = 0):
    """Generic minimal instance of a strict JSON schema (all required props, enum[0])."""
    t = schema.get("type")
    if "enum" in schema and schema["enum"]:
        return schema["enum"][0]
    if t == "object":
        props = schema.get("properties", {})
        return {k: instance_for(v, rnd, depth + 1) for k, v in props.items()}
    if t == "array":
        if depth > 4:
            return []
        return [instance_for(schema.get("items", {}), rnd, depth + 1) for _ in range(rnd.randint(1, 3))]
    if t == "boolean":
        return True
    if t == "integer":
        return 1
    if t == "number":
        return 1.0
    return "mock value"


def page_reference(page_key: str, allowed: list[str]) -> str:
    if not allowed:
        return "PDF p. " + page_key[1:] if page_key.startswith("p") else ""
    if page_key.startswith("p"):
        n = page_key[1:]
        for opt in allowed:   # single-page option for this page
            if ";" not in opt and re.match(rf"^PDF p\. {re.escape(n)}(?!\d)", opt):
                return opt
    return allowed[0]


def build_compliance(schema: dict, prompt: str, rnd: random.Random, content_cfg: dict,
                     unreadable: bool = False) -> dict:
    props = schema.get("properties", {})
    keys = list((props.get("clauseDecisions", {}) or {}).get("properties", {}).keys())
    row_props = ((props.get("rows", {}) or {}).get("items", {}) or {}).get("properties", {})
    allowed = (row_props.get("sourceReference", {}) or {}).get("enum") or json_array_after(prompt, "ALLOWED SOURCE REFERENCES:")
    categories = (row_props.get("productCategory", {}) or {}).get("enum") or product_hints(prompt) \
        or [content_cfg.get("default_product", "Medical Equipment")]
    if unreadable:
        return {"readable": False, "clauseDecisions": {k: "excluded" for k in keys}, "rows": []}
    anchors = source_clause_anchors(prompt)
    share = float(content_cfg.get("included_share", 1.0))
    decisions, rows = {}, []
    for k in keys:
        number, body = anchors.get(k, (k.split(":", 1)[-1], ""))
        include = rnd.random() < share
        decisions[k] = "included" if include else "excluded"
        if include:
            rows.append({
                "clauseReference": number,
                "requirement": body or f"Requirement as per clause {number}",
                "requiredEvidence": "Datasheet / compliance statement",
                "reviewerRemarks": "-",
                "productCategory": categories[len(rows) % len(categories)],
                "sourceReference": page_reference(k.split(":", 1)[0], allowed),
                "rowType": "requirement",
                "sectionReference": number.split(".")[0],
                "sectionTitle": "Technical Specifications",
                "scheduleReference": "",
            })
    if not keys:
        lo, hi = content_cfg.get("generic_rows_when_no_keys", [1, 3])
        for n in range(rnd.randint(lo, hi)):
            rows.append({
                "clauseReference": str(n + 1), "requirement": f"Equipment shall meet specification item {n + 1}.",
                "requiredEvidence": "Datasheet", "reviewerRemarks": "-",
                "productCategory": categories[n % len(categories)],
                "sourceReference": allowed[0] if allowed else "PDF p. 1", "rowType": "requirement",
                "sectionReference": "1", "sectionTitle": "Technical Specifications", "scheduleReference": "",
            })
    # Keep only properties the schema declares (strict schema, additionalProperties:false).
    if row_props:
        rows = [{f: str(r.get(f, "")) for f in row_props} for r in rows]
    return {"readable": True, "clauseDecisions": decisions, "rows": rows}


def build_output(fmt_name: str, schema: dict, prompt: str, rnd: random.Random, content_cfg: dict,
                 unreadable: bool) -> dict:
    if fmt_name == "compliance_rows" or "clauseDecisions" in (schema.get("properties") or {}):
        return build_compliance(schema, prompt, rnd, content_cfg, unreadable)
    out = instance_for(schema, rnd)
    if isinstance(out, dict):
        if "readable" in out:
            out["readable"] = not unreadable
        if fmt_name == "tender_products" and "products" in out:
            out["products"] = product_hints(prompt) or [content_cfg.get("default_product", "Medical Equipment")]
    return out


def envelope(model: str, text: str, prompt_chars: int, file_bytes: int, reasoning_effort: str) -> dict:
    in_tok = max(1, prompt_chars // 4 + file_bytes // 600)
    out_tok = max(1, len(text) // 4)
    reason_tok = out_tok // (2 if reasoning_effort == "medium" else 4)
    return {
        "id": "resp_mock_" + uuid.uuid4().hex[:24], "object": "response", "status": "completed",
        "model": model or "gpt-5-nano",
        "output": [{"type": "message", "role": "assistant", "id": "msg_mock",
                    "content": [{"type": "output_text", "text": text, "annotations": []}]}],
        "usage": {"input_tokens": in_tok, "input_tokens_details": {"cached_tokens": 0},
                  "output_tokens": out_tok + reason_tok, "output_tokens_details": {"reasoning_tokens": reason_tok},
                  "total_tokens": in_tok + out_tok + reason_tok},
    }


# ----------------------------------------------------------------- latency / faults
def sample_latency_ms(spec: dict, rnd: random.Random) -> float:
    kind = spec.get("kind", "fixed")
    if kind == "fixed":
        return float(spec.get("ms", 1000))
    if kind == "normal":
        return max(float(spec.get("min_ms", 0)), rnd.gauss(float(spec.get("mean_ms", 1000)), float(spec.get("sd_ms", 0))))
    if kind == "longtail":
        v = float(spec.get("median_ms", 1000)) * math.exp(rnd.gauss(0, float(spec.get("sigma", 0.5))))
        return min(v, float(spec.get("max_ms", 1e9)))
    raise ValueError(f"unknown latency kind {kind}")


def pick_fault(faults: dict, rnd: random.Random) -> str | None:
    r = rnd.random()
    acc = 0.0
    for name in ("429", "500", "503", "timeout", "empty", "unreadable"):
        acc += float(faults.get(f"rate_{name}", 0.0))
        if r < acc:
            return name
    return None


class MockState:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.rnd = random.Random(cfg.get("seed", 7))
        self.lock = threading.Lock()
        self.sem = threading.BoundedSemaphore(int(cfg.get("max_concurrency", 40)))
        self.in_flight = 0
        self.total = 0
        self.faults_count: dict[str, int] = {}
        log_dir = Path(cfg.get("log_dir", "mock-ai/logs"))
        if not log_dir.is_absolute():
            log_dir = HERE.parent / log_dir
        log_dir.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.log_path = log_dir / f"mock-ai-calls-{stamp}.csv"
        self.log_fh = open(self.log_path, "w", newline="", encoding="utf-8")
        self.log = csv.writer(self.log_fh)
        self.log.writerow(["timestamp_utc", "request_id", "schema", "status_code", "fault", "latency_ms",
                           "queued_ms", "in_flight", "prompt_chars", "file_bytes", "clause_keys", "rows",
                           "input_tokens", "output_tokens", "label"])
        self.log_fh.flush()

    def rand(self):
        with self.lock:
            return random.Random(self.rnd.random())

    def record(self, row: list):
        with self.lock:
            self.log.writerow(row + ["simulated provider latency"])
            self.log_fh.flush()


class Handler(BaseHTTPRequestHandler):
    server_version = "TenderPocketMockAI/1"
    protocol_version = "HTTP/1.1"
    state: MockState = None  # set by make_server

    def log_message(self, fmt, *args):  # quiet; CSV is the log
        pass

    def _send(self, code: int, body: bytes, ctype="application/json", headers: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        st = self.state
        if self.path.rstrip("/") in ("/health", "/v1/health"):
            body = json.dumps({"status": "ok", "label": "simulated provider latency", "total": st.total,
                               "in_flight": st.in_flight, "faults": st.faults_count,
                               "log": str(st.log_path)}).encode()
            return self._send(200, body)
        self._send(404, b'{"error":"not found"}')

    def do_POST(self):
        st = self.state
        cfg = st.cfg
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if not self.path.rstrip("/").endswith("/responses"):
            return self._send(404, b'{"error":"only POST .../responses is mocked"}')
        req_id = uuid.uuid4().hex[:12]
        t_arrive = time.monotonic()
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            return self._send(400, b'{"error":{"message":"invalid JSON"}}')
        fmt = ((body.get("text") or {}).get("format") or {})
        fmt_name = fmt.get("name", "unknown")
        schema = fmt.get("schema") or {}
        prompt, file_bytes = "", 0
        for msg in body.get("input") or []:
            for part in msg.get("content") or []:
                if part.get("type") == "input_text":
                    prompt += part.get("text", "")
                elif part.get("type") in ("input_file", "input_image"):
                    data = part.get("file_data") or part.get("image_url") or ""
                    file_bytes += int(len(data.split(",", 1)[-1]) * 3 / 4)
        keys = list(((schema.get("properties") or {}).get("clauseDecisions") or {}).get("properties", {}).keys())
        rnd = st.rand()
        fault = pick_fault(cfg.get("faults") or {}, rnd)

        # Provider concurrency cap.
        acquired = st.sem.acquire(blocking=False)
        if not acquired:
            if cfg.get("over_capacity", "queue") == "reject_429":
                ra = str(cfg.get("over_capacity_retry_after_s", 5))
                st.record([dt.datetime.now(dt.timezone.utc).isoformat(), req_id, fmt_name, 429, "over_capacity",
                           0, 0, st.in_flight, len(prompt), file_bytes, len(keys), 0, 0, 0])
                return self._send(429, b'{"error":{"code":"429","message":"Rate limit (mock over capacity)"}}',
                                  headers={"Retry-After": ra})
            st.sem.acquire()
        queued_ms = (time.monotonic() - t_arrive) * 1000
        with st.lock:
            st.in_flight += 1
            st.total += 1
            if fault:
                st.faults_count[fault] = st.faults_count.get(fault, 0) + 1
        code, rows, in_tok, out_tok = 200, 0, 0, 0
        try:
            lat_spec = (cfg.get("latency") or {}).get(fmt_name) or (cfg.get("latency") or {}).get("default") or {"kind": "fixed", "ms": 1000}
            latency = sample_latency_ms(lat_spec, rnd) + file_bytes / (1 << 20) * float(cfg.get("latency_per_file_mib_ms", 0))
            faults = cfg.get("faults") or {}
            if fault == "timeout":
                time.sleep(float(faults.get("timeout_sleep_s", 200)))
                code = 504
                self.close_connection = True
                return
            time.sleep(latency / 1000.0)
            if fault == "429":
                code = 429
                return self._send(429, b'{"error":{"code":"429","message":"Requests to the Responses API have exceeded rate limit (mock)"}}',
                                  headers={"Retry-After": str(faults.get("retry_after_s", 3))})
            if fault in ("500", "503"):
                code = int(fault)
                return self._send(code, json.dumps({"error": {"code": fault, "message": "mock injected fault"}}).encode())
            if fault == "empty":
                return self._send(200, b"")
            out = build_output(fmt_name, schema, prompt, rnd, cfg.get("content") or {}, unreadable=fault == "unreadable")
            text = json.dumps(out, ensure_ascii=False)
            rows = len(out.get("rows", [])) if isinstance(out, dict) else 0
            env = envelope(body.get("model"), text, len(prompt), file_bytes, (body.get("reasoning") or {}).get("effort", "low"))
            in_tok, out_tok = env["usage"]["input_tokens"], env["usage"]["output_tokens"]
            self._send(200, json.dumps(env).encode())
        except (BrokenPipeError, ConnectionResetError):
            code = 499
        finally:
            with st.lock:
                st.in_flight -= 1
            st.sem.release()
            st.record([dt.datetime.now(dt.timezone.utc).isoformat(), req_id, fmt_name, code, fault or "",
                       round((time.monotonic() - t_arrive) * 1000), round(queued_ms), st.in_flight,
                       len(prompt), file_bytes, len(keys), rows, in_tok, out_tok])


def load_cfg(path: str | None) -> dict:
    p = Path(path) if path else DEFAULT_CONFIG
    text = p.read_text(encoding="utf-8")
    if p.suffix in (".yaml", ".yml"):
        try:
            import yaml  # optional (pinned in requirements.txt)
            return yaml.safe_load(text) or {}
        except ImportError:
            sys.exit("PyYAML not installed: pass a .json config or pip install -r requirements.txt")
    return json.loads(text)


def make_server(cfg: dict, host: str | None = None, port: int | None = None) -> ThreadingHTTPServer:
    state = MockState(cfg)
    handler = type("BoundHandler", (Handler,), {"state": state})
    srv = ThreadingHTTPServer((host or cfg.get("listen_host", "0.0.0.0"), int(port if port is not None else cfg.get("listen_port", 8800))), handler)
    srv.daemon_threads = True
    srv.state = state
    return srv


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=os.environ.get("MOCK_AI_CONFIG"))
    ap.add_argument("--host")
    ap.add_argument("--port", type=int)
    args = ap.parse_args(argv)
    cfg = load_cfg(args.config)
    srv = make_server(cfg, args.host, args.port)
    h, p = srv.server_address[:2]
    print(f"mock AI (simulated provider latency) on http://{h}:{p}  POST */responses  GET /health")
    print(f"call log: {srv.state.log_path}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
