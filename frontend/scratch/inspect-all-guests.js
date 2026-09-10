const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../tenders.db');
const db = new Database(dbPath);

try {
  const rows = db.prepare("SELECT id, due_date, scraped_at, downloaded_docs FROM tenders WHERE original_url LIKE '%/auth/tender/%'").all();
  console.log(`Tenders details:`);
  console.log(JSON.stringify(rows, null, 2));
} catch (err) {
  console.error(err);
} finally {
  db.close();
}
