const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, '..', 'tenders.db');
const db = new Database(dbPath);

console.log('=== SEEDING WORKFLOW VERIFICATION TEST DATA ===');

// 1. Update SQLite tenders table with complete workflow statuses
console.log('1. Updating SQLite tenders table...');

// 1.1 Tender 9816988: Pending Technical Specification Clearance
db.prepare(`
  UPDATE tenders 
  SET status = 'Participating',
      spec_verification_status = 'Pending',
      payment_status = 'None',
      verification_status = 'None',
      submission_status = 'None',
      mis_executive = 'executive',
      assigned_mis_member_spec = 'clearance',
      assigned_mis_member = 'misteam',
      estimated_cost = 150000,
      emd = 7500
  WHERE id = '9816988'
`).run();

// 1.2 Tender 9849390: Spec Approved -> Pending TPC Manufacturer Purchase Price
db.prepare(`
  UPDATE tenders 
  SET status = 'Participating',
      spec_verification_status = 'Approved',
      tpc_purchase_price = NULL,
      mis_final_price = NULL,
      payment_status = 'None',
      verification_status = 'None',
      submission_status = 'None',
      mis_executive = 'executive',
      assigned_mis_member_spec = 'clearance',
      assigned_mis_member = 'misteam',
      estimated_cost = 450000,
      emd = 22500
  WHERE id = '9849390'
`).run();

// 1.3 Tender 9712000: Spec & TPC Approved -> Pending EMD Payment Verification
db.prepare(`
  UPDATE tenders 
  SET status = 'Participating',
      spec_verification_status = 'Approved',
      tpc_purchase_price = 14500,
      mis_final_price = 18000,
      payment_status = 'Pending',
      emd_amount_actual = 16000,
      emd_payment_mode = 'Online / NEFT',
      emd_payment_ref = 'TXN-MKN-9712000-NEFT',
      emd_payment_date = '2026-03-10',
      assigned_mis_member_emd = 'misteam',
      assigned_mis_member = 'misteam',
      verification_status = 'None',
      submission_status = 'None',
      mis_executive = 'executive',
      estimated_cost = 320000,
      emd = 16000
  WHERE id = '9712000'
`).run();

// 1.4 Tender 8715358: EMD Payment Approved -> Pending Document Verification
db.prepare(`
  UPDATE tenders 
  SET status = 'Participating',
      spec_verification_status = 'Approved',
      tpc_purchase_price = 420000,
      mis_final_price = 490000,
      payment_status = 'Approved',
      emd_amount_actual = 44500,
      emd_payment_mode = 'Demand Draft (DD)',
      emd_payment_ref = 'DD-8715358-SBI',
      emd_payment_date = '2026-03-08',
      verification_status = 'Pending',
      working_path = '/Shared/Tenders/2026/GEM-8715358',
      assigned_mis_member_docs = 'misteam',
      assigned_mis_member = 'misteam',
      submission_status = 'None',
      mis_executive = 'executive',
      estimated_cost = 890000,
      emd = 44500
  WHERE id = '8715358'
`).run();

// 1.5 Tender 9808508: Docs Approved -> Pending Submission Verification
db.prepare(`
  UPDATE tenders 
  SET status = 'Participating',
      spec_verification_status = 'Approved',
      tpc_purchase_price = 95000,
      mis_final_price = 115000,
      payment_status = 'Approved',
      emd_amount_actual = 10500,
      emd_payment_mode = 'Online / NEFT',
      emd_payment_ref = 'TXN-9808508-HDFC',
      emd_payment_date = '2026-03-09',
      verification_status = 'Approved',
      working_path = '/Shared/Tenders/2026/GEM-9808508',
      submission_status = 'Pending',
      assigned_mis_member_submission = 'misteam',
      assigned_mis_member = 'misteam',
      mis_executive = 'executive',
      estimated_cost = 210000,
      emd = 10500
  WHERE id = '9808508'
`).run();

