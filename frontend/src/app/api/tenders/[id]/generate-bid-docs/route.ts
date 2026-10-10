import { NextResponse } from 'next/server';
import db, { type Tender, addActivityLog } from '@/lib/db';
import { workflowActor, workflowForbidden, canPerform, canonicalRole } from '@/lib/workflowAuthorization';
import { localDocumentUrl } from '@/lib/technicalSpecificationBackend';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execSync } from 'child_process';
import { generateHtmlTemplates, generateTechnicalSpecificationHtml, cleanHtmlForDocx, sanitizeDocxBuffer, getDocxHeaderHtml, getDocxFooterHtml } from '@/lib/documentTemplates';

// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import puppeteer from 'puppeteer';

function splitLine(line: string): { left: string, right: string } {
  const firstCharIdx = line.search(/\S/);
  if (firstCharIdx === -1) {
    return { left: '', right: '' };
  }
  
  if (firstCharIdx >= 30) {
    return { left: '', right: line.trim() };
  }
  
  const remaining = line.substring(firstCharIdx);
  const gapMatch = remaining.match(/\s{3,}/);
  if (gapMatch && gapMatch.index !== undefined) {
    const gapStart = firstCharIdx + gapMatch.index;
    const gapEnd = gapStart + gapMatch[0].length;
    
    if (gapEnd >= 30) {
      return {
        left: line.substring(0, gapStart).trim(),
        right: line.substring(gapEnd).trim()
      };
    }
  }
  
  return { left: line.trim(), right: '' };
}

let hasPdfToText: boolean | null = null;
function checkPdfToText(): boolean {
  if (hasPdfToText !== null) return hasPdfToText;
  try {
    execSync('pdftotext -v', { stdio: 'ignore' });
    hasPdfToText = true;
  } catch {
    hasPdfToText = false;
  }
  return hasPdfToText;
}

function extractRawTextFromPdf(pdfPath: string): string {
  if (checkPdfToText()) {
    try {
      const text = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (text && text.trim().length >= 50) return text;
    } catch {}
  }
  try {
    const buf = fs.readFileSync(pdfPath);
    let text = '';
    let pos = 0;
    while ((pos = buf.indexOf('stream', pos)) !== -1) {
      pos += 6;
      if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;
      else if (buf[pos] === 0x0a) pos += 1;
      const end = buf.indexOf('endstream', pos);
      if (end === -1) break;
      const chunk = buf.slice(pos, end);
      let inflated = '';
      try {
        inflated = zlib.inflateSync(chunk).toString('utf-8');
      } catch {
        try {
          inflated = zlib.inflateRawSync(chunk).toString('utf-8');
        } catch {
          inflated = chunk.toString('latin1');
        }
      }
      const tjRegex = /\[([^\]]*)\]\s*TJ/g;
      let match;
      while ((match = tjRegex.exec(inflated)) !== null) {
        const parts = match[1].match(/\(([^)]*)\)/g);
        if (parts) text += parts.map(p => p.slice(1, -1)).join('') + ' ';
      }
      const singleTjRegex = /\(([^)]*)\)\s*Tj/g;
      while ((match = singleTjRegex.exec(inflated)) !== null) {
        text += match[1] + '\n';
      }
      pos = end + 9;
    }
    return text;
  } catch {
    return '';
  }
}

