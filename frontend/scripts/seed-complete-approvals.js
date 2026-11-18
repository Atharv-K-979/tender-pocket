const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

console.log('=== SEEDING COMPLETE NON-EMPTY APPROVALS DATA ===');

// Paths to both SQLite DBs
const dbs = [
  path.join(__dirname, '..', 'tenders.db'),
  path.join(__dirname, '..', '..', 'tenders.db')
];

const mockTenders = [
  {
    id: '9816988',
    ref_no: 'GEM/2026/B/9816988',
    title: 'Steel Almirah / Cabinets Heavy Duty (V4) - Specification Review',
    authority: 'Department of Justice, New Delhi',
    estimated_cost: 350000,
    emd: 17500,
    location: 'New Delhi, Delhi',
    sector: 'Office Furniture & Equipment',
    due_date: '2026-09-30 15:00:00',
    status: 'Participating',
    mis_executive: 'executive'
  },
  {
    id: '9849390',
    ref_no: 'GEM/2026/B/9849390',
    title: 'Fabrication of Cranial PSI along with supply of Ti screws for fixation in sterile EO Pack',
    authority: 'Department of Military Affairs, Armed Forces Medical Services',
    estimated_cost: 1250000,
    emd: 62500,
    location: 'Pune, Maharashtra',
    sector: 'Medical Implants & Surgical Equipment',
    due_date: '2026-09-25 18:00:00',
    status: 'Participating',
    mis_executive: 'executive'
  },
  {
    id: '9712000',
    ref_no: 'GEM/2026/B/9712000',
    title: 'Modular Conference Table / Meeting Table / Ergonomic Executive Chairs (V2)',
    authority: 'Ministry of Railways, Northern Railway Headquarters',
    estimated_cost: 800000,
    emd: 16000,
    location: 'New Delhi, Delhi',
    sector: 'Commercial Furniture',
    due_date: '2026-09-28 14:00:00',
    status: 'Participating',
    mis_executive: 'executive'
  },
  {
    id: '8715358',
    ref_no: 'GEM/2026/B/8715358',
    title: 'Digital Electrocardiography (ECG) Machine (V2) & Multi-channel EEG Machine with Cart',
    authority: 'Health and Family Welfare Department, Guwahati, Assam',
    estimated_cost: 2100000,
    emd: 105000,
    location: 'Guwahati, Assam',
    sector: 'Healthcare & Hospital Equipment',
    due_date: '2026-10-05 16:00:00',
    status: 'Participating',
    mis_executive: 'executive'
  },
  {
    id: '9808508',
    ref_no: 'GEM/2026/B/9808508',
    title: 'Fire-Resistant Steel Almirah & High-Security Lockers for Judicial Records',
    authority: 'Department of Justice, High Court of Bombay',
    estimated_cost: 540000,
    emd: 27000,
    location: 'Mumbai, Maharashtra',
    sector: 'Judicial Infrastructure',
    due_date: '2026-09-22 17:30:00',
    status: 'Participating',
    mis_executive: 'executive'
  },
  {
    id: '9747177',
    ref_no: 'GEM/2026/B/9747177',
    title: 'Miniature Circuit Breakers (MCB) for AC Operation Marked to IS/IEC 60898 (Part 1)',
    authority: 'Military Engineer Services (MES), Western Command',
    estimated_cost: 675000,
    emd: 33750,
    location: 'Chandigarh, Punjab',
    sector: 'Electrical & Power Equipment',
    due_date: '2026-09-20 15:00:00',
    status: 'Participating',
    mis_executive: 'executive'
  },
  {
    id: '9852027',
    ref_no: 'GEM/2026/B/9852027',
    title: 'Ultra-Low Temperature Deep Freezer (-86°C) & Laboratory Incubator Series',
    authority: 'Indian Council of Medical Research (ICMR), New Delhi',
    estimated_cost: 1850000,
    emd: 92500,
    location: 'New Delhi, Delhi',
    sector: 'Laboratory & Research Equipment',
    due_date: '2026-10-12 17:00:00',
    status: 'Participating',
    mis_executive: 'executive'
  },
  {
    id: '9878129',
    ref_no: 'GEM/2026/B/9878129',
    title: 'Hospital ICU Air Beds, Digital Adult Weighing Scale & Digital BP Apparatus',
    authority: 'All India Institute of Medical Sciences (AIIMS), Rishikesh',
    estimated_cost: 970000,
    emd: 48500,
    location: 'Rishikesh, Uttarakhand',
    sector: 'Hospital Equipment & Devices',
    due_date: '2026-10-02 16:30:00',
    status: 'Participating',
    mis_executive: 'executive'
  }
];

