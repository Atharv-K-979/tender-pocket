import { extractTenderLinks, parseMoneyValue, parseDateString } from '../src/lib/scraper';

function runTests() {
  console.log('--- Starting Parser Utility Tests ---');

  // Test 1: Link extraction
  console.log('\nTest 1: Link Extraction');
  const mockEmail = `
    Hello,
    Here are your daily tender alerts:
    1. Tender for road work: https://www.tender247.com/tender/detail?id=9876543
    2. Tender for software dev: http://tender247.com/tender/details/123456?source=alert
    3. ASPX format capitalized: https://tenders.tender247.com/TenderDetail.aspx?id=11111
    4. Domain and TLD variation: http://www.tender24by7.in/tender/details/22222
    Check out other links at https://google.com or contact support@tender247.com.
  `;
  const links = extractTenderLinks(mockEmail);
  console.log('Extracted links:', links);
  const expectedLinks = [
    'https://www.tender247.com/tender/detail?id=9876543',
    'http://tender247.com/tender/details/123456?source=alert',
    'https://tenders.tender247.com/TenderDetail.aspx?id=11111',
    'http://www.tender24by7.in/tender/details/22222'
  ];
  const linkPass = links.length === 4 && 
                   links[0] === expectedLinks[0] && 
                   links[1] === expectedLinks[1] &&
                   links[2] === expectedLinks[2] &&
                   links[3] === expectedLinks[3];
  console.log(linkPass ? '✅ PASS' : '❌ FAIL');

  // Test 2: Currency parsing
  console.log('\nTest 2: Currency/Money Parsing');
  const moneyTests = [
    { input: 'Rs. 5,00,000', expected: 500000 },
    { input: '5.5 Lakhs', expected: 550000 },
    { input: '2.1 Crore', expected: 21000000 },
    { input: '12,500', expected: 12500 },
    { input: 'Refer Document', expected: null },
    { input: 'N.A.', expected: null }
  ];
  
  let moneyPass = true;
  for (const t of moneyTests) {
    const res = parseMoneyValue(t.input);
    const pass = res === t.expected;
    console.log(`Input: "${t.input}" -> Parsed: ${res} (Expected: ${t.expected}) - ${pass ? '✅' : '❌'}`);
    if (!pass) moneyPass = false;
  }
  console.log(moneyPass ? '✅ PASS' : '❌ FAIL');

  // Test 3: Date parsing
  console.log('\nTest 3: Date Parsing');
  const dateTests = [
    { input: '24-May-2026', expected: '2026-05-24' },
    { input: '24/05/2026', expected: '2026-05-24' },
    { input: '2026-05-24 15:00:00', expected: '2026-05-24' },
    { input: 'Monday, 24-05-2026', expected: '2026-05-24' }
  ];

  let datePass = true;
  for (const t of dateTests) {
    const res = parseDateString(t.input);
    const pass = res === t.expected;
    console.log(`Input: "${t.input}" -> Parsed: ${res} (Expected: ${t.expected}) - ${pass ? '✅' : '❌'}`);
    if (!pass) datePass = false;
  }
  console.log(datePass ? '✅ PASS' : '❌ FAIL');

  if (linkPass && moneyPass && datePass) {
    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED.');
    process.exit(1);
  }
}

runTests();
