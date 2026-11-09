import { proxyToBackend } from '@/lib/backendProxy';

// Attach a document from the user's PC to a tender (multipart field "file").
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToBackend(request, `/api/tenders/${encodeURIComponent(id)}/upload-document`);
}
