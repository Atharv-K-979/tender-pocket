import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { getAuthFromRequest } from '@/lib/auth';
import { addActivityLog } from '@/lib/db';
import {
  COMPANY_DOC_LIMITS,
  canManageCompanyDocs,
  companyDocPath,
  deleteCompanyDoc,
  getCompanyDoc,
} from '@/lib/companyDocs';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Stream a document inline. Any signed-in role may view. Add ?download=1 to force a download. */
export async function GET(request: Request, { params }: Params) {
  const auth = getAuthFromRequest(request);
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required.' }, { status: 401 });
  }
  const { id } = await params;
  const doc = getCompanyDoc(id);
  if (!doc) {
    return NextResponse.json({ success: false, error: 'Document not found.' }, { status: 404 });
  }
  const filePath = companyDocPath(doc);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ success: false, error: 'Document file is missing on the server.' }, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get('download') === '1';
  const encodedName = encodeURIComponent(doc.original_name);
  const asciiName = doc.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const body = fs.readFileSync(filePath);
  return new Response(body, {
    headers: {
      'Content-Type': doc.mime_type,
      'Content-Length': String(body.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Delete a document. MIS Team only. */
export async function DELETE(request: Request, { params }: Params) {
  const auth = getAuthFromRequest(request);
  if (!auth) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Authentication required.' }, { status: 401 });
  }
  if (!canManageCompanyDocs(auth.role)) {
    return NextResponse.json({ success: false, error: 'Only the MIS Team can delete company documents.' }, { status: 403 });
  }
  const { id } = await params;
  const doc = getCompanyDoc(id);
  if (!doc) {
    return NextResponse.json({ success: false, error: 'Document not found.' }, { status: 404 });
  }
  deleteCompanyDoc(doc);
  addActivityLog(auth.username, auth.role, 'Deleted Company Document', null,
    `${COMPANY_DOC_LIMITS[doc.category].label}: ${doc.original_name}`);
  return NextResponse.json({ success: true });
}
