import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { downloadAndSaveTenderDocuments } from '@/lib/scraper';
import { getAuthFromRequest } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; filename: string | string[] }> }) {
  try {
    // 1. Enforce authentication on document proxy endpoint
    const auth = getAuthFromRequest(request);
    if (!auth) {
      return Response.json(
        { success: false, error: 'Unauthorized: Authentication required to access documents.' },
        { status: 401 }
      );
    }

    const rawParams = await params;
    const rawId = rawParams.id;
    if (!rawId || typeof rawId !== 'string' || rawId.includes('..') || rawId.includes('/') || rawId.includes('\\')) {
      return Response.json({ success: false, error: 'Invalid tender ID.' }, { status: 400 });
    }
    const safeId = path.basename(rawId);
    if (!safeId || safeId === '.' || safeId === '..') {
      return Response.json({ success: false, error: 'Invalid tender ID.' }, { status: 400 });
    }
    
    // Support string or array of path parts
    const rawFilename = rawParams.filename;
    const rawSegments = Array.isArray(rawFilename) ? rawFilename : [rawFilename];
    for (const seg of rawSegments) {
      if (!seg || typeof seg !== 'string' || seg.includes('..') || seg.includes('/') || seg.includes('\\')) {
        return Response.json({ success: false, error: 'Invalid document filename.' }, { status: 400 });
      }
    }
    const filenameSegments = rawSegments.map(p => path.basename(p));
    const filenameStr = filenameSegments.join('/');

    const docsDir = path.resolve(process.cwd(), 'public', 'documents');
    let targetPath = path.resolve(docsDir, safeId, ...filenameSegments);

    if (!targetPath.startsWith(docsDir + path.sep)) {
      return Response.json({ success: false, error: 'Invalid document path.' }, { status: 400 });
    }

    // If file does not exist on local disk in frontend, query backend (S3 presigned URL 302 or backend stream)
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      const backendBaseUrl = process.env.BACKEND_URL || 'http://localhost:8090';
      try {
        const headers: Record<string, string> = {
          'x-user-role': auth.role,
          'x-user-username': auth.username,
        };
        const authHeader = request.headers.get('authorization');
        if (authHeader) {
          headers['authorization'] = authHeader;
        }

        const backendRes = await fetch(`${backendBaseUrl}/documents/${encodeURIComponent(safeId)}/${encodeURIComponent(filenameStr)}`, {
          method: 'GET',
          redirect: 'manual',
          headers,
        });
        if (backendRes.status === 302 || backendRes.status === 301 || backendRes.status === 307) {
          const loc = backendRes.headers.get('location');
          if (loc) {
            return Response.redirect(loc, 302);
          }
        } else if (backendRes.ok) {
          const ab = await backendRes.arrayBuffer();
          return new Response(new Uint8Array(ab), {
            headers: {
              'Content-Type': backendRes.headers.get('content-type') || 'application/octet-stream',
              'Content-Disposition': backendRes.headers.get('content-disposition') || `attachment; filename="${filenameSegments[filenameSegments.length - 1]}"`,
              'Cache-Control': 'no-store'
            }
          });
        }
      } catch (backendFetchErr) {
        // Backend unreachable or returned 404, continue to on-demand fallback
      }

      console.log(`[Document Download API] ${filenameStr} missing for Tender ${safeId}. Attempting on-demand retrieval...`);

      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const lowerName = filenameStr.toLowerCase();

      // 1. On-demand live GeM PDF download (handles both Bid and RA documents)
      if (lowerName.endsWith('.pdf')) {
        const gemUrlsToTry = [
          `https://bidplus.gem.gov.in/showradocumentPdf/${safeId}`,
          `https://bidplus.gem.gov.in/showbidDocument/${safeId}`,
          `https://bidplus.gem.gov.in/showradocument/${safeId}`
        ];

        for (const gemUrl of gemUrlsToTry) {
          if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 500) break;
          try {
            console.log(`[Document Download API] Fetching from GeM: ${gemUrl}`);
            const res = await axios.get(gemUrl, {
              responseType: 'arraybuffer',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              },
              timeout: 15000
            });
            if (res.status === 200 && res.data && res.data.length > 500) {
              fs.writeFileSync(targetPath, res.data);
              console.log(`[Document Download API] Saved ${filenameStr} (${res.data.length} bytes) to ${targetPath}`);
              break;
            }
          } catch (gemErr: any) {
            console.warn(`[Document Download API] GeM fetch failed for ${gemUrl}: ${gemErr.message}`);
          }
        }
      }

      // 2. Fallback: try downloadAndSaveTenderDocuments via Tender247 scraper
      if (!fs.existsSync(targetPath)) {
        try {
          console.log(`[Document Download API] Invoking downloadAndSaveTenderDocuments for tender ${safeId}...`);
          await downloadAndSaveTenderDocuments(safeId);
        } catch (scraperErr: any) {
          console.warn(`[Document Download API] Scraper download failed: ${scraperErr.message}`);
        }
      }

      // 3. Case-insensitive or fuzzy match within safeId directory
      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
        const searchDir = path.resolve(docsDir, safeId);
        const baseNameOnly = path.basename(filenameStr).toLowerCase();
        if (fs.existsSync(searchDir)) {
          const files = fs.readdirSync(searchDir);
          const matched = files.find(f => f.toLowerCase() === baseNameOnly);
          if (matched) {
            targetPath = path.resolve(searchDir, matched);
          }
        }
      }
    }

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      return Response.json({ success: false, error: 'Document file is not available on site.' }, { status: 404 });
    }

    const bytes = fs.readFileSync(targetPath);
    const extension = path.extname(targetPath).toLowerCase();
    const types: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.zip': 'application/zip',
      '.csv': 'text/csv',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg'
    };

    const finalFileName = path.basename(targetPath);

    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': types[extension] || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${finalFileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }
    });
  } catch (error) {
    console.error('[Document Download API Error]:', error);
    return Response.json({ success: false, error: 'Could not read the document.' }, { status: 500 });
  }
}
