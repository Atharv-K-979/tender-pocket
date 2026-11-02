# 10 — Frontend journeys, polling and browser-side load profile

Scope: `frontend/` (Next.js 16.2.6, React 19.2.4, from `frontend/package.json`) at commit 68eb28ae, plus the static export bundled in `backend/src/main/resources/static/`. Read-only review; nothing was executed. The companion route inventory is `docs/loadtest/review/the Frontend (Next.js) API routes section of 02-service-inventory.md`.

Labels: **VERIFIED** = read in code; **INFERRED** = reasoned from code; **UNKNOWN** = not determinable from the repo.

## 0. Key numbers for the load model

| Who / where | Background requests per minute per open browser tab | Endpoints | Source |
|---|---|---|---|
| Dashboard `/` (any tab except Approvals): Tender Executive, Clearance Team, TPC Pricing Team | **80** (2 per 1.5 s tick) | `GET /api/tenders?…`, `GET /api/analytics?t=` | `frontend/src/app/page.tsx:952-1040` (VERIFIED) |
| Dashboard `/`: MIS Team (role string exactly `"MIS Team"`) | **120** (3 per tick) | the two above plus `GET /api/tenders/stats?t=` | `page.tsx:1004-1013` (VERIFIED) |
| Dashboard `/`: Admin | **160** (4 per tick) | the three above plus `GET /api/tenders?status=Participating&t=` | `page.tsx:993-1013` (VERIFIED) |
| Dashboard `/`: Approvals tab open (any role) | **0** | polling suspended | `page.tsx:954` (VERIFIED) |
| Dashboard drawer open (only reachable in the Spring-served SPA; see §6) | **+80** | `GET /api/tenders/{id}?t=`, `GET /api/tenders/{id}/comments?t=` | `page.tsx:1016-1033` (VERIFIED code; reachability INFERRED) |
| Tender detail page `/tenders/{id}`: every role | **80** (2 per 1.5 s) | `GET /api/tenders/{id}?t=`, `GET /api/tenders/{id}/comments?t=` | `frontend/src/app/tenders/[id]/page.tsx:384-397` (VERIFIED) |
| During a tech-spec upload (dashboard drawer or detail page) | **+~120** for the duration of the conversion: +60 from the page's own 1 s poll (no in-flight guard) and ≤+60 from `compliance-progress.js`'s 1 s poll (in-flight guarded), plus 1 baseline call | `GET /api/tenders/{id}/tech-spec-progress` | `page.tsx:1326-1338`, `tenders/[id]/page.tsx:1155-1167`, `backend/src/main/resources/static/compliance-progress.js:559,567,474-497` (VERIFIED) |

How these figures are derived:

- 40 ticks/min (60 s ÷ 1.5 s) × requests per tick.
- **No visibility handling.** There is no `visibilitychange`, SWR or React Query anywhere in `frontend/src` (VERIFIED by grep), so hidden/background tabs keep polling. How much the browser throttles hidden-tab timers is browser-specific (UNKNOWN). Model a hidden tab at the full rate as the worst case.
- **No overlap guard on the dashboard poll.** It is `setInterval(async …)` with sequential `await`s (`page.tsx:956-1037`). If one tick's requests take longer than 1.5 s in total, the next tick starts anyway, so in-flight requests per browser grow as backend latency rises (INFERRED). That is positive feedback under load. The detail-page poll fires its 2 requests without awaiting (`tenders/[id]/page.tsx:391-394`), so the same applies there.
- Each dashboard poll restarts when any filter, the active tab or `currentUser` changes (`page.tsx:1040` deps). Restarts don't change the rate.
- Per hour, an Admin dashboard tab left open makes about **9,600 requests**, about 4,800 of them full-table `GET /api/tenders` calls (INFERRED arithmetic).

## 1. Rendering model (SSR vs client)

- `frontend/src/app/layout.tsx` is a Server Component (no `'use client'`). It renders `<html data-theme="dark">` and injects `<Script src="/api/compliance-progress-client?v=20261012-sanitize-2" strategy="beforeInteractive">` (`layout.tsx:19`). That fetch happens on **every full page load**. The route returns `Cache-Control: no-store` (`frontend/src/app/api/compliance-progress-client/route.ts:14`) and proxies to backend `/compliance-progress.js` each time (VERIFIED). The `?v=` query does not make it cacheable, because the response headers forbid caching.
- `frontend/src/app/page.tsx` (8,359 lines), `tenders/[id]/page.tsx` (5,293), `preview-docs/page.tsx` and all of `components/*` begin with `'use client'` (VERIFIED). None export `dynamic`, `revalidate` or `generateStaticParams`, and none fetch on the server.
  - `/` has no dynamic server API use, so Next would prerender it statically at build time (INFERRED from Next defaults).
  - `/tenders/[id]` is a dynamic segment without `generateStaticParams`, so its shell is rendered on demand per request (INFERRED). It reads the id client-side via `useParams()` (`tenders/[id]/page.tsx:48`).
