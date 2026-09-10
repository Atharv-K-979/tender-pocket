const { downloadAndSaveTenderDocuments } = require('../src/lib/scraper');
const db = require('../src/lib/db').default;

async function run() {
  const tenderId = "100204425";
  console.log(`Starting document download and save for tender ID: ${tenderId}`);
  try {
    const result = await downloadAndSaveTenderDocuments(tenderId);
    console.log(`Download finished. Result:`, result);
    
    // Query db
    const row = db.prepare("SELECT downloaded_docs, product_name_as_per_tender, product_name_as_per_marken, vertical_name FROM tenders WHERE id = ?").get(tenderId);
    console.log("DB record after download:", JSON.stringify(row, null, 2));
  } catch (err) {
    console.error("Failed to run download:", err);
  }
}

run().catch(console.error);
