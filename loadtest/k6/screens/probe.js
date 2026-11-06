// Same-tender concurrency probe (S15; review 04 §4b). 2–3 MIS VUs act on the SAME probe tender at
// the same wall-clock instant (timers armed from the shared setup() start time):
//   double_approval  — all participants POST /api/approvals/{id}/review on one PAYMENT_APPROVAL id.
//                      Expected-by-code outcome: every transaction reads PENDING, so the review is
//                      applied more than once and initiateDualTrack inserts duplicate DOC_VERIFICATION
//                      PENDING rows (WorkflowSyncService.java:451-456).
//   dual_track_race  — participant 0 approves MIS_PRICING while participant 1 approves DOC_VERIFICATION
//                      of one tender; a lost update leaves both rows APPROVED but the tender short of
//                      SUBMISSION_READY (04 §4b row 2).
// Participant 0 inspects the result through GET /api/tenders/{id}/workflow-details (any role,
// WorkflowController.java:70) and records counters; it needs no data from the other VUs.
import { CFG, WARMUP_MS } from '../lib/config.js';
import { delay, jsonOf, startMs } from '../lib/http.js';
import { probeDoubleApprovals, probeDuplicatePending, probeErrors, probeLostUpdates, probeRuns } from '../lib/metrics.js';
import * as ui from '../lib/ui.js';

const P = CFG.screens.probe;
const MARK = 'LT-PROBE';

function rows(j, key) {
  const list = (j && (j[key] || j[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)])) || [];
  return list.map((a) => ({
    id: a.id, stage: a.stage, status: a.status,
    text: a.comment_text || a.commentText || '',
  }));
}

async function approvalId(tenderId, stage) {
  const j = jsonOf(await ui.workflowDetails(tenderId, 'probe'));
  const r = rows(j, 'approvalRequests').find((a) => a.stage === stage && a.status === 'PENDING');
  return r ? r.id : null;
}

async function atTime(epochMs) {
  await delay(epochMs - Date.now());
}

async function doubleApproval(ctx, tenderId, when) {
  const id = await approvalId(tenderId, 'PAYMENT_APPROVAL');
  if (!id) return;
  await atTime(when);
  const res = await ui.review(id, { action: 'APPROVED', comment: `${MARK} ${ctx.username}`, tenderId, stage: 'PAYMENT_APPROVAL' }, 'probe', 'S15');
  if (res.status >= 500) probeErrors.add(1, { probe: 'double_approval' });
  if (ctx.roleIndex !== 0) return;
  await delay(8000);
  const j = jsonOf(await ui.workflowDetails(tenderId, 'probe'));
  const applied = rows(j, 'comments').filter((c) => c.text.includes(MARK)).length;
  const dupDoc = rows(j, 'approvalRequests').filter((a) => a.stage === 'DOC_VERIFICATION' && a.status === 'PENDING').length;
  probeRuns.add(1, { probe: 'double_approval' });
  if (applied > 1) probeDoubleApprovals.add(applied - 1, { probe: 'double_approval', tender: tenderId });
  if (dupDoc > 1) probeDuplicatePending.add(dupDoc - 1, { probe: 'double_approval', tender: tenderId });
}

async function dualTrackRace(ctx, tenderId, when) {
  const stage = ctx.roleIndex === 0 ? 'MIS_PRICING' : (ctx.roleIndex === 1 ? 'DOC_VERIFICATION' : null);
  if (!stage) return;
  const id = await approvalId(tenderId, stage);
  if (!id) return;
  await atTime(when);
  const body = { action: 'APPROVED', comment: `${MARK} ${ctx.username}`, tenderId, stage };
  if (stage === 'MIS_PRICING') body.misFinalPrice = 990000;
  const res = await ui.review(id, body, 'probe', 'S15');
  if (res.status >= 500) probeErrors.add(1, { probe: 'dual_track_race' });
  if (ctx.roleIndex !== 0) return;
  await delay(8000);
  const j = jsonOf(await ui.workflowDetails(tenderId, 'probe'));
  const stageNow = j && (j.currentStage || j.current_stage);
  const rs = rows(j, 'approvalRequests');
  const bothApproved = ['MIS_PRICING', 'DOC_VERIFICATION'].every((s) => rs.some((a) => a.stage === s && a.status === 'APPROVED'));
  probeRuns.add(1, { probe: 'dual_track_race' });
  if (bothApproved && stageNow !== 'SUBMISSION_READY') probeLostUpdates.add(1, { probe: 'dual_track_race', tender: tenderId });
}

/** Arm the probe timers for this VU (fire-and-forget; they run alongside the VU's screens). */
export function armProbes(ctx) {
  if (!P || !(P.enabled_profiles || []).includes(CFG.profile.name)) return [];
  if (ctx.role !== 'MIS Team') return [];
  const participants = Math.min(P.participants || 3, ctx.roleCount);
  if (participants < 2 || ctx.roleIndex >= participants) return [];
  const steadyStart = startMs() + WARMUP_MS;
  const tasks = [];
  const plan = [
    ['double_approval', P.double_approval_at_min || [], doubleApproval],
    ['dual_track_race', P.dual_track_race_at_min || [], dualTrackRace],
  ];
  for (const [kind, minutes, fn] of plan) {
    const ids = (CFG.fixtures.probe || {})[kind] || [];
    minutes.forEach((m, k) => {
      if (k >= ids.length) return;
      const when = steadyStart + m * 60000;
      if (when > startMs() + CFG.durations.warmup_s * 1000 + CFG.durations.steady_s * 1000) return;
      // Look up the approval id ~20 s before, fire at `when`.
      tasks.push(delay(when - 20000 - Date.now()).then(() => fn(ctx, ids[k], when)).catch((e) => console.warn(`probe ${kind}: ${e}`)));
    });
  }
  return tasks;
}
