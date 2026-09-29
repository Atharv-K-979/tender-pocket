// Dependency-free route tests: node --experimental-vm-modules scripts/test-tech-spec-upload.cjs
async function main() {
const { test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const fs = await import('node:fs');
const path = await import('node:path');
const vm = await import('node:vm');
const { stripTypeScriptTypes } = await import('node:module');
const crypto = await import('node:crypto');

const root = path.resolve(__dirname, '..');
const uploadFile = 'src/app/api/tenders/[id]/upload-tech-spec/route.ts';
const progressFile = 'src/app/api/tenders/[id]/tech-spec-progress/route.ts';
const downloadFile = 'src/app/api/tenders/[id]/tech-spec-download/[filename]/route.ts';
const clientFile = 'src/app/api/compliance-progress-client/route.ts';
const metrics = { tokens: { total: 120 }, durationsMs: { total: 5000 }, warnings: ['Review note'] };
const products = ['Alpha', 'Beta'].map((name, i) => ({
  productName: name, scheduleNumber: String(i + 1), clauseCount: 3,
  pdfDownloadUrl: `/documents/T-1/${i + 1}_${name}.pdf`,
  docxDownloadUrl: `/documents/T-1/${i + 1}_${name}.docx`,
  xlsxDownloadUrl: `/documents/T-1/${i + 1}_${name}.xlsx`,
}));
const success = {
  success: true, generated: true, products, metrics, message: 'Sheets ready', clauseCount: 6,
  pdfDownloadUrl: products[0].pdfDownloadUrl, docxDownloadUrl: products[0].docxDownloadUrl,
  xlsxDownloadUrl: products[0].xlsxDownloadUrl,
  extraFutureField: { retained: true },
};
const empty = { success: true, generated: false, products: [], pdfDownloadUrl: null,
  docxDownloadUrl: null, xlsxDownloadUrl: null, clauseCount: 0,
  message: 'No products found with applicable compliance requirements.', metrics };
const originalDocs = [{ name: 'Unrelated document', filename: 'existing.pdf', local_path: '/existing.pdf' }];

async function fixture(options = {}) {
  const state = {
    docs: JSON.stringify(originalDocs), status: 'None', stage: 'SPEC_PREPARATION',
    writes: [], requests: [], logs: [], mutations: 0,
  };
  const db = {
    prepare(sql) {
      return {
        get() {
          if (options.missingLocal) return undefined;
          if (sql.includes('SELECT * FROM tenders')) return options.tender || { id: 'T-1', status: 'Issued', title: 'Test tender' };
          return sql.includes('downloaded_docs') ? { downloaded_docs: state.docs } : { id: 'T-1' };
        },
        all() { return options.allRows || []; },
        run(docs) {
          if (options.dbFailure) throw Error('Simulated local persistence failure');
          assert(sql.startsWith('UPDATE tenders SET '));
          state.docs = docs;
          if (sql.includes("spec_verification_status = 'Generated'")) state.status = 'Generated';
          state.mutations++;
          return { changes: 1 };
        },
      };
    },
    transaction(fn) {
      return () => {
        const before = { docs: state.docs, status: state.status, mutations: state.mutations };
        try { return fn(); } catch (error) { Object.assign(state, before); throw error; }
      };
    },
  };
  const fetchMock = async (url, init) => {
    state.requests.push({ url, init });
    return options.respond ? options.respond(url, init, state) : Response.json(options.result || success);
  };
  const context = vm.createContext({
    Request, Response, Headers, FormData, Blob, File, URL, Buffer, AbortController, AbortSignal,
    process: { env: options.env || { BACKEND_URL: 'http://java.test:8090' }, cwd: () => root },
    fetch: fetchMock, console: { error() {} }, setTimeout, clearTimeout,
  });
  const mockModules = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    fs: { default: { existsSync: () => true, mkdirSync() {},
      writeFileSync: (filename, bytes) => state.writes.push({ filename, bytes: Buffer.from(bytes) }) } },
    path: { default: path },
    '@/lib/db': { default: db, addActivityLog: (...args) => state.logs.push(args),
      hashPassword: () => { throw Error('Unexpected password hashing'); } },
    '@/lib/auth': { getAuthFromRequest: () => options.legacyAuth || options.anonymous ? null
      : { username: 'verified-user', role: options.role || 'Tender Executive' } },
    '@/lib/approvalsSync': { reconcileApprovalRequests() {} },
    '@/lib/documentTemplates': { generateHtmlTemplates() { throw Error('Unexpected rendering'); },
      generateTechnicalSpecificationHtml() { throw Error('Unexpected rendering'); } },
    '@google/generative-ai': { GoogleGenerativeAI: class {} },
    'html-to-docx': { default: () => { throw Error('Unexpected rendering'); } },
    puppeteer: { default: { launch() { throw Error('Unexpected browser launch'); } } },
    child_process: { execSync() { throw Error('Unexpected child process'); } },
    crypto: { default: crypto },
  };
  if (options.realAuth) delete mockModules['@/lib/auth'];
  const cache = new Map();
  const load = async name => {
    if (cache.has(name)) return cache.get(name);
    if (mockModules[name]) {
      const values = mockModules[name];
      const scriptModule = new vm.SyntheticModule(Object.keys(values), function () {
        Object.entries(values).forEach(([key, value]) => this.setExport(key, value));
      }, { context });
      cache.set(name, scriptModule);
      return scriptModule;
    }
    const filename = name.startsWith('@/') ? `src/${name.slice(2)}.ts` : name;
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    const scriptModule = new vm.SourceTextModule(stripTypeScriptTypes(source, { mode: 'strip' }),
      { context, identifier: filename });
    cache.set(name, scriptModule);
    await scriptModule.link(load);
    return scriptModule;
  };
  return {
    state,
    async route(filename = uploadFile) {
      const scriptModule = await load(filename);
      if (scriptModule.status !== 'evaluated') await scriptModule.evaluate();
      return scriptModule.namespace;
    },
  };
}

function uploadRequest({ file = true, textFile = false, bytes = '%PDF-test', signal, extras = {} } = {}) {
  const body = new FormData();
  if (file) body.append('file', textFile ? 'not-a-file' : new File([bytes], 'sample.pdf', { type: 'application/pdf' }));
  Object.entries(extras).forEach(([key, value]) => body.append(key, value));
  return new Request('http://frontend.test:8085/api/tenders/T-1/upload-tech-spec', {
    method: 'POST', body, signal,
    headers: { authorization: 'Bearer test-token', 'x-user-role': 'Admin', 'x-user-username': 'unverified-header' },
  });
}
const params = { params: Promise.resolve({ id: 'T-1' }) };

test('waits beyond three seconds, retains the full result, and registers every product format', async () => {
  const { state, route } = await fixture({ respond: async (_url, init, state) => {
    assert.equal(state.status, 'None', 'Must not report Generated before Java finishes');
    await new Promise(resolve => setTimeout(resolve, 3150));
    assert.equal(init.signal.aborted, false, 'No three-second conversion abort');
    state.docs = JSON.stringify([...originalDocs, { filename: 'added-during-conversion.pdf', local_path: '/later.pdf' }]);
    return Response.json(success);
  } });
  const request = uploadRequest({ extras: { offeredModel: 'Source model', scheduleNo: '7' } });
  const response = await (await route()).POST(request, params);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.generated, true);
  assert.deepEqual(data.metrics, metrics);
  assert.deepEqual(data.extraFutureField, success.extraFutureField);
  assert.equal(data.products.length, 2);
  assert.equal(data.pdfDownloadUrl, data.products[0].pdfDownloadUrl);
  assert.equal(data.docxDownloadUrl, data.products[0].docxDownloadUrl);
  assert.equal(data.xlsxDownloadUrl, data.products[0].xlsxDownloadUrl);
  assert.equal(data.pdfDownloadUrl, '/api/tenders/T-1/tech-spec-download/1_Alpha.pdf');
  assert.equal(data.filename, 'sample.pdf');
  assert.equal(data.url, '/api/tenders/T-1/documents/sample.pdf');
  assert.equal(state.status, 'Generated');
  assert.equal(state.stage, 'SPEC_PREPARATION');
  assert.equal(state.requests.length, 1, 'Never retry the conversion POST automatically');
  assert.equal(state.requests[0].init.headers.get('authorization'), 'Bearer test-token');
  assert.equal(state.requests[0].init.headers.get('x-user-role'), 'Tender Executive');
  assert.equal(state.requests[0].init.headers.get('x-user-username'), 'verified-user');
  assert.equal(state.requests[0].init.body.get('offeredModel'), 'Source model');
  assert.equal(state.requests[0].init.body.get('scheduleNo'), '7');
  assert.equal(state.requests[0].init.body.get('file').name, 'sample.pdf');
  const documents = JSON.parse(state.docs);
  assert.equal(documents.length, 9, 'Two unrelated files, input, six generated files');
  assert(documents.some(doc => doc.local_path === '/existing.pdf'));
  assert(documents.some(doc => doc.local_path === '/later.pdf'));
});

