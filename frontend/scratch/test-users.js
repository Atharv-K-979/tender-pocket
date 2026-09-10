const Database = require('better-sqlite3');
const crypto = require('crypto');

const dbPath = '/Users/anuthibhansali/.gemini/antigravity/scratch/tender-pocket/tenders.db';
console.log('Connecting to database:', dbPath);
const db = new Database(dbPath);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

console.log('--- Starting User Database Logic Verification ---');

// Test password hashing
const rawPassword = 'testpassword123';
const expectedHash = 'b55c8792d1ce458e279308835f8a97b580263503e76e1998e279703e35ad0c2e'; // SHA-256 for testpassword123
const computedHash = hashPassword(rawPassword);

if (computedHash === expectedHash) {
  console.log('✅ Password hashing: PASSED');
} else {
  console.error('❌ Password hashing: FAILED', { expected: expectedHash, got: computedHash });
  db.close();
  process.exit(1);
}

// Test inserting new team member
const testUsername = 'test_executive_ravi';
const testRole = 'MIS Executive';

try {
  // Clear any existing test record
  db.prepare('DELETE FROM users WHERE username = ?').run(testUsername);

  // Insert
  const insertStmt = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  insertStmt.run(testUsername, computedHash, testRole);
  console.log('✅ DB User insert: PASSED');

  // Verify
  const user = db.prepare('SELECT username, role, password_hash FROM users WHERE username = ?').get(testUsername);
  if (user && user.username === testUsername && user.role === testRole && user.password_hash === computedHash) {
    console.log('✅ DB User verification: PASSED');
  } else {
    console.error('❌ DB User verification: FAILED', user);
    db.close();
    process.exit(1);
  }

  // Delete
  db.prepare('DELETE FROM users WHERE username = ?').run(testUsername);
  const deletedUser = db.prepare('SELECT username FROM users WHERE username = ?').get(testUsername);
  if (!deletedUser) {
    console.log('✅ DB User deletion: PASSED');
  } else {
    console.error('❌ DB User deletion: FAILED', deletedUser);
    db.close();
    process.exit(1);
  }

  console.log('--- All DB User Verification Tests Passed Successfully! ---');
} catch (e) {
  console.error('❌ DB operations test crashed:', e);
  db.close();
  process.exit(1);
} finally {
  db.close();
}
