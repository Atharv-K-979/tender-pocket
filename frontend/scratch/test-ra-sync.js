const Database = require('better-sqlite3');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(process.cwd(), 'tenders.db');
const db = new Database(dbPath);

async function getCredentials() {
  const mainUrl = "https://bidplus.gem.gov.in/all-bids";
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.google.com/'
  };
  const mainPageRes = await axios.get(mainUrl, { headers, timeout: 15000 });
  const cookies = mainPageRes.headers['set-cookie'] || [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
  
  const html = mainPageRes.data;
  const match = html.match(/'csrf_bd_gem_nk'\s*:\s*'([a-f0-9]+)'/i);
  let csrfHash = '';
  if (match) csrfHash = match[1];
  return { cookieHeader, csrfHash };
}

async function searchKeyword(keyword, credentials) {
  const postData = {
    param: { searchBid: keyword, searchType: "fullText" },
    filter: {
      bidStatusType: "ongoing_bids",
      byType: "all",
      highBidValue: "",
      byEndDate: { from: "", to: "" },
      sort: "Bid-End-Date-Oldest"
    }
  };

  const postHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Referer': 'https://bidplus.gem.gov.in/all-bids',
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': credentials.cookieHeader
  };

  const params = new URLSearchParams();
  params.append('payload', JSON.stringify(postData));
  params.append('csrf_bd_gem_nk', credentials.csrfHash);

  const apiRes = await axios.post(
    "https://bidplus.gem.gov.in/all-bids-data",
    params.toString(),
    { headers: postHeaders, timeout: 15000 }
  );

  return apiRes.data?.response?.response?.docs || [];
}

async function downloadFile(url, outputPath, cookieHeader = null) {
  try {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    };
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers,
      timeout: 20000
    });

    fs.writeFileSync(outputPath, response.data);
    return true;
  } catch (error) {
    console.error(`  - Failed to download file from ${url}:`, error.message);
    return false;
  }
}

// Incorporate the modified downloadGemPdf logic directly for this integration test
async function downloadGemPdf(tenderId, downloadUrl, bidNo = '', doc = null, credentials) {
  const localDir = path.join(process.cwd(), 'public', 'documents', tenderId);
  const localFileName = `Bid_Document_${tenderId}.pdf`;
  const outputPath = path.join(localDir, localFileName);
  const localPath = `/documents/${tenderId}/${localFileName}`;

  console.log(`  - Downloading Bid PDF from ${downloadUrl} to ${outputPath}...`);
  const success = await downloadFile(downloadUrl, outputPath, credentials.cookieHeader);
  
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

    const bIdParentList = doc ? doc.b_id_parent : null;
    const bIdParent = (Array.isArray(bIdParentList) && bIdParentList.length > 0) ? String(bIdParentList[0]) : null;

    if (bIdParent) {
      const bBidTypeList = doc.b_bid_type;
      const bBidTypeVal = (Array.isArray(bBidTypeList) && bBidTypeList.length > 0) ? bBidTypeList[0] : bBidTypeList;
      let raDocUrl = null;
      let raFileName = `GeM-RA-${tenderId}.pdf`;
      if (bBidTypeVal === 5) {
        raDocUrl = `https://bidplus.gem.gov.in/showdirectradocumentPdf/${tenderId}`;
      } else {
        raDocUrl = `https://bidplus.gem.gov.in/showradocumentPdf/${tenderId}`;
      }

      const raOutputPath = path.join(localDir, raFileName);
      const raLocalPath = `/documents/${tenderId}/${raFileName}`;
      console.log(`  - This is a Reverse Auction. Downloading RA Document from ${raDocUrl} to ${raOutputPath}...`);
      const raSuccess = await downloadFile(raDocUrl, raOutputPath, credentials.cookieHeader);
      if (raSuccess) {
        console.log(`  - Successfully downloaded RA Document.`);
        docMeta.push({
          name: "Reverse Auction Document",
          filename: raFileName,
          local_path: raLocalPath,
          created_date: currentDate
        });
      } else {
        console.log(`  - Failed to download RA Document from ${raDocUrl}`);
      }
    }

    let place = 'N/A';
    let state = 'N/A';
    let openingDate = null;
    let dueTime = 'N/A';
    let extraNotes = '';
    let emdAmount = null;
    let emdRaw = 'N/A';
    let startDateTime = null;
    let dueDateTime = null;

    // Run PDF parser
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
          startDateTime = openingDate;
        }
        if (parsed.due_date && parsed.due_time) {
          dueDateTime = `${parsed.due_date} ${parsed.due_time}`;
          dueTime = parsed.due_time;
        }
        if (parsed.place && parsed.place !== 'N/A') place = parsed.place;
        if (parsed.state && parsed.state !== 'N/A') state = parsed.state;

        let extraNoteParts = [];
        if (parsed.bid_number && parsed.bid_number !== bidNo) {
          extraNoteParts.push(`[Parent Bid: ${parsed.bid_number}]`);
        }
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
        if (parsed.epbg_bank) {
          extraNoteParts.push(`[ePBG Advisory Bank: ${parsed.epbg_bank}]`);
        }
        if (parsed.epbg_percent) {
          extraNoteParts.push(`[ePBG: ${parsed.epbg_percent}%]`);
        }
        if (extraNoteParts.length > 0) {
          extraNotes = " " + extraNoteParts.join(" ");
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
        dueTime, dueTime,
        emdAmount,
        emdRaw, emdRaw,
        extraNotes,
        tenderId
      );
      console.log(`  - Successfully updated DB record for GeM Tender ${tenderId}`);
    } catch (dbErr) {
      console.error(`  - Failed to update database:`, dbErr.message);
    }
  }
}

