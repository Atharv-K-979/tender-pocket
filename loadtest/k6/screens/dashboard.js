// Dashboard `/` (review 10 §3.1, §0). Mount calls, per-role 1.5 s poll, debounced search/filter.
import { CFG } from '../lib/config.js';
import { delay, jsonOf, setScreen } from '../lib/http.js';
import { correctness, correctnessFailures, paginationOk } from '../lib/metrics.js';
import { choice, intBetween, uniform } from '../lib/pick.js';
import { dwell, startPoller } from '../lib/poll.js';
import * as ui from '../lib/ui.js';

const D = CFG.screens.dashboard;

// One poll tick, sequential awaits exactly as page.tsx:958-1013:
//   all roles: tenders list + analytics; Admin: + status=Participating; Admin/MIS Team: + stats.
export async function dashboardTick(role, f) {
  await ui.pollTenders(f, 'dashboard');
  await ui.analytics(true, 'dashboard');
  if (role === 'Admin') await ui.participating('dashboard');
  if (role === 'Admin' || role === 'MIS Team') await ui.stats(true, 'dashboard');
}

// Mount after login / router.push('/') remount (10 §1, §3.1 table "On mount"):
// tenders ∥ analytics ∥ auth/users (+ executives for MIS/Admin), then +300 ms debounced tenders.
export async function dashboardMount(ctx, f) {
  const calls = [ui.tendersList(f, 'dashboard'), ui.analytics(false, 'dashboard'), ui.authUsers(false, 'dashboard')];
  if (ctx.role === 'MIS Team' || ctx.role === 'Admin') calls.push(ui.executives('dashboard'));
  const [list] = await Promise.all(calls);
  check(list.status === 200, 'dashboard_list_200');
  await delay(D.debounce_ms);
  await ui.tendersList(f, 'dashboard');
}

function check(ok, name) {
  correctness.add(ok, { check: name });
  if (!ok) correctnessFailures.add(1, { check: name });
  return ok;
}

export async function dashboardScreen(ctx, dwellMs, opts) {
  setScreen('dashboard');
  const end = Date.now() + dwellMs;
  const f = { search: '', status: '' };
  if (!opts || !opts.skipShell) {
    await ui.dashboardShell('dashboard');
    await ui.pageScript('dashboard');
  }
  await dashboardMount(ctx, f);
  let poller = startPoller('dashboard', D.poll_interval_ms, () => dashboardTick(ctx.role, f));
  ctx.visits += 1;

  // Debounced search / filter interactions spread over the dwell. Each change restarts the
  // poll interval (effect deps, page.tsx:1040) and fires one debounced list fetch (:942-950).
  const n = intBetween(ctx.rnd, D.interactions_per_visit[0], D.interactions_per_visit[1]);
  const times = Array.from({ length: n }, () => uniform(ctx.rnd, 0.1, 0.8) * dwellMs).sort((a, b) => a - b);
  const t0 = Date.now();
  for (const at of times) {
    await dwell(Math.max(0, t0 + at - Date.now()), [poller]);
    if (ctx.rnd() < 0.6) { f.search = choice(ctx.rnd, D.search_terms); f.status = ''; } else { f.search = ''; f.status = choice(ctx.rnd, D.status_filters); }
    poller.stop();
    poller = startPoller('dashboard', D.poll_interval_ms, () => dashboardTick(ctx.role, f));
    await delay(D.debounce_ms);
    await ui.tendersList(f, 'dashboard');
  }
  if (CFG.screens.paged_probe && ctx.visits % CFG.screens.paged_probe.every_n_dashboard_visits === 0) {
    await pagedProbe(CFG.screens.paged_probe.limit, CFG.screens.paged_probe.pages);
  }
  if (CFG.screens.rbac_probe && ctx.visits % CFG.screens.rbac_probe.every_n_visits === 0) {
    await rbacProbe(ctx);
  }
  // Clear filters before leaving, like a user returning to the default view.
  f.search = '';
  f.status = '';
  await dwell(Math.max(0, end - Date.now()), [poller]);
  poller.stop();
}

// S2 — paginated list probe with pagination correctness (TenderController.java:476-494).
export async function pagedProbe(limit, pages) {
  const seen = new Set();
  let ok = true;
  let total = null;
  for (let p = 0; p < pages; p += 1) {
    const res = await ui.pagedList(p, limit, 'dashboard');
    const j = jsonOf(res);
    if (res.status !== 200 || !j || !j.success || !Array.isArray(j.tenders)) { ok = false; break; }
    if (total === null) total = j.totalElements;
    const expectLen = Math.max(0, Math.min(limit, total - p * limit));
    ok = ok && j.tenders.length === expectLen
      && j.totalElements === total
      && j.totalPages === Math.ceil(total / limit)
      && j.currentPage === p;
    for (const t of j.tenders) {
      if (seen.has(t.id)) ok = false;
      seen.add(t.id);
    }
  }
  paginationOk.add(ok);
  check(ok, 'pagination');
  return ok;
}

// S16 — deliberate RBAC checks; their 403s are expected and excluded from error rates.
// Tender Executive is refused the Approvals Center (ApprovalController.java:76-82, :365);
// only Admin has VIEW_AUDIT (WorkflowPermissions.java:41-61, ActivityLogController.java:23).
export async function rbacProbe(ctx) {
  if (ctx.role === 'Tender Executive') {
    const r = await ui.approvalCounts('PENDING', 'rbac', true);
    check(r.status === 403, 'rbac_exec_approvals_403');
  } else if (ctx.role !== 'Admin') {
    const r = await ui.activityLogs('rbac', true);
    check(r.status === 403, 'rbac_audit_403');
  }
}
