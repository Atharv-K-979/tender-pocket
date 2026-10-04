import { proxyToBackend } from '@/lib/backendProxy';

export async function GET(request: Request) {
  const { search } = new URL(request.url);
  return proxyToBackend(request, `/api/auth/users${search}`);
}

export async function POST(request: Request) {
  return proxyToBackend(request, '/api/auth/users');
}

export async function DELETE(request: Request) {
  const { search } = new URL(request.url);
  return proxyToBackend(request, `/api/auth/users${search}`);
}