// 1.6 Tender 9747177: Submitted / Filed -> Pending Outcome (Win/Loss) Review
db.prepare(`
  UPDATE tenders 
  SET status = 'Submitted',
      spec_verification_status = 'Approved',
      tpc_purchase_price = 68000,
      mis_final_price = 82000,
      payment_status = 'Approved',
      emd_amount_actual = 8000,
      emd_payment_mode = 'Online / NEFT',
      emd_payment_ref = 'TXN-9747177-SBIN',
      emd_payment_date = '2026-03-05',
      verification_status = 'Approved',
      working_path = '/Shared/Tenders/2026/GEM-9747177',
      submission_status = 'Approved',
      assigned_mis_member_submission = 'misteam',
      assigned_mis_member = 'misteam',
      assigned_by = 'misteam',
      mis_executive = 'executive',
      loss_reason = 'Competitor L1 bidder quoted 4.2% lower on item 2.',
      estimated_cost = 160000,
      emd = 8000
  WHERE id = '9747177'
`).run();

// 1.7 Tender 9811509: Fully Awarded / Won
db.prepare(`
  UPDATE tenders 
  SET status = 'Awarded',
      spec_verification_status = 'Approved',
      payment_status = 'Approved',
      verification_status = 'Approved',
      submission_status = 'Approved',
      mis_executive = 'executive',
      assigned_mis_member = 'misteam',
      estimated_cost = 500000,
      emd = 25000
  WHERE id = '9811509'
`).run();

// 1.8 Tender 9819345: Fully Not Awarded / Lost
db.prepare(`
  UPDATE tenders 
  SET status = 'Not Awarded',
      spec_verification_status = 'Approved',
      payment_status = 'Approved',
      verification_status = 'Approved',
      submission_status = 'Approved',
      mis_executive = 'executive',
      assigned_mis_member = 'misteam',
      loss_reason = 'Technical qualification passed, but lost in reverse auction round 2 to L1 bidder.',
      estimated_cost = 380000,
      emd = 19000
  WHERE id = '9819345'
`).run();

console.log('SQLite tenders table updated successfully.');

// 2. Clear and populate SQLite tender_approval_requests
console.log('2. Populating SQLite tender_approval_requests...');
db.prepare('DELETE FROM tender_approval_requests').run();

const insertApproval = db.prepare(`
  INSERT INTO tender_approval_requests (
    tender_id, stage, requested_by, assigned_to, status, working_path,
    emd_amount, transfer_mode, transfer_ref_no, receipt_file_url,
    loss_reason_executive, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`);

// 2.1 SPEC_CLEARANCE
insertApproval.run('9816988', 'SPEC_CLEARANCE', 'executive', 'clearance', '/documents/9816988/Technical_Specifications_Rev2.pdf', null, null, null, null, null);

// 2.2 TPC_PRICING
insertApproval.run('9849390', 'TPC_PRICING', 'clearance', 'tpc', '/documents/9849390/Cranial_PSI_Specs.pdf', null, null, null, null, null);

// 2.3 PAYMENT_APPROVAL
insertApproval.run('9712000', 'PAYMENT_APPROVAL', 'executive', 'team_1', null, 16000, 'Online / NEFT', 'TXN-MKN-9712000-NEFT', '/documents/9712000/neft_receipt.pdf', null);

// 2.4 DOC_VERIFICATION
insertApproval.run('8715358', 'DOC_VERIFICATION', 'executive', 'misteam', '/Shared/Tenders/2026/GEM-8715358', null, null, null, null, null);

// 2.5 SUBMISSION_PENDING
insertApproval.run('9808508', 'SUBMISSION_PENDING', 'executive', 'team_1', '/Shared/Tenders/2026/GEM-9808508', null, null, null, null, null);

// 2.6 WIN_LOSS_PENDING
insertApproval.run('9747177', 'WIN_LOSS_PENDING', 'executive', 'misteam', null, null, null, null, null, 'Competitor L1 bidder quoted 4.2% lower on item 2.');

console.log('SQLite tender_approval_requests populated successfully.');

// 3. Sync with Spring Boot
const backendUrl = process.env.BACKEND_URL || (process.env.SPRING_PORT ? `http://localhost:${process.env.SPRING_PORT}` : 'http://localhost:8090');
console.log(`3. Syncing with Spring Boot backend (${backendUrl})...`);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('Set JWT_SECRET (same value as the backend) before running this script.');
  process.exit(1);
}

