import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import { generateHtmlTemplates, cleanHtmlForDocx, getDocxFooterHtml, sanitizeDocxBuffer } from '../src/lib/documentTemplates';

async function test() {
  for (const companyKey of ['me', 'healthtech']) {
    console.log(`\n=== Testing ${companyKey} Footer & Header ===`);
    const html = generateHtmlTemplates({ companyKey });
    const isHealthtech = companyKey === 'healthtech';
    const docxFooterHtml = getDocxFooterHtml(companyKey);

    const docxOptions = {
      table: { row: { cantSplit: true } },
      footer: true,
      orientation: 'portrait' as const,
      pageSize: { width: 11906, height: 16838 },
      font: isHealthtech ? 'Cambria' : 'Times New Roman',
      fontSize: isHealthtech ? 22 : 23,
      margins: {
        top: 450,
        bottom: isHealthtech ? 820 : 420,
        left: isHealthtech ? 800 : 650,
        right: isHealthtech ? 800 : 650,
        footer: 150
      }
    };

    const cleaned = cleanHtmlForDocx(html);
    const docxRaw = await HTMLtoDOCX(cleaned, null, docxOptions, docxFooterHtml);
    const docxBuffer = await sanitizeDocxBuffer(docxRaw);

    const zip = await JSZip.loadAsync(docxBuffer);
    console.log('Files in docx:', Object.keys(zip.files));

    // Print all footer xml files
    for (const f of Object.keys(zip.files)) {
      if (f.includes('footer')) {
        const text = await zip.file(f)?.async('text');
        console.log(`--- Content of ${f} ---`);
        console.log(text?.slice(0, 500));
      }
    }
  }
}

test().catch(console.error);
