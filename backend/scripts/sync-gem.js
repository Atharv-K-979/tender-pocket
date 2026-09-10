const Database = require('better-sqlite3');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// Deduplicated list of raw keywords
const rawKeywords = [
  "EXAMINATION TABLE",
  "Active Cold Box",
  "Apheresis Machine",
  "Automated Blood Collection System",
  "Automated Blood Component Separator",
  "Automated Platelet Collection Systems",
  "Blast Freezer",
  "Blood Bag Tube Stripper",
  "Blood Bank Equipment",
  "Blood Bank Refrigerator",
  "Blood Cell Separator",
  "Blood Collection Mixer",
  "Blood Collection Monitor",
  "Blood Donation Camp Cot",
  "Blood Donation Van",
  "Blood Donor Couch",
  "Blood Grouping & Crossmatching Analyzer",
  "Blood Irradiators",
  "Blood storage Refrigerator",
  "Blood Transportation Box",
  "Blood Warmer",
  "BOD Incubator",
  "Centrifuge Machine",
  "Cold Box",
  "Cold Chain Equipment",
  "Cold Chamber",
  "Cold Drawer",
  "Cold Room",
  "Cold Storage Solutions",
  "Cooler",
  "CoolPod",
  "Cryo Bath",
  "Data Logger",
  "Deep Freezer",
  "Donor Couch",
  "Food Freezer",
  "Freezer",
  "Humidity Chamber",
  "HVAC System",
  "Ice lined Refrigerator",
  "Incubator",
  "Insulated Vaccine Van",
  "lab Refrigerator",
  "Laboratory Deep Freezer",
  "Laboratory Refrigerator",
  "Low Temperature Deep Freezer",
  "Medical Cold Chain Equipment",
  "Medical Van",
  "Non-Refrigerated Centrifuge",
  "Passive Cold Box",
  "Plasma Contact Freezer",
  "Plasma Expressor",
  "Plasma Thawing Bath",
  "Platelet Incubator",
  "Platelet Incubator and Agitator",
  "Thawing Bath",
  "Refrigerated Truck",
  "Refrigerated Van",
  "Refrigerators",
  "Serological Water Bath",
  "Shock Freezer",
  "Solar Cold Room",
  "Solar Direct Drive",
  "Solar Freezer",
  "Solar Operated Medical Cold Chain Equipment",
  "Solar Refrigerator",
  "Sterilizer",
  "Tube Sealer",
  "Ultra Low Temperature Freezer",
  "Vaccine Van",
  "Walk-In Cooler",
  "Medical Equipment & Furniture",
  "Ambu Bag",
  "Anesthesia Workstation",
  "Bedside Locker",
  "Bedside Screen",
  "Bio-Chemistry Analyser",
  "Modular O.T",
  "BIPAP",
  "Blood Bag Sealer",
  "Blood Bag Tube Sealer",
  "Boyle's Machine",
  "C-ARM Machine",
  "Cautery Machine",
  "Cell Counter",
  "Chemistry Analyser",
  "Colorimeter",
  "Colour Doppler",
  "CPAP",
  "Crash Cart",
  "CTG Machine",
  "Defibrillator",
  "Ward Plain Bed",
  "Dielectric Sealer",
  "Digital Analytical Balance",
  "Digital X-Ray",
  "Double Pan Balance",
  "Dressing Drum",
  "Dressing Trolley",
  "DVT Pump",
  "ECG Machine",
  "Electric Bed",
  "Electro Surgical Unit",
  "Electrolyte",
  "Electrosurgical Device",
  "Examination Couch",
  "Fetal Doppler",
  "Fogger Machine",
  "Foot Step",
  "Four Seater Chair Cushion",
  "Fowler Bed",
  "Gel Card Incubator",
  "Haematology Analyzer",
  "Hematology Analyzer",
  "Hemoglobin Analyzer",
  "Hemoglobinometer",
  "Holder Machine",
  "Hospital Bed",
  "Hospital Chair",
  "Hospital Furniture",
  "Hospital Table",
  "Hospital Trolley",
  "ICU Bed",
  "Instrument Trolley",
  "IV Rod",
  "Modular Operation Theatre",
  "Laminar Cabinet",
  "Laparoscopy Set",
  "Laparoscopy Trolley",
  "LDR Bed",
  "Mattress for ICU",
  "Mattress for Semi Fowler",
  "Medical Equipment",
  "Medical Gas Pipeline System",
  "Medical Hospital Lamps",
  "Microscope",
  "Modular Multipara Monitor",
  "Office Chair",
  "Operating Theatre Pendant",
  "Operation Table",
  "OT LED Light Double Dome",
  "OT Pendant",
  "OT Table Electric cum Manual",
  "Over Bed Table",
  "Oxygen Concentrator",
  "Patient Monitor",
  "Pediatric Bed",
  "PH Meter",
  "Plain Bed",
  "Pulse Oximeter",
  "Radiant Warmer",
  "Radiology & Imaging",
  "Recovery Trolley Hydraulic",
  "Revolving Stool",
  "RH View Box",
  "Rolling Hypothermia Treatment Carts",
  "Fradi",
  "Semi Auto Analyser",
  "Semi Fowler Bed",
  "Sterile Connecting Device",
  "Stretcher",
  "Suction Machine",
  "Syringe Pump",
  "Thermometer",
  "Three Seater Chair",
  "TMT Machine",
  "Tube Stripper",
  "Ultrasonic Cleaner",
  "Ultrasound Machine",
  "Ultrasound USG Machine",
  "USG Machine",
  "VDRL Shaker",
  "Ventilator",
  "Visi Cooler",
  "Visual Light Box",
  "Volumetric Infusion Pump",
  "Weighing Scale",
  "X-Ray Machine",
  "IVD Pathology",
  "Laproscopy and endoscopy",
  "Commercial Refrigeration",
  "Freezer / Deep Freezer",
  "Chest Freezer",
  "Chiller",
  "Insulated Truck / Vehicles",
  "Insulated Van / Vehicles",
  "Refrigerated Vans / Trucks / Vehicles",
  "Refrigerator",
  "Remote Temperature Monitoring Device (WHO Tested)",
  "Solar Walk In Cooler and Freezer / Cold Room",
  "Walk-In-Freezer / Cold Room",
  "Steel Cupboards & Funriture Range",
  "3 door steel cupboards",
  "2 door steel cupboards",
  "Office steel cupboards",
  "Particle Board Box bed Particle Board",
  "Particle Board Single Bed",
  "Particle Board Double Bed",
  "Particle Board Diwan",
  "Particle Board 3 Door Cupboard",
  "Particle Board 2 Door Cupboard",
  "Particle Board Dressing Table",
  "Particle Board TV Showcase",
  "Particle Board Office Table",
  "Steel Funriture",
  "ALMIRAH"
];

