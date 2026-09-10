const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'tenders.db');
const db = new Database(dbPath);

const mockTenders = [
  {
    id: 'MOCK_01_ISSUED',
    title: 'Mock Issued Active',
    publish_date: getOffsetDateString(0), // today
    due_date: getOffsetDateString(10),
    status: 'Issued'
  },
  {
    id: 'MOCK_02_LAPSED',
    title: 'Mock Lapsed Unreviewed',
    publish_date: getOffsetDateString(-5), // 5 days ago
    due_date: getOffsetDateString(10),
    status: 'Issued'
  },
  {
    id: 'MOCK_03_PARTICIPATING',
    title: 'Mock Participating Active',
    publish_date: getOffsetDateString(0),
    due_date: getOffsetDateString(2), // due in 2 days (T2-3)
    status: 'Participating'
  },
  {
    id: 'MOCK_04_LOSS_SUBMISSION',
    title: 'Mock Non-Submission Loss',
    publish_date: getOffsetDateString(-10),
    due_date: getOffsetDateString(-1), // past due date
    status: 'Issued'
  },
  {
    id: 'MOCK_05_LOSS_SUBMISSION_PART',
    title: 'Mock Non-Submission Loss (Part)',
    publish_date: getOffsetDateString(-10),
    due_date: getOffsetDateString(-2), // past due date
    status: 'Participating'
  },
  {
    id: 'MOCK_06_LOSS_PARTICIPATION',
    title: 'Mock Non-Participation Loss',
    publish_date: getOffsetDateString(-10),
    due_date: getOffsetDateString(-1), // past due date
    status: 'Not Participating'
  },
  {
    id: 'MOCK_07_FILED',
    title: 'Mock Filed Tender',
    publish_date: getOffsetDateString(-10),
    due_date: getOffsetDateString(-1),
    status: 'Filed'
  },
  {
    id: 'MOCK_08_AWARDED',
    title: 'Mock Awarded Tender',
    publish_date: getOffsetDateString(-10),
    due_date: getOffsetDateString(-1),
    status: 'Awarded'
  }
];

// Helper to get offset date in IST string (YYYY-MM-DD)
function getOffsetDateString(daysOffset) {
  const date = new Date();
  // Adjust for offset
  date.setDate(date.getDate() + daysOffset);
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-IN', options);
  const parts = formatter.formatToParts(date);
  const day = parts.find(p => p.type === 'day').value;
  const month = parts.find(p => p.type === 'month').value;
  const year = parts.find(p => p.type === 'year').value;
  return `${year}-${month}-${day}`;
}

async function runTest() {
  console.log("1. Cleaning up any previous mock tenders...");
  db.prepare("DELETE FROM tenders WHERE id LIKE 'MOCK_%'").run();

  console.log("2. Inserting mock test cases...");
  const stmt = db.prepare(`
    INSERT INTO tenders (id, title, publish_date, due_date, status, original_url, scraped_at)
    VALUES (?, ?, ?, ?, ?, 'https://example.com', datetime('now'))
  `);

  for (const t of mockTenders) {
    stmt.run(t.id, t.title, t.publish_date, t.due_date, t.status);
    console.log(`  - Inserted ${t.id} (${t.status}, Publish: ${t.publish_date}, Due: ${t.due_date})`);
  }

  console.log("\n3. Fetching analytics from API...");
  const analyticsRes = await fetch("http://localhost:3000/api/analytics");
  const analytics = await analyticsRes.json();
  
  if (!analytics.success) {
    throw new Error("Analytics API request failed: " + JSON.stringify(analytics.error));
  }

  const metrics = analytics.metrics;
  console.log("Metrics returned by API:");
  console.log(`  - Total Tenders: ${metrics.totalTenders}`);
  console.log(`  - Issued Count: ${metrics.issuedCount} (Expected >= 1)`);
  console.log(`  - Lapsed (Unreviewed) Count: ${metrics.lapsedCount} (Expected >= 1)`);
  console.log(`  - Participating Count: ${metrics.participatingCount} (Expected >= 1)`);
  console.log(`  - Not Participating Count: ${metrics.notParticipatingCount} (Expected >= 0)`);
  console.log(`  - Filed Count: ${metrics.filedCount} (Expected >= 1)`);
  console.log(`  - Awarded Count: ${metrics.awardedCount} (Expected >= 1)`);
  console.log(`  - Due in 3 Days Count: ${metrics.t2_3DaysCount} (Expected >= 1)`);
  console.log(`  - Non-Submission Loss Count: ${metrics.nonSubmissionLossCount} (Expected >= 2)`);
  console.log(`  - Non-Participation Loss Count: ${metrics.nonParticipationLossCount} (Expected >= 1)`);

  console.log("\n4. Verifying filter listings from /api/tenders...");
  
  const testFilters = [
    { filter: 'Issued', expectedCount: 1 },
    { filter: 'Lapsed (Unreviewed)', expectedCount: 1 },
    { filter: 'Participating', expectedCount: 1 },
    { filter: 'Business Loss due to Non-Submission', expectedCount: 2 },
    { filter: 'Business Loss due to Non-Participation', expectedCount: 1 },
    { filter: 'T2-3 days', expectedCount: 1 } // Participating mock is due in 2 days
  ];

  for (const tf of testFilters) {
    const listRes = await fetch(`http://localhost:3000/api/tenders?status=${encodeURIComponent(tf.filter)}`);
    const listData = await listRes.json();
    const mockMatches = listData.tenders.filter(t => t.id.startsWith('MOCK_'));
    console.log(`  - Filter "${tf.filter}": found ${mockMatches.length} mock bids (Expected: ${tf.expectedCount})`);
    if (mockMatches.length !== tf.expectedCount) {
      console.error(`❌ Mismatch for filter "${tf.filter}"! Expected ${tf.expectedCount}, got ${mockMatches.length}`);
      console.log("Mock Bids found:", mockMatches.map(m => m.id));
    } else {
      console.log(`✅ Success for filter "${tf.filter}"`);
    }
  }

  console.log("\n5. Cleaning up mock tenders from database...");
  db.prepare("DELETE FROM tenders WHERE id LIKE 'MOCK_%'").run();
  console.log("Cleaned up database.");
  db.close();
}

runTest().catch(err => {
  console.error("Test execution failed:", err);
  db.prepare("DELETE FROM tenders WHERE id LIKE 'MOCK_%'").run();
  db.close();
});
