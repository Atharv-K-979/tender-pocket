// Run configuration rendered by k6/render_config.py (or orchestrator/run.py) from
// loadtest/config/*.yaml + k6/profiles/<PROFILE>.yaml + seeder/out/fixtures.json.
// Read once in the init context. The test-user password is NOT in this file: it comes from
// the LT_PASSWORD environment variable (k6 includes system env vars by default).
export const CFG = JSON.parse(open(__ENV.LT_RUN_CONFIG || './build/run_config.json'));

export const BASE = CFG.base_url.replace(/\/+$/, '');
export const RUN_TYPE = CFG.run_type;
export const SLOTS = CFG.profile.slots;
export const WARMUP_MS = CFG.durations.warmup_s * 1000;
export const STEADY_MS = CFG.durations.steady_s * 1000;
export const TOTAL_MS = WARMUP_MS + STEADY_MS;
export const PASSWORD = __ENV.LT_PASSWORD || '';
