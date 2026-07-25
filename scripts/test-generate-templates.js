const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'tenders.db');
const db = new Database(dbPath);

console.log('=== Test Templates Generation API ===');

// 1. Create a mock tender for generation
const testTenderId = 'test_gen_templates_id';
const testTender = {
  id: testTenderId,
  ref_no: 'REF-GEN-TEST-123',
  title: 'Test Tender for Bid Templates Generation',
  authority: 'Directorate of Healthcare and Medical Services',
  estimated_cost: 1500000,
  estimated_cost_raw: 'INR 15,00,000',
  emd: 30000,
  emd_raw: 'INR 30,000',
  document_fee: 1000,
  document_fee_raw: 'INR 1,000',
  location: 'Mumbai, Maharashtra',
  sector: 'Medical',
  due_date: '2026-06-30',
  opening_date: '2026-07-01',
  original_url: 'https://test.tenders.com/details/123',
  status: 'In Progress',
  notes: 'Tender in progress.',
  scraped_at: new Date().toISOString(),
  mis_executive: 'Anuthi Bhansali'
};

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO tenders (
    id, ref_no, title, authority, estimated_cost, estimated_cost_raw,
    emd, emd_raw, document_fee, document_fee_raw, location, sector,
    due_date, opening_date, original_url, status, notes, scraped_at, mis_executive
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

console.log('Inserting mock tender in In Progress status...');
insertStmt.run(
  testTender.id,
  testTender.ref_no,
  testTender.title,
  testTender.authority,
  testTender.estimated_cost,
  testTender.estimated_cost_raw,
  testTender.emd,
  testTender.emd_raw,
  testTender.document_fee,
  testTender.document_fee_raw,
  testTender.location,
  testTender.sector,
  testTender.due_date,
  testTender.opening_date,
  testTender.original_url,
  testTender.status,
  testTender.notes,
  testTender.scraped_at,
  testTender.mis_executive
);

console.log('Tender inserted successfully.');

const apiUrl = `http://localhost:3000/api/tenders/${testTenderId}/generate-templates`;
console.log(`Sending POST request to template generation endpoint: ${apiUrl}...`);

async function runTest() {
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();
    console.log('API Response:', result);

    if (result.success) {
      console.log('API returned success.');
      
      // Verify that the ZIP file actually exists on disk
      const zipPath = path.join(process.cwd(), 'public', 'documents', testTenderId, `Tender_Templates_${testTenderId}.zip`);
      if (fs.existsSync(zipPath)) {
        const stats = fs.statSync(zipPath);
        console.log(`Verified: ZIP file exists at public/documents/${testTenderId}/Tender_Templates_${testTenderId}.zip (${stats.size} bytes).`);
      } else {
        console.error('Error: ZIP file not found on disk at ' + zipPath);
      }

      // Check DB update
      const updatedTender = db.prepare('SELECT status, downloaded_docs FROM tenders WHERE id = ?').get(testTenderId);
      console.log('Updated Tender Status in DB:', updatedTender.status);
      console.log('Updated Tender Downloaded Docs in DB:', updatedTender.downloaded_docs);
    } else {
      console.error('API failed with error:', result.error);
    }
  } catch (error) {
    console.error('Fetch request failed:', error);
  } finally {
    // Cleanup
    console.log('Cleaning up mock tender and generated files...');
    db.prepare('DELETE FROM tenders WHERE id = ?').run(testTenderId);
    
    const docDir = path.join(process.cwd(), 'public', 'documents', testTenderId);
    if (fs.existsSync(docDir)) {
      fs.rmSync(docDir, { recursive: true, force: true });
    }
    console.log('Cleanup finished.');
  }
}

runTest();
