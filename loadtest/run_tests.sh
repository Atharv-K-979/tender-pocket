#!/usr/bin/env bash
# Local test suite (no EC2, no database, no external API). Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")"
echo "== python unit tests"
python3 -m unittest discover -s tests -t . -v 2>&1 | tail -n 5
if command -v node >/dev/null 2>&1; then
  echo "== node: k6 pure-module tests"
  node --test tests/js/ 2>&1 | grep -E '^# (tests|pass|fail)'
  echo "== node: k6 import resolution"
  node tests/js/check_imports.mjs
  echo "== node: k6 syntax"
  for f in k6/main.js k6/lib/*.js k6/screens/*.js; do node --check "$f"; done && echo "syntax ok"
else
  echo "node not installed: skipping JS checks"
fi
if command -v k6 >/dev/null 2>&1; then
  echo "== k6 inspect (DEBUG profile, local stub URL)"
  python3 k6/render_config.py --profile DEBUG --tier 100 --run-type DEBUG --skip-preflight --out k6/build/run_config.json
  LT_RUN_CONFIG=k6/build/run_config.json k6 inspect k6/main.js > /dev/null && echo "k6 inspect ok"
else
  echo "k6 not installed: k6 inspect skipped (the node-shim smoke test covers the VU logic)"
fi
echo "== shell syntax"
for f in audit/env_audit.sh seeder/*.sh; do bash -n "$f"; done && echo "shell ok"
