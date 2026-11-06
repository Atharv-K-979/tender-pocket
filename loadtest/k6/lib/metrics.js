// Custom metrics. Built-in http_req_* metrics carry the request tags (service, name, role,
// screen, origin, run_type, tier, phase, expected).
import { Counter, Rate, Trend } from 'k6/metrics';

// Polling model
export const pollTicks = new Counter('lt_poll_ticks');
export const pollOverruns = new Counter('lt_poll_overruns');       // tick started while previous tick in flight
export const pollInflight = new Trend('lt_poll_inflight_at_tick');

// Correctness
export const correctness = new Rate('lt_correctness_ok');          // tags: check
export const correctnessFailures = new Counter('lt_correctness_failures');
export const paginationOk = new Rate('lt_pagination_ok');          // S2
export const workflowStepOk = new Rate('lt_workflow_step_ok');     // tags: step
export const poolExhausted = new Counter('lt_pool_exhausted');     // tags: kind
export const respBytes = new Trend('lt_resp_bytes');               // from Content-Length when present

// Same-tender probe (S15)
export const probeLostUpdates = new Counter('lt_probe_lost_updates');
export const probeDoubleApprovals = new Counter('lt_probe_double_approvals');
export const probeDuplicatePending = new Counter('lt_probe_duplicate_pending');
export const probeRuns = new Counter('lt_probe_runs');
export const probeErrors = new Counter('lt_probe_5xx');

// Track B — spec upload (S18): the upload response `metrics` object (05 §15, 11 §6)
export const specApiMs = new Trend('lt_spec_durations_api_ms', true);
export const specExtractionMs = new Trend('lt_spec_durations_extraction_ms', true);
export const specRenderingMs = new Trend('lt_spec_durations_rendering_ms', true);
export const specTotalMs = new Trend('lt_spec_durations_total_ms', true);
export const specClientMs = new Trend('lt_spec_upload_client_ms', true);
export const specApiAttempts = new Trend('lt_spec_api_attempts');
export const specTokensIn = new Trend('lt_spec_tokens_input');
export const specTokensOut = new Trend('lt_spec_tokens_output');
export const specTokensTotal = new Trend('lt_spec_tokens_total');
export const specOk = new Rate('lt_spec_upload_ok');
export const specStuck = new Counter('lt_spec_upload_stuck');      // progress never reached a terminal state

// Track B — bid pack (S19)
export const bidpackMs = new Trend('lt_bidpack_ms', true);
export const bidpackOk = new Rate('lt_bidpack_ok');

// Browser (S17)
export const pageLoadMs = new Trend('lt_page_load_ms', true);      // tags: page
export const browserBlocked = new Counter('lt_browser_blocked_requests');

// Safety
export const denied = new Counter('lt_denied_request_attempts');
