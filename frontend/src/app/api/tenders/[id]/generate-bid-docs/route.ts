import { NextResponse } from 'next/server';
import db, { type Tender, addActivityLog } from '@/lib/db';
import { workflowActor, workflowForbidden } from '@/lib/workflowAuthorization';
import { localDocumentUrl } from '@/lib/technicalSpecificationBackend';
import fs from 'fs';
import path from 'path';
import { generateHtmlTemplates, generateTechnicalSpecificationHtml, cleanHtmlForDocx } from '@/lib/documentTemplates';
import { execSync } from 'child_process';

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

function extractSpecsFromPdf(id: string): { sr: number, parameter: string, value: string }[] {
  if (!checkPdfToText()) {
    return [];
  }
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
      const text = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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

// Helper to launch Puppeteer and print HTML content to PDF
async function generatePdfFile(htmlContent: string, outputPath: string, isLandscape = false) {
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
      landscape: isLandscape,
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
  const auth = workflowActor(request, 'generateBids');
  if (!auth) return workflowForbidden();
  const userRole = auth.role;
  const username = auth.username;

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

    // Fetch existing tender details to update
    const tenderStmt = db.prepare('SELECT * FROM tenders WHERE id = ?');
    const tender = tenderStmt.get(id) as Tender | undefined;

    if (!tender) {
      return NextResponse.json(
        { success: false, error: 'Tender not found' },
        { status: 404 }
      );
    }

    // Merge body with tender metadata fallbacks
    if (tender.spec_verification_status !== 'Approved' || !Number.isFinite(tender.mis_final_price)
        || Number(tender.mis_final_price) <= 0) {
      return NextResponse.json({ success: false,
        error: 'Specification clearance and finalized MIS pricing are required before generating bid documents.' }, { status: 409 });
    }

    const companyKey = (body.companyKey || (body.companyName?.toLowerCase().includes('healthtech') ? 'healthtech' : 'me')).toLowerCase();
    const orientation = (body.orientation || 'portrait').toLowerCase();
    const isLandscape = orientation === 'landscape';

    const defaultCompany = companyKey === 'healthtech' ? {
      companyName: 'Healthtech Limited',
      companyAddress: 'Plot No. 45, Healthcare Park, MIDC Industrial Area, Ambad, Nashik – 422010, Maharashtra, India',
      companyEmail: 'info@healthtech.co.in',
      companyWebsite: 'www.healthtech.co.in',
      companyContact: '0253 2381200 / +91 98220 12345'
    } : {
      companyName: 'Mark Enterprises',
      companyAddress: 'Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India',
      companyEmail: 'info@markenworld.com',
      companyWebsite: 'www.markenworld.com',
      companyContact: '09175559646 / 090111 04332'
    };

    const templateData = {
      bidNumber: body.bidNumber || tender.ref_no || id,
      productDescription: body.productDescription || tender.product_name_as_per_tender || tender.title || 'Equipment / Goods',
      productName: body.productName || tender.product_name_as_per_marken || tender.title || 'Equipment / Goods',
      authorityName: body.authorityName || tender.authority || '',
      authorityDept: body.authorityDept || '',
      authorityAddress: body.authorityAddress || tender.location || '',
      offeredMake: body.offeredMake || (companyKey === 'healthtech' ? 'Healthtech' : 'MarkEn'),
      offeredModel: body.offeredModel || '-',
      scheduleNo: body.scheduleNo || '',
      companyKey,
      orientation,
      companyName: body.companyName || defaultCompany.companyName,
      companyAddress: body.companyAddress || defaultCompany.companyAddress,
      companyEmail: body.companyEmail || defaultCompany.companyEmail,
      companyWebsite: body.companyWebsite || defaultCompany.companyWebsite,
      companyContact: body.companyContact || defaultCompany.companyContact,
      signatoryName: body.signatoryName || 'Korra Praveen Naik',
      signatoryDesignation: body.signatoryDesignation || 'Partner',
      date: body.date || new Date().toLocaleDateString('en-GB'),
      ...body
    };

    const docDir = path.join(process.cwd(), 'public', 'documents', id);
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
    }

    // Generate unified HTML content representing all 15 documents
    const htmlContent = generateHtmlTemplates(templateData);

    // 1. Generate and save PDF using Puppeteer
    const pdfFileName = `Bid_Documents_${id}.pdf`;
    const pdfFilePath = path.join(docDir, pdfFileName);
    const pdfDownloadPath = localDocumentUrl(id, pdfFileName);
    await generatePdfFile(htmlContent, pdfFilePath, isLandscape);

    // 2. Generate and save Word document using html-to-docx
    const docFileName = `Bid_Documents_${id}.docx`;
    const docFilePath = path.join(docDir, docFileName);
    const docDownloadPath = localDocumentUrl(id, docFileName);

    const docxBuffer = await HTMLtoDOCX(cleanHtmlForDocx(htmlContent), null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
      orientation: isLandscape ? 'landscape' : 'portrait',
      margins: isLandscape ? {
        top: 1200,
        bottom: 800,
        left: 850,
        right: 850
      } : {
        top: 1960,
        bottom: 800,
        left: 850,
        right: 850
      }
    });
    fs.writeFileSync(docFilePath, docxBuffer);

    // 3. Generate and save Technical Specification Sheet PDF & DOCX
    const specs = extractSpecsFromPdf(id);
    const specHtml = generateTechnicalSpecificationHtml(templateData, specs);

    const specPdfFileName = `Technical_Specification_Sheet_${id}.pdf`;
    const specPdfFilePath = path.join(docDir, specPdfFileName);
    const specPdfDownloadPath = localDocumentUrl(id, specPdfFileName);
    await generatePdfFile(specHtml, specPdfFilePath, isLandscape);

    const specDocFileName = `Technical_Specification_Sheet_${id}.docx`;
    const specDocFilePath = path.join(docDir, specDocFileName);
    const specDocDownloadPath = localDocumentUrl(id, specDocFileName);

    const specDocxBuffer = await HTMLtoDOCX(cleanHtmlForDocx(specHtml), null, {
      table: { row: { cantSplit: true } },
      orientation: isLandscape ? 'landscape' : 'portrait',
      margins: {
        top: 1440,
        bottom: 1440,
        left: 1440,
        right: 1440
      }
    });
    fs.writeFileSync(specDocFilePath, specDocxBuffer);

    // 4. Update SQLite database downloaded_docs metadata
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
      currentDocs = JSON.parse(tender.downloaded_docs || '[]');
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

    // Update downloaded_docs metadata and advance stage to DOC_VERIFICATION (Pending MIS Approval)
    const updateStmt = db.prepare(`
      UPDATE tenders 
      SET downloaded_docs = ?, 
          current_stage = 'DOC_VERIFICATION', 
          verification_status = 'Pending' 
      WHERE id = ?
    `);
    updateStmt.run(JSON.stringify(currentDocs), id);

    const now = new Date().toISOString();
    const assignedMis = tender.assigned_mis_member || 'misteam';

    try {
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
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8090';
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
    addActivityLog(username, userRole, 'Generated Bid Documents', id, 'Generated Word & PDF bid document package and Technical Specification Sheet. Submitted to MIS Team for approval.');

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
