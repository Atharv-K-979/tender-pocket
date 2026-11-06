# Workload model (Part 4)

Code: `loadtest/k6/`. Sources: review 10 (journeys, polling), 03 (RBAC), 04 (workflow), 05/06 (Track B). Line citations in the code refer to main `09129d2a`.

## 1. Shape of a run

- **One k6 process, exactly 17 VUs** in every BENCHMARK run, browser VUs included. `main.js` throws at init otherwise (G1). DEBUG runs may use fewer VUs and write to `results/debug/`.
- Each VU is its own **scenario** (`per-vu-iterations`, 1 VU, 1 long iteration). Every VU therefore has a fixed identity: username, role, behaviour and pre-staged tenders. The 17-VU guard checks the slot count.
- **3 min warm-up + 15 min steady.** Every request is tagged `phase=warmup|steady` from a shared clock set in `setup()`, and the report uses `steady` only. The monitors start with k6, so the warm-up is observable but excluded from every verdict.
- Traffic goes **only to the Next.js frontend URL** (G3). The deny-list and the origin check run before every request, and a hit aborts the whole test.
- Tags on every request:
  - `service` (S1–S19, `config/services.yaml`);
  - `name`, the normalised endpoint, e.g. `GET /api/tenders/{id}`;
  - `role`, `screen`, `origin=api|browser`, `run_type`, `tier`, `profile`, `phase`;
  - `expected` (`rbac_403` for deliberate denials, which are excluded from error rates).
- The request timeout is 300 s (G7). Thresholds are report-only: k6 exit code 99 is not a failure.

## 2. Requests: exactly what the UI sends

