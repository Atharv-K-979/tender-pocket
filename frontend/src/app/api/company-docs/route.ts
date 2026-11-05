import path from 'node:path';
import { NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';
import { addActivityLog } from '@/lib/db';
import {
  ALLOWED_EXTENSIONS,
  COMPANY_DOC_LIMITS,
  MAX_SINGLE_FILE_BYTES,
  canManageCompanyDocs,
  categoryUsage,
  isCompanyDocCategory,
  listCompanyDocs,
  saveCompanyDoc,
  toPublicDoc,
} from '@/lib/companyDocs';

export const runtime = 'nodejs';

const MB = 1024 * 1024;

/** Any signed-in role can list company documents. */
export async function GET(request: Request) {
  const auth = getAuthFromRequest(request);
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required.' }, { status: 401 });
  }
  const docs = listCompanyDocs().map(toPublicDoc);
  return NextResponse.json({
    success: true,
    canManage: canManageCompanyDocs(auth.role),
    documents: docs,
    allowedExtensions: Object.keys(ALLOWED_EXTENSIONS),
  });
}

/** Upload one file. MIS Team only. */
export async function POST(request: Request) {
  const auth = getAuthFromRequest(request);
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required.' }, { status: 401 });
  }
  if (!canManageCompanyDocs(auth.role)) {
    return NextResponse.json({ success: false, error: 'Only the MIS Team can upload company documents.' }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid upload payload.' }, { status: 400 });
  }

  const category = formData.get('category');
  if (!isCompanyDocCategory(category)) {
    return NextResponse.json({ success: false, error: 'Invalid document category.' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 });
  }

  const name = path.basename(file.name || 'document');
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS[ext]) {
    return NextResponse.json(
      { success: false, error: `"${name}": file type not allowed. Allowed: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}` },
      { status: 400 }
    );
  }
  if (file.size > MAX_SINGLE_FILE_BYTES) {
    return NextResponse.json(
      { success: false, error: `"${name}" is larger than the ${MAX_SINGLE_FILE_BYTES / MB} MB per-file limit.` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Quota check and save run synchronously so concurrent uploads cannot both slip under the limit.
  const limits = COMPANY_DOC_LIMITS[category];
  const usage = categoryUsage(category);
  if (usage.files + 1 > limits.maxFiles) {
    return NextResponse.json(
      { success: false, error: `${limits.label} already has the maximum of ${limits.maxFiles} files. Delete some before uploading.` },
      { status: 413 }
    );
  }
  if (usage.bytes + buffer.length > limits.maxTotalBytes) {
    return NextResponse.json(
      { success: false, error: `Uploading "${name}" would exceed the ${limits.maxTotalBytes / MB} MB storage limit for ${limits.label}.` },
      { status: 413 }
    );
  }

  const doc = saveCompanyDoc(category, name, buffer, auth.username);
  addActivityLog(auth.username, auth.role, 'Uploaded Company Document', null, `${limits.label}: ${doc.original_name}`);

  return NextResponse.json({ success: true, document: toPublicDoc(doc) });
}
