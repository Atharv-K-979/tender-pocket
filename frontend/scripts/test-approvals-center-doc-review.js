/**
 * test-approvals-center-doc-review.js
 *
 * Validates that approving Bid Documents (DOC_VERIFICATION) from the Approvals Center
 * directly transitions the tender to PAYMENT_APPROVAL, marks verification_status as Approved,
 * updates the approval request to APPROVED, and unlocks EMD payment.
 */

const path = require('path');
const Database = require('../node_modules/better-sqlite3');
const db = new Database(path.join(__dirname, '../tenders.db'));

const BASE_URL = 'http://localhost:8085';

async function main() {
  console.log('=================================================================');
  console.log('  TESTING APPROVALS CENTER: BID DOCS (DOC_VERIFICATION) APPROVAL');
  console.log('=================================================================');

  // 1. Authenticate users
  const execLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'executive', password: process.env.EXECUTIVE_DEFAULT_PASSWORD || '' })
  });
  const execAuth = await execLoginRes.json();

  const misLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'misteam', password: process.env.MISTEAM_DEFAULT_PASSWORD || '' })
  });
  const misAuth = await misLoginRes.json();

  if (!execAuth.token || !misAuth.token) {
    throw new Error('Authentication failed for test users.');
  }

  // 2. Create a clean test tender ready for Bid Docs generation
  const tenderId = `test_ac_${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO tenders (
      id, ref_no, title, authority, status, current_stage,
      spec_verification_status, tpc_purchase_price, mis_final_price,
      verification_status, payment_status, submission_status, outcome_status,
      assigned_mis_member, mis_executive, scraped_at, original_url
    ) VALUES (
      ?, ?, 'Test Tender for Approvals Center Doc Verification', 'Defence Procurement', 'Participating', 'BID_DOC_PENDING',
      'Approved', 250000, 310000,
      'None', 'None', 'None', 'None',
      'misteam', 'executive', ?, 'https://bidplus.gem.gov.in/test'
    )
  `).run(tenderId, `GEM/TEST/${Date.now()}`, now);

  console.log(`[1] Created Test Tender ${tenderId} at stage BID_DOC_PENDING with spec approved and MIS price set.`);

  // 3. Generate Bid Documents as Tender Executive
  const genDocsRes = await fetch(`${BASE_URL}/api/tenders/${tenderId}/generate-bid-docs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${execAuth.token}`
    },
    body: JSON.stringify({
      makeModelOffered: 'Test Make Model',
      deliveryLocation: 'New Delhi HQ',
      warrantyYears: '3 Years Comprehensive'
    })
  });

  const genDocsData = await genDocsRes.json();
  if (!genDocsData.success) {
    throw new Error(`Failed to generate bid docs: ${genDocsData.error}`);
  }

  const tAfterGen = db.prepare('SELECT current_stage, verification_status FROM tenders WHERE id = ?').get(tenderId);
  console.log(`[2] Executive generated bid docs. Stage: ${tAfterGen.current_stage}, verification_status: ${tAfterGen.verification_status}`);
  if (tAfterGen.current_stage !== 'DOC_VERIFICATION' || tAfterGen.verification_status !== 'Pending') {
    throw new Error('Tender did not transition to DOC_VERIFICATION / Pending');
  }

  // 4. Verify pending approval request exists in Approvals Center
  const pendingReq = db.prepare(
    "SELECT id, tender_id, stage, status, assigned_to FROM tender_approval_requests WHERE tender_id = ? AND stage = 'DOC_VERIFICATION' AND status = 'PENDING'"
  ).get(tenderId);

  if (!pendingReq) {
    throw new Error('Pending approval request was not created for DOC_VERIFICATION');
  }
  console.log(`[3] Found pending approval request #${pendingReq.id} in Approvals Center queue assigned to: ${pendingReq.assigned_to}`);

  // 5. MIS Team approves from the Approvals Center (calling POST /api/approvals/[id]/review)
  console.log(`[4] MIS Team clicking "Confirm Approve" in Approvals Center on request #${pendingReq.id}...`);
  const reviewRes = await fetch(`${BASE_URL}/api/approvals/${pendingReq.id}/review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${misAuth.token}`
    },
    body: JSON.stringify({
      action: 'APPROVED',
      comment: 'Bid documents thoroughly verified and approved for EMD payment.',
      tenderId: tenderId,
      stage: 'DOC_VERIFICATION'
    })
  });

  const reviewData = await reviewRes.json();
  console.log(`[5] Approvals Center Review Response:`, reviewData);

  if (!reviewData.success) {
    throw new Error(`Approvals Center review failed: ${reviewData.error}`);
  }

  // 6. Verify Tender in SQLite after approval
  const tAfterApproval = db.prepare('SELECT current_stage, verification_status FROM tenders WHERE id = ?').get(tenderId);
  console.log(`[6] Tender state after Approvals Center review:`);
  console.log(`    - current_stage: ${tAfterApproval.current_stage}`);
  console.log(`    - verification_status: ${tAfterApproval.verification_status}`);

  if (tAfterApproval.verification_status !== 'Approved') {
    throw new Error(`FAILURE: verification_status is '${tAfterApproval.verification_status}', expected 'Approved'!`);
  }

  if (tAfterApproval.current_stage !== 'PAYMENT_APPROVAL') {
    throw new Error(`FAILURE: current_stage is '${tAfterApproval.current_stage}', expected 'PAYMENT_APPROVAL'!`);
  }

  // 7. Verify approval request in SQLite is marked APPROVED
  const reqAfterApproval = db.prepare('SELECT status FROM tender_approval_requests WHERE id = ?').get(pendingReq.id);
  if (reqAfterApproval.status !== 'APPROVED') {
    throw new Error(`FAILURE: Approval request #${pendingReq.id} status is '${reqAfterApproval.status}', expected 'APPROVED'!`);
  }
  console.log(`    - Approval request #${pendingReq.id} status: ${reqAfterApproval.status}`);

  // 8. Verify next pending approval request for PAYMENT_APPROVAL was automatically created
  const nextPaymentReq = db.prepare(
    "SELECT id, stage, status, assigned_to FROM tender_approval_requests WHERE tender_id = ? AND stage = 'PAYMENT_APPROVAL' AND status = 'PENDING'"
  ).get(tenderId);

  if (!nextPaymentReq) {
    throw new Error('FAILURE: Next pending approval request for PAYMENT_APPROVAL was not created!');
  }
  console.log(`[7] Next pending approval request #${nextPaymentReq.id} for PAYMENT_APPROVAL is ready in Approvals Center.`);

  // 9. Clean up test tender
  db.prepare('DELETE FROM tender_approval_requests WHERE tender_id = ?').run(tenderId);
  db.prepare('DELETE FROM tender_workflow_comments WHERE tender_id = ?').run(tenderId);
  db.prepare('DELETE FROM tenders WHERE id = ?').run(tenderId);

  console.log('=================================================================');
  console.log('  TEST PASSED: APPROVALS CENTER PROPERLY APPROVES BID DOCUMENTS!');
  console.log('=================================================================');
}

main().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
