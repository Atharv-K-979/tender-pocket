import { proxyToBackend } from '@/lib/backendProxy';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToBackend(request, `/api/tenders/${encodeURIComponent(id)}/comments`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToBackend(request, `/api/tenders/${encodeURIComponent(id)}/comments`);
}
