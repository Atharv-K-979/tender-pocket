const Database = require('better-sqlite3');
const path = require('path');

(async () => {
  try {
    const dbPath = path.join(__dirname, '..', 'tenders.db');
    const db = new Database(dbPath);

    const backendUrl = process.env.BACKEND_URL || (process.env.SPRING_PORT ? `http://localhost:${process.env.SPRING_PORT}` : 'http://localhost:8090');
    console.log(`Connecting to Spring Boot backend at ${backendUrl}...`);
    const adminPwd = process.env.ADMIN_PASSWORD || process.env.ADMIN_DEFAULT_PASSWORD || '';
    const loginRes = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: adminPwd })
    });
    const loginData = await loginRes.json();
    if (!loginData.success) {
      throw new Error('Login failed: ' + JSON.stringify(loginData));
    }

    console.log('Fetching tenders from PostgreSQL via Spring Boot...');
    const tendersRes = await fetch(`${backendUrl}/api/tenders`, {
      headers: { 'Authorization': 'Bearer ' + loginData.token }
    });
    const { tenders } = await tendersRes.json();
    console.log(`Fetched ${tenders.length} tenders from PostgreSQL.`);

    const insert = db.prepare(`
      INSERT OR REPLACE INTO tenders (
        id, ref_no, title, authority, estimated_cost, emd, location, sector,
        due_date, opening_date, document_url, original_url, status, notes,
        scraped_at, entry_date, mis_executive, source, source_id, publish_date,
        payment_status, verification_status, submission_status, outcome_status, spec_verification_status,
        tpc_purchase_price, mis_final_price, current_stage, working_path, downloaded_docs, loss_reason,
        assigned_mis_member, assigned_mis_member_spec, assigned_mis_member_docs, assigned_mis_member_emd, assigned_mis_member_submission,
        emd_amount_actual, emd_payment_mode, emd_payment_ref, emd_payment_date
      ) VALUES (
        @id, @refNo, @title, @authority, @estimatedCost, @emd, @location, @sector,
        @dueDate, @openingDate, @documentUrl, @originalUrl, @status, @notes,
        @scrapedAt, @entryDate, @misExecutive, @source, @sourceId, @publishDate,
        @paymentStatus, @verificationStatus, @submissionStatus, @outcomeStatus, @specVerificationStatus,
        @tpcPurchasePrice, @misFinalPrice, @currentStage, @workingPath, @downloadedDocs, @lossReason,
        @assignedMisMember, @assignedMisMemberSpec, @assignedMisMemberDocs, @assignedMisMemberEmd, @assignedMisMemberSubmission,
        @emdAmountActual, @emdPaymentMode, @emdPaymentRef, @emdPaymentDate
      )
    `);

    const insertMany = db.transaction((list) => {
      for (const t of list) {
        insert.run({
          id: t.id || '',
          refNo: t.refNo || t.ref_no || '',
          title: t.title || 'Untitled',
          authority: t.authority || '',
          estimatedCost: t.estimatedCost ?? t.estimated_cost ?? 0,
          emd: t.emd || 0,
          location: t.location || '',
          sector: t.sector || '',
          dueDate: t.dueDate || t.due_date || '',
          openingDate: t.openingDate || t.opening_date || '',
          documentUrl: t.documentUrl || t.document_url || '',
          originalUrl: t.originalUrl || t.original_url || '',
          status: t.status || 'Issued',
          notes: t.notes || '',
          scrapedAt: t.scrapedAt || t.scraped_at || new Date().toISOString(),
          entryDate: t.entryDate || t.entry_date || '',
          misExecutive: t.misExecutive || t.mis_executive || '',
          source: t.source || 'GeM',
          sourceId: t.sourceId || t.source_id || '',
          publishDate: t.publishDate || t.publish_date || '',
          paymentStatus: t.paymentStatus || t.payment_status || 'None',
          verificationStatus: t.verificationStatus || t.verification_status || 'None',
          submissionStatus: t.submissionStatus || t.submission_status || 'None',
          outcomeStatus: t.outcomeStatus || t.outcome_status || 'None',
          specVerificationStatus: t.specVerificationStatus || t.spec_verification_status || 'None',
          tpcPurchasePrice: t.tpcPurchasePrice ?? t.tpc_purchase_price ?? null,
          misFinalPrice: t.misFinalPrice ?? t.mis_final_price ?? null,
          currentStage: t.currentStage || t.current_stage || null,
          workingPath: t.workingPath || t.working_path || null,
          downloadedDocs: t.downloadedDocs || t.downloaded_docs || null,
          lossReason: t.lossReason || t.loss_reason || null,
          assignedMisMember: t.assignedMisMember || t.assigned_mis_member || null,
          assignedMisMemberSpec: t.assignedMisMemberSpec || t.assigned_mis_member_spec || null,
          assignedMisMemberDocs: t.assignedMisMemberDocs || t.assigned_mis_member_docs || null,
          assignedMisMemberEmd: t.assignedMisMemberEmd || t.assigned_mis_member_emd || null,
          assignedMisMemberSubmission: t.assignedMisMemberSubmission || t.assigned_mis_member_submission || null,
          emdAmountActual: t.emdAmountActual ?? t.emd_amount_actual ?? null,
          emdPaymentMode: t.emdPaymentMode || t.emd_payment_mode || null,
          emdPaymentRef: t.emdPaymentRef || t.emd_payment_ref || null,
          emdPaymentDate: t.emdPaymentDate || t.emd_payment_date || null
        });
      }
    });

    insertMany(tenders);
    const count = db.prepare('SELECT COUNT(*) as c FROM tenders').get();
    console.log(`SUCCESS! SQLite database now has ${count.c} tenders.`);
  } catch (err) {
    console.error('Sync failed:', err);
  }
})();