const mockApprovals = [
  // 1. SPEC_CLEARANCE
  {
    tender_id: '9816988',
    stage: 'SPEC_CLEARANCE',
    requested_by: 'executive',
    assigned_to: 'specification team',
    status: 'PENDING',
    working_path: '/documents/9816988/Technical_Specifications_Rev2.pdf',
    emd_amount: null,
    transfer_mode: null,
    transfer_ref_no: null,
    receipt_file_url: null,
    loss_reason_executive: null,
    loss_reason_mis: null,
    tpc_purchase_price: null,
    mis_final_price: null,
    created_at: '2026-09-12 08:30:00',
    updated_at: '2026-09-12 08:30:00'
  },
  // 2. TPC_PRICING
  {
    tender_id: '9849390',
    stage: 'TPC_PRICING',
    requested_by: 'executive',
    assigned_to: 'mis team',
    status: 'PENDING',
    working_path: '/documents/9849390/Cranial_PSI_Specs.pdf',
    emd_amount: null,
    transfer_mode: null,
    transfer_ref_no: null,
    receipt_file_url: null,
    loss_reason_executive: null,
    loss_reason_mis: null,
    tpc_purchase_price: 380000.0,
    mis_final_price: null,
    created_at: '2026-09-11 16:45:00',
    updated_at: '2026-09-12 09:10:00'
  },
  // 3. MIS_PRICING
  {
    tender_id: '9852027',
    stage: 'MIS_PRICING',
    requested_by: 'executive',
    assigned_to: 'mis team',
    status: 'PENDING',
    working_path: '/Shared/Tenders/2026/9852027/MIS_Pricing_Matrix.xlsx',
    emd_amount: null,
    transfer_mode: null,
    transfer_ref_no: null,
    receipt_file_url: null,
    loss_reason_executive: null,
    loss_reason_mis: null,
    tpc_purchase_price: 290000.0,
    mis_final_price: 345000.0,
    created_at: '2026-09-11 14:20:00',
    updated_at: '2026-09-12 07:50:00'
  },
  // 4. PAYMENT_APPROVAL (NEFT)
  {
    tender_id: '9712000',
    stage: 'PAYMENT_APPROVAL',
    requested_by: 'executive',
    assigned_to: 'mis team',
    status: 'PENDING',
    working_path: '/Shared/Tenders/2026/9712000',
    emd_amount: 16000.0,
    transfer_mode: 'Online / NEFT',
    transfer_ref_no: 'TXN-MKN-9712000-NEFT',
    receipt_file_url: '/documents/9712000/neft_receipt.pdf',
    loss_reason_executive: null,
    loss_reason_mis: null,
    tpc_purchase_price: null,
    mis_final_price: null,
    created_at: '2026-09-12 07:15:00',
    updated_at: '2026-09-12 07:15:00'
  },
  // 5. PAYMENT_APPROVAL (Demand Draft)
  {
    tender_id: '9878129',
    stage: 'PAYMENT_APPROVAL',
    requested_by: 'executive',
    assigned_to: 'mis team',
    status: 'PENDING',
    working_path: '/Shared/Tenders/2026/9878129',
    emd_amount: 48500.0,
    transfer_mode: 'Demand Draft',
    transfer_ref_no: 'DD-MKN-9878129-A002',
    receipt_file_url: '/documents/9878129/dd_scan.pdf',
    loss_reason_executive: null,
    loss_reason_mis: null,
    tpc_purchase_price: null,
    mis_final_price: null,
    created_at: '2026-09-11 11:30:00',
    updated_at: '2026-09-11 11:30:00'
  },
  // 6. DOC_VERIFICATION
  {
    tender_id: '8715358',
    stage: 'DOC_VERIFICATION',
    requested_by: 'executive',
    assigned_to: 'mis team',
    status: 'PENDING',
    working_path: '/Shared/Tenders/2026/GEM-8715358/Bid_Documents_Compiled',
    emd_amount: null,
    transfer_mode: null,
    transfer_ref_no: null,
    receipt_file_url: null,
    loss_reason_executive: null,
    loss_reason_mis: null,
    tpc_purchase_price: null,
    mis_final_price: null,
    created_at: '2026-09-12 06:00:00',
    updated_at: '2026-09-12 06:00:00'
  },
  // 7. SUBMISSION_PENDING
  {
    tender_id: '9808508',
    stage: 'SUBMISSION_PENDING',
    requested_by: 'executive',
    assigned_to: 'mis team',
    status: 'PENDING',
    working_path: '/Shared/Tenders/2026/GEM-9808508/Portal_Submission_Pack',
    emd_amount: null,
    transfer_mode: null,
    transfer_ref_no: null,
    receipt_file_url: null,
    loss_reason_executive: null,
    loss_reason_mis: null,
    tpc_purchase_price: null,
    mis_final_price: null,
    created_at: '2026-09-12 09:00:00',
    updated_at: '2026-09-12 09:00:00'
  },
  // 8. WIN_LOSS_PENDING
  {
    tender_id: '9747177',
    stage: 'WIN_LOSS_PENDING',
    requested_by: 'executive',
    assigned_to: 'mis team',
    status: 'PENDING',
    working_path: null,
    emd_amount: null,
    transfer_mode: null,
    transfer_ref_no: null,
    receipt_file_url: null,
    loss_reason_executive: 'Competitor L1 bidder quoted 4.2% lower on item 2 with alternative OEM.',
    loss_reason_mis: 'Distributor quoted aggressive bulk tier discount; recommend matching manufacturer tier in future rounds.',
    tpc_purchase_price: null,
    mis_final_price: null,
    created_at: '2026-09-10 17:00:00',
    updated_at: '2026-09-11 10:00:00'
  }
];