// Clean and deduplicate case-insensitively
const seen = new Set();
const keywords = [];

const args = process.argv.slice(2);
const allDates = args.includes('--all-dates');
let keywordsToProcess = rawKeywords;

if (args.length > 0) {
  if (args.includes('--test')) {
    keywordsToProcess = ["EXAMINATION TABLE", "Active Cold Box"];
    console.log('[GeM Sync] running in --test mode with examination table and active cold box.');
  } else {
    keywordsToProcess = args.filter(arg => !arg.startsWith('--'));
    console.log(`[GeM Sync] running with custom user keywords: ${JSON.stringify(keywordsToProcess)}`);
  }
}
if (allDates) {
  console.log('[GeM Sync] --all-dates flag is set. Bypassing today-only publish date filter.');
}

for (const rawK of keywordsToProcess) {
  const k = rawK.trim();
  if (k.length < 3) continue;
  const lower = k.toLowerCase();
  if (!seen.has(lower)) {
    seen.add(lower);
    keywords.push(k);
  }
}

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'tenders.db');
const db = new Database(dbPath);

console.log('--- GeM Sync Engine Started ---');
console.log(`Deduplicated keyword count: ${keywords.length}`);
console.log(`Using Database: ${dbPath}`);

function parseLocationFromDept(dept) {
  const states = ["Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi","Jammu","Kashmir","Ladakh","Puducherry","Chandigarh"];
  let state = 'N/A';
  let place = 'N/A';

  const lowerDept = dept.toLowerCase();
  
  // Find state
  for (const s of states) {
    if (lowerDept.includes(s.toLowerCase())) {
      state = s;
      break;
    }
  }

  // Common Indian Cities
  const cities = ["Mumbai","Pune","Nagpur","Thane","Nashik","Bengaluru","Bangalore","Mysore","Chennai","Coimbatore","Madurai","Hyderabad","Secunderabad","Ahmedabad","Surat","Vadodara","Rajkot","Jaipur","Jodhpur","Udaipur","Kota","Ajmer","Bikaner","Lucknow","Kanpur","Noida","Greater Noida","Ghaziabad","Agra","Varanasi","Allahabad","Prayagraj","Meerut","Patna","Gaya","Ranchi","Jamshedpur","Bhubaneswar","Cuttack","Kolkata","Calcutta","Howrah","Guwahati","Dispur","Shillong","Kohima","Imphal","Aizawl","Agartala","Itanagar","Gangtok","Dehradun","Nainital","Shimla","Dharamshala","Chandigarh","Amritsar","Ludhiana","Jalandhar","Jammu","Srinagar","Leh","Bhopal","Indore","Gwalior","Jabalpur","Raipur","Bilaspur","Panaji","Vasco Da Gama","Thiruvananthapuram","Trivandrum","Kochi","Cochin","Kozhikode","Calicut"];
  for (const c of cities) {
    if (lowerDept.includes(c.toLowerCase())) {
      place = c;
      if (state === 'N/A') {
        const clow = c.toLowerCase();
        if (["mumbai","pune","nagpur","thane","nashik"].includes(clow)) state = "Maharashtra";
        else if (["bengluru","bangalore","mysore"].includes(clow)) state = "Karnataka";
        else if (["chennai","coimbatore","madurai"].includes(clow)) state = "Tamil Nadu";
        else if (["hyderabad","secunderabad"].includes(clow)) state = "Telangana";
        else if (["ahmedabad","surat","vadodara","rajkot"].includes(clow)) state = "Gujarat";
        else if (["jaipur","jodhpur","udaipur","kota","ajmer","bikaner"].includes(clow)) state = "Rajasthan";
        else if (["lucknow","kanpur","noida","greater noida","ghaziabad","agra","varanasi","allahabad","prayagraj","meerut"].includes(clow)) state = "Uttar Pradesh";
        else if (["patna","gaya"].includes(clow)) state = "Bihar";
        else if (["ranchi","jamshedpur"].includes(clow)) state = "Jharkhand";
        else if (["bhubaneswar","cuttack"].includes(clow)) state = "Odisha";
        else if (["kolkata","calcutta","howrah"].includes(clow)) state = "West Bengal";
        else if (["guwahati","dispur"].includes(clow)) state = "Assam";
        else if (["shillong"].includes(clow)) state = "Meghalaya";
        else if (["kohima"].includes(clow)) state = "Nagaland";
        else if (["imphal"].includes(clow)) state = "Manipur";
        else if (["aizawl"].includes(clow)) state = "Mizoram";
        else if (["agartala"].includes(clow)) state = "Tripura";
        else if (["itanagar"].includes(clow)) state = "Arunachal Pradesh";
        else if (["gangtok"].includes(clow)) state = "Sikkim";
        else if (["dehradun","nainital"].includes(clow)) state = "Uttarakhand";
        else if (["shimla","dharamshala"].includes(clow)) state = "Himachal Pradesh";
        else if (["amritsar","ludhiana","jalandhar"].includes(clow)) state = "Punjab";
        else if (["jammu","srinagar"].includes(clow)) state = "Jammu & Kashmir";
        else if (["leh"].includes(clow)) state = "Ladakh";
        else if (["bhopal","indore","gwalior","jabalpur"].includes(clow)) state = "Madhya Pradesh";
        else if (["raipur","bilaspur"].includes(clow)) state = "Chhattisgarh";
        else if (["panaji","vasco da gama"].includes(clow)) state = "Goa";
        else if (["thiruvananthapuram","trivandrum","kochi","cochin","kozhikode","calicut"].includes(clow)) state = "Kerala";
      }
      break;
    }
  }
  return { place, state };
}

