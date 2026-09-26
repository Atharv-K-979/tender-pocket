import { NextResponse } from 'next/server';
import { workflowActor, workflowForbidden } from '@/lib/workflowAuthorization';
import { syncGeMTenders } from '@/lib/gemSyncEngine';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    if (!workflowActor(request, 'viewTenders')) return workflowForbidden();
    
    // 1. Run live GeM sync engine
    const syncResult = await syncGeMTenders();

    // 2. Notify Spring Boot backend in background if running
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8090';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const headers: Record<string, string> = { Accept: 'application/json' };
      const authHeader = request.headers.get('authorization');
      if (authHeader) headers['authorization'] = authHeader;
      const role = request.headers.get('x-user-role');
      if (role) headers['x-user-role'] = role;

      fetch(`${backendUrl}/api/tenders/sync-gem`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        cache: 'no-store'
      }).catch(() => {});
      clearTimeout(timeout);
    } catch (_) {}

    return NextResponse.json(syncResult);
  } catch (error) {
    console.error('[sync-gem] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
