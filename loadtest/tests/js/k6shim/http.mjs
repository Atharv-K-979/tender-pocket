import { execFileSync } from 'node:child_process';
globalThis.__REQS = globalThis.__REQS || [];
function toBody(body) {
  if (body === null || body === undefined) return undefined;
  if (typeof body === 'string') return body;
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) {
    if (v && v.__file) fd.append(k, new Blob([v.bytes], { type: v.type }), v.name);
    else fd.append(k, String(v));
  }
  return fd;
}
async function asyncRequest(method, url, body, params) {
  const p = params || {};
  const t0 = Date.now();
  const r = await fetch(url, { method, headers: p.headers, body: toBody(body) });
  const text = await r.text();
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  globalThis.__REQS.push({ method, url, status: r.status, ms: Date.now() - t0, tags: p.tags || {}, expect: !!p.responseCallback });
  return { status: r.status, body: p.responseType === 'none' ? null : text, headers };
}
function get(url) {
  const code = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', url]).toString();
  return { status: Number(code), body: null, headers: {} };
}
function request() { throw new Error('sync request not used'); }
const http = {
  asyncRequest, get, request,
  file: (bytes, name, type) => ({ __file: true, bytes, name, type }),
  cookieJar: () => ({ set() {} }),
  expectedStatuses: (...s) => ({ expected: s }),
};
export default http;
