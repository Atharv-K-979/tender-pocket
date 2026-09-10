import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'tenders.db');

// Declare global type to store db instance on globalThis in dev to prevent hot-reload resource leakage
declare global {
  var dbInstance: Database.Database | undefined;
}

let db: Database.Database;

if (process.env.NODE_ENV === 'production') {
  db = new Database(dbPath);
} else {
  if (!globalThis.dbInstance) {
    globalThis.dbInstance = new Database(dbPath);
  }
  db = globalThis.dbInstance;
}

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tenders (
    id TEXT PRIMARY KEY,
    ref_no TEXT,
    title TEXT NOT NULL,
    authority TEXT,
    estimated_cost REAL,
    estimated_cost_raw TEXT,
    emd REAL,
    emd_raw TEXT,
    document_fee REAL,
    document_fee_raw TEXT,
    location TEXT,
    sector TEXT,
    due_date TEXT,
    opening_date TEXT,
    document_url TEXT,
    downloaded_docs TEXT,
    original_url TEXT NOT NULL,
    status TEXT DEFAULT 'Issued',
    notes TEXT DEFAULT '',
    scraped_at TEXT NOT NULL,
    entry_date TEXT,
    mis_executive TEXT,
    source TEXT,
    source_id TEXT,
    vertical_name TEXT,
    place TEXT,
    state TEXT,
    tender_type TEXT,
    publish_date TEXT,
    start_date TEXT,
    time TEXT,
    pre_bid_date TEXT,
    corrigendum_remark TEXT,
    product_name_as_per_tender TEXT,
    product_name_as_per_marken TEXT,
    bid_qty INTEGER,
    quoted_qty INTEGER,
    ai_details_summary TEXT,
    ai_history_summary TEXT
  );

  CREATE TABLE IF NOT EXISTS processed_emails (
    id TEXT PRIMARY KEY,
    subject TEXT,
    sender TEXT,
    received_at TEXT,
    processed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tender_id TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    notes TEXT,
    FOREIGN KEY(tender_id) REFERENCES tenders(id) ON DELETE CASCADE
  );

  CREATE TRIGGER IF NOT EXISTS tender_status_insert_trigger
  AFTER INSERT ON tenders
  FOR EACH ROW
  BEGIN
    INSERT INTO status_history (tender_id, from_status, to_status, changed_at, notes)
    VALUES (new.id, NULL, new.status, datetime('now'), 'Tender created/imported.');
  END;

  CREATE TRIGGER IF NOT EXISTS tender_status_update_trigger
  AFTER UPDATE OF status ON tenders
  FOR EACH ROW
  WHEN (old.status IS NULL AND new.status IS NOT NULL) 
    OR (old.status IS NOT NULL AND new.status IS NULL) 
    OR (old.status != new.status)
  BEGIN
    INSERT INTO status_history (tender_id, from_status, to_status, changed_at, notes)
    VALUES (new.id, old.status, new.status, datetime('now'), 'Status transitioned.');
  END;

  CREATE TRIGGER IF NOT EXISTS tender_corrigendum_update_trigger
  AFTER UPDATE OF corrigendum_remark ON tenders
  FOR EACH ROW
  WHEN (old.corrigendum_remark IS NULL AND new.corrigendum_remark = 'Yes')
    OR (old.corrigendum_remark != new.corrigendum_remark AND new.corrigendum_remark = 'Yes')
  BEGIN
    INSERT INTO status_history (tender_id, from_status, to_status, changed_at, notes)
    VALUES (new.id, new.status, new.status, datetime('now'), 'System Alert: Corrigendum processed.');
  END;

  -- Run status migrations to align with new status mapping
  UPDATE tenders SET status = 'Participating' WHERE status = 'In Progress';
  UPDATE tenders SET status = 'Not Participating' WHERE status = 'Rejected';
  UPDATE tenders SET status = 'Filed' WHERE status = 'Ready to be Filed';

  UPDATE status_history SET from_status = 'Participating' WHERE from_status = 'In Progress';
  UPDATE status_history SET to_status = 'Participating' WHERE to_status = 'In Progress';
  UPDATE status_history SET from_status = 'Not Participating' WHERE from_status = 'Rejected';
  UPDATE status_history SET to_status = 'Not Participating' WHERE to_status = 'Rejected';
  UPDATE status_history SET from_status = 'Filed' WHERE from_status = 'Ready to be Filed';
  UPDATE status_history SET to_status = 'Filed' WHERE to_status = 'Ready to be Filed';

  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    email TEXT
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    tender_id TEXT,
    timestamp TEXT NOT NULL,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS tender_workflow_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tender_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    author TEXT NOT NULL,
    author_role TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(tender_id) REFERENCES tenders(id) ON DELETE CASCADE
  );