test('a successful empty conversion preserves null links and does not advance approval status', async () => {
  const { state, route } = await fixture({ result: empty });
  state.status = 'Pending';
  const response = await (await route()).POST(uploadRequest(), params);
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.generated, false);
  assert.deepEqual(data.products, []);
  assert.equal(data.pdfDownloadUrl, null);
  assert.equal(data.docxDownloadUrl, null);
  assert.equal(data.xlsxDownloadUrl, null);
  assert.deepEqual(data.metrics, metrics);
  assert.equal(state.status, 'Pending');
  assert.equal(JSON.parse(state.docs).length, 2);
  assert(!JSON.parse(state.docs).at(-1).name.includes('Technical Specification'));
});

test('combined outputs retain every product but register only one PDF DOCX and XLSX', async () => {
  const urls = {
    pdfDownloadUrl: '/documents/T-1/Combined_Technical_Data_Sheet.pdf',
    docxDownloadUrl: '/documents/T-1/Combined_Technical_Data_Sheet.docx',
    xlsxDownloadUrl: '/documents/T-1/Combined_Technical_Data_Sheet.xlsx',
  };
  const { state, route } = await fixture({ result: { ...success, ...urls, combined: true,
    products: products.map(product => ({ ...product, ...urls })) } });
  const response = await (await route()).POST(uploadRequest(), params);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.combined, true);
  assert.equal(body.products.length, 2);
  const documents = JSON.parse(state.docs);
  assert.equal(documents.length, 5, 'Unrelated file, input, and exactly three combined outputs');
  assert.equal(documents.filter(doc => doc.name.startsWith('Combined Technical Specifications')).length, 3);
  assert.equal(body.products[1].xlsxDownloadUrl, body.xlsxDownloadUrl);
});

