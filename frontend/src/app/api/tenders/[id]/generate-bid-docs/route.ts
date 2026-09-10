import { NextResponse } from 'next/server';
import db, { Tender, addActivityLog } from '@/lib/db';
import fs from 'fs';
import path from 'path';
import { generateHtmlTemplates, generateTechnicalSpecificationHtml } from '@/lib/documentTemplates';
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
  const userRole = request.headers.get('x-user-role') || 'Unknown';
  const username = request.headers.get('x-user-username') || 'system';

  try {
    const { id } = await params;
    const body = await request.json();

    // Fetch existing tender details to update
    const tenderStmt = db.prepare('SELECT * FROM tenders WHERE id = ?');
    const tender = tenderStmt.get(id) as Tender | undefined;

    if (!tender) {
      return NextResponse.json(
        { success: false, error: 'Tender not found' },
        { status: 404 }
      );
    }

    const docDir = path.join(process.cwd(), 'public', 'documents', id);
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
    }

    // Generate unified HTML content representing all 15 documents
    const htmlContent = generateHtmlTemplates(body);

    // 1. Generate and save PDF using Puppeteer
    const pdfFileName = `Bid_Documents_${id}.pdf`;
    const pdfFilePath = path.join(docDir, pdfFileName);
    const pdfDownloadPath = `/documents/${id}/${pdfFileName}`;
    await generatePdfFile(htmlContent, pdfFilePath);

    // 2. Generate and save Word document using html-to-docx
    const docFileName = `Bid_Documents_${id}.docx`;
    const docFilePath = path.join(docDir, docFileName);
    const docDownloadPath = `/documents/${id}/${docFileName}`;

    const docxBuffer = await HTMLtoDOCX(htmlContent, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
      margins: {
        top: 1960,    // 98pt * 20 = 1960 dxa
        bottom: 800,  // 40pt * 20 = 800 dxa
        left: 850,    // 42.5pt * 20 = 850 dxa
        right: 850    // 42.5pt * 20 = 850 dxa
      }
    });
    fs.writeFileSync(docFilePath, docxBuffer);

    // 3. Generate and save Technical Specification Sheet PDF & DOCX
    const specs = extractSpecsFromPdf(id);
    const specHtml = generateTechnicalSpecificationHtml(body, specs);

    const specPdfFileName = `Technical_Specification_Sheet_${id}.pdf`;
    const specPdfFilePath = path.join(docDir, specPdfFileName);
    const specPdfDownloadPath = `/documents/${id}/${specPdfFileName}`;
    await generatePdfFile(specHtml, specPdfFilePath);

    const specDocFileName = `Technical_Specification_Sheet_${id}.docx`;
    const specDocFilePath = path.join(docDir, specDocFileName);
    const specDocDownloadPath = `/documents/${id}/${specDocFileName}`;

    const specDocxBuffer = await HTMLtoDOCX(specHtml, null, {
      table: { row: { cantSplit: true } },
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

    // Update only downloaded_docs metadata (keep existing status)
    const updateStmt = db.prepare('UPDATE tenders SET downloaded_docs = ? WHERE id = ?');
    updateStmt.run(JSON.stringify(currentDocs), id);

    // Log the activity to activity_log
    addActivityLog(username, userRole, 'Generated Bid Documents', id, 'Generated Word & PDF bid document package and Technical Specification Sheet');

    console.log(`[API Generate Bid Docs] Compiled Word (.docx) and PDF (.pdf) successfully for Tender ${id} including Technical Specification Sheet.`);

    return NextResponse.json({
      success: true,
      message: 'Bid Documents and Technical Specification Sheet generated successfully in Word and PDF formats.',
      downloadUrl: docDownloadPath,
      pdfDownloadUrl: pdfDownloadPath,
      specDownloadUrl: specDocDownloadPath,
      specPdfDownloadUrl: specPdfDownloadPath,
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
