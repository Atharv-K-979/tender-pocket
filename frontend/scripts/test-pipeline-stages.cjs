const { resolveTenderStageDetails } = require('../src/lib/tenderStatus.ts');
const assert = require('assert');

const testCases = [
  { name: '1. New Assignment', t: { status: 'New' }, expectedKey: 'NEW_UNREVIEWED', expectedIdx: 0 },
  { name: '2. Participating (Specs Needed)', t: { status: 'Participating' }, expectedKey: 'SPEC_NOT_STARTED', expectedIdx: 0 },
  { name: '3. Spec Clearance Pending', t: { status: 'Participating', spec_verification_status: 'Pending' }, expectedKey: 'SPEC_CLEARANCE_PENDING', expectedIdx: 0 },
  { name: '4. TPC Pricing (Specs Approved)', t: { status: 'Participating', spec_verification_status: 'Approved' }, expectedKey: 'TPC_PRICING', expectedIdx: 1 },
  { name: '5. MIS Pricing (TPC Price Set)', t: { status: 'Participating', spec_verification_status: 'Approved', tpc_purchase_price: 50000 }, expectedKey: 'MIS_PRICING', expectedIdx: 2 },
  { name: '6. Docs Prep (MIS Price Set)', t: { status: 'Participating', spec_verification_status: 'Approved', tpc_purchase_price: 50000, mis_final_price: 60000 }, expectedKey: 'DOCS_PREP', expectedIdx: 3 },
  { name: '7. Doc Verification (Docs Generated)', t: { status: 'Participating', spec_verification_status: 'Approved', tpc_purchase_price: 50000, mis_final_price: 60000, downloaded_docs: '[{"name":"Generated Bid Documents (Word DOCX)","filename":"Bid_Documents_1.docx"}]', verification_status: 'Pending' }, expectedKey: 'DOC_VERIFICATION', expectedIdx: 4 },
  { name: '8. EMD Payment Prep (Docs Approved)', t: { status: 'Participating', spec_verification_status: 'Approved', tpc_purchase_price: 50000, mis_final_price: 60000, downloaded_docs: '[{"filename":"Bid_Documents_1.docx"}]', verification_status: 'Approved' }, expectedKey: 'EMD_REQ_READY', expectedIdx: 5 },
  { name: '9. EMD Payment Approval Pending', t: { status: 'Participating', spec_verification_status: 'Approved', tpc_purchase_price: 50000, mis_final_price: 60000, downloaded_docs: '[{"filename":"Bid_Documents_1.docx"}]', verification_status: 'Approved', payment_status: 'Pending' }, expectedKey: 'EMD_PENDING', expectedIdx: 5 },
  { name: '10. Ready to File on Portal (EMD Approved)', t: { status: 'Participating', spec_verification_status: 'Approved', tpc_purchase_price: 50000, mis_final_price: 60000, downloaded_docs: '[{"filename":"Bid_Documents_1.docx"}]', verification_status: 'Approved', payment_status: 'Approved' }, expectedKey: 'READY_TO_SUBMIT', expectedIdx: 6 },
  { name: '11. Submission Audit Pending', t: { status: 'Participating', spec_verification_status: 'Approved', tpc_purchase_price: 50000, mis_final_price: 60000, downloaded_docs: '[{"filename":"Bid_Documents_1.docx"}]', verification_status: 'Approved', payment_status: 'Approved', submission_status: 'Pending' }, expectedKey: 'SUBMISSION_PENDING', expectedIdx: 6 },
  { name: '12. Submitted / Under Evaluation', t: { status: 'Submitted' }, expectedKey: 'SUBMITTED', expectedIdx: 7 },
  { name: '13. Tender Won', t: { status: 'Won' }, expectedKey: 'WON', expectedIdx: 7 },
  { name: '14. Tender Lost', t: { status: 'Lost' }, expectedKey: 'LOST', expectedIdx: 7 }
];

console.log('--- RUNNING PIPELINE VERIFICATION MATRIX ---');
let allPassed = true;
for (const tc of testCases) {
  const res = resolveTenderStageDetails(tc.t);
  try {
    assert.strictEqual(res.stageKey, tc.expectedKey, `${tc.name}: key mismatch (got ${res.stageKey}, expected ${tc.expectedKey})`);
    assert.strictEqual(res.currentStepIndex, tc.expectedIdx, `${tc.name}: step index mismatch (got ${res.currentStepIndex}, expected ${tc.expectedIdx})`);
    console.log(`✅ PASS: ${tc.name} -> ${res.stageKey} (Step ${res.currentStepIndex + 1}) [${res.shortStage}]`);
  } catch (err) {
    console.error(`❌ FAIL: ${err.message}`);
    allPassed = false;
  }
}

if (!allPassed) {
  process.exit(1);
} else {
  console.log('ALL 14 PIPELINE STAGE TRANSITIONS PASSED PERFECTLY!');
}
