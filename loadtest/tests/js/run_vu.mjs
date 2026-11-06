// Child process: run one k6 VU body (apiVU) under the node shim; print metrics + requests as JSON.
const main = await import('../../k6/main.js');
const start = Number(process.env.LT_START_MS);
let error = null;
try { await main.apiVU({ start }); } catch (e) { error = String(e && e.stack || e); }
process.stdout.write(JSON.stringify({ slot: process.env.LT_SLOT, error, aborted: globalThis.__ABORTED || null,
  metrics: globalThis.__METRICS, reqs: globalThis.__REQS }));
process.exit(0);
