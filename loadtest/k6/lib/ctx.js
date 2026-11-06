// Per-VU context: identity, pre-staged fixture pools, peers for chained journeys, RNG.
import { CFG, SLOTS } from './config.js';
import { makePool, rng } from './pick.js';

const ALIASES = {
  'MIS Team': ['misteam', 'mis team', 'mis executive', ''],
  'Clearance Team': ['clearance', 'clearance team', 'specification team', ''],
  'TPC Team': ['tpc', 'tpc team', 'tpc pricing team', ''],
};

export function buildCtx(slotIndex) {
  const slot = SLOTS[slotIndex];
  const sameRole = SLOTS.filter((s) => s.role === slot.role);
  const fx = (CFG.fixtures.users || {})[slot.username] || {};
  const pools = {};
  for (const [kind, ids] of Object.entries(fx)) pools[kind] = makePool(ids);
  const peersOf = (role) => SLOTS.filter((s) => s.role === role).map((s) => s.username);
  return {
    slot,
    slotIndex,
    username: slot.username,
    role: slot.role,
    roleIndex: sameRole.indexOf(slot),
    roleCount: sameRole.length,
    behaviour: slot.behaviour || 'default',
    rnd: rng((CFG.seed || 1) * 1000 + slotIndex),
    pools,
    consumed: new Set(),
    ownIds: Object.values(fx).flat(),
    aliases: ALIASES[slot.role] || [],
    peers: { clearance: peersOf('Clearance Team'), mis: peersOf('MIS Team'), tpc: peersOf('TPC Team') },
    visits: 0,
    lastPending: [],
  };
}

export function isFixture(id) {
  return String(id).startsWith(CFG.fixtures.prefix) || String(id).startsWith(CFG.fixtures.probe_prefix);
}
export function isProbe(id) {
  return String(id).startsWith(CFG.fixtures.probe_prefix);
}

// Universe tender ids are deterministic (seeder/model.py): LTU-0000000 .. LTU-<tier-1>
export function universeId(r) {
  const n = Math.floor(r() * CFG.tier);
  return `${CFG.fixtures.universe_prefix}${String(n).padStart(7, '0')}`;
}

export function peerFor(ctx, list, fallback) {
  if (!list || !list.length) return fallback;
  return list[(ctx.roleIndex + ctx.slotIndex) % list.length];
}

// Approval DTO keys: SNAKE_CASE naming strategy (application.properties:80) — accept both.
export function normApproval(a) {
  return {
    id: a.id,
    tenderId: a.tender_id !== undefined ? a.tender_id : a.tenderId,
    stage: a.stage,
    status: a.status,
    assignedTo: a.assigned_to !== undefined ? a.assigned_to : a.assignedTo,
    tpcPurchasePrice: a.tpc_purchase_price !== undefined ? a.tpc_purchase_price : a.tpcPurchasePrice,
    estimatedCost: a.tender_estimated_cost !== undefined ? a.tender_estimated_cost : a.tenderEstimatedCost,
  };
}