`);

// Dynamic schema migration
const newColumns = [
  { name: 'downloaded_docs', type: 'TEXT' },
  { name: 'entry_date', type: 'TEXT' },
  { name: 'mis_executive', type: 'TEXT' },
  { name: 'source', type: 'TEXT' },
  { name: 'source_id', type: 'TEXT' },
  { name: 'vertical_name', type: 'TEXT' },
  { name: 'place', type: 'TEXT' },
  { name: 'state', type: 'TEXT' },
  { name: 'tender_type', type: 'TEXT' },
  { name: 'publish_date', type: 'TEXT' },
  { name: 'start_date', type: 'TEXT' },
  { name: 'time', type: 'TEXT' },
  { name: 'pre_bid_date', type: 'TEXT' },
  { name: 'corrigendum_remark', type: 'TEXT' },
  { name: 'product_name_as_per_tender', type: 'TEXT' },
  { name: 'product_name_as_per_marken', type: 'TEXT' },
  { name: 'bid_qty', type: 'INTEGER' },
  { name: 'quoted_qty', type: 'INTEGER' },
  { name: 'ai_details_summary', type: 'TEXT' },
  { name: 'ai_history_summary', type: 'TEXT' },
  { name: 'assigned_by', type: 'TEXT' },
  { name: 'assigned_at', type: 'TEXT' },
  { name: 'working_path', type: 'TEXT' },
  { name: 'assigned_mis_member', type: 'TEXT' },
  { name: 'emd_amount_actual', type: 'REAL' },
  { name: 'emd_payment_mode', type: 'TEXT' },
  { name: 'emd_payment_ref', type: 'TEXT' },
  { name: 'emd_payment_date', type: 'TEXT' },
  { name: 'loss_reason', type: 'TEXT' },
  { name: 'payment_status', type: "TEXT DEFAULT 'None'" },
  { name: 'verification_status', type: "TEXT DEFAULT 'None'" },
  { name: 'submission_status', type: "TEXT DEFAULT 'None'" },
  { name: 'outcome_status', type: "TEXT DEFAULT 'None'" },
  { name: 'assigned_mis_member_emd', type: 'TEXT' },
  { name: 'assigned_mis_member_docs', type: 'TEXT' },
  { name: 'assigned_mis_member_submission', type: 'TEXT' },
  { name: 'spec_verification_status', type: "TEXT DEFAULT 'None'" },
  { name: 'assigned_mis_member_spec', type: 'TEXT' }
];

for (const col of newColumns) {
  try {
    db.exec(`ALTER TABLE tenders ADD COLUMN ${col.name} ${col.type}`);
  } catch (e) {
    // Ignored if column already exists
  }
}

// Dynamic users schema migration
try {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT");
} catch (e) {
  // Ignored if column already exists
}

// User password hashing helper
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Seed default admin user if empty or missing
try {
  const insertUser = db.prepare("INSERT OR IGNORE INTO users (username, password_hash, role, email) VALUES (?, ?, ?, ?)");
  insertUser.run('admin', hashPassword('Marken@123$'), 'Admin', 'admin@company.com');
  console.log('Seeded database with default admin user.');
} catch (err) {
  console.error('Failed to seed default users:', err);
}

// Activity logging helper
export function addActivityLog(username: string, role: string, action: string, tenderId: string | null, details: string | null = null) {
  try {
    const stmt = db.prepare(`
      INSERT INTO activity_log (username, role, action, tender_id, timestamp, details)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'), ?)
    `);
    stmt.run(username, role, action, tenderId, details);
  } catch (err) {
    console.error('Failed to write activity log:', err);
  }
}

export default db;
export interface Tender {
  id: string;
  ref_no: string | null;
  title: string;
  authority: string | null;
  estimated_cost: number | null;
  estimated_cost_raw: string | null;
  emd: number | null;
  emd_raw: string | null;
  document_fee: number | null;
  document_fee_raw: string | null;
  location: string | null;
  sector: string | null;
  due_date: string | null;
  opening_date: string | null;
  document_url: string | null;
  downloaded_docs?: string | null;
  original_url: string;
  status: 'Issued' | 'Participating' | 'Not Participating' | 'Lapsed (Unreviewed)' | 'Filed' | 'Awarded' | 'Not Awarded' | 'Business Loss due to Non-Submission' | 'Business Loss due to Non-Participation' | 'New' | 'Lapsed' | 'Submitted' | 'Won' | 'Lost' | 'Missed Deadline' | 'Missed Opportunity';
  notes: string;
  scraped_at: string;
  entry_date?: string | null;
  mis_executive?: string | null;
  assigned_by?: string | null;
  assigned_at?: string | null;
  source?: string | null;
  source_id?: string | null;
  vertical_name?: string | null;
  place?: string | null;
  state?: string | null;
  tender_type?: string | null;
  publish_date?: string | null;
  start_date?: string | null;
  time?: string | null;
  pre_bid_date?: string | null;
  corrigendum_remark?: string | null;
  product_name_as_per_tender?: string | null;
  product_name_as_per_marken?: string | null;
  bid_qty?: number | null;
  quoted_qty?: number | null;
  ai_details_summary?: string | null;
  ai_history_summary?: string | null;
  working_path?: string | null;
  assigned_mis_member?: string | null;
  assigned_mis_member_emd?: string | null;
  assigned_mis_member_docs?: string | null;
  assigned_mis_member_submission?: string | null;
  assigned_mis_member_spec?: string | null;
  emd_amount_actual?: number | null;
  emd_payment_mode?: string | null;
  emd_payment_ref?: string | null;
  emd_payment_date?: string | null;
  loss_reason?: string | null;
  payment_status?: 'None' | 'Pending' | 'Approved' | 'Rejected';
  verification_status?: 'None' | 'Pending' | 'Approved' | 'Rejected';
  submission_status?: 'None' | 'Pending' | 'Approved';
  outcome_status?: 'None' | 'Pending' | 'Won' | 'Lost';
  spec_verification_status?: 'None' | 'Pending' | 'Approved' | 'Rejected' | 'Generated';
  has_tech_spec?: boolean;
  tech_spec_file?: string | null;
}

export interface ProcessedEmail {
  id: string;
  subject: string | null;
  sender: string | null;
  received_at: string | null;
  processed_at: string;
}
