// Workflow journeys on the VU's OWN pre-staged tenders (seeder fixtures), each performed on the
// tender detail page (DPOLL running) and verified by reading the resulting stage.
//   J1 Exec:      clearance-request on a spec-Generated tender      -> SPEC_CLEARANCE (T3, 04 §3)
//   J2 Clearance: approve-clearance (JSON) on its SPEC_CLEARANCE      -> BID_DOCS_PREPARATION (T4a)
//   J3 Exec:      emd-applicability{applicable:false} on BID_DOCS     -> DUAL_TRACK (T6)
//                 route-pricing{route:TPC} on DUAL_TRACK              -> TPC_PRICING (T9a)
//   J4 TPC:       tpc-price on its TPC_PRICING tender                 -> MIS_PRICING (T10c)
//   J5 MIS:       mis-price on MIS_PRICING / verify-all-documents on DOC_VERIFICATION (T11b, T12b)
//   J6 Admin:     monitoring (screens/admin.js)
// Review-based variants of J2/J4/J5 run in the Approvals Center (screens/approvals.js).
import { CFG } from '../lib/config.js';
import { jsonOf } from '../lib/http.js';
import { correctness, correctnessFailures, poolExhausted, workflowStepOk } from '../lib/metrics.js';
import { choice } from '../lib/pick.js';
import { peerFor } from '../lib/ctx.js';
import { detailScreen } from './detail.js';
import { verifyStage } from './approvals.js';
import * as ui from '../lib/ui.js';

const EXPECT = CFG.workflow.expect_after_action;

function rec(ok, step) {
  workflowStepOk.add(ok, { step });
  correctness.add(ok, { check: `journey_${step}` });
  if (!ok) correctnessFailures.add(1, { check: `journey_${step}` });
}

const JOURNEYS = {
  'Tender Executive': [
    { step: 'J1_clearance_request', pool: 'spec_generated',
      act: (ctx, id) => ui.clearanceRequest(id, peerFor(ctx, ctx.peers.clearance, 'clearance'), 'actions') },
    { step: 'J3_emd_not_applicable', pool: 'bid_docs_preparation', act: (ctx, id) => ui.emdApplicability(id, false, 'actions') },
    { step: 'J3_route_pricing_tpc', pool: 'dual_track', act: (ctx, id) => ui.routePricing(id, 'TPC', 'actions') },
  ],
  'Clearance Team': [
    { step: 'J2_approve_clearance', pool: 'spec_clearance_pending', act: (ctx, id) => ui.approveClearanceJson(id, 'actions') },
  ],
  'TPC Team': [
    { step: 'J4_tpc_price', pool: 'tpc_pricing',
      act: (ctx, id) => ui.tpcPrice(id, 750000, peerFor(ctx, ctx.peers.mis, 'misteam'), 'actions') },
  ],
  'MIS Team': [
    { step: 'J5_mis_price', pool: 'mis_pricing', act: (ctx, id) => ui.misPrice(id, 880000, 'actions') },
    { step: 'J5_verify_all_documents', pool: 'doc_verification', act: (ctx, id) => ui.verifyAllDocuments(id, 'actions') },
  ],
};

function nextFromPool(ctx, pool) {
  const p = ctx.pools[pool];
  if (!p) return null;
  let id = p.next();
  while (id && ctx.consumed.has(id)) id = p.next();
  return id;
}

export async function actionsScreen(ctx, dwellMs) {
  const list = JOURNEYS[ctx.role];
  if (!list) return detailScreen(ctx, dwellMs);
  const order = [...list].sort(() => ctx.rnd() - 0.5);
  let chosen = null;
  let id = null;
  for (const j of order) {
    id = nextFromPool(ctx, j.pool);
    if (id) { chosen = j; break; }
  }
  if (!chosen) {
    poolExhausted.add(1, { kind: `actions_${ctx.role}` });
    return detailScreen(ctx, dwellMs);
  }
  return detailScreen(ctx, dwellMs, id, {
    screen: 'actions',
    during: async (tenderId) => {
      ctx.consumed.add(tenderId);
      const res = await chosen.act(ctx, tenderId);
      const j = jsonOf(res);
      let ok = res.status === 200 && (!j || j.success !== false);
      await ui.tender(tenderId, 'actions');                // UI refresh after the action
      if (ok) ok = await verifyStage(tenderId, chosen.step, EXPECT[chosen.step] || [], 'actions');
      rec(ok, chosen.step);
      if (ctx.rnd() < 0.3) await ui.postComment(tenderId, `Note from ${ctx.username}: ${choice(ctx.rnd, ['checked', 'ok', 'follow up'])}`, 'actions');
    },
  });
}
