import {
  fetchSpecificationBackend, mapSpecificationDownloads, readSpecificationResponse,
  requirePathSegment, specificationFailure,
} from '@/lib/technicalSpecificationBackend';

export const runtime = 'nodejs';
import { workflowActor, workflowForbidden } from '@/lib/workflowAuthorization';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!workflowActor(request, 'viewTenders')) return workflowForbidden();
    const { id } = await params;
    requirePathSegment(id);
    const response = await fetchSpecificationBackend(request, `/api/tenders/${encodeURIComponent(id)}/tech-spec-progress`);
    const result = await readSpecificationResponse(response);
    if (result && result.status && result.status !== 'NOT_STARTED') {
      console.log(`⚡ [PROGRESS LOG] Tender ${id} | ${result.status} | ${result.percent}% | ${result.message}`);
    }
    return Response.json(response.ok ? mapSpecificationDownloads(result, request, id) : result,
      { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return specificationFailure(error, request);
  }
}
