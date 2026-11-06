// Admin monitoring journey J6 (review 10 §5 J6): analytics tab (stats), audit tab
// (activity-logs, whole table), approvals history (counts + pending ?status=HISTORY).
// The dashboard poll keeps running on the analytics/audit tabs and stops on the approvals
// tab (page.tsx:956).
import { CFG } from '../lib/config.js';
import { delay, setScreen } from '../lib/http.js';
import { uniform } from '../lib/pick.js';
import { dwell, startPoller } from '../lib/poll.js';
import { dashboardTick } from './dashboard.js';
import * as ui from '../lib/ui.js';

export async function historyScreen(ctx, dwellMs) {
  const end = Date.now() + dwellMs;
  const f = { search: '', status: '' };
  setScreen('history');
  const poller = startPoller('dashboard', CFG.screens.dashboard.poll_interval_ms, () => dashboardTick(ctx.role, f));
  try {
    // analytics tab: GET /api/tenders/stats (page.tsx:598-612, :769) + debounced list (:942-950)
    await ui.stats(false, 'history');
    await delay(CFG.screens.dashboard.debounce_ms);
    await ui.tendersList(f, 'history');
    await dwell(Math.min(end - Date.now(), uniform(ctx.rnd, 0.2, 0.35) * dwellMs), [poller]);
    // audit tab: GET /api/activity-logs (page.tsx:815)
    await ui.activityLogs('history');
    await delay(CFG.screens.dashboard.debounce_ms);
    await ui.tendersList(f, 'history');
    await dwell(Math.min(end - Date.now(), uniform(ctx.rnd, 0.2, 0.35) * dwellMs), [poller]);
  } finally {
    poller.stop();
  }
  // approvals tab, HISTORY view (ApprovalsCenter.tsx:301-305, :347, :408)
  await Promise.all([ui.approvalCounts('PENDING', 'history'), ui.approvalPending({ status: 'PENDING' }, 'history'), ui.misTeam('history')]);
  await delay(CFG.screens.approvals.second_pending_delay_ms);
  await Promise.all([ui.approvalCounts('HISTORY', 'history'), ui.approvalPending({ status: 'HISTORY' }, 'history')]);
  await delay(Math.max(0, end - Date.now()));
}
