import { proxyToBackend } from '@/lib/backendProxy';

export async function GET(request: Request) {
  const { search } = new URL(request.url);
  return proxyToBackend(request, `/api/activity-logs${search}`);
}

export async function POST(request: Request) {
  return proxyToBackend(request, '/api/activity-logs');
}
