// Deterministic randomness and partitioning helpers (pure module, unit-tested in node).

// mulberry32 PRNG — reproducible per VU (seeded from run seed + slot).
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uniform(r, lo, hi) {
  return lo + (hi - lo) * r();
}

export function intBetween(r, lo, hi) {
  return Math.floor(uniform(r, lo, hi + 1));
}

export function choice(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}

export function weightedPick(r, weights) {
  const entries = Object.entries(weights || {}).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!entries.length) return null;
  let x = r() * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x < 0) return k;
  }
  return entries[entries.length - 1][0];
}

// FNV-1a 32-bit; used to split team-queue (alias-assigned) items among the VUs of one role.
export function hash32(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function inPartition(id, slotIndex, slotCount) {
  if (!slotCount || slotCount <= 1) return true;
  return hash32(id) % slotCount === slotIndex;
}

// A small FIFO pool of pre-staged ids that a VU consumes exactly once.
export function makePool(ids) {
  const q = [...(ids || [])];
  const used = new Set();
  return {
    next() {
      while (q.length) {
        const id = q.shift();
        if (!used.has(id)) { used.add(id); return id; }
      }
      return null;
    },
    markUsed(id) { used.add(id); },
    isUsed(id) { return used.has(id); },
    has(id) { return q.includes(id) && !used.has(id); },
    remaining() { return q.filter((x) => !used.has(x)).length; },
  };
}
