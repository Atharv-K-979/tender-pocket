# Tender Pocket load-testing framework

Operator guide: [`docs/loadtest/RUNBOOK.md`](../docs/loadtest/RUNBOOK.md). Design docs:

- [`workload.md`](../docs/loadtest/workload.md)
- [`seed-design.md`](../docs/loadtest/seed-design.md)
- [`mock-ai.md`](../docs/loadtest/mock-ai.md)
- [`audit-howto.md`](../docs/loadtest/audit-howto.md)
- [`proposed-values.md`](../docs/loadtest/proposed-values.md)
- the source review in [`review/`](../docs/loadtest/review/)

| Path | What | Runs on |
|---|---|---|
| `config/*.yaml` | every tunable (G5). `env.yaml` holds hosts and secrets and is gitignored; copy it from `env.example.yaml` | – |
| `common/` | config loader, safety guards (EC2-1 deny-list, endpoint deny-list, IST windows, `--approved` gate), SSH runner | GEN |
| `audit/env_audit.sh` | read-only environment audit | EC2-2 |
| `seeder/` | `generate.py`, `load.py`, `validate.py`, `drift_check.py`, `backup.sh`, `dump_tier.sh`, `reset.sh`, `restore_backup.sh`, reconcile simulator | GEN / EC2-2 |
| `mock-ai/` | mock Azure Responses API + contract test | GEN |
| `k6/` | `main.js` (single entry), `lib/`, `screens/`, `profiles/*.yaml`, `render_config.py`, `data/make_spec_pdfs.py` | GEN |
| `orchestrator/` | `run.py`, `sweep.py`, `preflight.py`, `validity.py`, `logs.py`, `monitors/agent.py` (EC2-2, stdlib), `monitors/generator.py` | GEN (+ EC2-2) |
| `report/` | `build_report.py`: per-run summaries, breaking-point matrix, SVG charts | GEN |
| `tests/` | local tests: Python unittest, node tests, a node-shim DEBUG smoke against a local stub | dev / GEN |
| `tools/list_proposed.py` | inventory of unapproved defaults | – |

Global rules:

- **G1**: exactly 17 VUs per BENCHMARK run.
- **G2**: never EC2-1.
- **G3**: endpoint deny-list; frontend URL only.
- **G4**: no secrets in git.
- **G5**: config in YAML; unapproved defaults marked PROPOSED.
- **G6**: DB writes need `--approved`.
- **G7**: 300 s request timeout; thresholds are report-only.
- **G8**: Python 3.10+, PyYAML pinned; the EC2-2 agent is stdlib-only.

Run `./run_tests.sh` to execute the local suite.