function computeDefaultBusinessMetadata(title, refNo, location, originalUrl) {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formattedCurrentDate = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

  // 1. Vertical Name
  let verticalName = 'Others';
  if (title) {
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('wheelchair') || lowerTitle.includes('trolley') || lowerTitle.includes('couch') || lowerTitle.includes('screen') || lowerTitle.includes('cart') || lowerTitle.includes('cabinet') || lowerTitle.includes('ward') || lowerTitle.includes('bed') || lowerTitle.includes('furniture') || lowerTitle.includes('table')) {
      verticalName = 'Medical Equipment & Furniture';
    } else if (lowerTitle.includes('centrifuge')) {
      verticalName = 'Centrifuge';
    } else if (lowerTitle.includes('freezer') || lowerTitle.includes('deep freezer')) {
      verticalName = 'Deep Freezer';
    } else if (lowerTitle.includes('hvac') || lowerTitle.includes('conditioning') || lowerTitle.includes('split ac') || lowerTitle.includes('chiller') || lowerTitle.includes('cooling')) {
      verticalName = 'HVAC';
    }
  }

  // 2. Bid Qty
  let bidQty = 1;
  if (title) {
    const qtyMatch = title.match(/quantity\s*-\s*(\d+)/i) || title.match(/qty\s*-\s*(\d+)/i);
    if (qtyMatch) {
      bidQty = parseInt(qtyMatch[1], 10);
    }
  }

  return {
    entry_date: formattedCurrentDate,
    vertical_name: verticalName,
    publish_date: 'N/A',
    start_date: 'N/A',
    due_date: 'N/A',
    bid_qty: bidQty
  };
}

