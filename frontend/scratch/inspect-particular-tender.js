const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../tenders.db');
const db = new Database(dbPath);

const row = db.prepare("SELECT * FROM tenders WHERE id = ?").get("100620293");
console.log(JSON.stringify(row, null, 2));
