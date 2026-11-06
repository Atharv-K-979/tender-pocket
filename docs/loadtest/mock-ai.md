# Mock AI (Part 3): simulated provider latency

`loadtest/mock-ai/server.py` is a standard-library HTTP server that stands in for the Azure OpenAI **Responses API** the backend calls for spec extraction. Its config is `loadtest/config/mock_ai.yaml`; PyYAML is needed only to read the YAML, and a `.json` config works without it.

**Every result produced with it is labelled "simulated provider latency"**: in the CSV call log, in `/health` and in the run manifest (`ai_mode`).

## Why a mock is possible (review 05 §17)

- The endpoint comes from `System.getenv("AZURE_OPENAI_ENDPOINT")`, and `/responses` is appended (`AISpecificationIntelligenceService.java:1685-1693`).
- The key comes from `AZURE_OPENAI_API_KEY` and is sent as header `api-key`. Any non-blank value works.
- The model is hard-coded to `gpt-5-nano` (`:1695-1697`); the mock ignores it.
- **Gemini cannot be mocked.** Its URL is hard-coded (`:1137`). If Azure fails (5xx, timeout, empty body), the backend falls back to Gemini. `GEMINI_API_KEY` must therefore be unset, or the fallback reaches Google with a real key.

## Contract implemented

| Aspect | Behaviour | Code reference |
|---|---|---|
| Route | `POST <any>/responses`, `GET /health` | `:1685-1693` |
| Envelope | `status:"completed"`, `output[0].content[0] = {type:"output_text", text:<JSON>}` | `extractModelText :1977-2012`, `parseLlmJsonResponse :1763-1825` |
| `compliance_rows` | **Schema-driven.** `clauseDecisions` holds exactly the keys of the request schema's `clauseDecisions.properties`, which are the prompt's `SOURCE CLAUSE KEYS`. Each included key gets one row: `clauseReference` = clause number; `requirement` = the clause text, found by a port of `sourceClauseAnchors`; `sourceReference` = the single-page option for that page from `ALLOWED SOURCE REFERENCES`; `productCategory` = schema enum or `[PRODUCT_NAME_HINTS]`; all 10 fields as strings | `:862-965`, `:1384-1385`, `:1539-1574`, `:1617-1677` |
| other schemas | `tender_products`, `datasheet_specs`, `clause_matches`: a minimal instance of the strict schema | `:870-915` |
| usage | `input_tokens` (≈ prompt chars/4 + file bytes/600), `cached_tokens`, `output_tokens`, `reasoning_tokens`, `total_tokens` | `ComplianceConversionMetrics.java:132-150` |
| latency | per schema: `fixed`, `normal`, `longtail` (lognormal median/σ/cap), plus ms per MiB of attached file | `mock_ai.yaml` |
| capacity | `max_concurrency` slots; above it, `queue` or `reject_429` with Retry-After | |
| faults | independent rates: 429 + Retry-After (the backend retries once if ≤ 75 s), 500, 503, timeout (sleeps past the 180 s read timeout), empty 200, `readable:false` | 05 §6–§9 |
| log | CSV per process: `mock-ai/logs/mock-ai-calls-<UTC>.csv` with timestamp, schema, status, fault, latency, queue wait, in-flight count, prompt/file size, clause keys, rows, tokens, label | |

The contract test, `mock-ai/contract_test.py`, rebuilds the request exactly as `buildAzureResponsesPayload` does for COMPLIANCE_ROWS. It parses the answer the way the backend does: exact keys, enum references, coverage per included key, strict field set, and usage. It also covers each fault, the latency models and over-capacity rejection. Run it against a running mock with `--url http://127.0.0.1:8800/v1`.

> Fault rates 500/503/timeout/empty make Azure return null, and the backend then **tries Gemini** (05 §8). Use them only with `GEMINI_API_KEY` verified unset; pre-flight checks this. Without Gemini keys the batch, and the whole upload, fails with HTTP 400, which is the measured outcome.

## EC2-2 env change (you apply it, then recreate the backend container)

```bash
# In the env file / compose override used by tender-pocket-backend on EC2-2:
AZURE_OPENAI_ENDPOINT=http://<GENERATOR-PRIVATE-IP>:8800/v1
AZURE_OPENAI_API_KEY=loadtest-dummy-key
# GEMINI_API_KEY  -> remove the line entirely (unset); also make sure gemini.api.key is not set
#                    in any application.properties override (05 §8: three sources are read)
```

Then:

1. Recreate the backend: `docker compose up -d tender-pocket-backend`. Wait at least 20 minutes before any run, because the startup GeM/IMAP sync fires 15 s after boot (`SyncScheduler.java:22`).
2. Allow inbound TCP 8800 on the generator from EC2-2's private IP only (security group).
3. Verify from EC2-2: `docker exec tender-pocket-backend wget -qO- http://<GEN-IP>:8800/health`.
4. Verify names only: `docker exec tender-pocket-backend env | grep -E '^(AZURE_OPENAI_|GEMINI_)' | cut -d= -f1`. Expect both AZURE names and no GEMINI.

To revert, restore the previous env file and recreate the container.

## Running

```bash
cd ~/tp-loadtest/loadtest
python3 mock-ai/server.py --config config/mock_ai.yaml            # foreground
nohup python3 mock-ai/server.py > results/mock-ai.out 2>&1 &       # background
curl -s localhost:8800/health
```

Latency defaults (PROPOSED): `compliance_rows` lognormal with a 12 s median, σ 0.6, capped at 150 s; `tender_products` normal at 4 s. These are placeholders, not measurements. Calibrate them from a small, approved real-AI pilot using `metrics.durationsMs.api / apiAttempts` (05 §15) before quoting absolute Track B times.
