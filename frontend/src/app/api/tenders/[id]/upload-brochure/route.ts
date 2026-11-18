import { proxyToBackend } from '@/lib/backendProxy';

// Brochure Team uploads the brochure (PDF, Word or Excel) after Clearance approval.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToBackend(request, `/api/tenders/${encodeURIComponent(id)}/upload-brochure`);
}
