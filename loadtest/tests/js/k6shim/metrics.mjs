globalThis.__METRICS = globalThis.__METRICS || {};
class M {
  constructor(name) { this.name = name; globalThis.__METRICS[name] = globalThis.__METRICS[name] || { n: 0, sum: 0, trues: 0, byTag: {} }; }
  add(v, tags) {
    const m = globalThis.__METRICS[this.name];
    const val = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
    m.n += 1; m.sum += val; if (val) m.trues += 1;
    const key = tags ? Object.values(tags).join('|') : '';
    m.byTag[key] = (m.byTag[key] || 0) + (typeof v === 'boolean' ? (v ? 0 : 1) : 1);
  }
}
export class Counter extends M {}
export class Trend extends M {}
export class Rate extends M {}
export class Gauge extends M {}