async function run() {
  try {
    console.log("Negotiating credentials...");
    const credentials = await getCredentials();
    console.log("Searching Mattress for ICU...");
    const docs = await searchKeyword("Mattress for ICU", credentials);
    
    let raDoc = null;
    for (const d of docs) {
      const bidNo = Array.isArray(d.b_bid_number) ? d.b_bid_number[0] : d.b_bid_number;
      const bIdParent = d.b_id_parent;
      if (bIdParent || (bidNo && bidNo.includes('/R/'))) {
        raDoc = d;
        break;
      }
    }

    if (!raDoc) {
      console.error("No active Reverse Auction found for 'Mattress for ICU'.");
      return;
    }

    const bId = String(Array.isArray(raDoc.b_id) ? raDoc.b_id[0] : raDoc.b_id || raDoc.id);
    const bidNo = Array.isArray(raDoc.b_bid_number) ? raDoc.b_bid_number[0] : raDoc.b_bid_number || '';
    
    console.log(`Testing RA Sync for Tender ID: ${bId}, BidNo: ${bidNo}`);

    // Clean up existing record in SQLite DB
    db.prepare("DELETE FROM tenders WHERE id = ?").run(bId);

    // Clean up local files
    const localDir = path.join(process.cwd(), 'public', 'documents', bId);
    if (fs.existsSync(localDir)) {
      fs.rmSync(localDir, { recursive: true, force: true });
    }

    const start = Array.isArray(raDoc.final_start_date_sort) ? raDoc.final_start_date_sort[0] : raDoc.final_start_date_sort || '';
    const formattedStartDate = start ? start.split('T')[0] : '';
    const end = Array.isArray(raDoc.final_end_date_sort) ? raDoc.final_end_date_sort[0] : raDoc.final_end_date_sort || '';
    const dept = Array.isArray(raDoc.ba_official_details_deptName) ? raDoc.ba_official_details_deptName[0] : raDoc.ba_official_details_deptName || 'N/A';
    const items = Array.isArray(raDoc.b_category_name) ? raDoc.b_category_name.join(', ') : raDoc.b_category_name || '';
    
    const bIdParentList = raDoc.b_id_parent;
    const bIdParent = (Array.isArray(bIdParentList) && bIdParentList.length > 0) ? String(bIdParentList[0]) : null;
    const docDownloadId = bIdParent || bId;
    const url = `https://bidplus.gem.gov.in/showbidDocument/${docDownloadId}`;

    const bidNoParentList = raDoc.b_bid_number_parent;
    const bidNoParent = (Array.isArray(bidNoParentList) && bidNoParentList.length > 0) ? String(bidNoParentList[0]) : null;
    const officialRefNo = bidNoParent || bidNo;

    // Insert record
    const insertStmt = db.prepare(`
      INSERT INTO tenders (
        id, ref_no, title, authority, estimated_cost, estimated_cost_raw,
        emd, emd_raw, document_fee, document_fee_raw, location, sector,
        due_date, opening_date, document_url, original_url, status, scraped_at, notes,
        entry_date, mis_executive, source, source_id, vertical_name, place, state,
        tender_type, publish_date, start_date, time, pre_bid_date, corrigendum_remark,
        product_name_as_per_tender, product_name_as_per_marken, bid_qty, quoted_qty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      bId,
      officialRefNo,
      items,
      dept,
      null, 'N/A',
      null, 'N/A',
      null, 'N/A',
      'N/A', null,
      end, null,
      null, url,
      'Issued', new Date().toISOString(),
      'Test integration run for RA Document scraping.',
      '20-Jun-2026', '', 'GeM',
      bidNo,
      'Others', 'N/A', 'N/A',
      'GeM', formattedStartDate, start,
      'N/A', 'No', 'No',
      items, 'Others',
      1, 1
    );

    console.log("Inserted raw tender record. Running downloadGemPdf...");
    await downloadGemPdf(bId, url, bidNo, raDoc, credentials);

    console.log("\nVerifying database entry:");
    const row = db.prepare("SELECT id, ref_no, source_id, downloaded_docs, notes FROM tenders WHERE id = ?").get(bId);
    console.log(JSON.stringify(row, null, 2));

    console.log("\nVerifying local directory contents:");
    if (fs.existsSync(localDir)) {
      const files = fs.readdirSync(localDir);
      console.log("Files:", files);
    } else {
      console.log("Local directory does not exist!");
    }

  } catch (err) {
    console.error("Test failed:", err);
  }
}

run();
