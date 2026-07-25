const Database = require('better-sqlite3');
const axios = require('axios');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'tenders.db');
const db = new Database(dbPath);

async function runVerification() {
  console.log("--- Starting Summaries and Trigger Verification ---");

  // 1. Fetch a sample tender
  const tender = db.prepare("SELECT id, status, corrigendum_remark FROM tenders LIMIT 1").get();
  if (!tender) {
    console.error("No tenders found in the database. Cannot run test.");
    return;
  }
  const id = tender.id;
  const originalStatus = tender.status;
  const originalCorrigendum = tender.corrigendum_remark;
  console.log(`Found sample tender ID: ${id} with current status: "${originalStatus}"`);

  // 2. Clear status history for this tender to run a clean test
  db.prepare("DELETE FROM status_history WHERE tender_id = ?").run(id);

  // 3. Test INSERT trigger (Insert a test tender)
  const testId = 'TEST_TENDER_999';
  db.prepare("DELETE FROM tenders WHERE id = ?").run(testId);
  db.prepare("DELETE FROM status_history WHERE tender_id = ?").run(testId);
  
  db.prepare(`
    INSERT INTO tenders (id, title, original_url, status, scraped_at)
    VALUES (?, 'Test Tender Title', 'http://example.com', 'Issued', ?)
  `).run(testId, new Date().toISOString());
  
  const insertHistory = db.prepare("SELECT * FROM status_history WHERE tender_id = ?").all(testId);
  console.log("INSERT Trigger Test:", insertHistory.length === 1 && insertHistory[0].to_status === 'Issued' ? "PASSED" : "FAILED");
  console.log("Insert history record:", insertHistory);

  // 4. Test UPDATE trigger for status
  db.prepare("UPDATE tenders SET status = 'In Progress' WHERE id = ?").run(testId);
  const updateHistory = db.prepare("SELECT * FROM status_history WHERE tender_id = ? ORDER BY changed_at ASC").all(testId);
  console.log("UPDATE Status Trigger Test:", updateHistory.length === 2 && updateHistory[1].from_status === 'Issued' && updateHistory[1].to_status === 'In Progress' ? "PASSED" : "FAILED");
  console.log("Updated history records:", updateHistory);

  // 5. Test UPDATE trigger for corrigendum_remark
  db.prepare("UPDATE tenders SET corrigendum_remark = 'Yes' WHERE id = ?").run(testId);
  const corrigendumHistory = db.prepare("SELECT * FROM status_history WHERE tender_id = ? ORDER BY changed_at ASC").all(testId);
  console.log("Corrigendum Trigger Test:", corrigendumHistory.length === 3 && corrigendumHistory[2].notes.includes('Corrigendum') ? "PASSED" : "FAILED");
  console.log("All history records after corrigendum:", corrigendumHistory);

  // Clean up test tender
  db.prepare("DELETE FROM tenders WHERE id = ?").run(testId);
  db.prepare("DELETE FROM status_history WHERE tender_id = ?").run(testId);

  // 6. Test GET API Endpoint using axios
  console.log(`\nCalling GET http://localhost:3000/api/tenders/${id} to test summaries generation...`);
  try {
    const res = await axios.get(`http://localhost:3000/api/tenders/${id}`);
    console.log("API Status:", res.status);
    console.log("API Response Summaries:");
    console.log("==================================================");
    console.log("Tender Details Summary:");
    console.log(res.data.summaries.detailsSummary);
    console.log("--------------------------------------------------");
    console.log("Status History Summary:");
    console.log(res.data.summaries.statusHistorySummary);
    console.log("==================================================");
    console.log("API History Log Elements Count:", res.data.history.length);
    console.log("API Get Test: PASSED");
  } catch (err) {
    console.error("GET API test failed! Is the dev server running?");
    if (err.response) {
      console.error("API response error:", err.response.data);
    } else {
      console.error(err.message);
    }
  }
}

runVerification().catch(console.error);
