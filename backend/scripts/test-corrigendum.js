const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'tenders.db');
const db = new Database(dbPath);

console.log('=== Test Corrigendum Auto-Update and Status Reset ===');

const testTenderId = '9999111'; // Numeric ID representing a mock tender
const initialDueDate = '2026-06-20';
const newDueDate = '2026-06-28';

// 1. Setup initial tender in Filed status
const initialTender = {
  id: testTenderId,
  ref_no: 'REF-CORR-TEST',
  title: 'Acquisition of Deep Freezers for Laboratory',
  authority: 'State Medical Supply Corporation',
  estimated_cost: 2500000,
  estimated_cost_raw: 'Rs. 25,00,000',
  due_date: initialDueDate,
  status: 'Filed',
  original_url: 'https://test.tenders.com/details/9999111',
  scraped_at: new Date().toISOString(),
  notes: 'Tender was successfully filed.',
  corrigendum_remark: 'No'
};

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO tenders (
    id, ref_no, title, authority, estimated_cost, estimated_cost_raw, due_date, status, original_url, scraped_at, notes, corrigendum_remark
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

console.log('Inserting initial mock tender (Filed status, original due date: ' + initialDueDate + ')...');
insertStmt.run(
  initialTender.id,
  initialTender.ref_no,
  initialTender.title,
  initialTender.authority,
  initialTender.estimated_cost,
  initialTender.estimated_cost_raw,
  initialTender.due_date,
  initialTender.status,
  initialTender.original_url,
  initialTender.scraped_at,
  initialTender.notes,
  initialTender.corrigendum_remark
);

console.log('Setup finished.');

// 2. Prepare mock email body containing the Tender247 HTML table structure
const emailHtml = `
<html>
<body>
  <table>
    <thead>
      <tr>
        <td>TENDER DETAILS</td>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          T247 ID: 9999111
          <a href="https://r.tenders.bidsnrfp.com/tr/cl/somekey?id=9999111">Acquisition of Deep Freezers for Laboratory (Corrigendum 1)</a>
        </td>
        <td>
          <b>State Medical Supply Corporation</b><br/>
          Mumbai, Maharashtra
        </td>
        <td>
          Rs. 25,00,000<br/>
          Due Date: 28-06-2026
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>
`;

console.log('Sending mock email POST request to /api/process-email...');
const apiUrl = 'http://localhost:3000/api/process-email';

async function runTest() {
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        emailBody: emailHtml,
        subject: 'Corrigendum Alert - 9999111',
        sender: 'alerts@tender247.com',
        receivedAt: new Date().toISOString()
      })
    });

    const result = await res.json();
    console.log('API Response:', result);

    if (result.success) {
      console.log('API call succeeded.');
      
      // Query the database to check if the record was updated
      const updated = db.prepare('SELECT status, title, due_date, corrigendum_remark, notes FROM tenders WHERE id = ?').get(testTenderId);
      console.log('\nUpdated Database Record:');
      console.log('- Status (expected "Issued"):', updated.status);
      console.log('- Title (expected with Corrigendum):', updated.title);
      console.log('- Due Date (expected ' + newDueDate + '):', updated.due_date);
      console.log('- Corrigendum Remark (expected "Yes"):', updated.corrigendum_remark);
      console.log('- Notes Audit Log:\n', updated.notes);

      if (updated.status === 'Issued' && updated.due_date === newDueDate && updated.corrigendum_remark === 'Yes') {
        console.log('\nSUCCESS: Corrigendum auto-updated, status reset, and notes logged!');
      } else {
        console.error('\nFAILURE: Database record did not match expected values.');
      }
    } else {
      console.error('API call failed:', result.error);
    }
  } catch (error) {
    console.error('Fetch failed:', error);
  } finally {
    // Cleanup
    console.log('\nCleaning up mock tender from database...');
    db.prepare('DELETE FROM tenders WHERE id = ?').run(testTenderId);
    console.log('Cleanup finished.');
  }
}

runTest();
