const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'tenders.db');
const db = new Database(dbPath);

console.log('Starting migration of tender statuses...');

// Fetch count before migration
const allTenders = db.prepare('SELECT id, status FROM tenders').all();
console.log(`Found ${allTenders.length} total tenders in the database.`);

const statusCountsBefore = {};
allTenders.forEach(t => {
  statusCountsBefore[t.status] = (statusCountsBefore[t.status] || 0) + 1;
});
console.log('Status counts BEFORE migration:', statusCountsBefore);

// Run migration transactions
const migrateTx = db.transaction(() => {
  const updateStmt = db.prepare('UPDATE tenders SET status = ? WHERE status = ?');
  
  // 1. new -> Issued
  const r1 = updateStmt.run('Issued', 'new');
  console.log(`Migrated ${r1.changes} tenders from 'new' to 'Issued'.`);
  
  // 2. review -> In Progress
  const r2 = updateStmt.run('In Progress', 'review');
  console.log(`Migrated ${r2.changes} tenders from 'review' to 'In Progress'.`);
  
  // 3. applied -> Filed
  const r3 = updateStmt.run('Filed', 'applied');
  console.log(`Migrated ${r3.changes} tenders from 'applied' to 'Filed'.`);
  
  // 4. archived -> Rejected
  const r4 = updateStmt.run('Rejected', 'archived');
  console.log(`Migrated ${r4.changes} tenders from 'archived' to 'Rejected'.`);

  // Any other status that doesn't match the new system gets defaulted to Issued
  const invalidTenders = db.prepare("SELECT id, status FROM tenders WHERE status NOT IN ('Issued', 'In Progress', 'Rejected', 'Ready to be Filed', 'Filed', 'Not Filed')").all();
  if (invalidTenders.length > 0) {
    console.log(`Found ${invalidTenders.length} tenders with non-standard statuses. Defaulting them to 'Issued'...`);
    const defaultStmt = db.prepare("UPDATE tenders SET status = 'Issued' WHERE id = ?");
    for (const t of invalidTenders) {
      defaultStmt.run(t.id);
    }
  }
});

try {
  migrateTx();
  console.log('Migration transaction completed successfully.');
  
  // Fetch count after migration
  const allTendersAfter = db.prepare('SELECT id, status FROM tenders').all();
  const statusCountsAfter = {};
  allTendersAfter.forEach(t => {
    statusCountsAfter[t.status] = (statusCountsAfter[t.status] || 0) + 1;
  });
  console.log('Status counts AFTER migration:', statusCountsAfter);
} catch (error) {
  console.error('Migration failed:', error);
}
