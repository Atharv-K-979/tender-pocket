// Faithful polling. The UI uses setInterval with NO overlap guard (page.tsx:958-1040 dashboard,
// tenders/[id]/page.tsx:391-394 detail, tenders/[id]/page.tsx:1155-1167 spec progress), so a
// tick fires on schedule even when the previous tick is still in flight (10 §0). We reproduce
// that with k6 timers + non-blocking http.asyncRequest, and count overruns.
//
// Fallback ("guarded" mode) when timers/asyncRequest are unavailable in the installed k6:
// the tick runs to completion before the next one is scheduled (no overlap) — this
// UNDER-states load once latency exceeds the interval; the mode is recorded in the summary.
import { HAS_ASYNC, delay } from './http.js';
import { pollInflight, pollOverruns, pollTicks } from './metrics.js';

export const HAS_TIMERS = typeof setInterval === 'function' && typeof setTimeout === 'function';
export const POLL_MODE = HAS_TIMERS && HAS_ASYNC ? 'faithful' : 'guarded';

/**
 * start a poller. `tick` is an async function. `guardOverlap` reproduces callers that DO guard
 * (compliance-progress.js 1 s poll, backend/src/main/resources/static/compliance-progress.js:474-497).
 */
export function startPoller(name, intervalMs, tick, guardOverlap) {
  let inFlight = 0;
  let stopped = false;
  const fire = () => {
    if (stopped) return;
    pollTicks.add(1, { poller: name });
    pollInflight.add(inFlight, { poller: name });
    if (inFlight > 0) {
      pollOverruns.add(1, { poller: name });
      if (guardOverlap) return;
    }
    inFlight += 1;
    Promise.resolve()
      .then(() => tick())
      .catch((e) => console.warn(`poll ${name}: ${e && e.message}`))
      .then(() => { inFlight -= 1; });
  };
  if (POLL_MODE === 'faithful') {
    const id = setInterval(fire, intervalMs);
    return { stop() { stopped = true; clearInterval(id); }, inFlight: () => inFlight, mode: POLL_MODE };
  }
  // guarded fallback: drive ticks from `runGuarded`.
  return { stop() { stopped = true; }, inFlight: () => inFlight, mode: POLL_MODE, intervalMs, tick, name };
}

/** Wait `ms` while pollers run (faithful) or run guarded ticks inline (fallback). */
export async function dwell(ms, pollers) {
  if (POLL_MODE === 'faithful') {
    await delay(ms);
    return;
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const p of pollers || []) {
      pollTicks.add(1, { poller: p.name });
      try { await p.tick(); } catch (e) { /* recorded by http metrics */ }
    }
    const wait = Math.min(...(pollers || []).map((p) => p.intervalMs || 1500), end - Date.now());
    if (wait > 0) await delay(wait);
  }
}
