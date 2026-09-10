const Database = require('better-sqlite3');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.cwd(), 'tenders.db');
const db = new Database(dbPath);

console.log("=== GeM Date-Time & EMD/ePBG Enrichment Test ===");
console.log("Using DB:", dbPath);

// 1. Reset columns for tender 9445624
console.log("\n1. Resetting database record for tender 9445624...");
db.prepare(`
  UPDATE tenders SET
    place = 'N/A',
    state = 'N/A',
    location = 'N/A, N/A',
    opening_date = NULL,
    start_date = '2026-06-09',
    due_date = '2026-06-20',
    time = 'N/A',
    emd = NULL,
    emd_raw = 'N/A',
    downloaded_docs = NULL,
    notes = 'Imported automatically by daily GeM Sync job matching keyword "Insulated Vaccine Van".'
  WHERE id = '9445624'
`).run();

console.log("Reset complete. Current record state:");
const initialRecord = db.prepare("SELECT id, place, state, location, opening_date, start_date, due_date, time, emd, emd_raw, downloaded_docs, notes FROM tenders WHERE id = '9445624'").get();
console.log(JSON.stringify(initialRecord, null, 2));

// Helper function downloadFile copied from sync-gem.js
async function downloadFile(url, outputPath) {
  try {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      timeout: 20000
    });

    fs.writeFileSync(outputPath, response.data);
    return true;
  } catch (error) {
    console.error(`  - Failed to download file from ${url}:`, error.message);
    return false;
  }
}

