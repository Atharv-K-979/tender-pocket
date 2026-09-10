const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../tenders.db');
const db = new Database(dbPath);

console.log("Database path:", dbPath);

const total = db.prepare("SELECT count(*) as count FROM tenders").get().count;
console.log("Total tenders in DB:", total);

const t247Count = db.prepare("SELECT count(*) as count FROM tenders WHERE original_url LIKE '%tender247%' OR original_url LIKE '%tender24by7%'").get().count;
console.log("Total Tender247 tenders in DB:", t247Count);

const t247NaDates = db.prepare("SELECT count(*) as count FROM tenders WHERE (original_url LIKE '%tender247%' OR original_url LIKE '%tender24by7%') AND (publish_date = 'N/A' OR publish_date IS NULL)").get().count;
console.log("Tender247 tenders with N/A or NULL publish_date:", t247NaDates);

const t247NoDocs = db.prepare("SELECT count(*) as count FROM tenders WHERE (original_url LIKE '%tender247%' OR original_url LIKE '%tender24by7%') AND (downloaded_docs IS NULL OR downloaded_docs = '')").get().count;
console.log("Tender247 tenders with no downloaded documents:", t247NoDocs);

console.log("\nSample Tender247 Tenders without downloaded documents:");
const sample = db.prepare("SELECT id, title, ref_no, publish_date, start_date, due_date, document_url, downloaded_docs IS NULL as no_docs, original_url FROM tenders WHERE (original_url LIKE '%tender247%' OR original_url LIKE '%tender24by7%') AND (downloaded_docs IS NULL OR downloaded_docs = '') LIMIT 20").all();
for (const s of sample) {
  console.log(`- ID: ${s.id} | Title: ${s.title.substring(0, 50)}... | Ref: ${s.ref_no} | Due: ${s.due_date} | URL: ${s.original_url.substring(0, 80)}...`);
}