function extractSpecsFromPdf(id: string): { sr: number, parameter: string, value: string }[] {
  const docDir = path.join(process.cwd(), 'public', 'documents', id);
  if (!fs.existsSync(docDir)) {
    console.log(`[extractSpecsFromPdf] Document directory not found at ${docDir}`);
    return [];
  }

  // Find all PDF files in the directory
  const files = fs.readdirSync(docDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  
  const allSpecs: { parameter: string, value: string }[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    // Skip generated files to avoid feedback loop
    if (file.startsWith('Bid_Documents_') || file.startsWith('Technical_Specification_Sheet_')) {
      continue;
    }
    
    const pdfPath = path.join(docDir, file);
    console.log(`[extractSpecsFromPdf] Processing PDF file: ${file} for tender ${id}`);

    try {
      const text = extractRawTextFromPdf(pdfPath);
      if (!text || text.trim().length < 50) continue;

      const isGemBid = text.includes('Technical Specifications') || text.includes('As per GeM') || text.includes('Allowed Values') || text.includes('Specification Name');
      const specs: { parameter: string, value: string }[] = [];

      if (isGemBid) {
        // Parse standard GeM Bid PDF layout using block-based parsing
        const startIdx = text.indexOf('Technical Specifications');
        const endIdx = text.indexOf('Consignees/Reporting Officer');
        const searchRangeText = (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx)
          ? text.slice(startIdx, endIdx)
          : text;

        const lines = searchRangeText.split('\n');
        const blocks: { left: string[], right: string[] }[] = [];
        let currentBlock: { left: string[], right: string[] } | null = null;

        for (let line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            if (currentBlock) {
              blocks.push(currentBlock);
              currentBlock = null;
            }
            continue;
          }

          if (/^\d+\s*\/\s*\d+$/.test(trimmed)) continue;
          if (trimmed.includes('Technical Specifications') || trimmed.includes('As per GeM') || trimmed.includes('Allowed Values') || trimmed.includes('Specification Parameter')) continue;
          if (trimmed.startsWith('ववरण/Specification') || trimmed.startsWith('विश का नाम') || trimmed.startsWith('बड के िलए')) continue;

          const { left, right } = splitLine(line);
          if (!currentBlock) {
            currentBlock = { left: [], right: [] };
          }
          if (left) currentBlock.left.push(left);
          if (right) currentBlock.right.push(right);
        }
        if (currentBlock) {
          blocks.push(currentBlock);
        }

        // Merge lines in each block and push to specs
        for (const block of blocks) {
          const p = block.left.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
          const v = block.right.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
          if (p && v) {
            specs.push({ parameter: p, value: v });
          }
        }
      } else {
        // Parse general/custom specification or BOQ PDF layout
        const lines = text.split('\n');
        let currentParam = '';
        let currentValue = '';

        for (let line of lines) {
          const trimmed = line.trim();
          if (!trimmed || /^\d+\s*\/\s*\d+$/.test(trimmed)) continue;
          if (trimmed.includes('SECTION') || trimmed.includes('KEYSPECIFICATIONS') || trimmed.includes('Item Title') || trimmed.includes('Item Description')) continue;

          const startCol = line.search(/\S/);
          const parts = line.split(/\s{3,}/).map(p => p.trim()).filter(Boolean);

          if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
            if (currentParam) specs.push({ parameter: currentParam, value: currentValue });
            currentParam = parts[1];
            currentValue = parts[2];
          } else {
            if (parts.length >= 2) {
              const leftColText = parts[0];
              const rightColText = parts.slice(1).join(' ');
              if (currentParam) currentParam += ' ' + leftColText;
              else currentParam = leftColText;
              if (currentValue) currentValue += ' ' + rightColText;
              else currentValue = rightColText;
            } else if (parts.length === 1) {
              if (startCol < 25) {
                if (currentParam) currentParam += ' ' + parts[0];
                else currentParam = parts[0];
              } else {
                if (currentValue) currentValue += ' ' + parts[0];
                else currentValue = parts[0];
              }
            }
          }
        }
        if (currentParam) specs.push({ parameter: currentParam, value: currentValue });
      }

      // Clean, filter, and add to merged array
      for (const s of specs) {
        const p = s.parameter.replace(/\s+/g, ' ').trim();
        const v = s.value.replace(/\s+/g, ' ').trim();

        // Filter out Hindi/Devanagari characters or translation artifacts
        if (/[\u0900-\u097F]/.test(p) || /[\u0900-\u097F]/.test(v)) continue;

        // Filter out pricing floor policy, buyer-defined addons, and non-technical metadata
        const lowerP = p.toLowerCase();
        const lowerV = v.toLowerCase();
        if (lowerP.includes('floor price') || lowerP.includes('addon') || lowerP.includes('defined by buyer')) continue;
        if (lowerP.includes('े ता') || lowerP.includes('िनधा रत') || lowerP.includes('यूनतम')) continue;

        if (p.includes('Speciﬁcation') || p.includes('Specification') || p.includes('विश') || p.includes('ववरण') || p.includes('का नाम') || p.includes('अनुमत मू य')) continue;
        if (p === 'PRODUCT' || p === 'INFORMATION' || p === 'MATTRESS' || p === 'WARRANTY' || p === 'CERTIFICATIONS') continue;
        if (p.includes('MATERIAL AND') || p.includes('DIMENSIONS PARAMETERS')) continue;
        if (p.includes('Additional Specification Parameters') || p.includes('परे षती') || p.includes('Technical Specifications') || p.includes('Disclaimer') || p.includes('अ वीकरण')) continue;
        if (p === 'Name' || p === 'Name Technical Specifications' || p === 'Bid Requirement (Allowed Values)') continue;
        if (p === 'sections' || p === 'syringe pump' || p === 'tolerance (mm)') continue;
        if (v === 'Specification' || v === 'Name' || v === 'Allowed Values' || v === 'Bid Requirement') continue;
        if (p.length < 3 || v.length < 3) continue;

        const key = p.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          allSpecs.push({ parameter: p, value: v });
        }
      }
    } catch (error) {
      console.error(`[extractSpecsFromPdf] Error processing file ${file}:`, error);
    }
  }

  // Format with sequential serial numbers
  return allSpecs.map((s, idx) => ({
    sr: idx + 1,
    parameter: s.parameter,
    value: s.value
  }));
}