// Function downloadGemPdf copied from the modified sync-gem.js
async function downloadGemPdf(tenderId, downloadUrl) {
  const localDir = path.join(process.cwd(), 'public', 'documents', tenderId);
  const localFileName = `Bid_Document_${tenderId}.pdf`;
  const outputPath = path.join(localDir, localFileName);
  const localPath = `/documents/${tenderId}/${localFileName}`;

  console.log(`  - Downloading Bid PDF from ${downloadUrl} to ${outputPath}...`);
  const success = await downloadFile(downloadUrl, outputPath);
  
  if (success) {
    const d = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentDate = `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;

    let docMeta = [{
      name: "Bid Document",
      filename: localFileName,
      local_path: localPath,
      created_date: currentDate
    }];

    let place = 'N/A';
    let state = 'N/A';
    let openingDate = null;
    let dueTime = 'N/A';
    let extraNotes = '';
    let emdAmount = null;
    let emdRaw = 'N/A';
    let startDateTime = null;
    let dueDateTime = null;

    try {
      const execSync = require('child_process').execSync;
      console.log(`  - Parsing Bid PDF for links & EMD/metadata using scripts/parse-gem-pdf.py...`);
      const stdout = execSync(`python3 scripts/parse-gem-pdf.py "${outputPath}"`, { encoding: 'utf8' });
      const parsed = JSON.parse(stdout);
      
      if (parsed) {
        if (parsed.opening_date) {
          openingDate = parsed.opening_date;
          if (parsed.opening_time) {
            openingDate = `${parsed.opening_date} ${parsed.opening_time}`;
          }
          startDateTime = openingDate; // Mapped to opening date-time per user request
        }
        if (parsed.due_date && parsed.due_time) {
          dueDateTime = `${parsed.due_date} ${parsed.due_time}`; // Mapped to end date-time per user request
          dueTime = parsed.due_time;
        }
        if (parsed.place && parsed.place !== 'N/A') place = parsed.place;
        if (parsed.state && parsed.state !== 'N/A') state = parsed.state;

        let extraNoteParts = [];
        if (parsed.validity) {
          extraNoteParts.push(`[Bid Offer Validity: ${parsed.validity} Days]`);
        }
        if (parsed.emd_amount) {
          emdAmount = Number(parsed.emd_amount);
          if (emdAmount >= 10000000) {
            emdRaw = `₹${(emdAmount / 10000000).toFixed(2)} Crore`;
          } else if (emdAmount >= 100000) {
            emdRaw = `₹${(emdAmount / 100000).toFixed(2)} Lakh`;
          } else {
            emdRaw = `₹${emdAmount.toLocaleString('en-IN')}`;
          }
        }
        if (parsed.emd_bank) {
          extraNoteParts.push(`[EMD Advisory Bank: ${parsed.emd_bank}]`);
        }
        if (parsed.epbg_percent) {
          extraNoteParts.push(`[ePBG: ${parsed.epbg_percent}%]`);
        }
        if (extraNoteParts.length > 0) {
          extraNotes = " " + extraNoteParts.join(" ");
        }

        // Check if there are linked specification or BOQ documents
        if (parsed.links && parsed.links.length > 0) {
          for (const link of parsed.links) {
            if (link.includes('BoqDocument') || link.includes('BoqLineItemsDocument')) {
              let docName = "Linked Document";
              let defaultExt = ".pdf";
              if (link.includes('BoqDocument')) {
                docName = "Specification Document";
                defaultExt = ".pdf";
              } else if (link.includes('BoqLineItemsDocument')) {
                docName = "BOQ Detail Document";
                defaultExt = ".csv";
              }

              // Extract basename
              const urlPathname = new URL(link).pathname;
              let baseName = path.basename(urlPathname);
              if (!baseName.includes('.')) {
                baseName = baseName + defaultExt;
              }

              const linkOutputPath = path.join(localDir, baseName);
              const linkLocalPath = `/documents/${tenderId}/${baseName}`;

              console.log(`  - Downloading linked ${docName} from ${link}...`);
              const dlSuccess = await downloadFile(link, linkOutputPath);
              if (dlSuccess) {
                docMeta.push({
                  name: docName,
                  filename: baseName,
                  local_path: linkLocalPath,
                  created_date: currentDate
                });

                // If it's the specification PDF, run parser on it to check for a precise delivery location
                if (docName === "Specification Document") {
                  console.log(`  - Parsing Specification Document for delivery location...`);
                  try {
                    const specStdout = execSync(`python3 scripts/parse-gem-pdf.py "${linkOutputPath}"`, { encoding: 'utf8' });
                    const specParsed = JSON.parse(specStdout);
                    if (specParsed && specParsed.place && specParsed.place !== 'N/A') {
                      place = specParsed.place;
                      state = specParsed.state;
                      console.log(`  - Found precise delivery location in Specification PDF: ${place}, ${state}`);
                    }
                  } catch (specErr) {
                    console.error(`  - Failed to parse Specification PDF:`, specErr.message);
                  }
                }
              }
            }
          }
        }
      }
    } catch (parseErr) {
      console.error(`  - Failed to parse PDF:`, parseErr.message);
    }

    try {
      const updateStmt = db.prepare(`
        UPDATE tenders SET 
          downloaded_docs = ?, 
          document_url = ?,
          place = CASE WHEN ? = 'N/A' THEN place ELSE ? END,
          state = CASE WHEN ? = 'N/A' THEN state ELSE ? END,
          location = CASE WHEN ? = 'N/A' THEN location ELSE ? END,
          opening_date = COALESCE(?, opening_date),
          start_date = COALESCE(?, start_date),
          due_date = COALESCE(?, due_date),
          time = CASE WHEN ? = 'N/A' THEN time ELSE ? END,
          emd = COALESCE(?, emd),
          emd_raw = CASE WHEN ? = 'N/A' THEN emd_raw ELSE ? END,
          notes = notes || ?
        WHERE id = ?
      `);

      const finalLoc = (place !== 'N/A' && state !== 'N/A') ? `${place}, ${state}` : 'N/A';

      updateStmt.run(
        JSON.stringify(docMeta),
        localPath,
        place, place,
        state, state,
        finalLoc, finalLoc,
        openingDate,
        startDateTime,
        dueDateTime,
        dueTime, dueTime,
        emdAmount,
        emdRaw, emdRaw,
        extraNotes,
        tenderId
      );
      console.log(`  - Successfully updated DB record for GeM Tender ${tenderId} with local documents and parsed metadata.`);
    } catch (dbErr) {
      console.error(`  - Failed to update database for tender ${tenderId}:`, dbErr.message);
    }
  }
}

async function runTest() {
  console.log("\n2. Executing downloadGemPdf('9445624', 'https://bidplus.gem.gov.in/showbidDocument/9445624')...");
  await downloadGemPdf('9445624', 'https://bidplus.gem.gov.in/showbidDocument/9445624');

  console.log("\n3. Verifying updated database record...");
  const updatedRecord = db.prepare("SELECT id, place, state, location, opening_date, start_date, due_date, time, emd, emd_raw, downloaded_docs, notes FROM tenders WHERE id = '9445624'").get();
  console.log(JSON.stringify(updatedRecord, null, 2));
}

runTest().catch(console.error);
