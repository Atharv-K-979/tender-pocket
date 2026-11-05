import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '@/lib/db';
import { canonicalRole } from '@/lib/workflowAuthorization';

export type CompanyDocCategory = 'profile' | 'certificates';

export interface CompanyDocLimits {
  label: string;
  maxTotalBytes: number;
  maxFiles: number;
}

const MB = 1024 * 1024;

// Storage budgets per category (agreed sizing: profile docs ~50-60 MB / 20-25 files,
// certificates ~100 MB / 100-150 files).
export const COMPANY_DOC_LIMITS: Record<CompanyDocCategory, CompanyDocLimits> = {
  profile: { label: 'Company Profile Documents', maxTotalBytes: 60 * MB, maxFiles: 25 },
  certificates: { label: 'Certificates', maxTotalBytes: 100 * MB, maxFiles: 150 },
};

export const MAX_SINGLE_FILE_BYTES = 25 * MB;

export const ALLOWED_EXTENSIONS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export interface CompanyDoc {
  id: string;
  category: CompanyDocCategory;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_at: string;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS company_documents (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_company_documents_category ON company_documents(category);
`);

/** Files live next to the SQLite DB so they share its persistent volume (e.g. /app/data in Docker). */
export function companyDocsRoot(): string {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'tenders.db');
  return process.env.COMPANY_DOCS_DIR || path.join(path.dirname(dbPath), 'company-docs');
}

export function isCompanyDocCategory(value: unknown): value is CompanyDocCategory {
  return value === 'profile' || value === 'certificates';
}

export function canManageCompanyDocs(role: string | null | undefined): boolean {
  return canonicalRole(role) === 'MIS Team';
}

/** Client-facing shape: hides the on-disk file name. */
export function toPublicDoc(doc: CompanyDoc): Omit<CompanyDoc, 'stored_name'> {
  return {
    id: doc.id,
    category: doc.category,
    original_name: doc.original_name,
    mime_type: doc.mime_type,
    size_bytes: doc.size_bytes,
    uploaded_by: doc.uploaded_by,
    uploaded_at: doc.uploaded_at,
  };
}

export function listCompanyDocs(): CompanyDoc[] {
  return db.prepare('SELECT * FROM company_documents ORDER BY category, uploaded_at DESC').all() as CompanyDoc[];
}

export function getCompanyDoc(id: string): CompanyDoc | undefined {
  return db.prepare('SELECT * FROM company_documents WHERE id = ?').get(id) as CompanyDoc | undefined;
}

export function categoryUsage(category: CompanyDocCategory): { files: number; bytes: number } {
  const row = db.prepare(
    'SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM company_documents WHERE category = ?'
  ).get(category) as { files: number; bytes: number };
  return { files: Number(row.files), bytes: Number(row.bytes) };
}

export function companyDocPath(doc: CompanyDoc): string {
  return path.join(companyDocsRoot(), doc.category, path.basename(doc.stored_name));
}

export function saveCompanyDoc(
  category: CompanyDocCategory,
  originalName: string,
  buffer: Buffer,
  uploadedBy: string
): CompanyDoc {
  const ext = path.extname(originalName).toLowerCase();
  const id = crypto.randomUUID();
  const storedName = `${id}${ext}`;
  const dir = path.join(companyDocsRoot(), category);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, storedName), buffer);

  const doc: CompanyDoc = {
    id,
    category,
    original_name: path.basename(originalName).slice(0, 255),
    stored_name: storedName,
    mime_type: ALLOWED_EXTENSIONS[ext] || 'application/octet-stream',
    size_bytes: buffer.length,
    uploaded_by: uploadedBy,
    uploaded_at: new Date().toISOString(),
  };
  try {
    db.prepare(`
      INSERT INTO company_documents (id, category, original_name, stored_name, mime_type, size_bytes, uploaded_by, uploaded_at)
      VALUES (@id, @category, @original_name, @stored_name, @mime_type, @size_bytes, @uploaded_by, @uploaded_at)
    `).run(doc);
  } catch (err) {
    fs.rmSync(path.join(dir, storedName), { force: true });
    throw err;
  }
  return doc;
}

export function deleteCompanyDoc(doc: CompanyDoc): void {
  db.prepare('DELETE FROM company_documents WHERE id = ?').run(doc.id);
  fs.rmSync(companyDocPath(doc), { force: true });
}
