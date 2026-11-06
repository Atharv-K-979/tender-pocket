#!/usr/bin/env python3
"""Local stub of the Tender Pocket Next.js API (127.0.0.1 only) for DEBUG smoke runs of the k6
logic. It implements just enough of each endpoint the suite calls, with a tiny stage machine so
journey verification can pass. It is NOT a performance model.

    python3 tests/stub_frontend.py --port 18085 --fixtures seeder/out/fixtures.json
"""
from __future__ import annotations

import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROLE_OF = {"exec": "Tender Executive", "mis": "MIS Team", "clear": "Clearance Team", "tpc": "TPC Team", "admin": "Admin"}
INITIAL = {"SG": "SPEC_CLEARANCE", "BD": "BID_DOCS_PREPARATION", "DT": "DUAL_TRACK", "UP": "SPEC_CLEARANCE",
           "BP": "BID_DOCS_PREPARATION", "SC": "SPEC_CLEARANCE", "TP": "TPC_PRICING", "PA": "PAYMENT_APPROVAL",
           "MP": "MIS_PRICING", "DV": "DOC_VERIFICATION", "SP": "SUBMISSION_PENDING", "WL": "WIN_LOSS_PENDING",
           "DA": "PAYMENT_APPROVAL", "DR": "MIS_PRICING"}
APPROVAL_STAGE = {"SC": "SPEC_CLEARANCE", "TP": "TPC_PRICING", "PA": "PAYMENT_APPROVAL", "MP": "MIS_PRICING",
                  "DV": "DOC_VERIFICATION", "SP": "SUBMISSION_PENDING", "WL": "WIN_LOSS_PENDING", "DA": "PAYMENT_APPROVAL",
                  "DR": "MIS_PRICING"}
NEXT = {"SPEC_CLEARANCE": "BID_DOCS_PREPARATION", "PAYMENT_APPROVAL": "DUAL_TRACK", "TPC_PRICING": "MIS_PRICING",
        "MIS_PRICING": "MIS_PRICING", "DOC_VERIFICATION": "SUBMISSION_READY", "SUBMISSION_PENDING": "WIN_LOSS_PENDING",
        "WIN_LOSS_PENDING": "WON"}
ACTION_NEXT = {"clearance-request": "SPEC_CLEARANCE", "approve-clearance": "BID_DOCS_PREPARATION",
               "emd-applicability": "DUAL_TRACK", "route-pricing": "TPC_PRICING", "tpc-price": "MIS_PRICING",
               "mis-price": "DUAL_TRACK", "verify-all-documents": "SUBMISSION_READY"}


class Store:
    def __init__(self, fixtures: dict):
        self.lock = threading.Lock()
        self.stage: dict[str, str] = {}
        self.approvals: dict[int, dict] = {}
        self.calls: dict[str, int] = {}
        self.denied_hits: list[str] = []
        nid = 1
        groups = [(u, ids) for u, kinds in fixtures.get("users", {}).items() for ids in kinds.values()]
        groups += [("misteam", ids) for ids in fixtures.get("probe", {}).values()]
        for user, ids in groups:
            for tid in ids:
                code = tid.split("-")[2] if tid.startswith("LTF-") else tid.split("-")[1]
                self.stage[tid] = INITIAL.get(code, "NEW")
                st = APPROVAL_STAGE.get(code)
                if st:
                    self.approvals[nid] = {"id": nid, "tender_id": tid, "stage": st, "status": "PENDING", "assigned_to": user}
                    nid += 1
        self.next_id = nid


