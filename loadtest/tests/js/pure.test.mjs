// node --test tests/js — unit tests for the pure k6 modules (no k6 runtime needed).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assertVuTotal, checkOrigin, isEc21, matchDeny } from '../../k6/lib/guards.js';
import { endpointName, normalisePath } from '../../k6/lib/normalise.js';
import { hash32, inPartition, makePool, rng, weightedPick } from '../../k6/lib/pick.js';

const DENY = JSON.parse(readFileSync(new URL('./denylist.json', import.meta.url)));

test('deny-list blocks every G3 endpoint', () => {
  const blocked = [
    '/api/tenders/sync-gem', '/api/tenders/sync-emails', '/api/tenders/trigger-due-alerts',
    '/api/update/apply', '/api/update/check', '/api/update', '/api/noticedesk/notices',
    '/api/products/models/upload', '/api/products/models', '/api/preview-doc', '/api/signatures/upload',
    '/api/tenders/LTU-0000001/generate-tech-specs', '/api/company-docs', '/api/company-docs/5',
    '/api/tenders/X/documents/a.pdf', '/documents/X/a.pdf', '/api/v2/workflow/X/action',
    'http://h:8085/api/update/apply?x=1',
  ];
  for (const p of blocked) assert.ok(matchDeny(p, DENY), `should block ${p}`);
});

test('deny-list allows the journey endpoints', () => {
  const allowed = [
    '/api/tenders', '/api/tenders?search=x', '/api/tenders/LTU-0000001', '/api/tenders/stats',
    '/api/tenders/LTU-1/comments', '/api/approvals/counts', '/api/approvals/pending', '/api/approvals/12/review',
    '/api/tenders/LTF-X/generate-bid-docs', '/api/tenders/LTF-X/upload-tech-spec', '/api/tenders/LTF-X/tech-spec-progress',
    '/api/v2/workflow/LTF-X/route-pricing', '/api/auth/login', '/api/analytics', '/api/activity-logs', '/',
    '/tenders/LTU-0000001', '/api/compliance-progress-client',
  ];
  for (const p of allowed) assert.equal(matchDeny(p, DENY), null, `should allow ${p}`);
});

test('origin guard blocks direct backend and foreign hosts', () => {
  const base = 'http://10.0.0.5:8085';
  assert.equal(checkOrigin('http://10.0.0.5:8085/api/tenders', base, [8090]), null);
  assert.match(checkOrigin('http://10.0.0.5:8090/api/tenders/1/generate-bid-docs', base, [8090]), /blocked port/);
  assert.match(checkOrigin('http://evil:8085/api/tenders', base, [8090]), /not the frontend/);
});

test('17-VU guard', () => {
  const s = (n) => Array.from({ length: n }, () => ({}));
  assert.equal(assertVuTotal(s(17), 'BENCHMARK', 17), 17);
  assert.throws(() => assertVuTotal(s(16), 'BENCHMARK', 17), /G1/);
  assert.throws(() => assertVuTotal(s(18), 'benchmark', 17), /G1/);
  assert.equal(assertVuTotal(s(3), 'DEBUG', 17), 3);
});

test('EC2-1 detection', () => {
  assert.equal(isEc21('10.0.0.5', ['10.0.0.5'], ['1.2.3.4']), null);
  assert.equal(isEc21('ec2-2.local', ['1.2.3.4'], ['1.2.3.4']), '1.2.3.4');
  assert.equal(isEc21('EC2-1.example', [], ['ec2-1.example']), 'ec2-1.example');
});

test('endpoint normalisation', () => {
  assert.equal(normalisePath('/api/tenders/GEM-1?t=5'), '/api/tenders/{id}');
  assert.equal(normalisePath('/api/tenders/stats?t=1'), '/api/tenders/stats');
  assert.equal(normalisePath('/api/tenders/LTU-1/comments'), '/api/tenders/{id}/comments');
  assert.equal(normalisePath('/api/approvals/42/review'), '/api/approvals/{id}/review');
  assert.equal(normalisePath('/api/approvals/pending?status=PENDING'), '/api/approvals/pending');
  assert.equal(normalisePath('/api/v2/workflow/LTF-1/route-pricing'), '/api/v2/workflow/{id}/route-pricing');
  assert.equal(normalisePath('/tenders/LTU-1'), '/tenders/{id}');
  assert.equal(endpointName('get', '/api/tenders?search=&status=&page=0&limit=20'), 'GET /api/tenders (paged)');
  assert.equal(endpointName('GET', '/api/tenders?search=pump&status='), 'GET /api/tenders (search)');
  assert.equal(endpointName('GET', '/api/tenders?status=Participating&t=1'), 'GET /api/tenders?status=Participating');
  assert.equal(endpointName('GET', '/api/tenders?search=&status=&t=1'), 'GET /api/tenders');
});

test('rng, weighted pick, partition, pool', () => {
  const a = rng(5); const b = rng(5);
  assert.equal(a(), b());
  const r = rng(1);
  const counts = { x: 0, y: 0 };
  for (let i = 0; i < 10000; i += 1) counts[weightedPick(r, { x: 3, y: 1 })] += 1;
  assert.ok(counts.x > 7000 && counts.x < 8000, JSON.stringify(counts));
  const ids = Array.from({ length: 300 }, (_, i) => `LTF-${i}`);
  const parts = [0, 1, 2].map((s) => ids.filter((id) => inPartition(id, s, 3)));
  assert.equal(parts.flat().length, 300);
  assert.equal(new Set(parts.flat()).size, 300);
  assert.equal(hash32('abc'), hash32('abc'));
  const pool = makePool(['a', 'b']);
  pool.markUsed('a');
  assert.equal(pool.next(), 'b');
  assert.equal(pool.next(), null);
});