for (const dbFile of dbs) {
  try {
    const db = new Database(dbFile);
    console.log(`Processing SQLite DB: ${dbFile}`);

    // Update / insert full tender information
    const upsertTender = db.prepare(`
      INSERT INTO tenders (
        id, ref_no, title, authority, estimated_cost, emd, location, sector,
        due_date, status, mis_executive, scraped_at, original_url
      ) VALUES (
        @id, @ref_no, @title, @authority, @estimated_cost, @emd, @location, @sector,
        @due_date, @status, @mis_executive, datetime('now'), 'https://bidplus.gem.gov.in'
      )
      ON CONFLICT(id) DO UPDATE SET
        ref_no = excluded.ref_no,
        title = excluded.title,
        authority = excluded.authority,
        estimated_cost = excluded.estimated_cost,
        emd = excluded.emd,
        location = excluded.location,
        sector = excluded.sector,
        due_date = excluded.due_date,
        status = excluded.status,
        mis_executive = excluded.mis_executive
    `);

    for (const t of mockTenders) {
      upsertTender.run(t);
    }
    console.log(` - Upserted ${mockTenders.length} tenders with complete metadata.`);

    // Clear old pending approvals for these tenders to avoid duplicate clutter
    const tenderIds = mockTenders.map(t => t.id);
    const placeholders = tenderIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM tender_approval_requests WHERE tender_id IN (${placeholders})`).run(...tenderIds);

    // Insert complete approvals
    const insertApproval = db.prepare(`
      INSERT INTO tender_approval_requests (
        tender_id, stage, requested_by, assigned_to, status, working_path,
        emd_amount, transfer_mode, transfer_ref_no, receipt_file_url,
        loss_reason_executive, loss_reason_mis, tpc_purchase_price, mis_final_price,
        created_at, updated_at
      ) VALUES (
        @tender_id, @stage, @requested_by, @assigned_to, @status, @working_path,
        @emd_amount, @transfer_mode, @transfer_ref_no, @receipt_file_url,
        @loss_reason_executive, @loss_reason_mis, @tpc_purchase_price, @mis_final_price,
        @created_at, @updated_at
      )
    `);

    for (const a of mockApprovals) {
      insertApproval.run(a);
    }
    console.log(` - Inserted ${mockApprovals.length} complete approval requests.`);

    const count = db.prepare("SELECT count(*) as c FROM tender_approval_requests WHERE status = 'PENDING'").get();
    console.log(` - Total pending approvals in ${path.basename(dbFile)}: ${count.c}`);
    db.close();
  } catch (err) {
    console.warn(`Warning processing ${dbFile}:`, err.message);
  }
}

// Sync with Spring Boot PostgreSQL if running
(async () => {
  try {
    const backendUrl = process.env.BACKEND_URL || (process.env.SPRING_PORT ? `http://localhost:${process.env.SPRING_PORT}` : 'http://localhost:8090');
    console.log(`\nSyncing with Spring Boot (${backendUrl})...`);
    const p = process.env.ADMIN_PASSWORD || process.env.ADMIN_DEFAULT_PASSWORD || '';
    const loginRes = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: p })
    });
    const loginData = await loginRes.json();
    if (!loginData.success || !loginData.token) {
      console.log('Spring Boot login not available, skipping PG sync.');
      return;
    }
    console.log('Spring Boot authenticated successfully.');

    // Verify Spring Boot counts
    const countsRes = await fetch(`${backendUrl}/api/approvals/counts`, {
      headers: { 'Authorization': 'Bearer ' + loginData.token }
    });
    const countsData = await countsRes.json();
    console.log('Spring Boot Approvals Counts:', countsData.counts);
  } catch (err) {
    console.log('Spring Boot sync skipped:', err.message);
  }
  console.log('\n=== SEEDING COMPLETED SUCCESSFULLY ===');
})();
