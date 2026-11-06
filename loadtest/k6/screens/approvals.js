// Approvals Center (ApprovalsCenter.tsx; review 10 §3.3). No polling while open (page.tsx:956).
// Mount: counts ∥ pending ∥ mis-team (:347, :408, :430), then a second pending ~400 ms later
// (debounced search effect :440-445). Filter change: counts + pending. Each review/approval is
// followed by counts + pending (:587-588, :621-622). Every counts/pending call runs the
// reconcile (ApprovalController.java:371, :515).
import { CFG } from '../lib/config.js';
import { delay, jsonOf, setScreen } from '../lib/http.js';
import { correctness, correctnessFailures, poolExhausted, workflowStepOk } from '../lib/metrics.js';
import { choice, inPartition, intBetween, uniform } from '../lib/pick.js';
import { isFixture, isProbe, normApproval, peerFor } from '../lib/ctx.js';
import * as ui from '../lib/ui.js';

const A = CFG.screens.approvals;
const EXPECT = CFG.workflow.expect_after_review;   // stage -> allowed resulting current_stage values
const MIS_STAGES = ['PAYMENT_APPROVAL', 'MIS_PRICING', 'DOC_VERIFICATION', 'SUBMISSION_PENDING', 'WIN_LOSS_PENDING'];

function parsePending(res) {
  const j = jsonOf(res);
  if (!j || !Array.isArray(j.approvals)) return [];
  return j.approvals.map(normApproval);
}

function rec(ok, step) {
  workflowStepOk.add(ok, { step });
  correctness.add(ok, { check: `review_${step}` });
  if (!ok) correctnessFailures.add(1, { check: `review_${step}` });
}

// Only act on the VU's own pre-staged/chained fixture items (never universe or probe tenders):
// assigned to this user, or a team-queue alias split by hash among this role's VUs.
export function isMine(ctx, a) {
  if (!a || a.status !== 'PENDING' || !isFixture(a.tenderId) || isProbe(a.tenderId)) return false;
  if (ctx.consumed.has(a.tenderId)) return false;
  const who = String(a.assignedTo || '').trim().toLowerCase();
  if (who === ctx.username.toLowerCase()) return true;
  const alias = ctx.aliases.includes(who) || (ctx.role === 'MIS Team' && MIS_STAGES.includes(a.stage) && !who.startsWith(CFG.user_prefix));
  return alias && inPartition(a.tenderId, ctx.roleIndex, ctx.roleCount);
}

function reviewable(ctx, a) {
  if (ctx.role === 'Clearance Team') return a.stage === 'SPEC_CLEARANCE';
  if (ctx.role === 'TPC Team') return a.stage === 'TPC_PRICING';
  if (ctx.role === 'MIS Team') return MIS_STAGES.includes(a.stage);
  return false;   // Admin is view-only (ApprovalController.java:675-678)
}

export function reviewBody(ctx, a) {
  const body = { action: 'APPROVED', comment: `Approved by ${ctx.username} (load test)`, tenderId: a.tenderId, stage: a.stage };
  if (a.stage === 'TPC_PRICING') {
    body.tpcPurchasePrice = Math.round((a.estimatedCost || 1000000) * 0.7);
    body.assignedMisMember = peerFor(ctx, ctx.peers.mis, 'misteam');
  }
  if (a.stage === 'MIS_PRICING') body.misFinalPrice = Math.round((a.tpcPurchasePrice || 700000) * 1.15);
  if (a.stage === 'WIN_LOSS_PENDING') body.outcome = 'Won';
  return body;
}

export async function verifyStage(tenderId, step, allowed, screen) {
  const res = await ui.workflowDetails(tenderId, screen, 'S13');
  const j = jsonOf(res);
  const stage = j && (j.currentStage || j.current_stage);
  const ok = res.status === 200 && allowed.includes(stage);
  if (!ok) console.warn(`verify ${step} ${tenderId}: stage=${stage} expected ${allowed.join('|')}`);
  return ok;
}

async function refresh(status, stage) {
  const q = { stage, status };
  const [, p] = await Promise.all([ui.approvalCounts(status, 'approvals'), ui.approvalPending(q, 'approvals', true)]);
  return p;
}

export async function doReview(ctx, a) {
  ctx.consumed.add(a.tenderId);
  let res;
  if (a.stage === 'SPEC_CLEARANCE') {
    // Clearance approves via multipart approve-clearance, not /review (ApprovalsCenter.tsx:573-583)
    res = await ui.approveClearanceMultipart(a.tenderId, 'ALL COMPLY', `Cleared by ${ctx.username} (load test)`, 'approvals');
  } else {
    res = await ui.review(a.id, reviewBody(ctx, a), 'approvals');
  }
  const j = jsonOf(res);
  const allowed = EXPECT[a.stage] || [];
  let ok = res.status === 200 && j && j.success !== false;
  if (ok && j && j.newTenderStage) ok = allowed.includes(j.newTenderStage);
  if (ok) ok = await verifyStage(a.tenderId, a.stage, allowed, 'approvals');
  rec(ok, a.stage);
  return ok;
}

export async function approvalsScreen(ctx, dwellMs) {
  setScreen('approvals');
  const end = Date.now() + dwellMs;
  const status = 'PENDING';
  const [, first] = await Promise.all([ui.approvalCounts(status, 'approvals'), ui.approvalPending({ status }, 'approvals', true), ui.misTeam('approvals')]);
  correctness.add(first.status === 200, { check: 'approvals_pending_200' });
  await delay(A.second_pending_delay_ms);
  let pending = parsePending(await ui.approvalPending({ status }, 'approvals', true));

  const stages = (A.stage_filters || {})[ctx.role] || [''];
  const nFilters = intBetween(ctx.rnd, A.filter_changes_per_visit[0], A.filter_changes_per_visit[1]);
  const nReviews = reviewable(ctx, { stage: stages[0] }) || ctx.role !== 'Admin'
    ? intBetween(ctx.rnd, A.reviews_per_visit[0], A.reviews_per_visit[1]) : 0;
  for (let i = 0; i < nFilters && Date.now() < end; i += 1) {
    await delay(uniform(ctx.rnd, ...CFG.screen_time.think_seconds) * 1000);
    const stage = choice(ctx.rnd, stages);
    const p = await refresh(status, stage || undefined);
    if (p.status === 200) pending = parsePending(p).concat(pending);
  }
  if (ctx.role === 'Admin') {
    // Admin PENDING/HISTORY switch (ApprovalsCenter.tsx:301-305, :353-357)
    await refresh('HISTORY');
  }
  let done = 0;
  for (let i = 0; i < nReviews && Date.now() < end; i += 1) {
    const mine = pending.filter((a) => reviewable(ctx, a) && isMine(ctx, a));
    if (!mine.length) { poolExhausted.add(1, { kind: `approvals_${ctx.role}` }); break; }
    await delay(uniform(ctx.rnd, ...CFG.screen_time.think_seconds) * 1000);
    await doReview(ctx, mine[0]);
    done += 1;
    const p = await refresh(status);
    if (p.status === 200) pending = parsePending(p);
  }
  ctx.lastPending = pending;
  await delay(Math.max(0, end - Date.now()));
  return done;
}
