import { fetchSpecificationBackend, specificationFailure, SpecificationProxyError } from '@/lib/technicalSpecificationBackend';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const response = await fetchSpecificationBackend(request, '/compliance-progress.js',
      { headers: { Accept: 'text/javascript, application/javascript' } });
    if (!response.ok || !/javascript|ecmascript/i.test(response.headers.get('content-type') || '')) {
      throw new SpecificationProxyError(502, 'The compliance progress client is unavailable.');
    }
    return new Response(response.body, { headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    } });
  } catch (error) {
    return specificationFailure(error, request);
  }
}
