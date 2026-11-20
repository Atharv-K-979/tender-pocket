import { proxyToBackend } from '@/lib/backendProxy';

// Brochure Team: edit (new name and/or new file) or delete one brochure document.
type Params = { params: Promise<{ id: string; fileName: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, fileName } = await params;
  return proxyToBackend(request, `/api/tenders/${encodeURIComponent(id)}/brochures/${encodeURIComponent(fileName)}`);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, fileName } = await params;
  return proxyToBackend(request, `/api/tenders/${encodeURIComponent(id)}/brochures/${encodeURIComponent(fileName)}`);
}
