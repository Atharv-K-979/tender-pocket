// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import fs from 'fs';
import { generateHtmlTemplates, cleanHtmlForDocx, getDocxFooterHtml, sanitizeDocxBuffer } from '../src/lib/documentTemplates';

async function checkSections() {
  const html = generateHtmlTemplates({ companyKey: 'healthtech' });
  const cleaned = cleanHtmlForDocx(html);
  const footerHtml = getDocxFooterHtml('healthtech');

  const docx = await HTMLtoDOCX(cleaned, null, { footer: true, orientation: 'portrait' }, footerHtml);
  const sanitized = await sanitizeDocxBuffer(docx);

  const zip = await JSZip.loadAsync(sanitized);
  const docXml = await zip.file('word/document.xml')?.async('text');

  // Count sectPr and footerReference
  const sectMatches = docXml?.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) || [];
  console.log('Total sectPr count:', sectMatches.length);
  sectMatches.forEach((s, idx) => {
    console.log(`sectPr[${idx}]:`, s);
  });
}

checkSections().catch(console.error);
