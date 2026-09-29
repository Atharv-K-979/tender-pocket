import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import db, { addActivityLog } from '@/lib/db';
import { workflowActor, workflowForbidden } from '@/lib/workflowAuthorization';
import {
  fetchSpecificationBackend, isObject, mapSpecificationDownloads, readSpecificationResponse,
  requirePathSegment, specificationBackendUrl, specificationFailure, SpecificationProxyError,
  validateConversionResult, localDocumentUrl,
} from '@/lib/technicalSpecificationBackend';
import type { SpecificationPayload } from '@/lib/technicalSpecificationBackend';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = workflowActor(request, 'uploadSpecs');
    if (!auth) return workflowForbidden();
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Tender ID is required' }, { status: 400 });
    }
    requirePathSegment(id);
    specificationBackendUrl(request);

    const username = auth.username;
    const userRole = auth.role;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      if (request.signal.aborted) return specificationFailure(error, request);
      throw new SpecificationProxyError(400, 'A multipart specification file is required.');
    }
    const file = formData.get('file') as File | null;

    if (!file || typeof file === 'string') {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ success: false, error: 'Uploaded file is empty' }, { status: 400 });
    }
    if (!db.prepare('SELECT id FROM tenders WHERE id = ?').get(id)) {
      return NextResponse.json({ success: false, error: 'Tender not found' }, { status: 404 });
    }

    // Ensure document directory exists: public/documents/{id}
    const docDir = path.join(process.cwd(), 'public', 'documents', id);
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
    }

    const originalFilename = path.basename((file.name || 'specification.pdf').replace(/\\/g, '/'));
    requirePathSegment(originalFilename);
    const targetFilePath = path.join(docDir, originalFilename);
    const specFilePath = path.join(docDir, 'specification.pdf');

    // Save uploaded file
    fs.writeFileSync(targetFilePath, buffer);
    // Also save copy as specification.pdf for standard spec parser lookup
    if (originalFilename !== 'specification.pdf') {
      fs.writeFileSync(specFilePath, buffer);
    }

    const backendFormData = new FormData();
    const fileBlob = new Blob([buffer], { type: file.type || 'application/pdf' });
    backendFormData.append('file', fileBlob, originalFilename);
    for (const key of ['offeredModel', 'offered_model', 'offeredMake', 'scheduleNo', 'productDescription']) {
      const value = formData.get(key);
      if (typeof value === 'string') backendFormData.append(key, value);
    }
    let backendResult: SpecificationPayload;
    let backendResponse: Response;
    try {
      backendResponse = await fetchSpecificationBackend(request,
        `/api/tenders/${encodeURIComponent(id)}/upload-tech-spec`, { method: 'POST', body: backendFormData });
      backendResult = await readSpecificationResponse(backendResponse);
      if (!backendResponse.ok || backendResult.success === false) {
        return NextResponse.json({ ...backendResult, success: false,
          error: backendResult.error || `Specification conversion failed (HTTP ${backendResponse.status}).` },
        { status: backendResponse.ok ? 502 : backendResponse.status, headers: { 'Cache-Control': 'no-store' } });
      }
      validateConversionResult(backendResult);
      backendResult = mapSpecificationDownloads(backendResult, request, id);
    } catch (error) {
      return specificationFailure(error, request);
    }

    const docUrl = localDocumentUrl(id, originalFilename);
    const createdDate = new Date().toLocaleDateString('en-IN');
    const newDocs = [{
      name: `Uploaded Input (${originalFilename})`, filename: originalFilename,
      local_path: docUrl, created_date: createdDate,
    }];
    if (backendResult.generated === true && Array.isArray(backendResult.products)) {
      const documents = backendResult.combined === true
        ? [{ ...backendResult, productName: 'Combined Technical Specifications' }]
        : backendResult.products;
      for (const product of documents) {
        if (!isObject(product)) continue;
        for (const [key, type] of [['pdfDownloadUrl', 'PDF'], ['docxDownloadUrl', 'DOCX'],
          ['xlsxDownloadUrl', 'XLSX']]) {
          const url = product[key] as string;
          newDocs.push({ name: backendResult.combined === true
            ? `Combined Technical Specifications (${type})`
            : `Technical Specification - ${String(product.productName || 'Product')} (${type})`,
            filename: decodeURIComponent(url.slice(url.lastIndexOf('/') + 1)),
            local_path: url, created_date: createdDate });
        }
      }
    }

    // Keep the approvals database in sync only after Java's final, validated result.
    // Re-read documents inside the transaction, since conversion may have taken minutes.
    try {
      db.transaction(() => {
        const tender = db.prepare('SELECT downloaded_docs FROM tenders WHERE id = ?').get(id) as
          { downloaded_docs: string | null } | undefined;
        if (!tender) throw new Error('The local tender no longer exists.');
        const currentDocs: unknown = JSON.parse(tender.downloaded_docs || '[]');
        if (!Array.isArray(currentDocs)) throw new Error('Existing document metadata is invalid.');
        for (const entry of newDocs) {
          const index = currentDocs.findIndex(doc => isObject(doc)
            && (doc.local_path === entry.local_path || doc.filename === entry.filename));
          if (index < 0) currentDocs.push(entry);
          else currentDocs[index] = { ...currentDocs[index], ...entry };
        }
        const sql = backendResult.generated === true
          ? "UPDATE tenders SET spec_verification_status = 'Generated', downloaded_docs = ? WHERE id = ?"
          : 'UPDATE tenders SET downloaded_docs = ? WHERE id = ?';
        db.prepare(sql).run(JSON.stringify(currentDocs), id);
        addActivityLog(username, userRole, 'UPLOAD_TECH_SPEC', id, backendResult.generated === true
          ? `Generated technical specification sheets from ${originalFilename}`
          : `Uploaded ${originalFilename}; no technical specifications were found.`);
      })();
    } catch (dbErr) {
      console.error('[upload-tech-spec] SQLite update error:', dbErr);
      return NextResponse.json({ ...backendResult, success: false,
        error: 'Java processing completed, but saving local document metadata failed. Check the existing result before retrying.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      ...backendResult,
      filename: originalFilename,
      url: docUrl,
    }, { status: backendResponse.status, headers: { 'Cache-Control': 'no-store' } });

  } catch (error) {
    if (error instanceof SpecificationProxyError || request.signal.aborted) return specificationFailure(error, request);
    console.error('[upload-tech-spec] Route error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error during upload' },
      { status: 500 }
    );
  }
}
