import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8090';

/** Statuses whose response must not have a body (a Response with one would throw). */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** JSON responses smaller than this are sent uncompressed (gzip would not pay off). */
const MIN_GZIP_BYTES = 1024;

export async function proxyToBackend(
  request: Request,
  backendPath: string,
  options?: { method?: string; body?: any }
) {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    const authHeader = request.headers.get('authorization');
    if (authHeader) headers['authorization'] = authHeader;

    const roleHeader = request.headers.get('x-user-role');
    if (roleHeader) headers['x-user-role'] = roleHeader;

    const usernameHeader = request.headers.get('x-user-username');
    if (usernameHeader) headers['x-user-username'] = usernameHeader;

    const method = options?.method || request.method;

    // "Anything new?": the backend answers 304 Not Modified when the data still has this ETag.
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch && method === 'GET') headers['If-None-Match'] = ifNoneMatch;
    let requestBody: any = undefined;

    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      if (options?.body !== undefined) {
        requestBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        headers['Content-Type'] = 'application/json';
      } else {
        const contentType = request.headers.get('content-type') || '';
        if (contentType.includes('multipart/form-data')) {
          requestBody = await request.formData();
        } else {
          const text = await request.text();
          if (text) {
            requestBody = text;
            if (contentType) headers['Content-Type'] = contentType;
          }
        }
      }
    }

    const targetUrl = `${BACKEND_URL}${backendPath}`;
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: requestBody,
      cache: 'no-store',
      // A read the browser has given up on (page left, newer request sent) stops here too.
      // Writes are never cancelled half-way.
      signal: method === 'GET' ? request.signal : undefined,
    });

    const etag = response.headers.get('etag');
    if (NULL_BODY_STATUSES.has(response.status)) {
      return new Response(null, { status: response.status, headers: etag ? { ETag: etag } : undefined });
    }

    const responseContentType = response.headers.get('content-type') || '';
    if (responseContentType.includes('application/json')) {
      // Pass the JSON through unchanged, without decoding and re-encoding large lists.
      const responseHeaders = new Headers({ 'Content-Type': responseContentType, 'Vary': 'Accept-Encoding' });
      if (etag) responseHeaders.set('ETag', etag);
      // Next.js compresses pages but not API responses: gzip JSON here (a tender list is ~10x smaller).
      const declaredLength = Number(response.headers.get('content-length') || '0');
      const acceptsGzip = /\bgzip\b/i.test(request.headers.get('accept-encoding') || '');
      if (acceptsGzip && response.body && (declaredLength === 0 || declaredLength >= MIN_GZIP_BYTES)) {
        responseHeaders.set('Content-Encoding', 'gzip');
        return new Response(response.body.pipeThrough(new CompressionStream('gzip')), { status: response.status, headers: responseHeaders });
      }
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    } else {
      const text = await response.text();
      return new NextResponse(text, { status: response.status, headers: { 'Content-Type': responseContentType } });
    }
  } catch (error) {
    if (request.signal?.aborted) {
      // The browser closed the request; nobody is waiting for an answer.
      return new Response(null, { status: 499 });
    }
    console.error(`Error proxying ${request.method} ${backendPath} to backend:`, error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
