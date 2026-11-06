// Tender detail page /tenders/{id} (review 10 §3.4). Full navigation (page.tsx:1410-1412):
// HTML shell + page script, then tender ∥ comments ∥ auth/users (tenders/[id]/page.tsx:384-404,
// :546, :561), then a 1.5 s poll of tender + comments fired without awaiting each other (:391-394).
import { CFG } from '../lib/config.js';
import { jsonOf, setScreen } from '../lib/http.js';
import { correctness, correctnessFailures } from '../lib/metrics.js';
import { choice } from '../lib/pick.js';
import { dwell, startPoller } from '../lib/poll.js';
import { universeId } from '../lib/ctx.js';
import * as ui from '../lib/ui.js';

export function pickDetailTender(ctx) {
  if (ctx.role === 'MIS Team' || ctx.role === 'Admin') {
    return ctx.rnd() < 0.7 || !ctx.ownIds.length ? universeId(ctx.rnd) : choice(ctx.rnd, ctx.ownIds);
  }
  // Executives see only their own tenders; Clearance/TPC only assigned / pricing-related ones
  // (TenderController.java:780-799) — read-only visits use the VU's own fixtures.
  const unconsumed = ctx.ownIds.filter((id) => !ctx.consumed.has(id));
  const list = unconsumed.length ? unconsumed : ctx.ownIds;
  return list.length ? choice(ctx.rnd, list) : universeId(ctx.rnd);
}

export async function openDetail(id, screen) {
  setScreen(screen || 'detail');
  await ui.detailShell(id, screen || 'detail');
  await ui.pageScript(screen || 'detail');
  const [t] = await Promise.all([ui.tender(id, screen || 'detail'), ui.comments(id, screen || 'detail'), ui.authUsers(true, screen || 'detail')]);
  const j = jsonOf(t);
  const ok = t.status === 200 && j && j.tender && j.tender.id === id;
  correctness.add(ok, { check: 'detail_tender' });
  if (!ok) correctnessFailures.add(1, { check: 'detail_tender' });
  return j && j.tender;
}

export function detailPoller(id, screen) {
  const interval = CFG.screens.detail.poll_interval_ms;
  return startPoller('detail', interval, () => Promise.all([ui.tender(id, screen || 'detail', true), ui.comments(id, screen || 'detail')]));
}

/** opts.during: async fn run while the detail poll is active (workflow actions, uploads). */
export async function detailScreen(ctx, dwellMs, id, opts) {
  const end = Date.now() + dwellMs;
  const tenderId = id || pickDetailTender(ctx);
  const screen = (opts && opts.screen) || 'detail';
  await openDetail(tenderId, screen);
  const poller = detailPoller(tenderId, screen);
  try {
    if (opts && opts.during) await opts.during(tenderId);
    await dwell(Math.max(0, end - Date.now()), [poller]);
  } finally {
    poller.stop();
  }
  return tenderId;
}
