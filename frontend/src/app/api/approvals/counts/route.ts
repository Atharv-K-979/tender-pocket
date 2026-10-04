import { proxyToBackend } from '@/lib/backendProxy';

export async function GET(request: Request) {
  const { search } = new URL(request.url);
  return proxyToBackend(request, `/api/approvals/counts${search}`);
}
