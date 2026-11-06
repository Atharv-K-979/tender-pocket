// Request catalogue: each function reproduces one UI call exactly. Citations are to
// frontend/src at main 09129d2a (line numbers re-checked; review 10 cites 68eb28ae).
// Service ids: config/services.yaml.
import http from 'k6/http';
import { BASE, CFG, PASSWORD } from './config.js';
import { call, jsonOf, setSession } from './http.js';

const SORT = CFG.screens.dashboard.sort;

// $Q of review 10 §5: search,status,location,sector,sortBy,order,mis_executive (page.tsx:707-715)
export function listQuery(f, withT) {
  const p = [
    ['search', f.search || ''], ['status', f.status || ''], ['location', ''], ['sector', ''],
    ['sortBy', SORT.sortBy], ['order', SORT.order], ['mis_executive', ''],
  ];
  if (withT) p.push(['t', String(Date.now())]);
  return p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

// ---------------------------------------------------------------- auth / page shell
// POST /api/auth/login — plain fetch, JSON body, no auth headers (page.tsx:1961-1970).
// Stores token + user like localStorage and the `token` cookie (page.tsx:1966-1971).
export async function login(username, role) {
  const res = await call('POST', '/api/auth/login', {
    service: 'S3', plain: true, json: { username, password: PASSWORD }, screen: 'login',
  });
  const j = jsonOf(res);
  if (res.status !== 200 || !j || !j.success || !j.token) {
    throw new Error(`login failed for ${username}: HTTP ${res.status}`);
  }
  const s = { username: j.user.username, role: j.user.role, token: j.token };
  if (s.role !== role) console.warn(`login role ${s.role} != slot role ${role} for ${username}`);
  setSession(s);
  http.cookieJar().set(BASE, 'token', encodeURIComponent(s.token), { path: '/' });
  return s;
}

// Every full page load fetches the uncached helper script (layout.tsx:19, 10 §1).
export function pageScript(screen) {
  return call('GET', '/api/compliance-progress-client?v=20261012-sanitize-2', { service: 'S4', discard: true, screen });
}

// Full navigation to /tenders/{id} (page.tsx:1410-1412 window.location) renders the dynamic page shell.
export function detailShell(id, screen) {
  return call('GET', `/tenders/${encodeURIComponent(id)}`, { service: 'S17', discard: true, screen, name: 'GET /tenders/{id} (html)' });
}

export function dashboardShell(screen) {
  return call('GET', '/', { service: 'S17', discard: true, screen, name: 'GET / (html)' });
}

// ---------------------------------------------------------------- dashboard
// Mount + filter fetch: GET /api/tenders?$Q (page.tsx:698-723) — whole list, no limit (10 §4).
export function tendersList(f, screen) {
  return call('GET', `/api/tenders?${listQuery(f, false)}`, { service: f.search ? 'S2' : 'S1', discard: !f.parse, screen });
}
// Poll tick 1: GET /api/tenders?$Q&t= (page.tsx:960-972)
export function pollTenders(f, screen) {
  return call('GET', `/api/tenders?${listQuery(f, true)}`, { service: f.search ? 'S2' : 'S1', discard: true, screen });
}
// Mount / poll tick 2: GET /api/analytics (page.tsx:756) and ?t= (page.tsx:987)
export function analytics(withT, screen) {
  return call('GET', withT ? `/api/analytics?t=${Date.now()}` : '/api/analytics', { service: 'S10', discard: true, screen });
}
// Poll tick 3 (Admin): GET /api/tenders?status=Participating&t= (page.tsx:996-997)
export function participating(screen) {
  return call('GET', `/api/tenders?status=Participating&t=${Date.now()}`, { service: 'S1', discard: true, screen });
}
// Poll tick 4 (Admin, MIS Team) / analytics tab: GET /api/tenders/stats (page.tsx:769, :1007-1008)
export function stats(withT, screen) {
  return call('GET', withT ? `/api/tenders/stats?t=${Date.now()}` : '/api/tenders/stats', { service: 'S11', discard: true, screen });
}
// Mount: GET /api/auth/users (page.tsx:783), GET /api/auth/executives for MIS/Admin (page.tsx:800)
export function authUsers(withT, screen) {
  return call('GET', withT ? `/api/auth/users?t=${Date.now()}` : '/api/auth/users', { service: 'S4', discard: true, screen });
}
export function executives(screen) {
  return call('GET', '/api/auth/executives', { service: 'S4', discard: true, screen });
}
// Admin audit tab: GET /api/activity-logs (page.tsx:815) — whole table, unpaginated (08 Q19)
export function activityLogs(screen, expectDeny) {
  return call('GET', '/api/activity-logs', expectDeny
    ? { service: 'S16', discard: true, screen, expect: [403], expectedTag: 'rbac_403' }
    : { service: 'S12', discard: true, screen });
}
// S2 paginated probe: page/limit honoured after the in-memory filter (TenderController.java:476-494, 0-based page)
export function pagedList(page, limit, screen) {
  return call('GET', `/api/tenders?${listQuery({}, false)}&page=${page}&limit=${limit}`, { service: 'S2', screen });
}

// ---------------------------------------------------------------- detail page
// Mount: GET /api/tenders/{id}?t= (tenders/[id]/page.tsx:404), comments (:546), users (:561)
export function tender(id, screen, discard) {
  return call('GET', `/api/tenders/${encodeURIComponent(id)}?t=${Date.now()}`, { service: 'S5', screen, discard: !!discard });
}
export function comments(id, screen) {
  return call('GET', `/api/tenders/${encodeURIComponent(id)}/comments?t=${Date.now()}`, { service: 'S6', discard: true, screen });
}
// POST comment (tenders/[id]/page.tsx:1242)
export function postComment(id, text, screen) {
  return call('POST', `/api/tenders/${encodeURIComponent(id)}/comments`, { service: 'S14', json: { comment: text, phase: 'GENERAL' }, screen });
}

// ---------------------------------------------------------------- approvals center
// ApprovalsCenter.tsx:347 counts, :408 pending, :430 mis-team
export function approvalCounts(status, screen, expectDeny) {
  return call('GET', `/api/approvals/counts?status=${status}`, expectDeny
    ? { service: 'S16', discard: true, screen, expect: [403], expectedTag: 'rbac_403' }
    : { service: 'S7', discard: true, screen });
}
export function approvalPending(q, screen, parse) {
  const qs = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return call('GET', `/api/approvals/pending?${qs}`, { service: 'S8', discard: !parse, screen });
}
export function misTeam(screen) {
  return call('GET', '/api/auth/mis-team', { service: 'S4', discard: true, screen });
}
// POST /api/approvals/{id}/review JSON (ApprovalsCenter.tsx:601-615)
export function review(approvalId, body, screen, service) {
  return call('POST', `/api/approvals/${approvalId}/review`, { service: service || 'S9', json: body, screen });
}
// SPEC_CLEARANCE via Approvals Center: multipart complianceType + comment (ApprovalsCenter.tsx:573-583)
export function approveClearanceMultipart(id, complianceType, comment, screen) {
  return call('POST', `/api/tenders/${encodeURIComponent(id)}/approve-clearance`, {
    service: 'S9', body: { complianceType, comment }, screen,
  });
}

// ---------------------------------------------------------------- workflow actions (detail page)
export function clearanceRequest(id, rep, screen) {             // tenders/[id]/page.tsx:2944
  return call('POST', `/api/tenders/${encodeURIComponent(id)}/clearance-request`, {
    service: 'S13', json: { assignedClearanceRep: rep, note: 'Submitted technical specification for clearance approval.' }, screen,
  });
}
export function approveClearanceJson(id, screen) {               // WorkflowController.java:222-230 (JSON variant)
  return call('POST', `/api/tenders/${encodeURIComponent(id)}/approve-clearance`, {
    service: 'S13', json: { complianceType: 'ALL_COMPLY', comment: 'All clauses comply (load test).' }, screen,
  });
}
export function emdApplicability(id, applicable, screen) {        // tenders/[id]/page.tsx:3603
  return call('POST', `/api/v2/workflow/${encodeURIComponent(id)}/emd-applicability`, { service: 'S13', json: { applicable }, screen });
}
export function routePricing(id, route, screen) {                 // tenders/[id]/page.tsx:691
  return call('POST', `/api/v2/workflow/${encodeURIComponent(id)}/route-pricing`, { service: 'S13', json: { route }, screen });
}
export function tpcPrice(id, price, misMember, screen) {          // tenders/[id]/page.tsx:721
  return call('POST', `/api/tenders/${encodeURIComponent(id)}/tpc-price`, {
    service: 'S13', json: { tpcPurchasePrice: price, assignedMisMember: misMember }, screen,
  });
}
export function misPrice(id, price, screen) {                     // tenders/[id]/page.tsx:757
  return call('POST', `/api/tenders/${encodeURIComponent(id)}/mis-price`, { service: 'S13', json: { misFinalPrice: price }, screen });
}
export function verifyAllDocuments(id, screen) {                  // tenders/[id]/page.tsx:4589
  return call('POST', `/api/v2/workflow/${encodeURIComponent(id)}/verify-all-documents`, {
    service: 'S13', json: { remarks: 'Verified (load test).' }, screen,
  });
}
// Read-only state probes used for correctness (WorkflowController.java:70 any role; v2 state GET)
export function workflowDetails(id, screen, service) {
  return call('GET', `/api/tenders/${encodeURIComponent(id)}/workflow-details`, { service: service || 'S15', screen });
}

// ---------------------------------------------------------------- Track B
export function techSpecProgress(id, screen) {                    // tenders/[id]/page.tsx:1155-1157
  return call('GET', `/api/tenders/${encodeURIComponent(id)}/tech-spec-progress`, { service: 'S18', screen });
}
export function uploadTechSpec(id, fileBytes, fileName, screen) { // tenders/[id]/page.tsx:1169-1173 (field `file` only)
  return call('POST', `/api/tenders/${encodeURIComponent(id)}/upload-tech-spec`, {
    service: 'S18', body: { file: http.file(fileBytes, fileName, 'application/pdf') }, screen,
  });
}
export function generateBidDocs(id, fields, screen) {              // tenders/[id]/page.tsx:1405-1408
  return call('POST', `/api/tenders/${encodeURIComponent(id)}/generate-bid-docs`, { service: 'S19', json: fields, screen });
}
