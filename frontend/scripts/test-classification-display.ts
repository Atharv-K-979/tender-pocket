import assert from 'node:assert';
import {
  getClassificationDisplay,
  getClassificationLabel,
  getSourceBadgeLabel,
  getSourcePortalLabel
} from '../src/lib/tenderClassification';

console.log('=================================================================');
console.log('  TEST SUITE: Tender Classification & Ingestion Source Display   ');
console.log('=================================================================\n');

let passed = 0;
let failed = 0;

function it(desc: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// 1. GeM classification tests
it("1. Displays 'GeM' as 'GeM' with green styling (#10b981)", () => {
  const display = getClassificationDisplay('GeM');
  assert.strictEqual(display.label, 'GeM');
  assert.strictEqual(display.color, '#10b981');
  assert.strictEqual(display.bgColor, 'rgba(16, 185, 129, 0.1)');
  assert.strictEqual(display.borderColor, 'rgba(16, 185, 129, 0.2)');
  assert.strictEqual(getClassificationLabel('GeM'), 'GeM');
});

it("2. Handles 'GeM Bid' and case-insensitive 'gem' as GeM", () => {
  const displayBid = getClassificationDisplay('GeM Bid');
  assert.strictEqual(displayBid.label, 'GeM');
  assert.strictEqual(displayBid.color, '#10b981');

  const displayLower = getClassificationDisplay('gem');
  assert.strictEqual(displayLower.label, 'GeM');
  assert.strictEqual(displayLower.color, '#10b981');
});

// 2. Non-GeM classification tests
it("3. Displays 'Non-GeM' as 'Non-GeM' with blue styling (#3b82f6)", () => {
  const display = getClassificationDisplay('Non-GeM');
  assert.strictEqual(display.label, 'Non-GeM');
  assert.strictEqual(display.color, '#3b82f6');
  assert.strictEqual(display.bgColor, 'rgba(59, 130, 246, 0.1)');
  assert.strictEqual(display.borderColor, 'rgba(59, 130, 246, 0.2)');
  assert.strictEqual(getClassificationLabel('Non-GeM'), 'Non-GeM');
});

it("4. Displays 'Non GeM' (space-separated) as 'Non-GeM' with blue styling", () => {
  const display = getClassificationDisplay('Non GeM');
  assert.strictEqual(display.label, 'Non-GeM');
  assert.strictEqual(display.color, '#3b82f6');
  assert.strictEqual(display.bgColor, 'rgba(59, 130, 246, 0.1)');
  assert.strictEqual(display.borderColor, 'rgba(59, 130, 246, 0.2)');
  assert.strictEqual(getClassificationLabel('Non GeM'), 'Non-GeM');
});

// 3. Unverified classification tests
it("5. Displays 'Unverified' as 'Non-GeM' with blue styling (#3b82f6)", () => {
  const display = getClassificationDisplay('Unverified');
  assert.strictEqual(display.label, 'Non-GeM');
  assert.strictEqual(display.color, '#3b82f6');
  assert.strictEqual(display.bgColor, 'rgba(59, 130, 246, 0.1)');
  assert.strictEqual(display.borderColor, 'rgba(59, 130, 246, 0.2)');
  assert.strictEqual(getClassificationLabel('Unverified'), 'Non-GeM');
});

it("6. Displays lowercase 'unverified' and uppercase 'UNVERIFIED' as 'Non-GeM'", () => {
  assert.strictEqual(getClassificationLabel('unverified'), 'Non-GeM');
  assert.strictEqual(getClassificationLabel('UNVERIFIED'), 'Non-GeM');
  assert.strictEqual(getClassificationDisplay('unverified').color, '#3b82f6');
});

it("7. Displays missing, null, or empty string tender_type as 'Non-GeM' with blue styling", () => {
  assert.strictEqual(getClassificationLabel(null), 'Non-GeM');
  assert.strictEqual(getClassificationLabel(undefined), 'Non-GeM');
  assert.strictEqual(getClassificationLabel(''), 'Non-GeM');
  assert.strictEqual(getClassificationDisplay(null).color, '#3b82f6');
});

// 4. Ingestion source badge tests
it("8. Ingestion source displays 'Tender247 Portal' for Tender247", () => {
  assert.strictEqual(getSourceBadgeLabel('Tender247'), 'Tender247 Portal');
  assert.strictEqual(getSourceBadgeLabel('Tender 247'), 'Tender247 Portal');
  assert.strictEqual(getSourcePortalLabel('Tender247'), 'Tender247 Portal');
});

it("9. Ingestion source displays 'GeM Portal' for GeM", () => {
  assert.strictEqual(getSourceBadgeLabel('GeM'), 'GeM Portal');
  assert.strictEqual(getSourcePortalLabel('GeM'), 'GeM Portal');
});

it("10. Ingestion source preserves custom source names and handles empty/null", () => {
  assert.strictEqual(getSourceBadgeLabel('CPPP'), 'CPPP');
  assert.strictEqual(getSourceBadgeLabel(null), '');
  assert.strictEqual(getSourcePortalLabel(null), 'Not Specified');
});

// 5. Internal state preservation tests
it("11. Preserves raw internal tender_type ('Unverified') without in-place mutation", () => {
  const rawTender = {
    id: 'T1001',
    title: 'Hospital Bed Supply',
    tender_type: 'Unverified',
    source: 'Tender247'
  };

  const display = getClassificationDisplay(rawTender.tender_type);
  const label = getClassificationLabel(rawTender.tender_type);
  const sourceLabel = getSourceBadgeLabel(rawTender.source);

  // User-facing display is mapped
  assert.strictEqual(label, 'Non-GeM');
  assert.strictEqual(display.color, '#3b82f6');
  assert.strictEqual(sourceLabel, 'Tender247 Portal');

  // Internal raw object remains untouched
  assert.strictEqual(rawTender.tender_type, 'Unverified');
  assert.strictEqual(rawTender.source, 'Tender247');
});

// 6. CSV Export mapping simulation
it("12. CSV Export formats Unverified tenders as Non-GeM while preserving raw tender object", () => {
  const tenders = [
    { id: '1', title: 'Tender 1', tender_type: 'GeM', source: 'GeM' },
    { id: '2', title: 'Tender 2', tender_type: 'Non GeM', source: 'Tender247' },
    { id: '3', title: 'Tender 3', tender_type: 'Unverified', source: 'Tender247' }
  ];

  const exportRows = tenders.map(t => ({
    id: t.id,
    classificationInCsv: getClassificationLabel(t.tender_type),
    sourceInCsv: t.source
  }));

  assert.strictEqual(exportRows[0].classificationInCsv, 'GeM');
  assert.strictEqual(exportRows[1].classificationInCsv, 'Non-GeM');
  assert.strictEqual(exportRows[2].classificationInCsv, 'Non-GeM');

  // Verify internal records were not mutated
  assert.strictEqual(tenders[0].tender_type, 'GeM');
  assert.strictEqual(tenders[1].tender_type, 'Non GeM');
  assert.strictEqual(tenders[2].tender_type, 'Unverified');
});

console.log('\n-----------------------------------------------------------------');
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log('-----------------------------------------------------------------\n');

if (failed > 0) {
  process.exit(1);
}