- All data loading is client-side `fetch` with `cache: 'no-store'` and `Cache-Control/Pragma/Expires` no-cache request headers. Polling requests also add a `t=Date.now()` cache-buster (`page.tsx:151-153,165`, `tenders/[id]/page.tsx:336-345`). So nothing is cached by the browser, Next or any intermediary (VERIFIED).
- Navigation:
  - Dashboard → tender detail is a **full page load**: `window.location.href = /tenders/{id}` (`page.tsx:1410-1412`). That re-downloads the HTML shell, the JS chunks (browser-cacheable) and the uncached compliance script.
  - Detail → dashboard is a client-side `router.push('/')` (`tenders/[id]/page.tsx:1539`). That remounts `Dashboard` and re-runs all mount fetches.
  - Tabs inside `/` use hash routing (`#/dashboard`, …) (`page.tsx:560-583`). They are not page loads.
- Next.js `rewrites` maps `/documents/:id/:filename*` → `/api/tenders/:id/documents/:filename*` (`frontend/next.config.ts:8-14`). That is how every document link in the UI ends up in the heavy document route.

## 2. Login flow and token lifecycle (browser view)

1. Unauthenticated `/` renders the login form (`page.tsx:1986`).
2. Submit sends `POST /api/auth/login` with a JSON body `{username, password}` using **plain `fetch`** (no auth headers) (`page.tsx:1954-1963`). That request is proxied to Spring `AuthController.java:63`.
3. On `success`, the browser stores:
   - `localStorage.currentUser = JSON(user)` with `{username, role, email}`,
   - `localStorage.token = <JWT>`,
   - the cookie `token=<JWT>; path=/; SameSite=Lax` (`page.tsx:1966-1971`). It is set from JS, so it is **not HttpOnly**. It has no `Secure` flag and no `Expires`, so it is a session cookie.
4. `setCurrentUser` triggers the mount data load (§3) and starts the 1.5 s poll.
5. Every subsequent call goes through `fetchWithAuth` (`page.tsx:149-184`), which:
   - adds `Authorization: Bearer <localStorage.token>`,
   - adds `x-user-role` and `x-user-username`, taken from `localStorage.currentUser` and **therefore client-controlled**,
   - re-writes the cookie on every call (`page.tsx:161`).
   The detail page has its own `fetchWithAuth` (`tenders/[id]/page.tsx:325-346`) that sends the same headers but neither sets the cookie nor handles 401.
6. Document links carry the JWT in the URL: `getDocDownloadUrl` appends `?token=<JWT>` (`page.tsx:186-192`). The Next document route accepts query tokens (`frontend/src/lib/auth.ts:26`).
7. Expiry:
   - The client never inspects `exp`.
   - On reload, the session is restored if both localStorage keys exist (`page.tsx:541-557`), with no server round-trip.
   - The backend's default token lifetime is **315,360,000 s (10 years)** (`backend/src/main/resources/application.properties:20`, `JwtUtil.java:70`). In practice a session lasts until logout or until localStorage is cleared.
   - A 401 on any non-workflow URL clears the session and shows "session expired" (`page.tsx:168-182`). Workflow URLs (`/approve-`, `/tpc-`, `/mis-`, `/clearance-`, `/generate-bid-docs`) are exempt.
8. Logout (`page.tsx:934-939`) removes the localStorage keys only. It makes no server call and **leaves the `token` cookie in place**.
9. There is no refresh-token flow and no re-login traffic (VERIFIED). For load tests this means **one login per virtual user**, then reuse the JWT for the whole run.

Role derivation:
- **Client:** `currentUser.role` is a string from the login response. Tab gates mostly compare raw strings (`'Admin'`, `'MIS Team'`). Only the Approvals tab uses `canonicalRole()` (`page.tsx:2324`). So the backend-seeded TPC user (role `"TPC Team"`, `AuthController.java:86`) gets Approvals through canonicalisation, while `MIS Team` aliases (e.g. `"MIS"`) would *not* get Work-summary or the stats poll (INFERRED).
- **Server:** see `the Frontend (Next.js) API routes section of 02-service-inventory.md` → auth.ts section.

## 3. Screens per role, and the calls each makes

### 3.1 Dashboard shell `/` (`frontend/src/app/page.tsx`)

