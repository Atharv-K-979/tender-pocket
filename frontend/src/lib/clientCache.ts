/**
 * Browser-side caches that keep screens fast without changing what they show.
 * Only use these from effects and event handlers (never during server rendering).
 *
 * - fetchJsonWithEtag: requests ask the server "anything new?" by sending the ETag of the last
 *   answer for that URL. A 304 Not Modified reply carries no body; the caller gets that previous
 *   answer back (changed = false).
 * - tenderSummaries: the list row a user clicked, so the tender page can show its header at once
 *   while the full tender loads (kept per user).
 * - dashboardMemory: the dashboard's last data and filters, so going Back to it from a tender
 *   page shows the same tab, page and filters immediately instead of loading everything again.
 *
 * Everything lives in memory only (nothing is written to disk) and is cleared on logout.
 */

import type { Tender } from '@/lib/db';

type EtagEntry = { etag: string; data: unknown };

const MAX_ETAG_ENTRIES = 200;
const etagEntries = new Map<string, EtagEntry>();

export type CachedJsonResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  /**
   * False when the server answered 304: data is the previous answer for this URL, as the same object.
   * Apply it anyway (the screen may show another URL's data since, e.g. another page); setting
   * React state to the same object re-renders nothing.
   */
  changed: boolean;
};

/**
 * GET a JSON endpoint, re-using the previous answer when the server says it has not changed.
 * `cacheKey` must identify everything that changes the answer besides the URL (e.g. the user).
 */
export async function fetchJsonWithEtag<T = unknown>(
  fetcher: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  cacheKey: string,
  init: RequestInit = {}
): Promise<CachedJsonResult<T>> {
  const key = `${cacheKey}|${url}`;
  const previous = etagEntries.get(key);
  const headers = new Headers(init.headers || {});
  if (previous) headers.set('If-None-Match', previous.etag);

  const response = await fetcher(url, { ...init, headers });

  if (response.status === 304 && previous) {
    // Keep recently used entries at the end of the map (oldest are evicted first).
    etagEntries.delete(key);
    etagEntries.set(key, previous);
    return { ok: true, status: 200, data: previous.data as T, changed: false };
  }

  let data: T | null = null;
  try {
    data = (await response.json()) as T;
  } catch {
    data = null;
  }

  const etag = response.headers.get('ETag');
  if (response.ok && etag && data !== null) {
    etagEntries.delete(key);
    etagEntries.set(key, { etag, data });
    while (etagEntries.size > MAX_ETAG_ENTRIES) {
      const oldest = etagEntries.keys().next().value;
      if (oldest === undefined) break;
      etagEntries.delete(oldest);
    }
  } else if (!response.ok) {
    etagEntries.delete(key);
  }

  return { ok: response.ok, status: response.status, data, changed: true };
}

// ── Tender summaries (list row -> tender page) ────────────────────────────────────────────

const MAX_SUMMARIES = 500;
const tenderSummaries = new Map<string, Tender>();

/** A summary is only ever shown to the user whose list it came from. */
export function rememberTenderSummary(username: string, tender: Tender) {
  if (!username || !tender || tender.id == null) return;
  const key = `${username}|${tender.id}`;
  tenderSummaries.delete(key);
  tenderSummaries.set(key, tender);
  while (tenderSummaries.size > MAX_SUMMARIES) {
    const oldest = tenderSummaries.keys().next().value;
    if (oldest === undefined) break;
    tenderSummaries.delete(oldest);
  }
}

export function getTenderSummary(username: string, id: string): Tender | null {
  if (!username) return null;
  return tenderSummaries.get(`${username}|${id}`) ?? null;
}

// ── Dashboard memory (Back to the same tab, page and filters) ────────────────────────────

export type DashboardMemory = {
  username: string;
  savedAt: number;
  activeTab: string;
  filters: {
    searchQuery: string;
    statusFilter: string;
    locationFilter: string;
    sectorFilter: string;
    misExecutiveFilter: string;
    sortBy: string;
    sortOrder: string;
    corrigendumFilter: boolean;
    repoPage: number;
    repoLimit: number;
  };
  data: {
    deskTenders: Tender[] | null;
    repoTenders: Tender[] | null;
    repoTotal: number;
    tenders: Tender[] | null;
    analytics: unknown;
    filterOptions: { locations: string[]; sectors: string[] } | null;
  };
};

/** Remembered dashboards older than this are not restored (the data would be too old to show first). */
const DASHBOARD_MEMORY_MAX_AGE_MS = 10 * 60 * 1000;
let dashboardMemory: DashboardMemory | null = null;

export function saveDashboardMemory(memory: DashboardMemory) {
  dashboardMemory = memory;
}

export function readDashboardMemory(username: string): DashboardMemory | null {
  if (!dashboardMemory || dashboardMemory.username !== username) return null;
  if (Date.now() - dashboardMemory.savedAt > DASHBOARD_MEMORY_MAX_AGE_MS) return null;
  return dashboardMemory;
}

/** Forget everything (logout or another user signing in). */
export function clearClientCaches() {
  etagEntries.clear();
  tenderSummaries.clear();
  dashboardMemory = null;
}
