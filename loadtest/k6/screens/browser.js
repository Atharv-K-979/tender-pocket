// Browser VUs (S17) via the k6 browser module: real Chromium renders the Next.js UI, so the page's
// own timers produce the polling (10 §0). Journey: login → dashboard dwell → open a tender
// (full navigation, page.tsx:1410-1412) → back → approvals tab (if the role has it, page.tsx:2324).
// Timings: navigation-to-visible per page (lt_page_load_ms{page}); Web Vitals are emitted by the
// browser module itself (browser_web_vital_*). Requests made by the page are checked against
// the G3 deny-list via page.on('request') when the installed k6 supports it.
import { browser } from 'k6/browser';
import exec from 'k6/execution';
import { BASE, CFG, PASSWORD } from '../lib/config.js';
import { matchDeny } from '../lib/guards.js';
import { browserBlocked, pageLoadMs } from '../lib/metrics.js';
import { uniform } from '../lib/pick.js';
import { delay } from '../lib/http.js';
import { pickDetailTender } from './detail.js';

const B = CFG.screens.browser;
const APPROVAL_ROLES = ['Admin', 'MIS Team', 'Clearance Team', 'TPC Team'];

async function timed(page, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    pageLoadMs.add(Date.now() - t0, { page: name, origin: 'browser', ok: 'true' });
  } catch (e) {
    pageLoadMs.add(Date.now() - t0, { page: name, origin: 'browser', ok: 'false' });
    console.warn(`browser ${name}: ${e}`);
    if (name === 'login_page' || name === 'dashboard_after_login') throw e;
  }
}

export async function browserJourney(ctx, endMs) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (typeof page.on === 'function') {
    try {
      page.on('request', (req) => {
        const url = req.url();
        if (url.startsWith(BASE) && matchDeny(url, CFG.safety.endpoint_denylist)) {
          browserBlocked.add(1);
          console.error(`SAFETY ABORT (browser): ${url}`);
          exec.test.abort(`G3 browser deny-list hit: ${url}`);
        }
      });
    } catch (e) {
      console.warn(`page.on('request') unsupported in this k6 build: ${e}`);
    }
  }
  try {
    await timed(page, 'login_page', () => page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 }));
    // Login form placeholders (page.tsx:2008-2033 "Enter username" / "Enter password")
    await page.locator('input[placeholder="Enter username"]').fill(ctx.username);
    await page.locator('input[placeholder="Enter password"]').fill(PASSWORD);
    await timed(page, 'dashboard_after_login', async () => {
      await page.locator('button[type="submit"]').click();
      await page.waitForFunction(() => !!localStorage.getItem('token'), { timeout: 120000 });
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    });
    while (Date.now() < endMs) {
      await delay(Math.min(endMs - Date.now(), uniform(ctx.rnd, B.dwell_seconds[0], B.dwell_seconds[1]) * 1000));
      if (Date.now() >= endMs) break;
      const id = pickDetailTender(ctx);
      await timed(page, 'tender_detail', () => page.goto(`${BASE}/tenders/${encodeURIComponent(id)}`, { waitUntil: 'load', timeout: 120000 }));
      await delay(Math.min(endMs - Date.now(), uniform(ctx.rnd, B.dwell_seconds[0], B.dwell_seconds[1]) * 1000));
      if (Date.now() >= endMs) break;
      if (APPROVAL_ROLES.includes(ctx.role)) {
        await timed(page, 'approvals', () => page.goto(`${BASE}/#/approvals`, { waitUntil: 'load', timeout: 120000 }));
        await delay(Math.min(endMs - Date.now(), uniform(ctx.rnd, B.dwell_seconds[0], B.dwell_seconds[1]) * 1000));
      }
      if (Date.now() >= endMs) break;
      await timed(page, 'dashboard', () => page.goto(`${BASE}/#/dashboard`, { waitUntil: 'load', timeout: 120000 }));
    }
  } finally {
    await page.close();
    await context.close();
  }
}
