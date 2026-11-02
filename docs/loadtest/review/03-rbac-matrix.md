# 03 — RBAC Matrix and Authentication (Spring Boot backend)

Commit `68eb28ae`. Path prefixes: same as `02-service-inventory.md`, all repo-relative under `backend/src/main/java/com/tenderpocket/`.
Labels: VERIFIED, INFERRED, UNKNOWN.

## 1. Roles as defined in code

There is **no role enum**. A role is a free-text column, `users.role` (`models/User.java:28-29`). Three different string sets are used.

### 1a. Strings that can be stored (user creation allow-list), VERIFIED

`controllers/AuthController.java:251`:
`"Admin", "MIS Team", "Tender Executive", "Clearance Team", "TPC Team", "Specification Team"`.

`"MIS Executive"` and `"Tender Operations Executive"` are rewritten to `"Tender Executive"` before validation (`:247-249`).

### 1b. Canonical roles used for permission decisions, VERIFIED

`config/WorkflowPermissions.java:16-26`. The `ROLE_` prefix is stripped, `_` becomes a space, and the result is upper-cased before mapping:

| Canonical | Accepted aliases |
|---|---|
| `Admin` | ADMIN |
| `Tender Executive` | EXECUTIVE, TENDER EXECUTIVE, MIS EXECUTIVE |
| `Clearance Team` | SPECIFICATION TEAM, CLEARANCE TEAM, CLEARANCE, SPECIFICATION |
| `TPC Pricing Team` | TPC TEAM, TPC PRICING TEAM, TPC, TPC PRICING |
| `MIS Team` | MIS TEAM, MISTEAM, MIS |
| *(empty: denied everywhere `WorkflowPermissions` is consulted)* | anything else, including the fallback `"User"` assigned to a token with no role claim (`config/JwtRequestFilter.java:49`) |

### 1c. Comparison with the expected role list

| Expected | In code | Note |
|---|---|---|
| Admin | `Admin` | match |
| Tender Executive | `Tender Executive` | match |
| Clearance Team | `Clearance Team` (+ alias `Specification Team`, which is a separate *creatable* stored role) | **extra stored role**: `Specification Team` |
| TPC Pricing Team | Canonical only. **The stored string is `TPC Team`**, and `"TPC Pricing Team"` is *rejected* by `POST /api/auth/users` (`controllers/AuthController.java:251-256`) | **name mismatch**. Test users must be created with role `TPC Team` |
| MIS Team | `MIS Team` | match |
| — | `MIS Executive` (legacy) | Canonically a Tender Executive, but several controllers string-compare it as an MIS-team member: `controllers/ApprovalController.java:762, 778, 478`, `controllers/TenderController.java:229, 754`. These are inconsistent semantics (VERIFIED). It cannot be created through the API (rewritten at `AuthController:247`); it can exist only through legacy data. |

### 1d. How the role reaches the controller

- JWT claim `role`, verbatim from `users.role` at login time (`controllers/AuthController.java:92`, `config/JwtUtil.java:59-63`). VERIFIED.
- The filter builds a single authority `ROLE_<ROLE upper, spaces→_>` (`config/JwtRequestFilter.java:49-50`). VERIFIED.
- Controllers recover the role in three different ways (VERIFIED):
  - (a) `WorkflowPermissions.role()`, which returns the canonical name (`config/WorkflowPermissions.java:28-33`).
  - (b) Local helpers returning the *upper-cased* raw string, e.g. `"TENDER EXECUTIVE"`, compared with `equalsIgnoreCase` (`controllers/ApprovalController.java:65-73`, `controllers/WorkflowController.java:59-67`, `controllers/TenderController.java:200-213`).
  - (c) **Client request headers** `x-user-role` / `x-user-username`. These are trusted only in `controllers/AnalyticsController.java:257-263` (executive-performance) and `controllers/SignatureController.java:27` (username). Elsewhere a header value is overwritten by the JWT value, or used only as a fallback that is unreachable because `/api/**` requires authentication (INFERRED).
- **The role is frozen in the token.** The filter never reads the DB (`config/JwtRequestFilter.java:24-58`). Role changes and user deletion take effect only after the user obtains a new token, which given the expiry means effectively never (see §3). VERIFIED / INFERRED.

## 2. Permission table (`WorkflowPermissions.allowed`)

Source: `config/WorkflowPermissions.java:41-61`. VERIFIED. It matches `backend/src/test/resources/workflow-permissions.json` exactly (VERIFIED by comparison).

