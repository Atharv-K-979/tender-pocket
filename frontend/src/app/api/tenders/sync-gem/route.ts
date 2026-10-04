import { proxyToBackend } from '@/lib/backendProxy';

export async function POST(request: Request) {
  return proxyToBackend(request, '/api/tenders/sync-gem');
}
