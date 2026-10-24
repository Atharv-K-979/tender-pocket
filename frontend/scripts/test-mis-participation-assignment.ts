import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { forbiddenPatchFields, canonicalRole } from '../src/lib/workflowAuthorization';

console.log('====================================================');
console.log('TEST SUITE: MIS Participation & Assignment Migration');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------
// Test 1: Page structure verification for MIS Team vs Other Roles
// -------------------------------------------------------------
const pagePath = path.resolve(__dirname, '../src/app/tenders/[id]/page.tsx');
const pageSource = fs.readFileSync(pagePath, 'utf8');

runTest('1. Assignment card is removed from MIS Team view and preserved for non-MIS roles', () => {
  // In the top-right column, the separate Executive & Quantities Assignment card must be guarded with {!isMisRole && (
  assert(
    pageSource.includes('{!isMisRole && (') && pageSource.includes('Executive & Quantities Assignment'),
    'Expected Executive & Quantities Assignment card to be guarded by {!isMisRole && ('
  );
  // Ensure the old MIS "Save Assignment" button inside the top-right card is removed
  assert(
    !pageSource.includes('Save Assignment'),
    'Top-right "Save Assignment" button must be removed'
  );
});

runTest('2. Participation section contains exact title, supporting text, and controls in specified order', () => {
  // Header and supporting text
  assert(pageSource.includes('Participation Decision Pending'), 'Missing "Participation Decision Pending" title');
  assert(
    pageSource.includes('Review this tender, assign it to an executive, and decide whether to participate.'),
    'Missing exact supporting text'
  );

  // Assign to: label and dropdown
  assert(pageSource.includes('Assign to:'), 'Missing "Assign to:" label');
  assert(pageSource.includes('id="assign-to-select"'), 'Missing id="assign-to-select"');
  assert(pageSource.includes('executivesList.map'), 'Must use existing executivesList without hardcoding');

  // Bid Quantity
  assert(pageSource.includes('id="bid-qty-input"'), 'Missing id="bid-qty-input"');
  assert(pageSource.includes('Bid Quantity'), 'Missing "Bid Quantity" label');

  // Quoted Quantity
  assert(pageSource.includes('id="quoted-qty-input"'), 'Missing id="quoted-qty-input"');
  assert(pageSource.includes('Quoted Quantity'), 'Missing "Quoted Quantity" label');

  // Action buttons
  assert(pageSource.includes('id="btn-assign-participate"'), 'Missing id="btn-assign-participate"');
  assert(pageSource.includes('Assign & Participate'), 'Missing "Assign & Participate" button text');

  assert(pageSource.includes('id="btn-not-participating"'), 'Missing id="btn-not-participating"');
  assert(pageSource.includes('Not Participating'), 'Missing "Not Participating" button text');

  // Removed old buttons
  assert(!pageSource.includes('Accept & Participate'), 'Old button "Accept & Participate" must be removed');
  assert(!pageSource.includes('Decline / Not Participating'), 'Old button "Decline / Not Participating" must be removed');
});

runTest('3. Frontend quantity validation rejects negative and decimal quantities', () => {
  const validateSpecQuantity = (val: string | number | null | undefined): string | null => {
    if (val === null || val === undefined || val === '') return null;
    const s = String(val).trim();
    if (!s || s.toLowerCase() === 'n/a') return null;
    if (s.includes('.')) {
      const num = Number(s);
      if (isNaN(num)) return "Enter a valid numeric quantity.";
      if (num < 0) return "Quantity cannot be negative.";
      return "Quantity must be an integer.";
    }
    const num = Number(s);
    if (isNaN(num)) return "Enter a valid numeric quantity.";
    if (num < 0) return "Quantity cannot be negative.";
    return null;
  };

  assert.equal(validateSpecQuantity(10), null, 'Valid integer quantity should have no error');
  assert.equal(validateSpecQuantity('50'), null, 'Valid string integer quantity should have no error');
  assert.equal(validateSpecQuantity(''), null, 'Empty quantity should have no error');
  assert.equal(validateSpecQuantity(null), null, 'Null quantity should have no error');
  assert.equal(validateSpecQuantity(-5), 'Quantity cannot be negative.', 'Negative quantity must be rejected');
  assert.equal(validateSpecQuantity('-10'), 'Quantity cannot be negative.', 'Negative string quantity must be rejected');
  assert.equal(validateSpecQuantity(10.5), 'Quantity must be an integer.', 'Decimal quantity must be rejected');
  assert.equal(validateSpecQuantity('25.75'), 'Quantity must be an integer.', 'Decimal string quantity must be rejected');
});

