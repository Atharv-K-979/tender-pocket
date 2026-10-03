import { NextResponse } from 'next/server';
import db, { Tender } from '@/lib/db';
import { workflowActor, workflowForbidden, redactManufacturerPricing, forbiddenPatchFields } from '@/lib/workflowAuthorization';
import { getTodayISTString, isLapsed, resolveStatus } from '@/lib/tenderStatus';

export async function GET(request: Request) {
  try {
    const auth = workflowActor(request, 'viewTenders');
    if (!auth) return workflowForbidden();

    const { searchParams } = new URL(request.url);
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8090';

    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };

    const authHeader = request.headers.get('authorization');
    if (authHeader) headers['authorization'] = authHeader;

    const userRoleHeader = request.headers.get('x-user-role');
    if (userRoleHeader) headers['x-user-role'] = userRoleHeader;

    const usernameHeader = request.headers.get('x-user-username');
    if (usernameHeader) headers['x-user-username'] = usernameHeader;

    const targetUrl = `${backendUrl}/api/tenders?${searchParams.toString()}`;
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      cache: 'no-store'
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('Error proxying GET /api/tenders to backend:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = workflowActor(request, 'viewTenders');
    if (!auth) return workflowForbidden();
    const body = await request.json();
    const {
      id, ref_no, title, authority, estimated_cost, estimated_cost_raw,
      emd, emd_raw, document_fee, document_fee_raw, location, sector,
      due_date, opening_date, document_url, original_url, status
    } = body;

    if (!id || !title || !original_url) {
      return NextResponse.json(
        { success: false, error: 'id, title, and original_url are required' },
        { status: 400 }
      );
    }

    if (forbiddenPatchFields(auth.role, body, {}).length) return workflowForbidden();
    if (db.prepare('SELECT id FROM tenders WHERE id = ?').get(id)) {
      return NextResponse.json({ success: false, error: 'Tender already exists. Use its update endpoint.' }, { status: 409 });
    }
    const stmt = db.prepare(`
      INSERT INTO tenders (
        id, ref_no, title, authority, estimated_cost, estimated_cost_raw,
        emd, emd_raw, document_fee, document_fee_raw, location, sector,
        due_date, opening_date, document_url, original_url, status, scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      ref_no || null,
      title,
      authority || null,
      estimated_cost || null,
      estimated_cost_raw || null,
      emd || null,
      emd_raw || null,
      document_fee || null,
      document_fee_raw || null,
      location || null,
      sector || null,
      due_date || null,
      opening_date || null,
      document_url || null,
      original_url,
      status || 'New',
      new Date().toISOString()
    );

    return NextResponse.json({ success: true, message: 'Tender added successfully' });
  } catch (error) {
    console.error('Error creating tender:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