class H(BaseHTTPRequestHandler):
    store: Store = None
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def role(self):
        return self.headers.get("x-user-role", "")

    def user(self):
        return self.headers.get("x-user-username", "")

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw) if raw and raw[:1] in b"{[" else {}
        except ValueError:
            return {}

    def count(self, key):
        with self.store.lock:
            self.store.calls[key] = self.store.calls.get(key, 0) + 1

    def do_GET(self):
        u = urlparse(self.path)
        p, q = u.path, parse_qs(u.query)
        s = self.store
        self.count("GET " + re.sub(r"/(LT[A-Z]-[^/]+|\d+)", "/{id}", p))
        if p in ("/", "/api/compliance-progress-client") or p.startswith("/tenders/"):
            body = b"<html>stub</html>"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if p == "/api/tenders":
            limit = int(q.get("limit", ["0"])[0] or 0)
            page = int(q.get("page", ["0"])[0] or 0)
            total = 57
            ids = [f"LTU-{i:07d}" for i in range(total)]
            sl = ids[page * limit:(page + 1) * limit] if limit else ids
            return self.send_json({"success": True, "tenders": [{"id": i} for i in sl], "totalElements": total,
                                   "totalPages": -(-total // limit) if limit else 1, "currentPage": page, "filters": {}})
        if p in ("/api/analytics", "/api/tenders/stats", "/api/auth/users", "/api/auth/executives", "/api/auth/mis-team"):
            return self.send_json({"success": True, "stats": [], "users": []})
        if p == "/api/activity-logs":
            return self.send_json({"logs": []} if self.role() == "Admin" else {"error": "denied"}, 200 if self.role() == "Admin" else 403)
        if p.startswith("/api/approvals/"):
            if self.role() == "Tender Executive":
                return self.send_json({"error": "denied"}, 403)
            items = [a for a in s.approvals.values() if a["status"] == q.get("status", ["PENDING"])[0] or q.get("status", [""])[0] == "HISTORY"]
            if q.get("stage"):
                items = [a for a in items if a["stage"] == q["stage"][0]]
            if p.endswith("/counts"):
                return self.send_json({"counts": {}, "pendingCounts": {}})
            return self.send_json({"approvals": items, "total": len(items)})
        m = re.match(r"^/api/tenders/([^/]+)(/.*)?$", p)
        if m:
            tid, rest = m.group(1), m.group(2) or ""
            if rest == "":
                return self.send_json({"tender": {"id": tid, "current_stage": s.stage.get(tid, "NEW"), "ref_no": "R"}, "history": []})
            if rest == "/comments":
                return self.send_json({"comments": []})
            if rest == "/workflow-details":
                reqs = [a for a in s.approvals.values() if a["tender_id"] == tid]
                return self.send_json({"currentStage": s.stage.get(tid, "NEW"), "approvalRequests": reqs, "comments": []})
            if rest == "/tech-spec-progress":
                return self.send_json({"status": "RUNNING"})
        self.send_json({"error": "stub: not found " + p}, 404)

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        s = self.store
        self.count("POST " + re.sub(r"/(LT[A-Z]-[^/]+|\d+)", "/{id}", p))
        b = self.body()
        if p == "/api/auth/login":
            name = b.get("username", "")
            code = name.split("_")[1] if "_" in name else "exec"
            return self.send_json({"success": True, "token": "stub.jwt.token",
                                   "user": {"username": name, "role": ROLE_OF.get(code, "Tender Executive"), "email": ""}})
        m = re.match(r"^/api/approvals/(\d+)/review$", p)
        if m:
            a = s.approvals.get(int(m.group(1)))
            if not a:
                return self.send_json({"success": False}, 404)
            with s.lock:
                if a["status"] == "PENDING":
                    a["status"] = "APPROVED"
                    s.stage[a["tender_id"]] = NEXT.get(a["stage"], s.stage.get(a["tender_id"]))
            return self.send_json({"success": True, "newTenderStage": s.stage[a["tender_id"]]})
        m = re.match(r"^/api/(?:tenders|v2/workflow)/([^/]+)/([a-z-]+)$", p)
        if m:
            tid, action = m.group(1), m.group(2)
            if action == "upload-tech-spec":
                time.sleep(1.5)
                return self.send_json({"success": True, "metrics": {"apiAttempts": 2, "durationsMs": {"api": 900, "extraction": 1000, "rendering": 300, "total": 1400},
                                                                      "tokens": {"input": 4000, "output": 900, "total": 4900}}})
            if action == "generate-bid-docs":
                time.sleep(0.5)
                return self.send_json({"success": True})
            if action == "comments":
                return self.send_json({"comment": {}})
            if action in ACTION_NEXT:
                with s.lock:
                    s.stage[tid] = ACTION_NEXT[action]
                    for a in s.approvals.values():
                        if a["tender_id"] == tid and a["status"] == "PENDING" and action in ("approve-clearance", "tpc-price", "mis-price", "verify-all-documents"):
                            a["status"] = "APPROVED"
                return self.send_json({"success": True, "currentStage": s.stage[tid]})
        self.send_json({"error": "stub: not found " + p}, 404)


def serve(fixtures: dict, port: int = 0) -> ThreadingHTTPServer:
    handler = type("Bound", (H,), {"store": Store(fixtures)})
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    srv.daemon_threads = True
    return srv


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18085)
    ap.add_argument("--fixtures", required=True)
    a = ap.parse_args()
    srv = serve(json.load(open(a.fixtures)), a.port)
    print(f"stub frontend on http://127.0.0.1:{srv.server_address[1]}", flush=True)
    srv.serve_forever()
