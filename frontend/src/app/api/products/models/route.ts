import { proxyToBackend } from '@/lib/backendProxy';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const search = url.search;
  return proxyToBackend(request, `/api/products/models${search}`);
}