async function downloadFile(url, outputPath, cookieHeader = null) {
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

  let retries = 3;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers,
        timeout: 20000
      });

      fs.writeFileSync(outputPath, response.data);
      return true;
    } catch (error) {
      if (i === retries - 1) {
        console.error(`  - Failed to download file from ${url} after all attempts:`, error.message);
        return false;
      }
      console.warn(`  - [Network Retry] Failed to download file from ${url}: ${error.message}. Retrying in 5s (attempt ${i + 1}/${retries})...`);
      await sleep(5000);
    }
  }
}

async function downloadGemPdf(tenderId, downloadUrl, bidNo = '', doc = null) {
  const localDir = path.join(process.cwd(), 'public', 'documents', tenderId);
  const localFileName = `Bid_Document_${tenderId}.pdf`;
  const outputPath = path.join(localDir, localFileName);
  const localPath = `/documents/${tenderId}/${localFileName}`;

  console.log(`  - Downloading Bid PDF from ${downloadUrl} to ${outputPath}...`);
  const { cookieHeader } = await getCredentials().catch(() => ({}));
  const success = await downloadFile(downloadUrl, outputPath, cookieHeader);
  
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
      const raSuccess = await downloadFile(raDocUrl, raOutputPath, cookieHeader);
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
          start_date = CASE WHEN ref_no LIKE '%/R/%' THEN start_date ELSE COALESCE(?, start_date) END,
          due_date = CASE WHEN ref_no LIKE '%/R/%' THEN due_date ELSE COALESCE(?, due_date) END,
          time = CASE WHEN ? = 'N/A' THEN time ELSE ? END,
          emd = COALESCE(?, emd),
          emd_raw = CASE WHEN ? = 'N/A' THEN emd_raw ELSE ? END,
          notes = notes || ?,
          ai_details_summary = NULL,
          ai_history_summary = NULL
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

// Helper sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Session parameters cache to avoid calling main page for every keyword
let cachedCookieHeader = null;
let cachedCsrfHash = null;

async function getCredentials() {
  if (cachedCookieHeader && cachedCsrfHash) {
    return { cookieHeader: cachedCookieHeader, csrfHash: cachedCsrfHash };
  }

  const mainUrl = "https://bidplus.gem.gov.in/all-bids";
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.google.com/'
  };

  console.log('[GeM Sync] Negotiating session cookie and CSRF token...');
  let mainPageRes;
  let retries = 3;
  for (let i = 0; i < retries; i++) {
    try {
      mainPageRes = await axios.get(mainUrl, { headers, timeout: 10000 });
      break;
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`[Network Retry] Failed to load GeM main page: ${err.message}. Retrying in 5s (attempt ${i + 1}/${retries})...`);
      await sleep(5000);
    }
  }
  
  // Parse cookies
  const cookies = mainPageRes.headers['set-cookie'] || [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');

  // Parse CSRF token
  const html = mainPageRes.data;
  const $ = cheerio.load(html);
  
  const csrfRegex = /'csrf_bd_gem_nk'\s*:\s*'([a-f0-9]+)'/i;
  const match = html.match(csrfRegex);
  let csrfHash = '';

  if (match) {
    csrfHash = match[1];
  } else {
    const inputVal = $('input[name="csrf_bd_gem_nk"]').val() || $('#csrf_bd_gem_nk').val();
    if (inputVal) {
      csrfHash = String(inputVal);
    }
  }

  if (!csrfHash) {
    const anyHashMatch = html.match(/'csrf_bd_gem_nk'\s*,\s*'([a-f0-9]+)'/i) || html.match(/csrf_bd_gem_nk=([a-f0-9]+)/i);
    if (anyHashMatch) {
      csrfHash = anyHashMatch[1];
    }
  }

  if (!csrfHash) {
    throw new Error('Could not parse CSRF security token from GeM portal page.');
  }

  cachedCookieHeader = cookieHeader;
  cachedCsrfHash = csrfHash;
  return { cookieHeader, csrfHash };
}

