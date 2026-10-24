import { proxyToBackend } from '@/lib/backendProxy';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToBackend(request, `/api/products/models/${encodeURIComponent(id)}/specifications`, { method: 'PUT' });
}
