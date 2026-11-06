// Endpoint-name normalisation for the `name` tag (pure module: no k6 imports, unit-tested in node).
// Static segments are kept; tender ids / approval ids become {id} so per-endpoint stats aggregate.
// Static children of /api/tenders: TenderController.java:226-286, :2262 (stats), :2336 (documents).
const TENDER_STATIC = new Set(['stats', 'sync-gem', 'sync-emails', 'trigger-due-alerts', 'documents']);
const APPROVAL_STATIC = new Set(['counts', 'pending']);

export function normalisePath(path) {
  const clean = String(path).split('?')[0].split('#')[0];
  const segs = clean.split('/');
  // segs[0] === '' for absolute paths
  if (segs[1] === 'api' && segs[2] === 'tenders' && segs.length > 3 && segs[3] && !TENDER_STATIC.has(segs[3])) {
    segs[3] = '{id}';
  }
  if (segs[1] === 'api' && segs[2] === 'approvals' && segs.length > 3 && segs[3] && !APPROVAL_STATIC.has(segs[3])) {
    segs[3] = '{id}';
  }
  if (segs[1] === 'api' && segs[2] === 'v2' && segs[3] === 'workflow' && segs.length > 4 && segs[4]) {
    segs[4] = '{id}';
  }
  if (segs[1] === 'tenders' && segs.length > 2 && segs[2]) {
    segs[2] = '{id}';
  }
  return segs.join('/') || '/';
}

export function endpointName(method, path) {
  const base = `${String(method).toUpperCase()} ${normalisePath(path)}`;
  const q = String(path).includes('?') ? String(path).split('?')[1] : '';
  if (base === 'GET /api/tenders' && q) {
    const params = new Map(q.split('&').map((kv) => kv.split('=').map(decodeURIComponent)));
    if (params.has('limit') || params.has('page')) return `${base} (paged)`;
    if ((params.get('search') || '') !== '') return `${base} (search)`;
    if (params.get('status') === 'Participating' && params.size <= 2) return `${base}?status=Participating`;
  }
  return base;
}