Sidebar tab visibility (VERIFIED):

| Tab (hash) | Who sees it | Gate |
|---|---|---|
| dashboard ("Control Desk"), status ("Tender Status & Overview"), tenders ("Tender Repositories"), analytics, settings | all logged-in roles | `page.tsx:2268-2300, 2350-2375` (no role condition) |
| team ("Team Management") | Admin | `page.tsx:2304`; content `:4278` |
| work-summary | Admin, MIS Team | `page.tsx:2314`; content `:4549` |
| approvals ("Approvals Center") | Admin, MIS Team, Clearance Team, TPC Pricing Team (canonical) | `page.tsx:2324`; content `:4538` |
| audit ("System Activity Log") | Admin | `page.tsx:2359`; content `:3981` |

The resulting set of tabs per role:

- **Tender Executive:** 5 tabs.
- **Clearance / TPC:** 6 tabs (+Approvals).
- **MIS Team:** 7 tabs (+Work-summary, +Approvals).
- **Admin:** 9 tabs.

Note that `'status'` is missing from the hash whitelist (`page.tsx:562`), so `#/status` in a URL is ignored on load. Clicking the tab works (VERIFIED).

**On mount, after login or restore** (VERIFIED):

| # | Call | Condition | Source |
|---|---|---|---|
| 1 | `GET /api/compliance-progress-client?v=…` | every full page load | `layout.tsx:19` |
| 2 | `GET /api/tenders?search=&status=&location=&sector=&sortBy=scraped_at&order=desc&mis_executive=` | all | `fetchData` → `fetchTenders` (`page.tsx:589-596, 684-731`) |
| 3 | `GET /api/analytics` | all | `page.tsx:752-763` |
| 4 | `GET /api/auth/users` | all. The team list is used to build MIS/spec dropdowns | `fetchMisTeam` (`page.tsx:779-794`) |
| 5 | `GET /api/auth/executives` | `role === 'MIS Team' \|\| 'Admin'` | `page.tsx:592-594, 796-808` |
| 6 | `GET /api/tenders?…` (same as #2) | all. The 300 ms debounced filter effect also fires on mount, so it duplicates #2 | `page.tsx:942-950` |
| then | 1.5 s poll (§0) | | `page.tsx:952-1040` |

**On tab switch** (VERIFIED, `page.tsx:598-612, 942-950`):

| Tab | Calls on switch |
|---|---|
| any | `GET /api/tenders?…` again (debounced 300 ms, since `activeTab` is in the deps) |
| analytics | `GET /api/tenders/stats` once (only while `execStats` is empty) |
| audit (Admin) | `GET /api/activity-logs` (unpaginated; the backend returns all rows, `ActivityLogController.java:28`) |
| team (Admin) | `GET /api/auth/users` |
| work-summary (Admin/MIS) | `GET /api/auth/users`, plus `GET /api/tenders` only if the tenders list is empty (`page.tsx:734-750`) |
| approvals | mounts `ApprovalsCenter` (§3.3). The dashboard poll stops |
| dashboard / status / tenders / settings | none beyond the debounced `/api/tenders` |

- **Status tab** = `StatusDashboard.tsx`. It receives `tenders` and `fetchWithAuth` as props but **never calls `fetchWithAuth`** (VERIFIED: only the declaration at `StatusDashboard.tsx:46,60`). Filtering and pagination (page size 20, `StatusDashboard.tsx:82`) are done client-side over the full `tenders` array.
- **Tenders (repository) tab** paginates client-side too (`repoPage`/`repoLimit=20`, `page.tsx:136-137`). This confirms the API is expected to return the entire list.

**On action from the dashboard** (VERIFIED):

- Refresh/sync button: header (`page.tsx:2509`, no role gate) and the "System Sync" card (`page.tsx:2953`). It calls `handleRefresh` (`page.tsx:1057-1085`):
  1. `POST /api/tenders/sync-emails`. Next aborts the backend call after 3 s and fakes success (`sync-emails/route.ts:9-38`).
  2. `POST /api/tenders/sync-gem`, with no timeout.
  3. `fetchData` (calls #2-#4 above).
  **Any role can trigger GeM and email sync** from the UI. Whether the backend restricts it is for the backend reviewer.
- Metric-card click: `fetchTenders({status, …})` → `GET /api/tenders?status=…` (`page.tsx:1417-1424`).
- Team tab (Admin):
  - Create user: `POST /api/auth/users` (`page.tsx:868`), then `GET /api/auth/users` and `GET /api/auth/executives`.
  - Delete user: `DELETE /api/auth/users?username=` (`page.tsx:914`), then the same two refetches.
  - The client-side gate also lets MIS Team call these handlers (`page.tsx:851,899`), but the Team tab is only shown to Admin.

### 3.2 Dashboard drawer (inside `page.tsx`)

The drawer (`page.tsx:5557` onward) holds the full workflow UI:

- notes: `PATCH /api/tenders/{id}`
- participation: `handleStatusChange` → `PATCH` (`:1709-1711`, buttons `:6091-6109`)
- tech-spec upload: `POST /api/tenders/{id}/upload-tech-spec` plus the 1 s progress poll (`:1308-1400`)
- clearance request/approval: `POST …/clearance-request` (`:6341`) and `POST …/approve-clearance` (`:6530`)
- TPC/MIS price: `POST …/tpc-price` (`:6763`) and `POST …/mis-price` (`:6837`)
- EMD receipt: `POST …/upload-emd-receipt` (`:1270`)
- generic workflow `PATCH` via `updateTenderField` (`:1233-1260`, ~20 call sites `:6317-7756`)
- comments: `POST …/comments` (`:1213`)
- bid docs: `POST …/generate-bid-docs` (`:452`)

**Reachability.** `selectedTender` is only set when `window.location.pathname` starts with `/tenders/` (`page.tsx:615-643, 646-680`). In the Next deployment that path renders `tenders/[id]/page.tsx` instead, and list clicks do a full navigation there (`page.tsx:1410-1412`). So **in the Next deployment the drawer is unreachable** (INFERRED). In the Spring-served SPA, `/tenders/**` is forwarded to `index.html` (`SpaForwardController.java:13-15`, `WebConfig.java:35-36`), so the drawer *is* the detail view there (INFERRED). Load scripts should treat the drawer and the detail page as alternative implementations of the same journey.

### 3.3 Approvals Center (`frontend/src/app/components/ApprovalsCenter.tsx`, mounted at `page.tsx:4538-4545`)

- Roles: Admin, MIS Team, Clearance Team, TPC Pricing Team. Admin additionally gets a PENDING/HISTORY switch and team/role filters (`ApprovalsCenter.tsx:301-305, 391-399`).
- On mount (VERIFIED):
  - `GET /api/approvals/counts?status=PENDING` (`:347`)
  - `GET /api/approvals/pending?status=PENDING[&stage&search&team&role]` (`:408`, effect `:424-427`)
  - `GET /api/auth/mis-team` (`:429-438`)
  - **plus a second `GET /api/approvals/pending`** about 400 ms later, because the search-debounce effect also runs on mount (`:440-445`) (INFERRED from React effect semantics).
  - Admin with 0 pending and >0 history auto-switches to HISTORY, which adds one more `pending?status=HISTORY` call (`:353-357`).
- On filter/stage/tab change: counts + pending again (`:424-427, 447-454`). History filter: pending only (`:456-459`).
- Actions:
  - `POST /api/approvals/{id}/review` with a JSON body (`:601`).
  - For SPEC_CLEARANCE: `POST /api/tenders/{tenderId}/approve-clearance` with multipart (complianceType, comment, optional pdf/docx/xlsx) (`:579`).
  - Each action is followed by counts + pending.
- **No polling** (VERIFIED: no timers apart from debounces). The sidebar badge count (`page.tsx:2332-2345`) only updates while this component is mounted (`onCountsChange`, `:366`).
- `/api/approvals/pending` has no page/limit parameters (`ApprovalController.java:498-504`), so it is unpaginated.

### 3.4 Tender detail page `/tenders/{id}` (`frontend/src/app/tenders/[id]/page.tsx`)

- Auth gate is client-only: if `localStorage.currentUser` is missing, `router.push('/')` (`:356-375`).
- **On mount** (VERIFIED, `:384-397`):
  - `GET /api/compliance-progress-client` (layout)
  - `GET /api/tenders/{id}?t=` (`:404`)
  - `GET /api/tenders/{id}/comments?t=` (`:546`)
  - `GET /api/auth/users?t=` (`:561`)
  - then the 1.5 s poll of the first two (80/min).
- Role-dependent sections and their actions (VERIFIED gates; all actions are on click):

| Section | Shown to | Calls |
|---|---|---|
| Tech-spec upload (step 1) | `canPerform(role,'uploadSpecs')` = Tender Executive (`:2812`) | `POST /api/tenders/{id}/upload-tech-spec` multipart (`:1172`). In parallel the page polls `GET …/tech-spec-progress` every 1 s (`:1155-1167`) and `compliance-progress.js` adds its own 1 s poll plus 1 baseline (`compliance-progress.js:534-590`). Afterwards: `GET /api/tenders/{id}` + `GET /api/tenders?…`-equivalent refresh (`:1200`) |
| Clearance request | Tender Executive (within step 1 UI) | `POST /api/tenders/{id}/clearance-request` (`:2944`) |
| Clearance decision | `canReviewAssignment(role, user, assigned_mis_member_spec)`, effectively Clearance Team (`:2987`) | `POST /api/tenders/{id}/approve-clearance` multipart (`:601`, button `:3198`) |
| Bid package | `canPerform(role,'generateBids')` = Tender Executive (`:3455, 3530`) | `POST /api/tenders/{id}/generate-bid-docs` JSON (`:1405`). **Heaviest call in the app**: Chromium, python and file writes in the Next process |
| EMD applicability | Tender Executive | `POST /api/v2/workflow/{id}/emd-applicability` (`:3603, 3650`) |
| EMD receipt upload | Tender Executive (enforced server-side too, `upload-emd-receipt/route.ts:36-43`) | `POST /api/tenders/{id}/upload-emd-receipt` multipart (`:148`) |
| EMD approval (MIS) | `isMisRole && canReviewAssignment(…)` (`:3926`) | `POST /api/v2/workflow/{id}/action` (`:3933`). **No backend mapping found** (see routes part) |
| Pricing route | Executive or Admin (`:4140`) | `POST /api/v2/workflow/{id}/route-pricing` (`:691`, buttons `:4163-4234`) |
| TPC price | TPC or Admin UI (`:4263`) | `POST /api/tenders/{id}/tpc-price` (`:721`, button `:4287`) |
| MIS final price | MIS or Admin UI (`:4302-4356`) | `POST /api/tenders/{id}/mis-price` (`:757`) |
| Document verification | `isMisRole && canReviewAssignment(…docs)` (`:4580`) | `POST /api/v2/workflow/{id}/verify-all-documents` (`:4589`) or `…/reject-documents` (`:4618`) |
| Submission / outcome | `isMisRole && canReviewAssignment(…)` (`:4725, 4842`) | `PATCH /api/tenders/{id}` (`updateTenderField :625-660`, plus `:1095-1102, 1260-1267, 1320-1326, 1355-1360`) |
| Comments | all | `POST /api/tenders/{id}/comments` (`:1242`) |
| Document links | all (EMD receipt only if `isAuthorizedForEmdReceipt`, `:138`) | `GET /documents/{id}/{file}?token=…` → Next rewrite → document route (`:3004-3020, 3327, 3476-3484, 3779, 4497-4531`) |

- Admin is mostly view-only on this page:
  - `canPerform` denies Admin `uploadSpecs`/`generateBids`/`approveSpecs` (`workflowAuthorization.ts:32-34`).
  - `canReviewAssignment` returns false for Admin (`workflowAuthorization.ts:77`).
  - Admin does still see the pricing-route, TPC and MIS price controls (`:4140, 4263, 4325`).

### 3.5 Other pages and components

- `/preview-docs` (`frontend/src/app/preview-docs/page.tsx`): an internal template preview page with **no login check and no link from the app** (VERIFIED: no reference in `src/`).
  - On mount and on each option change: `POST /api/preview-doc` (`:42`, effect `:107-109`).
  - "Run tests" fires a sequence of `POST /api/preview-doc` calls (`:134`).
  - Each response is full HTML with **multiple base64-embedded PNG/JPEG images**, read from disk with `readFileSync` on every render (`frontend/src/lib/documentLayout.ts:21-31,104-176`, `documentTemplates.ts:989-1171`). The source images are 26 KB-800 KB each (`frontend/public/images/`), so responses are plausibly in the MB range (INFERRED).
  - The endpoint is unauthenticated. Exclude it from user journeys, but treat it as an abuse vector.
- `ProductCatalogue.tsx`: **not mounted anywhere** (VERIFIED: never imported; commit dfd86780 removed the tab). It would call `/api/products/models*` with plain `fetch` and no auth headers (`ProductCatalogue.tsx:97,119,168,200,225`). Exclude it from journeys.
- `WorkflowPipelineStepper.tsx`: pure presentational component, no network (VERIFIED).
- `compliance-progress.js` (backend static, injected by the Next layout or by the Spring filter):
  - It monkey-patches `window.fetch`, but only to intercept `POST …/upload-tech-spec` (`compliance-progress.js:534-597`). That adds the baseline `GET …/tech-spec-progress` (3 s timeout) and the guarded 1 s poll.
  - It intercepts clicks on `/api/tenders/{id}/(tech-spec-download|documents)/…` links and downloads them via `fetch` → blob (`:70-96`).
  - A `MutationObserver` on `document.body` (`:179`) only touches the DOM, with no network (VERIFIED: `restoreAdminUpload` returns early, `:101-106`).

## 4. Largest payloads (reasoning)

1. **`GET /api/tenders` with no `limit`.** The UI never sends `limit`/`page` (VERIFIED: the only `fetchTenders` override call, `page.tsx:1424`, passes neither). The backend then loads `findAll()` (Admin/MIS/TPC/Clearance) or `findByMisExecutive` (executives), filters and sorts in memory, and returns every matching full `Tender` row plus location/sector filter lists (`TenderController.java:306-313, 463-495`). Row fields include the free-text `notes`, `ai_details_summary`, `ai_history_summary` and the `downloaded_docs` JSON (`frontend/src/lib/db.ts:299-383` mirrors the shape). It is **polled every 1.5 s per dashboard tab, twice per tick for Admin.** This is the dominant read load. The size scales with tender count (UNKNOWN).
2. `GET /api/activity-logs`: the whole audit table, unpaginated (`ActivityLogController.java:28`). Fetched once per Admin visit to the Audit tab.
3. `GET /api/approvals/pending`: unpaginated (`ApprovalController.java:498-504`).
4. `GET /api/analytics`: the response is aggregated, but computed from a whole-table projection (`AnalyticsController.java:~44-48`). Polled every 1.5 s.
5. Document downloads (`/documents/…`, `/api/tenders/{id}/documents/…`). The Next handler buffers the **entire file** in memory, either with `fs.readFileSync` (`documents/[...filename]/route.ts:232`) or with backend `arrayBuffer()` (`:140`), before responding. Tender PDFs/ZIPs can be large (UNKNOWN sizes).
6. Uploads: tech-spec, EMD receipt, clearance documents and product sheets. Each is fully buffered by Next (`backendProxy.ts:33-34`, `upload-emd-receipt/route.ts:28,48`) before being forwarded. No client-side size limit was found (VERIFIED for `isValidTechSpecFile`, `page.tsx:1302-1306`, which checks the extension only).
7. `POST /api/preview-doc` responses: HTML with embedded base64 images (§3.5).

## 5. Realistic user journeys (replayable HTTP sequences)

Conventions:

- All authenticated calls carry `Authorization: Bearer $JWT`, `x-user-role: $ROLE`, `x-user-username: $USER`, `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, `Expires: 0`. A cookie `token=$JWT` is also present.
- `$Q` = `search=&status=&location=&sector=&sortBy=scraped_at&order=desc&mis_executive=`.
- `POLL(role)` = repeat every 1.5 s until the user leaves the screen:
  - all roles: `GET /api/tenders?$Q&t=$now`, `GET /api/analytics?t=$now`
  - Admin: + `GET /api/tenders?status=Participating&t=$now`
  - Admin/MIS: + `GET /api/tenders/stats?t=$now`
- `DPOLL(id)` = every 1.5 s, concurrently: `GET /api/tenders/{id}?t=$now`, `GET /api/tenders/{id}/comments?t=$now`.

All steps below are derived from the code paths cited in §3. Think times are not in the code (UNKNOWN). Pick them from production analytics.

**J0: Login (all roles)**
1. `GET /` (HTML), plus static `/_next/static/*` chunks
2. `GET /api/compliance-progress-client?v=20261012-sanitize-2`
3. `POST /api/auth/login` with `{"username","password"}`
4. `GET /api/tenders?$Q` ∥ `GET /api/analytics` ∥ `GET /api/auth/users`
5. Admin/MIS only: `GET /api/auth/executives`
6. (+300 ms) `GET /api/tenders?$Q`
7. start `POLL(role)`

**J1: Tender Executive: browse → open tender → upload spec → request clearance**
1. J0
2. Tab "tenders" or "status": `GET /api/tenders?$Q` (debounced), then search typing: `GET /api/tenders?search=…` per 300 ms pause
3. Open a tender (full navigation):
   - `GET /tenders/{id}`
   - `GET /api/compliance-progress-client?v=…`
   - `GET /api/tenders/{id}?t=` ∥ `GET /api/tenders/{id}/comments?t=` ∥ `GET /api/auth/users?t=`
   - start `DPOLL(id)`
4. Upload the spec:
   - `GET /api/tenders/{id}/tech-spec-progress` (baseline)
   - `POST /api/tenders/{id}/upload-tech-spec` (multipart `file`), held open until conversion finishes
   - meanwhile `GET /api/tenders/{id}/tech-spec-progress` ×2 per second
   - on success: `GET /api/tenders/{id}`
5. Download the generated sheets: `GET /api/tenders/{id}/tech-spec-download/{file}.pdf|docx|xlsx` and/or `GET /documents/{id}/Combined_Technical_Data_Sheet.pdf?token=$JWT`
6. `POST /api/tenders/{id}/clearance-request`
7. `POST /api/tenders/{id}/comments` with `{"comment","phase"}` (optional)
8. Back to the dashboard (`router.push('/')`): repeat J0 steps 4-7 (without the login)

**J2: Clearance Team: review clearance via Approvals**
1. J0 (POLL at 80/min until the tab switch)
2. Tab "approvals" (POLL stops):
   - `GET /api/approvals/counts?status=PENDING` ∥ `GET /api/approvals/pending?status=PENDING` ∥ `GET /api/auth/mis-team`
   - (+400 ms) `GET /api/approvals/pending?status=PENDING`
3. Stage filter `SPEC_CLEARANCE`: `GET /api/approvals/counts?status=PENDING` ∥ `GET /api/approvals/pending?stage=SPEC_CLEARANCE&status=PENDING`
4. Open the documents: `GET /documents/{id}/Combined_Technical_Data_Sheet.pdf?token=$JWT` (document route)
5. Approve: `POST /api/tenders/{tenderId}/approve-clearance` (multipart `complianceType`, `comment`, optional `pdfFile`/`docxFile`/`xlsxFile`), then counts + pending
6. Alternative path via the detail page: J1 step 3, then `POST /api/tenders/{id}/approve-clearance`

**J3: Tender Executive: bid package + EMD**
1. J1 step 3 (detail page, DPOLL running)
2. `POST /api/tenders/{id}/generate-bid-docs` with the JSON bid form. **Heavy, in the Next process.**
3. `GET /documents/{id}/Bid_Documents_{id}.pdf?token=$JWT`, `GET /documents/{id}/Bid_Documents_{id}.docx?token=$JWT`
4. `POST /api/v2/workflow/{id}/emd-applicability`
5. `PATCH /api/tenders/{id}` with the EMD payment fields
6. `POST /api/tenders/{id}/upload-emd-receipt` (multipart `file`)
7. `POST /api/v2/workflow/{id}/route-pricing` with `{route: 'TPC'|'MIS', …}`

**J4: TPC Pricing Team: price**
1. J0 → approvals tab (as J2 step 2), stage `TPC_PRICING`
2. `POST /api/approvals/{approvalId}/review` with JSON `{action, comment, tpcPurchasePrice, assignedMisMember, tenderId, stage:'TPC_PRICING'}`, then counts + pending
3. Alternative via detail: J1 step 3 → `POST /api/tenders/{id}/tpc-price`

**J5: MIS Team: price, verify documents, submission, outcome**
1. J0 (POLL at 120/min) → optionally the work-summary tab: `GET /api/auth/users`
2. Approvals: as J2 step 2, then `POST /api/approvals/{id}/review` for the MIS stages (MIS_PRICING, DOC_VERIFICATION, PAYMENT_*, SUBMISSION_PENDING, WIN_LOSS_PENDING)
3. Or via detail (J1 step 3):
   - `POST /api/tenders/{id}/mis-price`
   - `POST /api/v2/workflow/{id}/verify-all-documents` | `…/reject-documents`
   - `PATCH /api/tenders/{id}` (submission/outcome fields)
   - `POST /api/tenders/{id}/comments`

**J6: Admin: monitoring**
1. J0 (POLL at 160/min)
2. Tab analytics: `GET /api/tenders/stats` (once)
3. Tab audit: `GET /api/activity-logs` (full table)
4. Tab team: `GET /api/auth/users`. Create user: `POST /api/auth/users`, then `GET /api/auth/users` + `GET /api/auth/executives`
5. Tab approvals: as J2 step 2. Possibly the HISTORY switch: `GET /api/approvals/counts?status=HISTORY` + `GET /api/approvals/pending?status=HISTORY`
6. Leave the dashboard open idle, which keeps 160 req/min going

**J7: Any role: manual sync (rare, expensive)**
1. `POST /api/tenders/sync-emails` (Next answers within 3 s)
2. `POST /api/tenders/sync-gem` (no timeout)
3. `GET /api/tenders?$Q` ∥ `GET /api/analytics` ∥ `GET /api/auth/users`

**Idle-tab baseline (most important for capacity).** N logged-in users with the dashboard open generate ≈ N × (80…160) req/min. Each request costs about one full-table tender scan plus one analytics scan on the backend, plus a Next proxy hop (Next deployment). Users on the detail page add 80 req/min each.

## 6. Static export inside Spring (`backend/src/main/resources/static/`)

- Spring bundles a Next static export: `index.html`, `404.html`, `_not-found*`, `__next.*.txt`, and `_next/static/chunks/*` with build id `iwYRzmOg4HRzMmB2st_fG` (VERIFIED by listing).
- Spring serves it at `/`. It forwards `/tenders/**` to `/index.html` (`SpaForwardController.java:13-15`, `WebConfig.java:35-36`) and injects `<script src="/compliance-progress.js…">` into those HTML responses (`ComplianceProgressUiInjectionFilter.java:19-48`). The filter's own comment says it does this "without rebuilding its unavailable source project" (`:16`).
- So **yes, a frontend is also served by Spring.** In that topology:
  - no Next route handlers exist (static export does not support request-dependent Route Handlers or rewrites: `frontend/node_modules/next/dist/docs/01-app/02-guides/static-exports.md:274-284`)
  - browser `/api/*` calls hit Spring directly and same-origin
  - `/documents/**` is served by Spring (`DocumentDownloadController.java:15`, `WebConfig.java:25-30`, `permitAll` at `SecurityConfig.java:66`)
- **The static export is stale compared with the current source** (VERIFIED by content):
  - Its chunks reference `/api/tenders`, `/api/analytics`, `/api/tenders/stats`, `/api/tenders?status=Participating`, `/api/auth/*`, `/api/activity-logs`, `/api/tenders/sync-*`, `…/clearance-request`, `…/generate-bid-docs`, `…/upload-tech-spec`, `…/comments`.
  - They contain **no** `/api/approvals/*`, `/api/v2/workflow/*`, `…/tech-spec-progress`, `…/tpc-price`, `…/mis-price` or `…/upload-emd-receipt` (grep of `_next/static/chunks/*.js`).
  - The current `next.config.ts` has no `output: 'export'`.
  - `index.html` was last changed in the initial commit 4c913b65 (2026-09-10) (`git log` on the file).
- The stale bundle **also polls at 1.5 s**:
  - the dashboard poll (`11-we87xhvbs8.js`, `setInterval(…,1500)` with `/api/tenders?…`, `/api/analytics?t=`, `/api/tenders?status=Participating&t=`, `/api/tenders/stats?t=`)
  - a detail-view poll (`10w45kcb4.02s.js`: `setInterval(()=>{e0(!0),e1(R)},1500)` hitting `/api/tenders/{id}?t=` and `/comments?t=`)
  So the background request rates in §0 hold for either build (VERIFIED for the intervals; per-role conditions in the minified code were not traced).
- **Which build users actually get is UNKNOWN.** It depends on whether production users reach Spring's port directly, or the Next server (`next start`, port/env not in the reviewed code) with `BACKEND_URL` pointing at Spring. Settle via deployment configs (Dockerfile/compose/systemd/reverse-proxy) or by checking the build id served in production.

## Open questions / UNKNOWN

1. Deployed topology: Next server in front of Spring, or Spring-served stale static SPA, or both (§6). This decides whether Next route handlers (proxy hop, SQLite, Puppeteer, OCR) are in the request path at all.
2. Production data volumes (tenders, activity_log, approvals, comment counts) and tender document sizes. These set the size of the 1.5 s full-list poll and of downloads.
3. Concurrency profile: how many users per role are logged in at once, and how many keep tabs open idle. Polling dominates, so this matters more than any click journey.
4. Browser hidden-tab throttling for the actual user browsers (affects idle-tab rate; the code itself never pauses).
5. Think times and journey mix. The code gives the sequences, not the frequencies.
6. Duration of `upload-tech-spec` conversion (sets how long the 2 req/s progress poll lasts) and `sync-gem` duration. These are backend-side and need measurement.
7. Node/undici timeouts on `proxyToBackend` (no explicit timeout), and whether a reverse proxy in front enforces its own.
8. Whether `python3`, `pdftotext`, `pdftoppm`, `tesseract` and Chromium exist in the Next runtime (decides the cost of `generate-bid-docs` and document cache misses).
9. Role strings stored in the production user table, e.g. `"TPC Team"` vs `"TPC Pricing Team"`, `"MIS"` vs `"MIS Team"`. Raw-string gates in `page.tsx` change which polls and tabs a user gets (§2).
10. Backend mappings for UI calls with no matching controller: `POST /api/v2/workflow/{id}/action` (`tenders/[id]/page.tsx:3933`), and `POST /api/process-email` (UI handler is unwired). Confirm with the backend inventory.
