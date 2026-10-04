import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8090';

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
    });

    const responseContentType = response.headers.get('content-type') || '';
    if (responseContentType.includes('application/json')) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    } else {
      const text = await response.text();
      return new NextResponse(text, { status: response.status, headers: { 'Content-Type': responseContentType } });
    }
  } catch (error) {
    console.error(`Error proxying ${request.method} ${backendPath} to backend:`, error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
