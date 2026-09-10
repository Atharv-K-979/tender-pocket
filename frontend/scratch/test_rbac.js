const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'tenders.db');
console.log('Testing DB at:', dbPath);
const db = new Database(dbPath);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// 1. Check users table
try {
  const users = db.prepare('SELECT username, role, password_hash FROM users').all();
  console.log('\n--- Seeded Users ---');
  users.forEach(u => {
    console.log(`Username: ${u.username.padEnd(10)} | Role: ${u.role.padEnd(15)} | Hash: ${u.password_hash.substring(0, 8)}...`);
  });

  // Verify misteam password
  const misteam = users.find(u => u.username === 'misteam');
  if (misteam && misteam.password_hash === hashPassword('misteam123')) {
    console.log('✅ MIS Team password verification passed');
  } else {
    console.error('❌ MIS Team password verification failed');
  }

  // Verify misexec1 password
  const misexec1 = users.find(u => u.username === 'misexec1');
  if (misexec1 && misexec1.password_hash === hashPassword('misexec123')) {
    console.log('✅ MIS Exec 1 password verification passed');
  } else {
    console.error('❌ MIS Exec 1 password verification failed');
  }

  // Verify admin password
  const admin = users.find(u => u.username === 'admin');
  if (admin && admin.password_hash === hashPassword('admin123')) {
    console.log('✅ Admin password verification passed');
  } else {
    console.error('❌ Admin password verification failed');
  }

} catch (err) {
  console.error('Failed to read users:', err);
}

// 2. Check activity log table structure
try {
  const tableInfo = db.prepare("PRAGMA table_info(activity_log)").all();
  console.log('\n--- Activity Log Schema ---');
  tableInfo.forEach(c => {
    console.log(`Column: ${c.name.padEnd(15)} | Type: ${c.type}`);
  });
  console.log('✅ Activity log table schema checked');
} catch (err) {
  console.error('Failed to read activity log schema:', err);
}

db.close();