for (const status of [400, 401, 403, 429, 500, 503]) {
  test(`Java HTTP ${status} and its error/metrics are preserved without local success`, async () => {
    const body = { success: false, error: 'Java conversion failed', metrics };
    const { state, route } = await fixture({ respond: async () => Response.json(body, { status }) });
    const response = await (await route()).POST(uploadRequest(), params);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
    assert.equal(state.mutations, 0);
    assert.equal(state.logs.length, 0);
    assert.equal(state.writes.length, 2, 'Uploaded sources remain available after failure');
  });
}

for (const [label, reply, expected] of [
  ['200 success=false', () => Response.json({ success: false, error: 'Rejected', metrics }), 502],
  ['non-JSON error', () => new Response('Service unavailable', { status: 503, headers: { 'content-type': 'text/plain' } }), 503],
  ['HTML success', () => new Response('<html>not a result</html>'), 502],
  ['array success', () => Response.json([]), 502],
  ['upload-only acknowledgement', () => Response.json({ success: true, filename: 'sample.pdf' }), 502],
  ['contradictory empty result', () => Response.json({ ...success, generated: false }), 502],
  ['missing generated links', () => Response.json({ ...success, pdfDownloadUrl: null }), 502],
  ['external generated URL', () => Response.json({ ...success, pdfDownloadUrl: 'https://other.test/secret.pdf' }), 502],
]) {
  test(`${label} cannot produce a Generated state`, async () => {
    const { state, route } = await fixture({ respond: async () => reply() });
    const response = await (await route()).POST(uploadRequest(), params);
    assert.equal(response.status, expected);
    assert.equal((await response.json()).success, false);
    assert.equal(state.mutations, 0);
  });
}