async function searchKeyword(keyword) {
  const { cookieHeader, csrfHash } = await getCredentials();

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
    'Cookie': cookieHeader
  };

  const params = new URLSearchParams();
  params.append('payload', JSON.stringify(postData));
  params.append('csrf_bd_gem_nk', csrfHash);

  let apiRes;
  let retries = 3;
  for (let i = 0; i < retries; i++) {
    try {
      apiRes = await axios.post(
        "https://bidplus.gem.gov.in/all-bids-data",
        params.toString(),
        { headers: postHeaders, timeout: 10000 }
      );
      break;
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`[Network Retry] Failed to search keyword "${keyword}": ${err.message}. Retrying in 5s (attempt ${i + 1}/${retries})...`);
      await sleep(5000);
    }
  }

  if (apiRes.data?.code !== 200) {
    throw new Error(apiRes.data?.message || 'GeM server returned non-200 code');
  }

  return apiRes.data?.response?.response?.docs || [];
}

async function run() {
  let totalImports = 0;
  let totalKeywordsProcessed = 0;

  const checkStmt = db.prepare('SELECT id FROM tenders WHERE id = ? OR ref_no = ?');
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

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    console.log(`[${i+1}/${keywords.length}] Querying GeM for: "${keyword}"...`);
    
    try {
      const docs = await searchKeyword(keyword);
      console.log(`  - Found ${docs.length} ongoing bid(s) for "${keyword}"`);
      
      let newBidsCount = 0;
      for (const doc of docs) {
        const bId = String(Array.isArray(doc.b_id) ? doc.b_id[0] : doc.b_id || doc.id);
        const bidNo = Array.isArray(doc.b_bid_number) ? doc.b_bid_number[0] : doc.b_bid_number || '';
        
        if (!bId || !bidNo) continue;

        // Check deduplication
        const existing = checkStmt.get(bId, bidNo);
        if (existing) {
          continue;
        }

        const start = Array.isArray(doc.final_start_date_sort) ? doc.final_start_date_sort[0] : doc.final_start_date_sort || '';
        const formattedStartDate = start ? start.split('T')[0] : '';
        
        // Filter: Only sync today's tenders (published/started on current calendar date in IST)
        const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        if (!allDates && formattedStartDate !== todayStr) {
          continue;
        }

        newBidsCount++;
        totalImports++;

        const items = Array.isArray(doc.b_category_name) ? doc.b_category_name.join(', ') : doc.b_category_name || '';
        const qty = Array.isArray(doc.b_total_quantity) ? doc.b_total_quantity[0] : doc.b_total_quantity || 1;
        const end = Array.isArray(doc.final_end_date_sort) ? doc.final_end_date_sort[0] : doc.final_end_date_sort || '';
        const dept = Array.isArray(doc.ba_official_details_deptName) ? doc.ba_official_details_deptName[0] : doc.ba_official_details_deptName || 'N/A';
        
        // Use parent bid ID for Reverse Auctions to ensure the document link works
        const bIdParentList = doc.b_id_parent;
        const bIdParent = (Array.isArray(bIdParentList) && bIdParentList.length > 0) ? String(bIdParentList[0]) : null;
        const docDownloadId = bIdParent || bId;
        const url = `https://bidplus.gem.gov.in/showbidDocument/${docDownloadId}`;

        // Extract parent bid number for Reverse Auctions (Option B mapping)
        const bidNoParentList = doc.b_bid_number_parent;
        const bidNoParent = (Array.isArray(bidNoParentList) && bidNoParentList.length > 0) ? String(bidNoParentList[0]) : null;
        const officialRefNo = bidNoParent || bidNo;

        // Parse location
        const { place, state } = parseLocationFromDept(dept);
        
        // Business metadata
        const defaults = computeDefaultBusinessMetadata(items, officialRefNo, `${place}, ${state}`, url);

        // Store full date-time strings if present
        let startDateTimeStr = start;
        if (start && start.includes('T')) {
          startDateTimeStr = start.replace('T', ' ').replace('Z', '').split('.')[0];
        }
        let endDateTimeStr = end;
        if (end && end.includes('T')) {
          endDateTimeStr = end.replace('T', ' ').replace('Z', '').split('.')[0];
        } else {
          endDateTimeStr = defaults.due_date;
        }

        insertStmt.run(
          bId,
          officialRefNo, // Option B: Store parent Bid number in ref_no
          items,
          dept,
          null, // estimated cost
          'N/A', // estimated cost raw
          null, // emd
          'N/A', // emd raw
          null, // doc fee
          'N/A', // doc fee raw
          `${place}, ${state}`,
          null, // sector
          endDateTimeStr, // due_date
          null, // opening date
          null, // document url (updated after download)
          url,
          'Issued',
          new Date().toISOString(),
          `Imported automatically by daily GeM Sync job matching keyword "${keyword}".`,
          defaults.entry_date,
          '', // MIS executive
          'GeM',
          bidNo, // Option B: Store active RA number in source_id
          defaults.vertical_name,
          place,
          state,
          'GeM',
          formattedStartDate, // publish_date
          startDateTimeStr, // start_date
          'N/A',
          'No',
          'No',
          items,
          defaults.vertical_name,
          qty ? Number(qty) : 1,
          qty ? Number(qty) : 1
        );

        console.log(`  - Registered new GeM Bid: ${bidNo} (Items: "${items.substring(0, 50)}...")`);

        // Download document PDF sequentially to be robust
        await downloadGemPdf(bId, url, bidNo, doc);
      }

      if (newBidsCount > 0) {
        console.log(`  - Imported ${newBidsCount} new bid(s) successfully.`);
      }
      
      totalKeywordsProcessed++;

    } catch (err) {
      console.error(`  - Error searching/importing for "${keyword}":`, err.message);
      
      // If error is related to invalid/expired CSRF, reset credentials cache so the next keyword can retry resolving
      if (err.message.includes('csrf') || err.message.includes('code') || err.message.includes('session')) {
        cachedCookieHeader = null;
        cachedCsrfHash = null;
      }
    }

    // Sleep 2.5 seconds to avoid GeM portal rate limits
    if (i < keywords.length - 1) {
      await sleep(2500);
    }
  }

  console.log('--- GeM Sync completed ---');
  console.log(`Total keywords processed: ${totalKeywordsProcessed}/${keywords.length}`);
  console.log(`Total new tenders imported: ${totalImports}`);
  process.exit(0);
}

run().catch(err => {
  console.error('Critical execution error:', err);
  process.exit(1);
});