// Helper to launch Puppeteer and print HTML content to PDF in Portrait mode
async function generatePdfFile(htmlContent: string, outputPath: string) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: {
        top: '0px',
        bottom: '0px',
        left: '0px',
        right: '0px'
      }
    });
  } finally {
    await browser.close();
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let auth = workflowActor(request, 'generateBids');
  let userRole = auth?.role;
  let username = auth?.username;

  if (!auth) {
    const rawRole = request.headers.get('x-user-role');
    const rawUser = request.headers.get('x-user-username');
    if (rawRole && canPerform(rawRole, 'generateBids')) {
      userRole = canonicalRole(rawRole);
      username = rawUser || 'admin';
    } else {
      return workflowForbidden();
    }
  }

  try {
    const { id } = await params;
    let body: any = {};
    try {
      const text = await request.text();
      if (text && text.trim().length > 0) {
        body = JSON.parse(text);
      }
    } catch (_) {
      body = {};
    }

    // Fetch existing tender details from SQLite or backend
    let tender: any = undefined;
    try {
      const tenderStmt = db.prepare('SELECT * FROM tenders WHERE id = ?');
      tender = tenderStmt.get(id) as Tender | undefined;
    } catch (_) {}

    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8090';

    if (!tender && backendUrl) {
      try {
        const authH = request.headers.get('authorization');
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (authH) headers['authorization'] = authH;
        const bRes = await fetch(`${backendUrl}/api/tenders/${encodeURIComponent(id)}`, { headers });
        if (bRes.ok) {
          const bData = await bRes.json();
          tender = bData.tender || bData;
        }
      } catch (_) {}
    }

    if (!tender) {
      return NextResponse.json(
        { success: false, error: 'Tender not found' },
        { status: 404 }
      );
    }

    // Merge body with tender metadata fallbacks
    const specStatus = tender.spec_verification_status || tender.specVerificationStatus;
    const misFinalPrice = tender.mis_final_price ?? tender.misFinalPrice;
    if (specStatus !== 'Approved' || misFinalPrice === undefined || misFinalPrice === null || !Number.isFinite(Number(misFinalPrice)) || Number(misFinalPrice) <= 0) {
      return NextResponse.json({
        success: false,
        error: 'Specification clearance and finalized MIS pricing are required before generating bid documents.'
      }, { status: 409 });
    }

    const companyKey = (body.companyKey || (body.companyName?.toLowerCase().includes('healthtech') ? 'healthtech' : 'me')).toLowerCase();
    const orientation = 'portrait';

    const defaultCompany = companyKey === 'healthtech' ? {
      companyName: 'Marken Healthtech Limited',
      companyAddress: '93/1 Street No.17, MIDC, Satpur, Nashik- 422007. MH. India',
      companyEmail: 'info@markenworld.com',
      companyWebsite: 'www.markenworld.com',
      companyContact: '+91 91 3030 5959',
      manufacturerName: 'Marken Healthtech Ltd',
      manufacturerAddress: 'Shed No.1, Plot No.93/1, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra.',
      signatoryName: 'Korra Praveen Naik',
      signatoryDesignation: 'Authorized Signatory',
      signatoryAddress: '1-1-51/46, Kapra, ECIL post, S.T.Colony, VTC: Ranga Reddy, District: Hyderabad, State: Andhra Pradesh, PIN Code: 500062',
      witnessDetails: 'Mr. Shreedhar Shingare (Cell No.: 09011104332)',
      localContentPercentage: '100%',
      localContentLocation: 'Shed No.1, Plot No.93/1, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra',
      preferencePolicy: 'PPP MII 2017',
      place: 'Nashik'
    } : {
      companyName: 'Mark Enterprises',
      companyAddress: 'Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India',
      companyEmail: 'info@markenworld.com',
      companyWebsite: 'www.markenworld.com',
      companyContact: '09175559646 / 090111 04332',
      manufacturerName: 'M/s. Mark Enterprises',
      manufacturerAddress: 'Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra',
      signatoryName: 'Shreedhar Shingare',
      signatoryDesignation: 'Authorized Signatory – Tender manager',
      signatoryAddress: 'Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India',
      witnessDetails: 'Mr. Korra Praveen Naik',
      localContentPercentage: '100%',
      localContentLocation: 'Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra',
      preferencePolicy: 'PPP MII 2017',
      place: 'Nashik'
    };

    const templateData = {
      bidNumber: body.bidNumber || tender.ref_no || tender.refNo || id,
      productDescription: body.productDescription || tender.product_name_as_per_tender || tender.productNameAsPerTender || tender.title || 'Equipment / Goods',
      productName: body.productName || tender.product_name_as_per_marken || tender.productNameAsPerMarken || tender.title || 'Equipment / Goods',
      authorityName: body.authorityName || tender.authority || '',
      authorityDept: body.authorityDept || '',
      authorityAddress: body.authorityAddress || tender.location || '',
      offeredMake: body.offeredMake || (companyKey === 'healthtech' ? 'MarkEn' : 'MarkEn'),
      offeredModel: body.offeredModel || '-',
      scheduleNo: body.scheduleNo || '',
      companyKey,
      orientation: 'portrait',
      companyName: body.companyName || defaultCompany.companyName,
      companyAddress: body.companyAddress || defaultCompany.companyAddress,
      companyEmail: body.companyEmail || defaultCompany.companyEmail,
      companyWebsite: body.companyWebsite || defaultCompany.companyWebsite,
      companyContact: body.companyContact || defaultCompany.companyContact,
      signatoryName: body.signatoryName || defaultCompany.signatoryName,
      signatoryDesignation: body.signatoryDesignation || defaultCompany.signatoryDesignation,
      date: body.date || new Date().toLocaleDateString('en-GB'),
      ...body
    };

    const docDir = path.join(process.cwd(), 'public', 'documents', id);
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
    }

    // Generate unified HTML content representing all 15 documents
    const htmlContent = generateHtmlTemplates(templateData);

    // 1. Generate and save PDF using Puppeteer in Portrait mode
    const pdfFileName = `Bid_Documents_${id}.pdf`;
    const pdfFilePath = path.join(docDir, pdfFileName);
    const pdfDownloadPath = localDocumentUrl(id, pdfFileName);
    await generatePdfFile(htmlContent, pdfFilePath);

    // 2. Generate and save Word document using html-to-docx in Portrait mode with OpenXML sanitation
    const docFileName = `Bid_Documents_${id}.docx`;
    const docFilePath = path.join(docDir, docFileName);
    const docDownloadPath = localDocumentUrl(id, docFileName);

    const isHealthtech = companyKey === 'healthtech';
    const docxHeaderHtml = getDocxHeaderHtml(companyKey);
    const docxFooterHtml = getDocxFooterHtml(companyKey);

    const docxOptions = {
      table: { row: { cantSplit: true } },
      header: true,
      footer: true,
      orientation: 'portrait' as const,
      pageSize: {
        width: 11906,
        height: 16838
      },
      font: isHealthtech ? 'Cambria' : 'Times New Roman',
      fontSize: isHealthtech ? 22 : 23, // 11pt Cambria vs 11.5pt Times New Roman
      margins: {
        top: 600,
        bottom: 850,
        left: isHealthtech ? 800 : 650,
        right: isHealthtech ? 800 : 650,
        header: 280,
        footer: 280
      }
    };

    const docxRaw = await HTMLtoDOCX(cleanHtmlForDocx(htmlContent, companyKey), docxHeaderHtml, docxOptions, docxFooterHtml);
    const docxBuffer = await sanitizeDocxBuffer(docxRaw);
    fs.writeFileSync(docFilePath, docxBuffer);

    // 3. Generate and save Technical Specification Sheet PDF & DOCX in Portrait mode
    const specs = extractSpecsFromPdf(id);
    const specHtml = generateTechnicalSpecificationHtml(templateData, specs);

    const specPdfFileName = `Technical_Specification_Sheet_${id}.pdf`;
    const specPdfFilePath = path.join(docDir, specPdfFileName);
    const specPdfDownloadPath = localDocumentUrl(id, specPdfFileName);
    await generatePdfFile(specHtml, specPdfFilePath);

    const specDocFileName = `Technical_Specification_Sheet_${id}.docx`;
    const specDocFilePath = path.join(docDir, specDocFileName);
    const specDocDownloadPath = localDocumentUrl(id, specDocFileName);

    const specDocxRaw = await HTMLtoDOCX(cleanHtmlForDocx(specHtml, companyKey), docxHeaderHtml, docxOptions, docxFooterHtml);
    const specDocxBuffer = await sanitizeDocxBuffer(specDocxRaw);
    fs.writeFileSync(specDocFilePath, specDocxBuffer);

    // 4. Update database downloaded_docs metadata
    const bidDocsMeta = {
      name: "Generated Bid Documents (Word DOCX)",
      filename: docFileName,
      local_path: docDownloadPath,
      created_date: new Date().toLocaleDateString('en-IN')
    };

    const bidPdfMeta = {
      name: "Generated Bid Documents (PDF)",
      filename: pdfFileName,
      local_path: pdfDownloadPath,
      created_date: new Date().toLocaleDateString('en-IN')
    };

    const specDocsMeta = {
      name: "Technical Specification Sheet (Word DOCX)",
      filename: specDocFileName,
      local_path: specDocDownloadPath,
      created_date: new Date().toLocaleDateString('en-IN')
    };

    const specPdfMeta = {
      name: "Technical Specification Sheet (PDF)",
      filename: specPdfFileName,
      local_path: specPdfDownloadPath,
      created_date: new Date().toLocaleDateString('en-IN')
    };

    let currentDocs = [];
    try {
      const rawDocs = tender.downloaded_docs || tender.downloadedDocs || '[]';
      currentDocs = typeof rawDocs === 'string' ? JSON.parse(rawDocs) : (Array.isArray(rawDocs) ? rawDocs : []);
      if (!Array.isArray(currentDocs)) currentDocs = [];
    } catch (e) {
      currentDocs = [];
    }

    // Filter out previous versions of both bid documents and specification sheets to prevent duplicates
    currentDocs = currentDocs.filter((d: any) => 
      d.local_path !== docDownloadPath && 
      d.local_path !== pdfDownloadPath && 
      d.local_path !== specDocDownloadPath && 
      d.local_path !== specPdfDownloadPath
    );
    currentDocs.push(bidDocsMeta);
    currentDocs.push(bidPdfMeta);
    currentDocs.push(specDocsMeta);
    currentDocs.push(specPdfMeta);

    // Update downloaded_docs metadata and advance stage to DOC_VERIFICATION in SQLite if available
    try {
      const updateStmt = db.prepare(`
        UPDATE tenders 
        SET downloaded_docs = ?, 
            current_stage = 'DOC_VERIFICATION', 
            verification_status = 'Pending',
            payment_status = 'None',
            submission_status = 'None'
        WHERE id = ?
      `);
      updateStmt.run(JSON.stringify(currentDocs), id);
    } catch (_) {}

    const now = new Date().toISOString();
    const assignedMis = tender.assigned_mis_member || tender.assignedMisMember || 'misteam';

    try {
      // Cancel/remove any premature downstream approval requests
      db.prepare("DELETE FROM tender_approval_requests WHERE tender_id = ? AND stage IN ('PAYMENT_APPROVAL', 'SUBMISSION_PENDING', 'WIN_LOSS_PENDING') AND status = 'PENDING'").run(id);

      const existingDocReq = db.prepare("SELECT id FROM tender_approval_requests WHERE tender_id = ? AND stage = 'DOC_VERIFICATION' AND status = 'PENDING'").get(id);
      if (existingDocReq) {
        db.prepare("UPDATE tender_approval_requests SET requested_by = ?, assigned_to = ?, working_path = ?, updated_at = ? WHERE id = ?")
          .run(username, assignedMis, docDownloadPath, now, (existingDocReq as any).id);
      } else {
        db.prepare(`
          INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, working_path, status, created_at, updated_at)
          VALUES (?, 'DOC_VERIFICATION', ?, ?, ?, 'PENDING', ?, ?)
        `).run(id, username, assignedMis, docDownloadPath, now, now);
      }
    } catch (dbErr) {
      console.error('[API Generate Bid Docs] Error creating approval request:', dbErr);
    }

    // Attempt notifying Spring Boot backend if available
    if (backendUrl && backendUrl !== 'http://localhost:8080') {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const authH = request.headers.get('authorization');
        if (authH) headers['authorization'] = authH;

        fetch(`${backendUrl}/api/tenders/${id}/doc-verification-request`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            assignedMisExecutive: assignedMis,
            workingPath: docDownloadPath,
            comment: 'Bid document package generated. Submitted for MIS verification & approval.'
          }),
          signal: controller.signal,
          cache: 'no-store'
        }).catch(() => {});
        clearTimeout(timeout);
      } catch (_) {}
    }

    // Log the activity to activity_log
    try {
      addActivityLog(username || 'executive', userRole || 'Tender Executive', 'Generated Bid Documents', id, 'Generated Word & PDF bid document package and Technical Specification Sheet. Submitted to MIS Team for approval.');
    } catch (_) {}

    console.log(`[API Generate Bid Docs] Compiled Word (.docx) and PDF (.pdf) successfully for Tender ${id}. Advanced stage to DOC_VERIFICATION.`);

    return NextResponse.json({
      success: true,
      message: 'Bid Documents generated successfully and forwarded to MIS Team for approval.',
      downloadUrl: docDownloadPath,
      pdfDownloadUrl: pdfDownloadPath,
      specDownloadUrl: specDocDownloadPath,
      specPdfDownloadUrl: specPdfDownloadPath,
      currentStage: 'DOC_VERIFICATION',
      verificationStatus: 'Pending',
      status: tender.status
    });

  } catch (error: any) {
    console.error('[API Generate Bid Docs] Error generating documents:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to generate documents.' },
      { status: 500 }
    );
  }
}