for (const code of ['ECONNREFUSED', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT']) {
  test(`transport ${code} is reported truthfully`, async () => {
    const { state, route } = await fixture({ respond: async () => { throw new TypeError('fetch failed', { cause: { code } }); } });
    const response = await (await route()).POST(uploadRequest(), params);
    assert.equal(response.status, code === 'ECONNREFUSED' ? 502 : 504);
    assert.equal((await response.json()).success, false);
    assert.equal(state.mutations, 0);
    assert.equal(state.requests.length, 1);
  });
}

test('client cancellation never reports success or retries Java', async () => {
  const controller = new AbortController();
  const { state, route } = await fixture({ respond: async (_url, init) => {
    controller.abort();
    init.signal.throwIfAborted();
  } });
  const response = await (await route()).POST(uploadRequest({ signal: controller.signal }), params);
  assert.equal(response.status, 499);
  assert.equal(state.mutations, 0);
});

for (const file of [{ file: false }, { textFile: true }, { bytes: '' }]) {
  test(`invalid upload ${JSON.stringify(file)} has no backend or database effects`, async () => {
    const { state, route } = await fixture();
    const response = await (await route()).POST(uploadRequest(file), params);
    assert.equal(response.status, 400);
    assert.equal(state.requests.length, 0);
    assert.equal(state.writes.length, 0);
  });
}

test('missing local tender and invalid backend config fail before saving files', async () => {
  for (const options of [{ missingLocal: true }, { env: { BACKEND_URL: 'http://frontend.test:8085' } }]) {
    const { state, route } = await fixture(options);
    const response = await (await route()).POST(uploadRequest(), params);
    assert.equal(response.status, options.missingLocal ? 404 : 503);
    assert.equal(state.writes.length, 0);
    assert.equal(state.requests.length, 0);
  }
});

test('both the established 8090 default and an explicitly configured 8080 backend work', async () => {
  for (const [env, port] of [[{}, '8090'], [{ BACKEND_URL: 'http://java.test:8080/' }, '8080']]) {
    const { state, route } = await fixture({ env });
    assert.equal((await (await route()).POST(uploadRequest(), params)).status, 200);
    assert.equal(new URL(state.requests[0].url).port, port);
  }
});

test('a configured backend path prefix is retained without exposing it in browser downloads', async () => {
  const { state, route } = await fixture({ env: { BACKEND_URL: 'https://services.test/java' } });
  const response = await (await route()).POST(uploadRequest(), params);
  assert.equal(response.status, 200);
  assert.equal(state.requests[0].url, 'https://services.test/java/api/tenders/T-1/upload-tech-spec');
  assert.equal((await response.json()).pdfDownloadUrl, '/api/tenders/T-1/tech-spec-download/1_Alpha.pdf');
});

test('local persistence failure does not lie about completion or discard Java metrics/downloads', async () => {
  const { state, route } = await fixture({ dbFailure: true });
  const response = await (await route()).POST(uploadRequest(), params);
  const data = await response.json();
  assert.equal(response.status, 500);
  assert.equal(data.success, false);
  assert.equal(data.generated, true, 'Java really generated the files, even though local registration failed');
  assert.deepEqual(data.metrics, metrics);
  assert(data.pdfDownloadUrl.includes('tech-spec-download'));
  assert.equal(state.status, 'None');
  assert.equal(state.docs, JSON.stringify(originalDocs));
});

test('corrupt existing document metadata is not silently overwritten', async () => {
  const { state, route } = await fixture();
  state.docs = '{invalid-existing-metadata';
  const response = await (await route()).POST(uploadRequest(), params);
  assert.equal(response.status, 500);
  assert.equal(state.docs, '{invalid-existing-metadata');
  assert.equal(state.status, 'None');
});

test('progress forwards the existing snapshot, not a new job', async () => {
  const snapshot = { ...success, status: 'COMPLETED', jobId: 'existing-job', percent: 100, events: [] };
  const { state, route } = await fixture({ result: snapshot });
  const response = await (await route(progressFile)).GET(
    new Request('http://frontend.test:8085/api/tenders/T-1/tech-spec-progress'), params);
  const data = await response.json();
  assert.equal(data.jobId, 'existing-job');
  assert.deepEqual(data.metrics, metrics);
  assert(data.products[0].pdfDownloadUrl.includes('tech-spec-download'));
  assert.equal(state.requests[0].init.method, undefined);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('generated downloads stream from Java through the same origin', async () => {
  const bytes = Buffer.from('%PDF-binary-result');
  const { state, route } = await fixture({ respond: async () =>
    new Response(bytes, { headers: { 'content-type': 'application/pdf' } }) });
  const response = await (await route(downloadFile)).GET(new Request('http://frontend.test:8085/download'),
    { params: Promise.resolve({ id: 'T-1', filename: '1_Alpha.pdf' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(state.requests[0].url, 'http://java.test:8090/documents/T-1/1_Alpha.pdf');
  assert.match(response.headers.get('content-disposition'), /1_Alpha\.pdf/);
});

test('download proxy rejects traversal and non-sheet files', async () => {
  for (const filename of ['../secret.pdf', '..\\secret.pdf', '.env']) {
    const { state, route } = await fixture();
    const response = await (await route(downloadFile)).GET(new Request('http://frontend.test:8085/download'),
      { params: Promise.resolve({ id: 'T-1', filename }) });
    assert.equal(response.status, 400);
    assert.equal(state.requests.length, 0);
  }
});

test('a missing Java document remains a failed download', async () => {
  const { route } = await fixture({ respond: async () => Response.json({ error: 'Document not found' }, { status: 404 }) });
  const response = await (await route(downloadFile)).GET(new Request('http://frontend.test:8085/download'),
    { params: Promise.resolve({ id: 'T-1', filename: 'missing.pdf' }) });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'Document not found');
});

test('the canonical Java progress client is reused rather than duplicated', async () => {
  const script = 'window.__complianceProgressLoaded = true;';
  const { state, route } = await fixture({ respond: async () =>
    new Response(script, { headers: { 'content-type': 'text/javascript' } }) });
  const response = await (await route(clientFile)).GET(new Request('http://frontend.test:8085/client'));
  assert.equal(await response.text(), script);
  assert.equal(state.requests[0].url, 'http://java.test:8090/compliance-progress.js');
});

for (const filename of ['src/app/page.tsx', 'src/app/tenders/[id]/page.tsx']) {
  for (const body of [empty, { success: false, error: 'Failed' }, { success: true }]) {
    test(`${filename}: non-generated outcome does not mutate approval state`, async () => {
      const text = fs.readFileSync(path.join(root, filename), 'utf8');
      const start = text.indexOf('  const handleTechSpecUpload = async');
      const end = text.indexOf('\n  };', start) + '\n  };'.length;
      assert(start >= 0 && end > start);
      const updates = [], toasts = [], loading = [];
      const context = vm.createContext({
        FormData, selectedTender: { id: 'T-1', spec_verification_status: 'None' },
        techSpecUploadInFlight: { current: false },
        setUploadingTechSpec: value => loading.push(value),
        fetchWithAuth: async () => Response.json(body),
        setSelectedTender: value => updates.push(value),
        updateTenderField: () => assert.fail('Upload must not submit a clearance/workflow mutation'),
        fetchTenders: async () => {},
        showToast: (...args) => toasts.push(args), console: { error() {} },
      });
      const handler = vm.runInContext(stripTypeScriptTypes(text.slice(start, end) + '\nhandleTechSpecUpload;',
        { mode: 'strip' }), context);
      await handler(new File(['test'], 'test.pdf'));
      assert.equal(updates.length, 0);
      assert.equal(toasts.length, 1);
      assert.deepEqual(loading, [true, false]);
    });
  }
  test(`${filename}: generated success refreshes state, guards duplicate submits, and never PATCHes approvals`, async () => {
    const text = fs.readFileSync(path.join(root, filename), 'utf8');
    const start = text.indexOf('  const handleTechSpecUpload = async');
    const end = text.indexOf('\n  };', start) + '\n  };'.length;
    let finishPost;
    const post = new Promise(resolve => { finishPost = resolve; });
    let posts = 0, selected = { id: 'T-1', spec_verification_status: 'None' };
    const context = vm.createContext({
      FormData, selectedTender: selected, techSpecUploadInFlight: { current: false },
      setUploadingTechSpec() {}, showToast() {}, console: { error() {} },
      fetchWithAuth: async (_url, init = {}) => {
        if (init.method === 'POST') { posts++; await post; return Response.json(success); }
        assert.equal(init.method, undefined, 'Refresh must be GET, not a workflow mutation');
        return Response.json({ success: true, tender: { id: 'T-1', spec_verification_status: 'Approved' } });
      },
      setSelectedTender: update => { selected = update(selected); },
      updateTenderField: () => assert.fail('Unexpected workflow PATCH'),
      fetchTenders: async () => {},
    });
    const handler = vm.runInContext(stripTypeScriptTypes(text.slice(start, end) + '\nhandleTechSpecUpload;',
      { mode: 'strip' }), context);
    const first = handler(new File(['test'], 'test.pdf'));
    const duplicate = handler(new File(['test'], 'test.pdf'));
    assert.equal(posts, 1);
    finishPost();
    await Promise.all([first, duplicate]);
    assert.equal(selected.spec_verification_status, 'Approved', 'Preserve fresher approval state returned by GET');
  });
  test(`${filename}: refresh failure cannot misreport a completed conversion as failed`, async () => {
    const text = fs.readFileSync(path.join(root, filename), 'utf8');
    const start = text.indexOf('  const handleTechSpecUpload = async');
    const end = text.indexOf('\n  };', start) + '\n  };'.length;
    const toasts = [];
    const context = vm.createContext({
      FormData, selectedTender: { id: 'T-1' }, techSpecUploadInFlight: { current: false },
      setUploadingTechSpec() {}, setSelectedTender() {}, fetchTenders: async () => {},
      showToast: (...args) => toasts.push(args), console: { error() {} },
      fetchWithAuth: async (_url, init = {}) => {
        if (init.method === 'POST') return Response.json(success);
        throw Error('Refresh network failure');
      },
    });
    const handler = vm.runInContext(stripTypeScriptTypes(text.slice(start, end) + '\nhandleTechSpecUpload;',
      { mode: 'strip' }), context);
    await handler(new File(['test'], 'test.pdf'));
    assert.deepEqual(toasts, [['Sheets ready', 'success']]);
  });
}

const matrix = JSON.parse(fs.readFileSync(path.resolve(root, '../backend/src/test/resources/workflow-permissions.json'), 'utf8'));
const actions = matrix.Admin;
for (const [role, granted] of Object.entries(matrix)) {
  test(`README permission matrix: ${role}`, async () => {
    const { route } = await fixture({ role });
    const policy = await route('@/lib/workflowAuthorization');
    for (const action of actions) assert.equal(policy.canPerform(role, action), granted.includes(action), action);
  });
}

for (const [file, action, method] of [
  [uploadFile, 'uploadSpecs', 'POST'],
  ['src/app/api/tenders/[id]/clearance-request/route.ts', 'uploadSpecs', 'POST'],
  ['src/app/api/tenders/[id]/approve-clearance/route.ts', 'approveSpecs', 'POST'],
  ['src/app/api/tenders/[id]/tpc-price/route.ts', 'setTpcPrice', 'POST'],
  ['src/app/api/tenders/[id]/mis-price/route.ts', 'setMisPrice', 'POST'],
  ['src/app/api/tenders/[id]/generate-bid-docs/route.ts', 'generateBids', 'POST'],
  ['src/app/api/auth/users/route.ts', 'manageUsers', 'POST'],
  ['src/app/api/auth/users/route.ts', 'manageUsers', 'DELETE'],
  ['src/app/api/activity-logs/route.ts', 'viewAudit', 'GET'],
]) {
  test(`${file} ${method}: denied roles cannot forward or mutate data`, async () => {
    for (const role of [...Object.keys(matrix).filter(role => !matrix[role].includes(action)), 'User']) {
      const { route, state } = await fixture({ role });
      const response = await (await route(file))[method](new Request('http://frontend.test:8085/test', {
        method, headers: { 'x-user-role': 'Admin', 'x-user-username': 'admin' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }), params);
      assert.equal(response.status, 403, role);
      assert.equal(state.mutations, 0);
      assert.equal(state.requests.length, 0);
      assert.equal(state.writes.length, 0);
    }
  });
}

test('legacy Executive aliases cannot approve MIS actions', async () => {
  const { route } = await fixture();
  const policy = await route('@/lib/workflowAuthorization');
  assert(policy.canPerform('MIS Executive', 'generateBids'));
  assert(!policy.canPerform('MIS Executive', 'reviewBids'));
  assert(policy.canPerform('Specification Team', 'approveSpecs'));
  assert(policy.canPerform('TPC Team', 'setTpcPrice'));
  assert(!policy.canPerform(null, 'viewTenders'));
  assert(policy.canReviewAssignment('MIS Team', 'reviewer', 'misteam'));
  assert(policy.canReviewAssignment('MIS Team', 'reviewer', 'reviewer'));
  assert(!policy.canReviewAssignment('MIS Team', 'reviewer', 'someone-else'));
  assert(policy.canReviewAssignment('Admin', 'admin', 'someone-else'));
});

test('PATCH does not provide an alternative path to privileged workflow mutations', async () => {
  const { route, state } = await fixture({ role: 'Tender Executive' });
  const api = await route('src/app/api/tenders/[id]/route.ts');
  for (const body of [{ tpc_purchase_price: 123 }, { spec_verification_status: 'Approved' },
    { payment_status: 'Approved' }, { current_stage: 'WON' }, { status: 'Won' }]) {
    const response = await api.PATCH(new Request('http://frontend.test:8085/api/tenders/T-1', {
      method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'x-user-role': 'Admin' },
    }), params);
    assert.equal(response.status, 403);
  }
  assert.equal(state.mutations, 0);
});

test('manufacturer quotes and cached pricing summaries are hidden from Executive and Clearance roles', async () => {
  const source = { tpc_purchase_price: 12345, ai_details_summary: 'Cost 12345',
    requests: [{ tpcPurchasePrice: 12345, stage: 'TPC_PRICING', comment: 'Price 12345' }] };
  const { route } = await fixture();
  const policy = await route('@/lib/workflowAuthorization');
  for (const role of ['Tender Executive', 'Clearance Team']) {
    assert(!JSON.stringify(policy.redactManufacturerPricing(source, role)).includes('12345'));
  }
  assert.equal(source.tpc_purchase_price, 12345);
  for (const role of ['Admin', 'MIS Team', 'TPC Pricing Team']) {
    assert.equal(policy.redactManufacturerPricing(source, role), source);
  }
});

test('non-admin user directory omits management details while preserving assignment names', async () => {
  const { route } = await fixture({ role: 'Tender Executive',
    allRows: [{ username: 'clearance-user', role: 'Clearance Team', email: 'private@example.test' }] });
  const response = await (await route('src/app/api/auth/users/route.ts')).GET(new Request('http://frontend.test:8085/api/auth/users'));
  assert.deepEqual((await response.json()).users, [{ username: 'clearance-user', role: 'Clearance Team' }]);
});

test('invalid JWTs cannot downgrade to spoofed role headers', async () => {
  const { route } = await fixture({ realAuth: true, env: { JWT_SECRET: 'test-signing-key' } });
  const auth = await route('@/lib/auth');
  for (const token of ['Bearer not-a-jwt', 'Basic invalid']) {
    assert.equal(auth.getAuthFromRequest(new Request('http://frontend.test/test', {
      headers: { authorization: token, 'x-user-role': 'Admin', 'x-user-username': 'admin' },
    })), null);
  }
  for (const algorithm of ['HS256', 'HS384', 'HS512']) {
    const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'verified-user', role: 'MIS Team', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
    const signature = crypto.createHmac(algorithm.toLowerCase().replace('hs', 'sha'), 'test-signing-key')
      .update(`${header}.${body}`).digest('base64url');
    const actor = auth.getAuthFromRequest(new Request('http://frontend.test/test', {
      headers: { authorization: `Bearer ${header}.${body}.${signature}`, 'x-user-role': 'Admin' },
    }));
    assert.equal(actor.role, 'MIS Team');
  }
});
}

main().catch(error => { console.error(error); process.exitCode = 1; });