| Action | Admin | Tender Executive | Clearance Team | TPC Pricing Team | MIS Team |
|---|---|---|---|---|---|
| VIEW_TENDERS | Y | Y | Y | Y | Y |
| UPLOAD_SPEC | N | Y | N | N | N |
| APPROVE_SPEC | N | N | Y | N | N |
| SET_TPC_PRICE | **Y** | N | N | Y | **Y** |
| VIEW_TPC_PRICE | Y | N | N | Y | Y |
| SET_MIS_PRICE | N | N | N | N | Y |
| GENERATE_BIDS | N | Y | N | N | N |
| REVIEW_BIDS | N | N | N | N | Y |
| RECORD_PAYMENT | N | N | N | N | Y |
| RECORD_SUBMISSION | N | N | N | N | Y |
| RECORD_OUTCOME | N | N | N | N | Y |
| MANAGE_USERS | Y | N | N | N | N |
| VIEW_AUDIT | Y | N | N | N | N |

Generic `PATCH /api/tenders/{id}` adds field-level rules in `allowedPatch` (`config/WorkflowPermissions.java:102-208`). Admin may only send `tpc_purchase_price` (and `id`) (`:113-120`). Other field rules are summarised in §4.

## 3. Authentication mechanism

| Item | Finding | Evidence | Label |
|---|---|---|---|
| Login endpoint | `POST /api/auth/login`, body `{username,password}`, returns `{token,user}` | `controllers/AuthController.java:63-107` | VERIFIED |
| Password hashing | **Unsalted, single-round SHA-256 hex** in a custom `PasswordEncoder`. No BCrypt is used, even though `BCryptPasswordEncoder` is imported | `config/SecurityConfig.java:28-56` | VERIFIED |
| Login CPU cost | Negligible (one SHA-256). Login is DB-bound: up to 6 PK queries, and up to 5 inserts on the first login against an empty DB | `controllers/AuthController.java:73-89` | INFERRED |
| Token type | JWS (jjwt 0.12.6, `backend/pom.xml:70-83`), HMAC. The algorithm follows key length: 32 bytes → HS256, 48 → HS384, ≥64 → HS512 (asserted by `backend/src/test/java/com/tenderpocket/config/WorkflowPermissionsTest.java:64-73`). The default secret is 73 bytes → **HS512** | `config/JwtUtil.java:25-28, 65-73` | VERIFIED (mapping) / INFERRED (default → HS512) |
| Claims | `sub`=username, `role`, `iat`, `exp`. No `jti`, issuer or audience | `config/JwtUtil.java:59-73` | VERIFIED |
| Signing key source | `jwt.secret=${JWT_SECRET:<REDACTED>}`: a **hard-coded fallback secret committed to the repo** | `application.properties:19` | VERIFIED |
| Expiry | `jwt.expiration=${JWT_EXPIRATION:315360000}` seconds = **10 years** | `application.properties:20`, `config/JwtUtil.java:70` | VERIFIED |
| Expiry enforcement | `parseSignedClaims` rejects expired tokens (jjwt default). `validateToken` exists but is never called | `config/JwtUtil.java:47-53, 75-78` | INFERRED (library behaviour) |
| Refresh | **None.** There is no refresh endpoint or refresh token | all controllers read | VERIFIED |
| Revocation / logout | **None.** There is no logout endpoint or deny-list. Deleting a user does not invalidate their token | `config/JwtRequestFilter.java` | VERIFIED |
| Sessions | `SessionCreationPolicy.STATELESS` | `config/SecurityConfig.java:63` | VERIFIED |
| Concurrent logins | **No limit.** Any number of tokens per user can be valid at once, and the same account can be used by many virtual users | no session store | VERIFIED (absence) |
| Invalid token | Logged and treated as anonymous; `/api/**` then rejects. There is no fallback to headers | `config/JwtRequestFilter.java:37-45` | VERIFIED |
| Response on unauthenticated `/api/**` | Spring Security default entry point → 403 (no httpBasic or formLogin configured) | `config/SecurityConfig.java:58-74` | INFERRED |
| CSRF | Disabled | `config/SecurityConfig.java:62` | VERIFIED |
| CORS | Origins from `app.cors.allowed-origins` (env `ALLOWED_ORIGINS`), default `http://localhost:3000`, `http://localhost:8085`; methods GET/POST/PUT/PATCH/DELETE/OPTIONS; headers `Authorization, Content-Type, x-user-role, x-user-username`; credentials allowed. `ProductCatalogueController` adds its own `@CrossOrigin` | `config/SecurityConfig.java:76-99`, `controllers/ProductCatalogueController.java:19` | VERIFIED |
| `permitAll` paths | `/api/auth/login`, `/api/health`, `/`, `/index.html`, `/static/**`, `/favicon.ico`, **`/documents/**`**, `/images/**`, `/*.html`, `/*.js`, `/*.css`, `/*.png`, `/*.ico`, `/*.json`, `/*.svg`, and **everything not under `/api/**`** (`anyRequest().permitAll()`) | `config/SecurityConfig.java:65-68` | VERIFIED |
| Method security | None (no `@EnableMethodSecurity`, `@PreAuthorize`, `@Secured` or `@RolesAllowed`) | grep over `backend/src/main/java` | VERIFIED |

