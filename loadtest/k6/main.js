// Tender Pocket load test — single k6 entry point (Part 4).
//
//   LT_RUN_CONFIG=build/run_config.json LT_PASSWORD=*** LT_OUT_DIR=../results/<run> \
//     k6 run --out json=../results/<run>/raw.jsonl.gz k6/main.js
// (normally launched by orchestrator/run.py, which renders run_config.json and enforces pre-flight)
//
// One scenario per VU slot (per-vu-iterations, 1 VU, 1 long iteration), so every VU has a fixed
// identity (username, role, pre-staged fixtures). API VUs cycle screens per config/screen_time.yaml;
// browser VUs drive real Chromium. G1: BENCHMARK aborts at init unless exactly 17 slots exist.
import exec from 'k6/execution';
import http from 'k6/http';
import { BASE, CFG, RUN_TYPE, SLOTS, TOTAL_MS } from './lib/config.js';
import { assertVuTotal, isEc21, parseOrigin } from './lib/guards.js';
import { delay, guard, setScreen, setStart } from './lib/http.js';
import { buildCtx } from './lib/ctx.js';
import { uniform, weightedPick } from './lib/pick.js';
import { POLL_MODE } from './lib/poll.js';
import * as ui from './lib/ui.js';
import { approvalsScreen } from './screens/approvals.js';
import { historyScreen } from './screens/admin.js';
import { bidPackLoop } from './screens/bidpack.js';
import { browserJourney } from './screens/browser.js';
import { dashboardScreen } from './screens/dashboard.js';
import { detailScreen } from './screens/detail.js';
import { armProbes } from './screens/probe.js';
import { specUploadLoop } from './screens/specupload.js';
import { actionsScreen } from './screens/workflow.js';

// ---------------------------------------------------------------- init-time guards (G1, G2, G3)
assertVuTotal(SLOTS, RUN_TYPE, CFG.total_vus);
{
  const o = parseOrigin(BASE);
  const hit = isEc21(o && o.host, CFG.safety.resolved_ips, CFG.safety.ec2_1_denylist);
  if (hit) throw new Error(`G2: target ${BASE} matches the EC2-1 deny-list (${hit}) — refusing to run`);
  if (o && (CFG.safety.blocked_ports || []).includes(o.port)) throw new Error(`G3: base URL uses blocked port ${o.port}`);
  if (!['BENCHMARK', 'DEBUG'].includes(RUN_TYPE)) throw new Error(`RUN_TYPE must be BENCHMARK or DEBUG, got ${RUN_TYPE}`);
}

// Upload files must be opened in the init context; only when a spec_upload slot exists.
const NEEDS_FILES = SLOTS.some((s) => s.behaviour === 'spec_upload');
const FILES = NEEDS_FILES ? (CFG.screens.spec_upload.files_resolved || []).map((f) => ({ name: f.name, bytes: open(f.path, 'b') })) : [];
if (NEEDS_FILES && !FILES.length) throw new Error('spec_upload slots need screens.spec_upload.files (run k6/data/make_spec_pdfs.py)');

// ---------------------------------------------------------------- options
const ROLE_CODE = { 'Tender Executive': 'exec', 'MIS Team': 'mis', 'Clearance Team': 'clear', 'TPC Team': 'tpc', Admin: 'admin' };
const GRACE = CFG.durations.graceful_stop_s;

function scenarios() {
  const sc = {};
  SLOTS.forEach((s, i) => {
    const name = `s${String(i).padStart(2, '0')}_${ROLE_CODE[s.role] || 'x'}_${s.kind}${s.behaviour && s.behaviour !== 'default' ? `_${s.behaviour}` : ''}`;
    const def = {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: `${Math.ceil(TOTAL_MS / 1000) + GRACE + 120}s`,
      gracefulStop: `${GRACE}s`,
      exec: s.kind === 'browser' ? 'browserVU' : 'apiVU',
      env: { LT_SLOT: String(i) },
      tags: { vu_slot: String(i), origin: s.kind === 'browser' ? 'browser' : 'api', behaviour: s.behaviour || 'default' },
    };
    if (s.kind === 'browser') def.options = { browser: { type: 'chromium' } };
    sc[name] = def;
  });
  return sc;
}

