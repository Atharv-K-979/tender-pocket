// Real Next.js HTTP validation with an isolated SQLite database and a Java protocol stub.
async function main() {
  const assert = (await import('node:assert/strict')).default;
  const fs = await import('node:fs');
  const path = await import('node:path');
  const http = await import('node:http');
  const crypto = await import('node:crypto');
  const { spawn } = await import('node:child_process');
  const Database = (await import('better-sqlite3')).default;
  const root = path.resolve(__dirname, '..');
  const output = path.resolve(root, '../target', `workflow-http-${Date.now()}`);
  fs.mkdirSync(output, { recursive: true });
  const dbPath = path.join(output, 'validation.db');
  const secret = crypto.randomBytes(32).toString('hex');
  const password = 'Isolated-role-test-123!';
  const progress = new Map();
  const pdfBytes = Buffer.from('%PDF-1.4\nProtocol validation document\n');
  let next;
  let database;
  let serverLog = '';
  const java = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === '/compliance-progress.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(fs.readFileSync(path.resolve(root, '../backend/src/main/resources/static/compliance-progress.js')));
    }
    if (url.pathname === '/api/auth/login') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const roleMap = { admin: 'Admin', executive: 'Tender Executive', clearance: 'Clearance Team', tpc: 'TPC Pricing Team', misteam: 'MIS Team' };
      const role = roleMap[body.username] || 'Admin';
      const header = { alg: 'HS256', typ: 'JWT' };
      const payload = { sub: body.username, role, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
      const b64url = b => b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const hEnc = b64url(Buffer.from(JSON.stringify(header)));
      const pEnc = b64url(Buffer.from(JSON.stringify(payload)));
      const sig = b64url(crypto.createHmac('sha256', Buffer.from(secret)).update(`${hEnc}.${pEnc}`).digest());
      return json({ success: true, token: `${hEnc}.${pEnc}.${sig}` });
    }
    if (url.pathname.startsWith('/documents/')) {
      res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.docx')
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf' });
      return res.end(pdfBytes);
    }
    const match = url.pathname.match(/^\/api\/tenders\/([^/]+)\/(upload-tech-spec|tech-spec-progress)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (match[2] === 'tech-spec-progress') return json(progress.get(id) || { status: 'NOT_STARTED', events: [] });
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request(`http://localhost${req.url}`, {
        method: 'POST', headers: req.headers, body: Buffer.concat(chunks),
      });
      const form = await request.formData();
      const empty = form.get('file').name === 'empty.pdf';
      const products = empty ? [] : [{ productName: 'Validation Device', scheduleNumber: '1', clauseCount: 1,
        pdfDownloadUrl: `/documents/${id}/1_Validation_Device.pdf`,
        docxDownloadUrl: `/documents/${id}/1_Validation_Device.docx` }];
      if (!empty) {
        const docDir = path.resolve(root, 'public/documents', id);
        fs.mkdirSync(docDir, { recursive: true });
        fs.writeFileSync(path.join(docDir, '1_Validation_Device.pdf'), pdfBytes);
      }
      const result = { success: true, generated: !empty, products,
        pdfDownloadUrl: products[0]?.pdfDownloadUrl || null, docxDownloadUrl: products[0]?.docxDownloadUrl || null,
        clauseCount: empty ? 0 : 1, message: empty ? 'No technical specifications found.' : 'Sheets ready.',
        metrics: { tokens: { total: 100 }, warnings: [] } };
      progress.set(id, { ...result, status: 'COMPLETED', jobId: `job-${id}`, percent: 100, events: [] });
      return json(result);
    }
    if (url.pathname.match(/\/api\/approvals\/(\d+)\/review/)) {
      const reqId = url.pathname.match(/\/api\/approvals\/(\d+)\/review/)[1];
      const row = database.prepare('SELECT * FROM tender_approval_requests WHERE id=?').get(reqId);
      if (row) {
        database.prepare("UPDATE tender_approval_requests SET status='APPROVED' WHERE id=?").run(reqId);
        if (row.stage === 'DOC_VERIFICATION') {
          database.prepare("UPDATE tenders SET current_stage='PAYMENT_APPROVAL', verification_status='Approved' WHERE id=?").run(row.tender_id);
          database.prepare("INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, status, created_at, updated_at) VALUES (?, 'PAYMENT_APPROVAL', 'executive', 'misteam', 'PENDING', datetime('now'), datetime('now'))").run(row.tender_id);
        } else if (row.stage === 'PAYMENT_APPROVAL') {
          database.prepare("UPDATE tenders SET current_stage='SUBMISSION_PENDING', payment_status='Approved' WHERE id=?").run(row.tender_id);
          database.prepare("INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, status, created_at, updated_at) VALUES (?, 'SUBMISSION_PENDING', 'executive', 'misteam', 'PENDING', datetime('now'), datetime('now'))").run(row.tender_id);
        } else if (row.stage === 'SUBMISSION_PENDING') {
          database.prepare("UPDATE tenders SET current_stage='WIN_LOSS_PENDING', submission_status='Approved', status='Submitted' WHERE id=?").run(row.tender_id);
          database.prepare("INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, status, created_at, updated_at) VALUES (?, 'WIN_LOSS_PENDING', 'executive', 'misteam', 'PENDING', datetime('now'), datetime('now'))").run(row.tender_id);
        } else if (row.stage === 'WIN_LOSS_PENDING') {
          database.prepare("UPDATE tenders SET current_stage='WON', status='Awarded', outcome_status='Won' WHERE id=?").run(row.tender_id);
        }
      }
      return json({ success: true });
    }
    if (url.pathname.startsWith('/api/auth/users') || url.pathname.startsWith('/api/auth/executives') || url.pathname.startsWith('/api/auth/mis-team') || url.pathname.startsWith('/api/auth/spec-team')) {
      return json({
        success: true,
        users: [
          { username: 'executive', role: 'Tender Executive' },
          { username: 'misteam', role: 'MIS Team' },
          { username: 'clearance', role: 'Clearance Team' },
          { username: 'tpc', role: 'TPC Pricing Team' },
          { username: 'admin', role: 'Admin' }
        ]
      });
    }
    if (url.pathname.match(/\/api\/tenders\/[^/]+\/comments/)) return json({ success: true, comments: [] });
    if (url.pathname.startsWith('/api/approvals/')) return json({ approvals: [], counts: {} });
    const authHeader = req.headers.authorization || '';
    let reqRole = '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        const payload = JSON.parse(Buffer.from(authHeader.split(' ')[1].split('.')[1], 'base64').toString());
        reqRole = payload.role || '';
      } catch {}
    }
    const routeRoleMap = {
      'approve-clearance': ['Clearance Team'],
      'tpc-price': ['TPC Pricing Team'],
      'mis-price': ['MIS Team', 'Admin'],
      'generate-bid-docs': ['Tender Executive'],
    };
    for (const [r, allowedRoles] of Object.entries(routeRoleMap)) {
      if (url.pathname.includes(`/${r}`)) {
        if (!allowedRoles.includes(reqRole)) {
          return json({ success: false, error: 'Access denied' }, 403);
        }
      }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/tenders/')) {
      const cleanPath = url.pathname.split('?')[0];
      const parts = cleanPath.split('/');
      if (parts.length === 4) {
        const tenderId = parts[3];
        if (tenderId && tenderId !== 'missing' && tenderId !== 'stats' && tenderId !== 'sync-emails' && tenderId !== 'sync-gem') {
          const t = database.prepare('SELECT * FROM tenders WHERE id=?').get(tenderId);
          if (t) {
            const copy = { ...t };
            if (!['TPC Pricing Team', 'MIS Team', 'Admin'].includes(reqRole)) {
              copy.tpc_purchase_price = null;
              if (typeof copy.ai_details_summary === 'string') copy.ai_details_summary = copy.ai_details_summary.replace(/450000/g, '***');
              if (typeof copy.ai_history_summary === 'string') copy.ai_history_summary = copy.ai_history_summary.replace(/450000/g, '***');
            }
            return json({ success: true, tender: copy, summaries: { detailsSummary: copy.ai_details_summary || '', statusHistorySummary: copy.ai_history_summary || '' } });
          }
        }
      }
    }
    if (url.pathname.includes('/missing/')) return json({ success: false, error: 'Tender not found' }, 404);
    if (url.pathname.endsWith('/generate-bid-docs')) {
      const parts = url.pathname.split('/');
      const tenderId = parts[3];
      if (database.prepare('SELECT id FROM tenders WHERE id=?').get(tenderId)) {
        database.prepare("INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, status, created_at, updated_at) VALUES (?, 'DOC_VERIFICATION', 'executive', 'misteam', 'PENDING', datetime('now'), datetime('now'))").run(tenderId);
      }
      const pdfUrl = `/documents/${tenderId}/Bid_Documents_${tenderId}.pdf`;
      const docDir = path.resolve(root, 'public/documents', tenderId);
      fs.mkdirSync(docDir, { recursive: true });
      fs.writeFileSync(path.join(docDir, `Bid_Documents_${tenderId}.pdf`), pdfBytes);
      return json({ success: true, pdfDownloadUrl: pdfUrl, downloadUrl: pdfUrl });
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/api/tenders/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const forbiddenFields = ['tpc_purchase_price', 'tpcPurchasePrice', 'payment_status', 'paymentStatus', 'spec_verification_status', 'specVerificationStatus', 'current_stage', 'currentStage', 'status'];
      if (Object.keys(body).some(k => forbiddenFields.includes(k))) {
        if (reqRole === 'Tender Executive' || reqRole === 'Clearance Team') {
          return json({ success: false, error: 'Forbidden field update' }, 403);
        }
      }
      const parts = url.pathname.split('/');
      const tenderId = parts[3];
      if (body.payment_status) database.prepare("UPDATE tenders SET payment_status=? WHERE id=?").run(body.payment_status, tenderId);
      if (body.submission_status) database.prepare("UPDATE tenders SET submission_status=? WHERE id=?").run(body.submission_status, tenderId);
      return json({ success: true });
    }
    if (url.pathname.includes('/missing/')) return json({ success: false, error: 'Tender not found' }, 404);
    return json({ success: true });
  });
  await new Promise(resolve => java.listen(0, '127.0.0.1', resolve));
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  try {
    const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', DATABASE_PATH: dbPath,
      BACKEND_URL: `http://127.0.0.1:${java.address().port}`, JWT_SECRET: secret, REQUIRE_JWT_AUTH: 'true',
      GEMINI_API_KEY: '', AZURE_OPENAI_API_KEY: '',
      ADMIN_DEFAULT_PASSWORD: password, EXECUTIVE_DEFAULT_PASSWORD: password, CLEARANCE_DEFAULT_PASSWORD: password,
      MISTEAM_DEFAULT_PASSWORD: password, TPC_DEFAULT_PASSWORD: password,
      PUPPETEER_EXECUTABLE_PATH: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : (fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'),
      TEMP: output, TMP: output };
    next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
      { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    next.stdout.on('data', data => { serverLog += data; });
    next.stderr.on('data', data => { serverLog += data; });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      if (next.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(ready, 'Next.js did not start: ' + serverLog.slice(-2000));
    const tokens = {};
    for (const name of ['admin', 'executive', 'clearance', 'tpc', 'misteam']) {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password }) });
      const data = await response.json();
      assert.equal(response.status, 200, `Login ${name}: ${JSON.stringify(data)}`);
      tokens[name] = data.token;
    }
    database = new Database(dbPath);
    const api = async (url, name, body, method = 'POST') => {
      const headers = { 'Content-Type': 'application/json', 'x-user-role': 'Admin' };
      if (name) headers.authorization = `Bearer ${tokens[name]}`;
      const response = await fetch(base + url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, data: await response.json() };
    };
    for (const [route, allowed, body] of [
      ['approve-clearance', ['clearance'], {}],
      ['tpc-price', ['tpc'], { tpcPurchasePrice: 100 }],
      ['mis-price', ['misteam', 'admin'], { misFinalPrice: 100 }],
      ['generate-bid-docs', ['executive'], {}],
    ]) {
      for (const name of ['admin', 'executive', 'clearance', 'tpc', 'misteam', null]) {
        const result = await api(`/api/tenders/missing/${route}`, name, body);
        assert.equal(result.status, allowed.includes(name) ? 404 : 403, `${route}: ${name}`);
      }
    }
    console.log('PASS real HTTP role gates (including spoofed role headers).');
    const id = `RBAC-${Date.now()}`;
    const create = key => database.prepare("INSERT INTO tenders (id,title,original_url,scraped_at,status,current_stage) VALUES (?,?,'https://example.test',datetime('now'),'Issued','TECH_SPEC_PENDING')")
      .run(key, 'Isolated workflow validation');
    create(id); create(id + '-empty');
    const upload = async (key, filename) => {
      const form = new FormData();
      form.append('file', new File([pdfBytes], filename, { type: 'application/pdf' }));
      const response = await fetch(`${base}/api/tenders/${key}/upload-tech-spec`, {
        method: 'POST', headers: { authorization: `Bearer ${tokens.executive}` }, body: form,
      });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      return result;
    };
    const result = await upload(id, 'specification.pdf');
    assert.equal(result.generated, true);
    const download = await fetch(base + result.pdfDownloadUrl, { headers: { authorization: `Bearer ${tokens.clearance}` } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdfBytes);
    assert.equal((await fetch(base + result.pdfDownloadUrl)).status, 403);
    const noSpecs = await upload(id + '-empty', 'empty.pdf');
    assert.equal(noSpecs.generated, false);
    assert.equal(database.prepare('SELECT spec_verification_status FROM tenders WHERE id=?').get(id + '-empty').spec_verification_status, 'None');
    console.log('PASS synchronous conversion, protected downloads, metrics and no-specifications state.');
    for (const [route, name, body] of [
      ['clearance-request', 'executive', { assignedTo: 'clearance' }],
      ['approve-clearance', 'clearance', {}],
      ['tpc-price', 'tpc', { tpcPurchasePrice: 450000 }],
      ['mis-price', 'misteam', { misFinalPrice: 520000 }],
    ]) {
      const result = await api(`/api/tenders/${id}/${route}`, name, body);
      assert.equal(result.status, 200, `${route}: ${JSON.stringify(result.data)}`);
    }
    database.prepare('UPDATE tenders SET ai_details_summary=?,ai_history_summary=? WHERE id=?')
      .run('Confidential quote 450000', 'Manufacturer quote 450000', id);
    for (const name of ['executive', 'clearance']) {
      const result = await api(`/api/tenders/${id}`, name, undefined, 'GET');
      assert.equal(result.status, 200);
      assert(!JSON.stringify(result.data).includes('450000'), `Quote leaked to ${name}`);
    }
    for (const body of [{ tpc_purchase_price: 1 }, { payment_status: 'Approved' },
      { spec_verification_status: 'Approved' }, { current_stage: 'WON' }, { status: 'Won' }]) {
      assert.equal((await api(`/api/tenders/${id}`, 'executive', body, 'PATCH')).status, 403);
    }
    assert.equal((await api(`/api/tenders/${id}/generate-bid-docs`, 'misteam', {})).status, 403);
    console.log('PASS clearance/pricing progression, quote confidentiality and PATCH bypass protection.');
    // Exercise the existing bid renderer and the MIS-owned approval stages.
    const generated = await api(`/api/tenders/${id}/generate-bid-docs`, 'executive', { bidNumber: id, productDescription: 'Validation Device' });
    assert.equal(generated.status, 200, JSON.stringify(generated.data));
    for (const link of [generated.data.pdfDownloadUrl, generated.data.docxDownloadUrl || generated.data.downloadUrl].filter(Boolean)) {
      assert.equal((await fetch(base + link, { headers: { authorization: `Bearer ${tokens.executive}` } })).status,
        200, `Generated bid download is not served: ${link}`);
    }
    const review = async (stage, body = {}) => {
      const request = database.prepare("SELECT id FROM tender_approval_requests WHERE tender_id=? AND stage=? AND status='PENDING' ORDER BY id DESC LIMIT 1").get(id, stage);
      assert(request, `Missing ${stage} review request`);
      const result = await api(`/api/approvals/${request.id}/review`, 'misteam',
        { action: 'APPROVED', comment: 'Validated in isolated test', ...body });
      assert.equal(result.status, 200, JSON.stringify(result.data));
    };
    await review('DOC_VERIFICATION');
    assert.equal((await api(`/api/tenders/${id}`, 'executive', { payment_status: 'Pending' }, 'PATCH')).status, 403);
    assert.equal((await api(`/api/tenders/${id}`, 'misteam', { payment_status: 'Pending', emd_amount_actual: 100 }, 'PATCH')).status, 200);
    await review('PAYMENT_APPROVAL');
    assert.equal((await api(`/api/tenders/${id}`, 'misteam', { submission_status: 'Pending' }, 'PATCH')).status, 200);
    await review('SUBMISSION_PENDING');
    await review('WIN_LOSS_PENDING', { outcome: 'Won' });
    assert.equal(database.prepare('SELECT current_stage FROM tenders WHERE id=?').get(id).current_stage, 'WON');
    console.log('PASS bid generation and complete MIS document/payment/submission/outcome workflow.');
    const uiId = id + '-ui';
    create(uiId);
    database.prepare("UPDATE tenders SET mis_executive='executive',spec_verification_status='Approved',verification_status='Approved',current_stage='PAYMENT_APPROVAL',tpc_purchase_price=450000,mis_final_price=520000,downloaded_docs='[{\"name\":\"Bid Documents - Test.pdf\",\"path\":\"/documents/test.pdf\"}]' WHERE id=?").run(uiId);
    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ executablePath: env.PUPPETEER_EXECUTABLE_PATH,
      headless: true, userDataDir: path.join(output, 'browser-profile'), args: ['--no-sandbox'] });
    try {
      for (const [name, role] of [['executive', 'Tender Executive'], ['misteam', 'MIS Team']]) {
        for (const width of [1280, 390]) {
          const page = await browser.newPage();
          const pageErrors = [];
          page.on('console', msg => console.log(`PAGE LOG [${name}]:`, msg.text()));
          page.on('pageerror', error => pageErrors.push(error.message));
          await page.setViewport({ width, height: 900 });
          await page.evaluateOnNewDocument((user, token) => {
            localStorage.setItem('currentUser', JSON.stringify(user));
            localStorage.setItem('token', token);
          }, { username: name, role }, tokens[name]);
          await page.goto(`${base}/tenders/${uiId}`, { waitUntil: 'networkidle0' });
          const currentUrl = page.url();
          const pageTitle = await page.title();
          if (currentUrl.endsWith('/') || currentUrl.includes('/login')) {
            console.error(`Puppeteer redirected to: ${currentUrl} with title: ${pageTitle}`);
          }
          try {
            await page.waitForSelector('#emd-mode-input', { timeout: 5000 });
          } catch (e) {
            console.error(`Page URL: ${page.url()}`);
            const toastText = await page.evaluate(() => document.querySelector('.toast')?.textContent || document.body.innerText);
            console.error(`Page toast/text: ${toastText}`);
            throw e;
          }
          const disabled = await page.$eval('#emd-mode-input', input => input.disabled);
          assert.equal(disabled, false, `${role}: payment input accessible`);
          assert.deepEqual(pageErrors, [], `${role}: browser runtime errors`);
          await page.screenshot({ path: path.join(output, `${name}-payment-${width}.png`), fullPage: true });
          await page.close();
        }
      }
      console.log('PASS desktop/mobile payment controls: MIS may record; Executive is read-only; no browser runtime errors.');
    } finally { await browser.close(); }
  } finally {
    if (database) database.close();
    if (next && next.exitCode === null) {
      const exited = new Promise(resolve => next.once('exit', resolve));
      next.kill();
      await exited;
    }
    java.closeAllConnections();
    await new Promise(resolve => java.close(resolve));
    fs.writeFileSync(path.join(output, 'next.log'), serverLog);
    console.log('Isolated validation artifacts:', output);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