## 4. Role × endpoint matrix

Key: **Y** allowed; **N** rejected; **C** conditional (condition given); **Any** any authenticated principal, including a token whose role maps to no canonical role. "Where" column codes: **WP** `WorkflowPermissions.allowed`; **SC** `SecurityConfig`; **M** manual string check in the controller; **Q** queue/assignee ownership check; **none** = authenticated only.

| Endpoint | Admin | Exec | Clear | TPC | MIS | Where enforced (file:line) |
|---|---|---|---|---|---|---|
| POST /api/auth/login | Y | Y | Y | Y | Y | SC public `config/SecurityConfig.java:65` |
| GET /api/health | Y | Y | Y | Y | Y | SC public `:65` |
| GET /api/auth/users | Y (full + stats) | C (directory) | C | C | C | WP `controllers/AuthController.java:114-125` |
| POST /api/auth/users | Y | N | N | N | N | WP MANAGE_USERS `:210` + M DB role `:222-235` |
| DELETE /api/auth/users | Y | N | N | N | N | WP `:303` + M `:314-326` |
| GET /api/auth/{executives,roles,clearance-team,tpc-team,mis-team,spec-team} | Y | Y | Y | Y | Y | WP VIEW_TENDERS `:352,366,380,391,402,413` |
| GET /api/activity-logs | Y | N | N | N | N | WP VIEW_AUDIT `controllers/ActivityLogController.java:23` |
| GET /api/analytics | Y | C (own) | C (spec-scoped) | Y | Y | WP `controllers/AnalyticsController.java:36`; scope `:41-49` |
| GET /api/analytics/executive-performance | Any | Any | Any | Any | Any | **none**; scope from **client header** `:261` |
| GET /api/approvals/counts, /pending | Y (global) | **N** | Y (spec queue) | Y (TPC queue) | Y (MIS queue) | M+WP `controllers/ApprovalController.java:76-82, 365, 509` |
| POST /api/approvals/{id}/review | **N** | N | C: SPEC_CLEARANCE only; cannot reject | C: TPC_PRICING only | C: PAYMENT_APPROVAL, MIS_PRICING, DOC_VERIFICATION, SUBMISSION_PENDING, WIN_LOSS_PENDING | M `:675`, WP `:680, 732`, Q `:747-794`, stage match `:807-821` |
| POST /api/tenders/sync-gem, /sync-emails | Y | Y | N | N | Y | M `controllers/TenderController.java:229, 253` |
| POST /api/tenders/trigger-due-alerts | Any | Any | Any | Any | Any | **none** `:273-284` |
| GET /api/tenders | Y (all) | C (own `mis_executive`) | C (assigned or SPEC_CLEARANCE) | C (pricing-related) | Y (all) | WP `:302`; M filters `:308-339` |
| GET /api/tenders/{id} | Y | C own | C | C | Y | WP `:768`; M `:780-800` |
| POST /api/tenders | **N** | Y | Y | Y | Y | WP `:835`; `allowedPatch` denies Admin `:846` |
| PATCH /api/tenders/{id} | C: `tpc_purchase_price` only | C: field rules, **any tender** | C: field rules, any tender | C | C | WP `:884`; `allowedPatch` `:897`; Q for approval-status fields `:1434-1498` |
| DELETE /api/tenders/{id} | N | N | N | N | Y | M `WorkflowPermissions.role().equals("MIS Team")` `:1608` |
| POST /api/tenders/{id}/generate-bid-docs | N | Y (any tender) | N | N | N | WP GENERATE_BIDS `:1643` |
| GET /api/tenders/{id}/tech-spec-progress | Y | Y | Y | Y | Y | WP `:1787` |
| POST /api/tenders/{id}/upload-tech-spec | N | Y (any or new tender id) | N | N | N | WP UPLOAD_SPEC `:1816` |
| POST /api/tenders/{id}/generate-tech-specs | N | Y | N | N | N | WP `:2155` |
| GET/POST /api/tenders/{id}/comments | Y | Y | Y | Y | Y | WP `:2235, 2246` |
| GET /api/tenders/stats | Y | Y | Y | Y | Y | WP `:2264` |
| GET /api/tenders/documents/{id}/{file} | Y | C (EMD receipt only if assigned) | C (no EMD receipts) | C | C (assigned/queue) | WP `:2340`; M `:2343-2353` |
| POST /api/tenders/{id}/upload-emd-receipt | **N** | C (assigned or unassigned) | N | N | C (assigned/queue/unassigned) | M `:2448-2455` (no WP gate) |
| GET /api/tenders/{id}/workflow-details | Y | Y | Y | Y | Y (no per-tender scoping) | WP `controllers/WorkflowController.java:76` |
| POST …/clearance-request | N | Y | N | N | N | WP UPLOAD_SPEC `:129` |
| POST …/approve-clearance (both) | N | N | C (assigned rep or queue) | N | N | WP APPROVE_SPEC `:259`; Q `:271-279` |
| POST …/tpc-price | **Y** | N | N | Y | **Y** | WP SET_TPC_PRICE `:518` |
| POST …/mis-price | N | N | N | N | Y | WP `:607` |
| POST …/payment-request | N | **N** | N | N | Y | WP RECORD_PAYMENT `:673` |
| POST …/doc-verification-request | N | Y | N | N | N | WP GENERATE_BIDS `:743` |
| POST …/submission-request | N | **N** | N | N | Y | WP RECORD_SUBMISSION `:810` |
| POST …/win-loss-request | N | **N** | N | N | Y | WP RECORD_OUTCOME `:864` |
| POST …/review-approval | N | N | C | C | C | M `:924`; WP `:929-946`; Q `:954-965` |
| POST …/unable-to-submit | N | N | N | N | Y | WP `:1178` |
| GET/POST …/workflow-comments | Y | Y | Y | Y | Y | WP `:1202, 1215` |
| GET /api/v2/workflow/{id}/state, /manifest | Y | Y | Y | Y | Y | WP `controllers/WorkflowSyncController.java:62, 124` |
| POST /api/v2/workflow/{id}/assign-executive | N | N | N | N | Y | M `:170` |
| POST …/spec-clearance | N | N | Y | N | N | M `:209` |
| POST …/bid-docs-prep, /emd-applicability, /emd-payment, /final-submission | N | Y (any tender) | N | N | N | M `:394, 420, 456, 629` |
| POST …/verify-document/{mid}, /verify-all-documents, /reject-documents, /commercial-go-ahead | N | N | N | N | Y | M `:494, 509, 532, 600` |
| POST …/route-pricing | **Y** | Y | N | N | Y | M `:558` |
| /api/products/** (8 handlers), /api/tenders/{id}/offered-models | Any | Any | Any | Any | Any | **none** `controllers/ProductCatalogueController.java` |
| /api/noticedesk/** (4) | Any | Any | Any | Any | Any | **none** `controllers/NoticeDeskController.java` |
| /api/signatures/** (2) | Any | Any | Any | Any | Any | **none**; username from header `controllers/SignatureController.java:27` |
| /api/update/status, /check, **/apply** | Any | Any | Any | Any | Any | **none** `controllers/UpdateController.java` |
| GET /documents/{id}/{file} (controller) | Y | C | C | C | C | SC permitAll + WP in delegate `controllers/TenderController.java:2340` |
| GET /documents/** (static, nested paths) | public | public | public | public | public | SC permitAll `config/SecurityConfig.java:66` + `config/WebConfig.java:20-25` |
| GET /tenders/**, / , /index.html | public | public | public | public | public | SC `:66, 68` |

### Workflow-order observations visible in RBAC (VERIFIED from the checks above)
- Admin is **view-only for approvals** (`controllers/ApprovalController.java:675`, `controllers/WorkflowController.java:924`, `controllers/TenderController.java:2448`). However, Admin **can** set the TPC price (`WorkflowController:518`), route pricing (`WorkflowSyncController:558`), and PATCH `tpc_purchase_price`.
- Tender Executive cannot open the Approvals Center (`ApprovalController:76-82`). The `isExecutive` branches in `ApprovalController` (`:378, :523`) and the `*ForExecutive` repository queries (`repositories/TenderApprovalRepository.java:216-245`) are therefore dead code (INFERRED).
- The legacy executive actions `payment-request`, `submission-request` and `win-loss-request` are MIS-only by permission, although the code comments and default headers say "executive" (`WorkflowController.java:665-673, 802-810, 856-864`).

## 5. Endpoints with no server-side role enforcement

None of the following 19 handlers (plus static `/documents/**`) consults `WorkflowPermissions` or any role check. Any authenticated principal, including one whose role maps to no canonical role, can call them (VERIFIED):

| Endpoint | Risk for load test / security |
|---|---|
| `POST /api/update/apply` | **JVM exit** (`services/AutoUpdateService.java:142-147`) |
| `POST /api/update/check` | outbound GitHub download |
| `POST /api/tenders/trigger-due-alerts` | sends SMTP email synchronously |
| `GET /api/analytics/executive-performance` | scope chosen by the spoofable `x-user-role` header |
| `/api/products/**`, `/api/tenders/{id}/offered-models` | AI call; create, update and delete of the catalogue |
| `/api/noticedesk/**` | unsynchronised static `ArrayList` mutation |
| `/api/signatures/**` | header-spoofable username; overwrites the global signature image |
| `GET /documents/**` (nested paths, e.g. `/documents/{id}/confidential/emd_receipt_*`) | **unauthenticated** access to EMD receipts written by `controllers/WorkflowSyncController.java:463-468`. INFERRED from path matching |

Endpoints where **ownership is enforced only by the frontend** (any user of the right role can act on any tender; VERIFIED absence of a `misExecutive == username` check): `PATCH /api/tenders/{id}`, `generate-bid-docs`, `upload-tech-spec`, `generate-tech-specs`, `clearance-request`, `doc-verification-request`, and all `/api/v2/workflow/*` executive actions (`bid-docs-prep`, `emd-applicability`, `emd-payment`, `final-submission`).

## 6. Creating 17 concurrent test users

| Fact | Evidence | Label |
|---|---|---|
| The only creation path in the backend is `POST /api/auth/users` with an **Admin** JWT. The body is `{username, password, role, email?}` | `controllers/AuthController.java:203-294` | VERIFIED |
| Username must be 3–20 characters after trim. Role must be one of the 6 allow-listed strings (use **`TPC Team`**, not `TPC Pricing Team`) | `:251-262` | VERIFIED |
| **Upsert semantics**: posting an existing username silently resets its password and role | `:264-277` | VERIFIED |
| Each creation costs 1 `findById` (caller), 1 `existsById`, 1 insert, and 1 `activity_log` insert (plus 2 trigger rows in `db_change_log` on PostgreSQL) | `:222-291` | VERIFIED / INFERRED |
| Seeded users are created **lazily on the first login call**, not at startup: `admin` (Admin), `misteam` (MIS Team), `executive` (Tender Executive), `clearance` (Clearance Team), `tpc` (**TPC Team**). Passwords come from `ADMIN_/MISTEAM_/EXECUTIVE_/CLEARANCE_/TPC_DEFAULT_PASSWORD`, default **empty string** | `controllers/AuthController.java:46-59, 73-87`; `application.properties:23-27` | VERIFIED |
| If those env vars are unset, the seeded accounts accept the **empty password** `""` (SHA-256 of "" matches) | `config/SecurityConfig.java:33-53` + `:73-87` | INFERRED |
| Concurrent first-ever logins can race on the seed insert (both see `existsById=false`, so one PK violation becomes a 500) | `:73-87` (no lock) | INFERRED |
| There are no SQL seed files for users. `backend/src/main/resources/*.sql` contains only backup triggers and the product catalogue schema | grep | VERIFIED |
| Hard-coded team-queue usernames appear in routing logic: `misteam`, `clearance`, `tpc`, `executive` (defaults in `controllers/ApprovalController.java:115, 249-250, 279`; `services/WorkflowSyncService.java:377, 815`). MIS, TPC and Clearance test users still see these queues because the queue queries OR on stage (`repositories/TenderApprovalRepository.java:104-119, 141-151, 177-188`) | | VERIFIED |
| Tender Executives see only tenders whose `mis_executive` equals their username (`controllers/TenderController.java:308-309, 323`). Test executives must therefore have tenders assigned first, via `PATCH mis_executive` as MIS or `POST /api/v2/workflow/{id}/assign-executive` | | VERIFIED |
| One account can be shared by many virtual users (no session limit), but distinct users are needed to exercise queue ownership (`assigned_to = username`) | §3 | INFERRED |

Suggested split for 17 users (INFERRED; the task gives no ratio): Tender Executive ×6, MIS Team ×4, Clearance Team ×3, TPC Team ×3, Admin ×1. Adjust to the business mix.

## 7. Next.js API tier authorization (from the frontend reviewer)

The matrix above covers Spring only. Browser traffic first passes through Next.js route handlers (see 02, Frontend section). Their own checks:

### `auth.ts` and `workflowAuthorization.ts` (server side) (VERIFIED unless marked)

- Token extraction order (`frontend/src/lib/auth.ts:18-46`): `Authorization: Bearer`, then the `?token=` / `?auth=` query param (`:26`), then the `token` / `auth_token` cookie (`:39`).
- Verification (`auth.ts:57-126`): HMAC HS256/384/512 with `process.env.JWT_SECRET || '<REDACTED>…'` (`:5`). The backend signs with `jwt.secret=${JWT_SECRET:<REDACTED>}` (`backend/src/main/resources/application.properties:19`). **The two defaults differ**, so unless the same `JWT_SECRET` env is given to both processes, every real token fails the local signature check.
- **Signature-mismatch branch accepts the token anyway** (`auth.ts:85-93`). If the signature does not match, it decodes the payload and returns `{sub, role}` **without checking signature, `exp` or `nbf`**. This branch runs before the `REQUIRE_JWT_AUTH` check (`:99`), so **any forged JWT-shaped string with an HS* header and `{sub, role}` payload is accepted by every Next-side check, even with `REQUIRE_JWT_AUTH=true`**.
- Header fallback (`auth.ts:107-123`): without a token (and unless `REQUIRE_JWT_AUTH === 'true'`), `x-user-username` + `x-user-role` headers are trusted if the role is in a fixed list (`:113-120`).
- `workflowAuthorization.ts`: `canonicalRole` (`:7-26`) maps aliases. `canPerform` (`:28-49`) returns true for `viewTenders`/`viewAudit` for any recognised role (`:31`). Admin may only `manageUsers`/`viewTpcPrice`/`setMisPrice` (`:32-34`), so the later `|| canonical === 'Admin'` clauses (`:37,39,40`) are dead. `workflowActor` (`:51-55`) wraps `getAuthFromRequest`.
- Client-side token storage (`frontend/src/app/page.tsx`): `localStorage.token` + `localStorage.currentUser` set on login (`:1966-1968`). A non-HttpOnly, non-Secure, session-lifetime cookie `token=…; path=/; SameSite=Lax` (`:1970`) is re-written on every `fetchWithAuth` call (`:161`) and on mount (`:547`). Logout clears localStorage but **not the cookie** (`:934-939`).
- Expiry: there is no client-side `exp` check (mount only checks presence, `page.tsx:541-557`). The backend default lifetime is `jwt.expiration=${JWT_EXPIRATION:315360000}` seconds, i.e. **10 years** (`application.properties:20`, used at `JwtUtil.java:70`). A 401 on non-workflow URLs clears the session (`page.tsx:168-182`). The tender detail page has no 401 handling (`tenders/[id]/page.tsx:325-346`).
- Role derivation:
  - **Client:** `currentUser.role` comes from the login response stored in localStorage (user-editable). It drives tab visibility and is sent as `x-user-role` / `x-user-username` on every call (`page.tsx:155-156`, `tenders/[id]/page.tsx:328-329`).
  - **Backend:** the role comes from the verified JWT (`JwtRequestFilter.java:28-54`, `TenderController.java:200-208`).
  - **Next routes:** the role comes from the JWT payload (possibly unverified) or the headers (above).


### Routes where authorization is client-only or absent (flags)

1. **No auth at all, server-side:** `POST /api/preview-doc` (`preview-doc/route.ts:4`) is an unauthenticated CPU endpoint (template rendering of an attacker-sized body). `GET /api/compliance-progress-client` (`compliance-progress-client/route.ts:5`) serves a public static JS (acceptable, but uncached).
2. **Next-side auth that can be forged, guarding local side-effects that never reach backend auth:**
   - `GET /api/tenders/{id}/documents/{…}`. Local files are served after only `getAuthFromRequest` (`:12`), and a cache miss triggers GeM, Tender247 and OCR work (`:164-196`). The backend `/documents/**` it falls back to is itself `permitAll` (`SecurityConfig.java:66`).
   - `POST /api/tenders/{id}/generate-bid-docs` with the raw-header fallback (`:293-301`). A request with `x-user-role: Tender Executive` and no token runs Chromium and python, and writes files plus SQLite. The backend GET/PATCH just fail (`:325-331,614-616`).
   - `POST /api/tenders/{id}/upload-emd-receipt` writes 5 files plus SQLite plus activity_log before/independently of backend auth (`:52-115`).
   - `GET /api/tenders/{id}/tech-spec-download/{file}` proxies to the backend `/documents/**`, which is `permitAll`.
3. **Client-only gates (server relies entirely on the backend):** the Team/Audit/Work-summary/Approvals tabs and user create/delete are gated only in React (`page.tsx:2304,2314,2324,2359,851,899`). Every proxied route does **no** Next-side check (rows marked "none"), so correctness depends wholly on backend `WorkflowPermissions` (backend/RBAC reviewer to confirm per endpoint). `forbiddenPatchFields` (`workflowAuthorization.ts:103`) and `redactManufacturerPricing` (`:192`) are imported by no route (VERIFIED by grep). Their server-side equivalents, if any, live in the backend.
4. Tokens in URLs: `getDocDownloadUrl` appends `?token=<JWT>` to document links (`page.tsx:186-192`), which `auth.ts:26` accepts. The JWT therefore ends up in access logs, browser history and Referer headers (INFERRED).


## Doc conflicts (code wins)

| Doc claim | Code reality |
|---|---|
| README.md:160-175: Admin can upload specs, approve specs, set the MIS price, generate bids, verify docs, and record EMD, submission and outcome | Admin has only VIEW_TENDERS, SET/VIEW_TPC_PRICE, MANAGE_USERS and VIEW_AUDIT (`config/WorkflowPermissions.java:45-50`), and is explicitly refused on approvals (`controllers/ApprovalController.java:675`) |
| README.md:299-309: accounts are seeded **on startup** with passwords `<REDACTED>`, `<REDACTED>`, … and `tpc` is "TPC Pricing Team" | Seeded **on login**, with passwords from env (default empty); the `tpc` role string is `TPC Team` (`controllers/AuthController.java:46-87`) |
| README.md:166 / 147: Clearance can "Approve / Reject" specs | Rejection is refused (`controllers/ApprovalController.java:823-825`, `controllers/WorkflowController.java:989-991`, `controllers/TenderController.java:1502-1504`) |
| README.md:160: "RBAC at both Next.js and Spring Boot layers" | 19 backend handlers have no server role check (§5): products 8, noticedesk 4, update 3, signatures 2, trigger-due-alerts 1, executive-performance 1 |
| README.md:40: "JWT (HS256/HS512)" | Algorithm depends on secret length; the default secret gives HS512 |
| README.md:186-188: Clearance cannot see the manufacturer quote | True for responses that pass through `ManufacturerPriceAdvice` (`config/ManufacturerPriceAdvice.java:25`). Not otherwise contradicted |

## Open questions / UNKNOWN

- UNKNOWN: the value of `JWT_SECRET` and `JWT_EXPIRATION` in the target environment. If unset, the committed fallback secret signs tokens valid for 10 years. Check the deployment env.
- UNKNOWN: whether the `*_DEFAULT_PASSWORD` env vars are set in the target environment (otherwise seeded accounts accept an empty password).
- UNKNOWN: whether legacy rows with role `MIS Executive` or `Executive` exist in the target DB. They would get inconsistent permissions (§1c). Query `SELECT role, count(*) FROM users GROUP BY role`.
- UNKNOWN: whether the Next.js layer adds its own RBAC in front of these endpoints; another reviewer covers `frontend/src/app/api/**`. The backend must still be treated as directly reachable on port 8090 (`application.properties:2`).
- UNKNOWN: the exact HTTP status for an unauthenticated `/api/**` call (403 is expected from the Spring Security 6 defaults; not asserted in code).