- Headers come from `fetchWithAuth` (`frontend/src/app/page.tsx:151-166`): `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, `Expires: 0`, `x-user-role`, `x-user-username`, `Authorization: Bearer <JWT>`, plus the `token` cookie (`:161`).
- **One login per VU** (10 §2.9; tokens last 10 years) through a plain `fetch` (`:1961-1970`).

## 3. Screen-time model

Each API VU loops until the end. It picks a screen by its role's weights (`config/screen_time.yaml`, overridable per profile) and dwells 60–180 s (PROPOSED).

| Role | dashboard | detail | approvals | actions | history |
|---|---|---|---|---|---|
| Tender Executive | 55 | 35 | – | 10 | – |
| MIS Team | 40 | 20 | 30 | 10 | – |
| Clearance Team | 25 | 25 | 45 | 5 | – |
| TPC Team | 35 | 15 | 45 | 5 | – |
| Admin | 80 | 10 | – | – | 10 |

**Dashboard** (10 §3.1):

- mount: tenders ∥ analytics ∥ auth/users (+ executives for MIS/Admin), then a 300 ms debounced tenders call;
- **1.5 s poll** with sequential awaits per tick, as in `page.tsx:958-1013`. All roles fetch tenders + analytics; Admin adds `status=Participating`; Admin and MIS add stats;
- 1–3 debounced search/filter changes from a fixed term set. Each change restarts the interval, as the effect dependencies do;
- every 2nd visit: the **S2 paginated probe**. Pages 0..2 at limit 20 are checked for length, `totalElements`/`totalPages`/`currentPage` and no overlap between pages;
- every 5th visit: an **RBAC probe** (S16). An Executive calls `GET /api/approvals/counts` and expects 403; other non-Admin roles call `GET /api/activity-logs` and expect 403.

**Detail** (10 §3.4):

- HTML shell + page script, then tender ∥ comments ∥ auth/users;
- a 1.5 s poll of tender + comments, fired without awaiting each other (`tenders/[id]/page.tsx:391-394`);
- MIS and Admin open random universe tenders; other roles open their own fixtures, because the backend scopes them (`TenderController.java:780-799`).

**Approvals** (10 §3.3):

- counts ∥ pending ∥ mis-team, then a second pending after 400 ms;
- 1–2 stage-filter changes;
- 1–2 reviews of the VU's own items, each followed by counts + pending;
- **no polling** (`page.tsx:956`). Every counts/pending call runs the reconcile (`ApprovalController.java:371, :515`).

**Actions** (detail page, DPOLL running), on the VU's own pre-staged tenders. The stage is verified through `GET /api/tenders/{id}/workflow-details` after every step (allowed stages: `config/screens.yaml workflow`):

| Journey | Role | Step | Expected stage |
|---|---|---|---|
| J1 | Executive | `clearance-request` on a spec-Generated tender | SPEC_CLEARANCE |
| J2 | Clearance | `approve-clearance` (JSON here, multipart in Approvals) | BID_DOCS_PREPARATION |
| J3 | Executive | `emd-applicability {applicable:false}` | DUAL_TRACK |
| J3 | Executive | `route-pricing {route:TPC}` | TPC_PRICING |
| J4 | TPC | `tpc-price` (or a TPC_PRICING review) | MIS_PRICING |
| J5 | MIS | `mis-price` / `verify-all-documents` / reviews of PAYMENT, MIS_PRICING, DOC, SUBMISSION, WIN_LOSS | per stage |
| J6 | Admin | history screen: stats, activity-logs (whole table), approvals HISTORY | – |

Journeys chain. J1 assigns the clearance rep to a Clearance VU of the same run, and J4 assigns the MIS member to a MIS VU. Work created in the run is therefore picked up by the next role:

- items assigned to the VU's username are its own;
- team-alias items are split by hash between the VUs of that role;
- universe and probe tenders are never acted on.

**Same-tender probe** (S15, MIX/APPROVALS/WORKFLOW). 2–3 MIS VUs fire at the same wall-clock instant, at steady +2/7/12 min and +4/9/14 min:

- **double approval**: concurrent `POST /review` on one PAYMENT_APPROVAL id. Participant 0 counts review comments and DOC_VERIFICATION PENDING rows.
- **dual-track race**: MIS_PRICING and DOC_VERIFICATION approved at the same time. If both rows are APPROVED but the stage is not SUBMISSION_READY, a lost update is recorded.

These are correctness findings that 04 §4b predicts. They mark S15 Broken, never the run invalid.

**Track B:**

- **S18 spec upload** (AI-k, k = 1/3/6/10). Executive VUs loop: open a distinct `upload` fixture, take a baseline progress reading, then `POST upload-tech-spec`. While the request is held open, two progress pollers run: the page's own 1 s poll (unguarded) and the `compliance-progress.js` 1 s poll (in-flight guarded). The response `metrics` (`durationsMs.api/extraction/rendering/total`, `apiAttempts`, `tokens`) is recorded as custom trends.
- **S19 bid pack** (DOCGEN-k, k = 1/3/6). `POST generate-bid-docs` with the UI's bid form fields on spec-Approved fixtures; the duration is recorded.

**Browser VUs** (3 per profile, `k6/browser`):

- login through the real form, a dashboard dwell (the page polls by itself), a tender detail, approvals (if the role has the tab), and the dashboard again;
- `lt_page_load_ms{page}` plus the built-in `browser_web_vital_*` metrics;
- page requests are checked against the deny-list through `page.on('request')` where the installed k6 supports it.

## 4. Polling: faithful, with overrun counting

The UI uses `setInterval` with **no overlap guard**, so in-flight requests pile up once latency passes 1.5 s (10 §0). `lib/poll.js` reproduces this with k6 timers plus non-blocking `http.asyncRequest`:

- a tick fires on schedule even if the previous tick is still in flight;
- `lt_poll_overruns` counts ticks started while one was in flight;
- `lt_poll_inflight_at_tick` records how many were in flight.

**Requirement on the installed k6:** global `setInterval`/`setTimeout` (k6 timers) and `http.asyncRequest`. Both exist in current k6 v1.x releases; verify with `k6 version` (RUNBOOK step 3).

If either is missing, the suite falls back to **guarded polling**: each tick completes before the next is scheduled. This **under-states load** once latency exceeds the interval. The mode appears as `poll_mode` in `summary.json`, `manifest.json` and the report. **k6 could not be verified here** (not installed on the development machine); the logic was exercised under a node shim instead.

## 5. Limitations and assumptions

1. **The Next.js deployment is assumed** to be what users hit (frontend URL). The Spring-served static SPA (10 §6) is not modelled; in that build the "drawer" replaces the detail page.
2. **Fixture floor.** About 350 reconcile-active fixture rows exist at every tier (seed-design §1). Approvals latency at tiers ≤ 1,000 includes them.
3. **Hidden-tab throttling is not modelled.** Every VU polls at the full rate, the worst case 10 §0 recommends.
4. **AI is mocked.** All S18 times are *simulated provider latency*; the mock latency distribution is a placeholder. The uploads are synthetic text PDFs, so the scanned-page / OCR path (05 §5) is **not** exercised. Add a scanned sample to `screens.yaml spec_upload.files` to cover it.
5. **Document download routes are excluded** (deny-list). A missing file triggers live GeM/Tender247 fetches (06 §4). For the same reason, bid-pack outputs are generated but not downloaded.
6. **Company Docs** (`/api/company-docs`, added in main after the review) is not reviewed and is on the deny-list. Browser VUs never open that tab.
7. **Pool exhaustion.** Each VU acts once per pre-staged tender. When its pools run out it falls back to read screens and counts `lt_pool_exhausted`. Pool sizes are in `seed.yaml fixtures` (PROPOSED).
8. **Probe timing** relies on VU clocks. All VUs run in one k6 process, so they share the host clock; skew is milliseconds.
9. **Large S1 responses.** Polls use `responseType: none`, so k6 discards bodies (memory) but still downloads them. At 100K tenders the unpaginated list is hundreds of MB per call (08 Q01); generator network and CPU become a limit. Validity rule R1 watches generator CPU; check the generator NIC throughput in `generator.csv`/CloudWatch too.
10. **Display-only date drift.** `anchor_date` is fixed, so Lapsed/Missed Deadline statuses shift slowly over the weeks of a sweep (seed-design §4).