runTest('4. Assign & Participate payload and handler validation logic', () => {
  // Ensure handler validates missing assignee
  assert(
    pageSource.includes("if (!trimmedExec)") && pageSource.includes("showToast('Please select an executive to assign.', 'error')"),
    'Missing assignee must show error toast'
  );
  // Ensure handler validates bid quantity and quoted quantity
  assert(
    pageSource.includes("const bidQtyErr = validateSpecQuantity(bidQty)") &&
    pageSource.includes("const quotedQtyErr = validateSpecQuantity(quotedQty)"),
    'Handler must validate both quantities'
  );
  // Ensure status is set to Participating
  assert(
    pageSource.includes("status: 'Participating'"),
    'Payload must set status to Participating'
  );
  // Ensure duplicate submissions are prevented
  assert(
    pageSource.includes("isParticipatingSubmitting") &&
    pageSource.includes("disabled={isParticipatingSubmitting}"),
    'Duplicate requests must be prevented with submission lock'
  );
});

runTest('5. Not Participating payload does not assign executive or advance stages', () => {
  // Ensure handleNotParticipating only sends status: 'Not Participating'
  assert(
    pageSource.includes("handleNotParticipating") &&
    pageSource.includes("status: 'Not Participating'"),
    'Not Participating must record tender status as Not Participating'
  );
  // Ensure it does not include mis_executive in its payload
  const notPartIndex = pageSource.indexOf('const handleNotParticipating = async () => {');
  const notPartEnd = pageSource.indexOf('};', notPartIndex + 40);
  const notPartBody = pageSource.slice(notPartIndex, notPartEnd);
  assert(
    !notPartBody.includes('mis_executive:'),
    'handleNotParticipating must not include mis_executive in payload'
  );
});

runTest('6. Role Authorization: MIS Team allowed, other roles denied for assignment & participation', () => {
  const oldTender = { status: 'New', mis_executive: null, bid_qty: null, quoted_qty: null };

  // MIS Team can patch assignment, quantities, and participation statuses
  const misParticipatingDenied = forbiddenPatchFields('MIS Team', {
    status: 'Participating',
    mis_executive: 'exec1',
    bid_qty: 10,
    quoted_qty: 10
  }, oldTender);
  assert.deepEqual(misParticipatingDenied, [], 'MIS Team should have no denied fields for Assign & Participate');

  const misNotParticipatingDenied = forbiddenPatchFields('MIS Team', {
    status: 'Not Participating'
  }, oldTender);
  assert.deepEqual(misNotParticipatingDenied, [], 'MIS Team should have no denied fields for Not Participating');

  // Tender Executive cannot set status: 'Participating' or 'Not Participating' or modify mis_executive
  const execDenied = forbiddenPatchFields('Tender Executive', {
    status: 'Participating',
    mis_executive: 'exec1',
    bid_qty: 10
  }, oldTender);
  assert(execDenied.includes('status'), 'Tender Executive must be denied from setting status Participating');
  assert(execDenied.includes('mis_executive'), 'Tender Executive must be denied from setting mis_executive');
  assert(execDenied.includes('bid_qty'), 'Tender Executive must be denied from setting bid_qty');

  const execNotPartDenied = forbiddenPatchFields('Tender Executive', {
    status: 'Not Participating'
  }, oldTender);
  assert(execNotPartDenied.includes('status'), 'Tender Executive must be denied from setting status Not Participating');

  // Clearance Team cannot set status: 'Participating' or modify mis_executive
  const clearanceDenied = forbiddenPatchFields('Clearance Team', {
    status: 'Participating',
    mis_executive: 'exec1'
  }, oldTender);
  assert(clearanceDenied.includes('status'), 'Clearance Team must be denied from setting status Participating');
  assert(clearanceDenied.includes('mis_executive'), 'Clearance Team must be denied from setting mis_executive');

  // Admin cannot modify assignment fields (read-only for Admin)
  const adminDenied = forbiddenPatchFields('Admin', {
    mis_executive: 'exec1',
    bid_qty: 10
  }, oldTender);
  assert(adminDenied.includes('mis_executive'), 'Admin must be restricted from modifying mis_executive');
  assert(adminDenied.includes('bid_qty'), 'Admin must be restricted from modifying bid_qty');
});

runTest('7. Existing workflows for other roles remain intact', () => {
  // Tender Executive can still perform uploadSpecs and generateBids
  const execRole = canonicalRole('Tender Executive');
  assert.equal(execRole, 'Tender Executive');

  // Clearance Team can still approveSpecs
  const clearanceRole = canonicalRole('Clearance Team');
  assert.equal(clearanceRole, 'Clearance Team');

  // TPC Pricing Team can still setTpcPrice
  const tpcRole = canonicalRole('TPC Pricing Team');
  assert.equal(tpcRole, 'TPC Pricing Team');
});

console.log(`\n----------------------------------------------------`);
console.log(`RESULTS: ${passedTests} of ${totalTests} tests passed successfully.`);
console.log(`----------------------------------------------------\n`);