// Thresholds are REPORT-ONLY (G7): no abortOnFail; run.py treats k6 exit code 99 as success.
// Classification against config/slo.yaml is done by report/build_report.py.
export const options = {
  scenarios: scenarios(),
  thresholds: {
    'http_req_duration{service:S1,phase:steady}': ['p(95)<2000', 'p(99)<5000'],
    'http_req_failed{service:S1,phase:steady}': ['rate<0.005'],
    'http_req_duration{service:S2,phase:steady}': ['p(95)<2000', 'p(99)<5000'],
    'lt_pagination_ok': ['rate==1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  setupTimeout: '180s',
  userAgent: 'TenderPocketLoadTest/1 (k6)',
};

// ---------------------------------------------------------------- setup: pre-flight + shared clock
// Frontend must answer GET / (the same Next.js origin real users hit, G3). The shared start time
// lets every VU tag warm-up vs steady requests and lets probe VUs act at the same instant.
export function setup() {
  setScreen('preflight');
  const url = `${BASE}/`;
  guard(url);
  const res = http.get(url, { tags: { service: 'S0', name: 'GET / (preflight)', phase: 'preflight', run_type: RUN_TYPE }, timeout: '60s', responseType: 'none' });
  if (res.status !== 200) exec.test.abort(`pre-flight: frontend ${url} answered ${res.status}`);
  return { start: Date.now() + 5000, pollMode: POLL_MODE };
}

// ---------------------------------------------------------------- VU bodies
function screenWeights(ctx) {
  const base = (CFG.screen_time.roles || {})[ctx.role] || { dashboard: 1 };
  const ov = ((CFG.profile.screen_time_overrides || {})[ctx.role]) || null;
  return ov || base;
}

async function screenLoop(ctx, endMs) {
  const weights = screenWeights(ctx);
  while (Date.now() < endMs - 3000) {
    const scr = weightedPick(ctx.rnd, weights) || 'dashboard';
    const dwellMs = Math.min(uniform(ctx.rnd, CFG.screen_time.dwell_seconds[0], CFG.screen_time.dwell_seconds[1]) * 1000, endMs - Date.now());
    if (dwellMs <= 0) break;
    try {
      if (scr === 'dashboard') await dashboardScreen(ctx, dwellMs, { skipShell: true });
      else if (scr === 'detail') await detailScreen(ctx, dwellMs);
      else if (scr === 'approvals') await approvalsScreen(ctx, dwellMs);
      else if (scr === 'actions') await actionsScreen(ctx, dwellMs);
      else if (scr === 'history') await historyScreen(ctx, dwellMs);
      else await dashboardScreen(ctx, dwellMs, { skipShell: true });
    } catch (e) {
      if (String(e).startsWith('Error: denied')) throw e;
      console.warn(`${ctx.username} screen ${scr}: ${e}`);
      await delay(2000);
    }
  }
}

export async function apiVU(data) {
  setStart(data.start);
  const ctx = buildCtx(Number(__ENV.LT_SLOT));
  const endMs = data.start + TOTAL_MS;
  await delay(Math.max(0, data.start - Date.now()) + ctx.rnd() * 8000);   // de-synchronise logins
  // J0: page load, page script, login (10 §5 J0)
  setScreen('login');
  await ui.dashboardShell('login');
  await ui.pageScript('login');
  await ui.login(ctx.username, ctx.role);
  const probes = armProbes(ctx);
  if (ctx.behaviour === 'spec_upload') await specUploadLoop(ctx, endMs, FILES, screenLoop);
  else if (ctx.behaviour === 'bidpack') await bidPackLoop(ctx, endMs, screenLoop);
  else await screenLoop(ctx, endMs);
  await Promise.all(probes);
}

export async function browserVU(data) {
  setStart(data.start);
  const ctx = buildCtx(Number(__ENV.LT_SLOT));
  await delay(Math.max(0, data.start - Date.now()) + ctx.rnd() * 8000);
  await browserJourney(ctx, data.start + TOTAL_MS);
}

// ---------------------------------------------------------------- summary
export function handleSummary(data) {
  const out = (__ENV.LT_OUT_DIR || '.').replace(/\/+$/, '');
  const meta = {
    run_id: CFG.run_id, run_type: RUN_TYPE, profile: CFG.profile.name, tier: CFG.tier,
    poll_mode: POLL_MODE, vus: SLOTS.length, slots: SLOTS, durations: CFG.durations,
    warmup_excluded: true, ai_mode: CFG.ai_mode,
  };
  const brief = [
    `run ${CFG.run_id}  profile=${CFG.profile.name} tier=${CFG.tier} type=${RUN_TYPE} vus=${SLOTS.length} poll_mode=${POLL_MODE}`,
    `http_reqs=${(data.metrics.http_reqs && data.metrics.http_reqs.values.count) || 0}`,
    `summary -> ${out}/summary.json ; raw per-request data -> ${out}/raw.jsonl.gz`,
  ].join('\n');
  return {
    [`${out}/summary.json`]: JSON.stringify({ meta, state: data.state, metrics: data.metrics }, null, 1),
    stdout: `${brief}\n`,
  };
}
