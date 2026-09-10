const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../tenders.db');
const db = new Database(dbPath);

const tenders = db.prepare(`
  SELECT id, title, ref_no, publish_date, start_date, due_date, document_url, downloaded_docs 
  FROM tenders 
  WHERE original_url LIKE '%tender247%' OR original_url LIKE '%tender24by7%'
`).all();

console.log("=== Tender247 records ===");
tenders.forEach(t => {
  console.log(`ID: ${t.id}`);
  console.log(`  Title: ${t.title.substring(0, 80)}`);
  console.log(`  Ref: ${t.ref_no}`);
  console.log(`  Dates - Pub: ${t.publish_date} | Start: ${t.start_date} | Due: ${t.due_date}`);
  console.log(`  Doc URL: ${t.document_url}`);
  console.log(`  Docs: ${t.downloaded_docs ? JSON.parse(t.downloaded_docs).length + ' docs' : 'None'}`);
  console.log("-----------------------------------------");
});