function createToken(sub, role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS512' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub, role, iat: now, exp: now + 3600000 })).toString('base64url');
  const sig = crypto.createHmac('sha512', Buffer.from(JWT_SECRET, 'utf8')).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}

const execToken = createToken('executive', 'Tender Executive');
const clearanceToken = createToken('clearance', 'Clearance Team');
const tpcToken = createToken('tpc', 'TPC Team');
const adminToken = createToken('admin', 'Admin');

async function syncSpringBoot() {
  try {
    // 3.1 Spec Clearance for 9816988
    console.log(' - Submitting clearance request for 9816988...');
    await fetch(`${backendUrl}/api/tenders/9816988/clearance-request`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + execToken,
        'Content-Type': 'application/json',
        'x-user-role': 'Tender Executive',
        'x-user-username': 'executive'
      },
      body: JSON.stringify({ note: 'Technical specification submitted for clearance approval.' })
    });

    // 3.2 Approve clearance for 9849390 -> becomes TPC_PRICING
    console.log(' - Approving clearance for 9849390 (advances to TPC_PRICING)...');
    await fetch(`${backendUrl}/api/tenders/9849390/approve-clearance`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + clearanceToken,
        'Content-Type': 'application/json',
        'x-user-role': 'Clearance Team',
        'x-user-username': 'clearance'
      },
      body: JSON.stringify({ comment: 'Technical specification approved. Sent to TPC Team for purchase price.' })
    });

    // 3.3 Payment request for 9712000
    console.log(' - Submitting payment request for 9712000...');
    await fetch(`${backendUrl}/api/tenders/9712000/payment-request`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + execToken,
        'Content-Type': 'application/json',
        'x-user-role': 'Tender Executive',
        'x-user-username': 'executive'
      },
      body: JSON.stringify({
        assignedMisExecutive: 'team_1',
        emdAmount: 16000,
        transferMode: 'Online / NEFT',
        transferRefNo: 'TXN-MKN-9712000-NEFT',
        receiptFileUrl: '/documents/9712000/neft_receipt.pdf',
        comment: 'EMD ₹16,000 paid via NEFT. Verification required.'
      })
    });

    // 3.4 Doc Verification request for 8715358
    console.log(' - Submitting doc verification request for 8715358...');
    await fetch(`${backendUrl}/api/tenders/8715358/doc-verification-request`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + execToken,
        'Content-Type': 'application/json',
        'x-user-role': 'Tender Executive',
        'x-user-username': 'executive'
      },
      body: JSON.stringify({
        assignedMisExecutive: 'misteam',
        workingPath: '/Shared/Tenders/2026/GEM-8715358',
        comment: 'Compiled bid documents uploaded to share. Requesting review.'
      })
    });

    // 3.5 Submission request for 9808508
    console.log(' - Submitting submission request for 9808508...');
    await fetch(`${backendUrl}/api/tenders/9808508/submission-request`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + execToken,
        'Content-Type': 'application/json',
        'x-user-role': 'Tender Executive',
        'x-user-username': 'executive'
      },
      body: JSON.stringify({
        note: 'Uploaded bid pack to GeM portal. Confirmation receipt attached. Please verify.'
      })
    });

    // 3.6 Win/Loss request for 9747177
    console.log(' - Submitting win/loss outcome request for 9747177...');
    await fetch(`${backendUrl}/api/tenders/9747177/win-loss-request`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + execToken,
        'Content-Type': 'application/json',
        'x-user-role': 'Tender Executive',
        'x-user-username': 'executive'
      },
      body: JSON.stringify({
        status: 'Lost',
        lossReason: 'Competitor L1 bidder quoted 4.2% lower on item 2.'
      })
    });

    // Verify Spring Boot counts
    const res = await fetch(`${backendUrl}/api/approvals/counts`, {
      headers: { 'Authorization': 'Bearer ' + adminToken, 'Accept': 'application/json' }
    });
    const data = await res.json();
    console.log('Spring Boot Approval Counts:', JSON.stringify(data, null, 2));

  } catch (err) {
    console.warn('Warning: Could not sync all Spring Boot endpoints:', err.message);
  }
}

syncSpringBoot().then(() => {
  console.log('=== SEEDING COMPLETED SUCCESSFULLY ===');
});
