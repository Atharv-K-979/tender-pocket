const Database = require('better-sqlite3');
const path = require('path');
const { execSync } = require('child_process');

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'tenders.db');
const db = new Database(dbPath);

console.log('=== Test send-alerts script ===');

// Helper to compute local IST Date string (YYYY-MM-DD)
function getISTDateString(offsetDays = 0) {
  const date = new Date();
  // Adjust offset
  date.setDate(date.getDate() + offsetDays);
  
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-IN', options);
  const parts = formatter.formatToParts(date);
  const day = parts.find(p => p.type === 'day').value;
  const month = parts.find(p => p.type === 'month').value;
  const year = parts.find(p => p.type === 'year').value;
  return `${year}-${month}-${day}`;
}

// 1. Insert temporary test tenders that match the due date conditions
const t5Date = getISTDateString(5);
const t2Date = getISTDateString(2);
const t3Date = getISTDateString(3);
const t0Date = getISTDateString(0);

console.log(`Setting up test dates relative to today:
- T-5 Date: ${t5Date}
- T-3 Date: ${t3Date}
- T-2 Date: ${t2Date}
- T-0 (Due Today): ${t0Date}
`);

const testTenders = [
  {
    id: 'test_issued_t5',
    ref_no: 'TEST-REF-T5',
    title: 'Test Issued Tender T-5 Alert',
    authority: 'Test Procuring Authority A',
    due_date: t5Date,
    status: 'Issued',
    original_url: 'https://test.tenders.com/t5',
    entry_date: getISTDateString(0)
  },
  {
    id: 'test_issued_t2',
    ref_no: 'TEST-REF-T2',
    title: 'Test Issued Tender T-2 Alert',
    authority: 'Test Procuring Authority B',
    due_date: t2Date,
    status: 'Issued',
    original_url: 'https://test.tenders.com/t2',
    entry_date: getISTDateString(0)
  },
  {
    id: 'test_issued_t0',
    ref_no: 'TEST-REF-T0',
    title: 'Test Issued Tender T-0 Alert (Due Today!)',
    authority: 'Test Procuring Authority C',
    due_date: t0Date,
    status: 'Issued',
    original_url: 'https://test.tenders.com/t0',
    entry_date: getISTDateString(0)
  },
  {
    id: 'test_ready_t3',
    ref_no: 'TEST-REF-READY-T3',
    title: 'Test Ready Tender T-3 Alert',
    authority: 'Test Procuring Authority D',
    due_date: t3Date,
    status: 'Ready to be Filed',
    original_url: 'https://test.tenders.com/ready-t3',
    entry_date: getISTDateString(0)
  },
  {
    id: 'test_ready_t0',
    ref_no: 'TEST-REF-READY-T0',
    title: 'Test Ready Tender T-0 Alert (Due Today!)',
    authority: 'Test Procuring Authority E',
    due_date: t0Date,
    status: 'Ready to be Filed',
    original_url: 'https://test.tenders.com/ready-t0',
    entry_date: getISTDateString(0)
  },
  {
    id: 'test_sla_t3',
    ref_no: 'TEST-REF-SLA-T3',
    title: 'Test Issued SLA T+3 Action Alert',
    authority: 'Test Procuring Authority F',
    due_date: getISTDateString(10),
    status: 'Issued',
    original_url: 'https://test.tenders.com/sla-t3',
    entry_date: getISTDateString(-3)
  }
];

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO tenders (
    id, ref_no, title, authority, due_date, status, original_url, scraped_at, entry_date
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

console.log('Inserting mock test tenders into database...');
db.transaction(() => {
  for (const t of testTenders) {
    insertStmt.run(t.id, t.ref_no, t.title, t.authority, t.due_date, t.status, t.original_url, new Date().toISOString(), t.entry_date);
  }
})();

console.log('Successfully inserted test tenders.');

console.log('\n--- Running alert engine script ---');
try {
  const output = execSync('node --env-file=.env scripts/send-alerts.js', { encoding: 'utf-8' });
  console.log('Script Output:\n', output);
} catch (e) {
  console.error('Script Execution Failed:\n', e.stdout || e.message);
}

// 2. Clean up database
console.log('\nCleaning up mock test tenders from database...');
const deleteStmt = db.prepare('DELETE FROM tenders WHERE id = ?');
db.transaction(() => {
  for (const t of testTenders) {
    deleteStmt.run(t.id);
  }
})();

console.log('Clean up complete.');
console.log('=== Test Finished ===');
