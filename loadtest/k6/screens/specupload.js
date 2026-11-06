// Track B AI: spec upload (S18; review 05 §1, 10 §5 J1 step 4). One DISTINCT pre-staged tender per
// upload (progress map is keyed by tender id, 05 §13). On the detail page (DPOLL running):
//   GET  tech-spec-progress (baseline by compliance-progress.js, 10 §3.5)
//   POST upload-tech-spec multipart `file` (tenders/[id]/page.tsx:1169-1173) — held open for the
//        whole synchronous conversion (TenderController.java:1800-2146)
//   meanwhile: page poll of tech-spec-progress every 1 s WITHOUT overlap guard (:1155-1167) and
//              compliance-progress.js 1 s poll WITH an in-flight guard (static/compliance-progress.js:474-497)
//   then GET /api/tenders/{id} (:1200)
// The response `metrics` object (durationsMs api/extraction/rendering/total, apiAttempts, tokens)
// is recorded as custom metrics (05 §15).
import { CFG } from '../lib/config.js';
import { jsonOf, setScreen } from '../lib/http.js';
import * as M from '../lib/metrics.js';
import { uniform } from '../lib/pick.js';
import { dwell, startPoller } from '../lib/poll.js';
import { detailPoller, openDetail } from './detail.js';
import * as ui from '../lib/ui.js';

const S = CFG.screens.spec_upload;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function recordSpecMetrics(m) {
  if (!m) return;
  const d = m.durationsMs || m.durations_ms || {};
  const pairs = [[M.specApiMs, d.api], [M.specExtractionMs, d.extraction], [M.specRenderingMs, d.rendering], [M.specTotalMs, d.total]];
  for (const [metric, v] of pairs) if (num(v) !== null) metric.add(v);
  if (num(m.apiAttempts) !== null) M.specApiAttempts.add(m.apiAttempts);
  const t = m.tokens || {};
  if (num(t.input) !== null) M.specTokensIn.add(t.input);
  if (num(t.output) !== null) M.specTokensOut.add(t.output);
  if (num(t.total) !== null) M.specTokensTotal.add(t.total);
}

export async function specUploadOnce(ctx, files) {
  const pool = ctx.pools.upload;
  const id = pool ? pool.next() : null;
  if (!id) { M.poolExhausted.add(1, { kind: 'upload' }); return false; }
  ctx.consumed.add(id);
  await openDetail(id, 'spec_upload');
  const dpoll = detailPoller(id, 'spec_upload');
  let lastStatus = 'NOT_STARTED';
  const pagePoll = startPoller('spec_progress_page', S.progress_interval_ms, async () => {
    const r = await ui.techSpecProgress(id, 'spec_upload');
    const j = jsonOf(r);
    if (j && j.status) lastStatus = j.status;
  }, false);
  const scriptPoll = startPoller('spec_progress_script', S.progress_interval_ms, () => ui.techSpecProgress(id, 'spec_upload'), true);
  try {
    await ui.techSpecProgress(id, 'spec_upload');
    const file = files[ctx.slotIndex % files.length];
    const t0 = Date.now();
    const res = await ui.uploadTechSpec(id, file.bytes, file.name, 'spec_upload');
    M.specClientMs.add(Date.now() - t0);
    const j = jsonOf(res);
    const ok = res.status === 200 && j && j.success === true;
    M.specOk.add(ok);
    if (j && j.metrics) recordSpecMetrics(j.metrics);
    if (!ok && lastStatus && !['FAILED', 'COMPLETED', 'NOT_STARTED'].includes(String(lastStatus).toUpperCase())) M.specStuck.add(1);
  } finally {
    pagePoll.stop();
    scriptPoll.stop();
  }
  await ui.tender(id, 'spec_upload');
  await dwell(uniform(ctx.rnd, ...S.think_between_uploads_s) * 1000, [dpoll]);
  dpoll.stop();
  return true;
}

export async function specUploadLoop(ctx, endMs, files, fallback) {
  setScreen('spec_upload');
  while (Date.now() < endMs) {
    const did = await specUploadOnce(ctx, files);
    if (!did) return fallback(ctx, endMs);
  }
  return null;
}
