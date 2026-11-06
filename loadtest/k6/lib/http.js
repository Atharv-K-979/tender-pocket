// HTTP layer: every request goes through `call()`, which
//  * enforces G3 (deny-list + frontend-origin only) — a violation aborts the whole test;
//  * sends the exact UI headers of fetchWithAuth (frontend/src/app/page.tsx:151-166):
//      Cache-Control: no-cache, no-store, must-revalidate / Pragma: no-cache / Expires: 0
//      x-user-role, x-user-username (from the login response), Authorization: Bearer <JWT>
//    plus the `token` cookie that page.tsx:161 writes (held in the VU cookie jar);
//  * tags service, name (normalised), role, screen, origin=api, run_type, tier, phase;
//  * uses the 300 s request timeout (G7) and non-blocking http.asyncRequest.
import http from 'k6/http';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { BASE, CFG, RUN_TYPE, WARMUP_MS } from './config.js';
import { checkOrigin, matchDeny } from './guards.js';
import { endpointName } from './normalise.js';
import { denied, respBytes } from './metrics.js';

const STATE = { start: 0, session: null, screen: 'none' };

export function setStart(ms) { STATE.start = ms; }
export function startMs() { return STATE.start; }
export function setSession(s) { STATE.session = s; }
export function session() { return STATE.session; }
export function setScreen(name) { STATE.screen = name; }
export function screen() { return STATE.screen; }
export function phase() { return Date.now() - STATE.start < WARMUP_MS ? 'warmup' : 'steady'; }

export const HAS_ASYNC = typeof http.asyncRequest === 'function';

export function guard(url) {
  const deniedBy = matchDeny(url, CFG.safety.endpoint_denylist);
  const originErr = CFG.safety.frontend_only ? checkOrigin(url, BASE, CFG.safety.blocked_ports) : null;
  if (deniedBy || originErr) {
    denied.add(1);
    const why = deniedBy ? `endpoint deny-list match ${deniedBy}` : originErr;
    console.error(`SAFETY ABORT: ${url} — ${why}`);
    exec.test.abort(`G3 safety abort: ${url} (${why})`);
    throw new Error(`denied: ${url}`);
  }
}

export function uiHeaders(extra) {
  const h = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  };
  const s = STATE.session;
  if (s) {
    h['x-user-role'] = s.role;
    h['x-user-username'] = s.username;
    h.Authorization = `Bearer ${s.token}`;
  }
  return Object.assign(h, extra || {});
}

/**
 * opts: { service, body, json, headers, expect (array of OK statuses), expectedTag, discard,
 *         name, screen, plain (no auth headers: login), tags }
 */
export async function call(method, path, opts) {
  const o = opts || {};
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  guard(url);
  let body = o.body;
  const extra = Object.assign({}, o.headers || {});
  if (o.json !== undefined) {
    body = JSON.stringify(o.json);
    extra['Content-Type'] = 'application/json';
  }
  const headers = o.plain ? Object.assign({}, extra) : uiHeaders(extra);
  const s = STATE.session;
  const tags = Object.assign({
    service: o.service || 'S0',
    name: o.name || endpointName(method, path),
    role: s ? s.role : 'anonymous',
    screen: o.screen || STATE.screen,
    origin: 'api',
    run_type: RUN_TYPE,
    tier: String(CFG.tier),
    profile: CFG.profile.name,
    phase: phase(),
    expected: o.expectedTag || 'ok',
  }, o.tags || {});
  const params = {
    headers,
    tags,
    timeout: CFG.request_timeout,
    responseType: o.discard ? 'none' : 'text',
  };
  if (o.expect) params.responseCallback = http.expectedStatuses(...o.expect);
  const res = HAS_ASYNC
    ? await http.asyncRequest(method, url, body === undefined ? null : body, params)
    : http.request(method, url, body === undefined ? null : body, params);
  const len = res.headers && (res.headers['Content-Length'] || res.headers['content-length']);
  if (len) respBytes.add(Number(len), { service: tags.service, name: tags.name });
  return res;
}

export function jsonOf(res) {
  try {
    return res && res.body ? JSON.parse(res.body) : null;
  } catch (e) {
    return null;
  }
}

export function delay(ms) {
  const v = Math.max(0, ms);
  if (typeof setTimeout === 'function') return new Promise((resolve) => setTimeout(resolve, v));
  sleep(v / 1000); // fallback for k6 builds without timers (blocking)
  return Promise.resolve();
}
