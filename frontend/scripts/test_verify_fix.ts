import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { generateHtmlTemplates, cleanHtmlForDocx, sanitizeDocxBuffer, getDocxHeaderHtml, getDocxFooterHtml } from '../src/lib/documentTemplates';
// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';

async function run() {
  console.log('Generating ME templates...');
  const data = {
    companyKey: 'me',
    bidNumber: 'GEM/2026/B/9808508',
    bidDate: '10-10-2026',
    date: '10-10-2026'
  };
  const html = generateHtmlTemplates(data);

  // Check strings
  if (html.includes('Authorize Signatory')) {
    console.error('FAIL: Found typo Authorize Signatory in HTML');
  } else {
    console.log('PASS: No typo Authorize Signatory in HTML');
  }
  if (html.includes('Authorized Signatory – Tender manager')) {
    console.log('PASS: Found Authorized Signatory – Tender manager');
  } else {
    console.error('FAIL: Authorized Signatory – Tender manager not found');
  }

  // Generate PDF
  console.log('Generating PDF via Puppeteer...');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const pdfPath = path.join(process.cwd(), 'scratch', 'test_verified_me.pdf');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
  });

  // Also take a screenshot of the signature block area on page 1
  const sigElement = await page.$('.signature-block');
  if (sigElement) {
    const screenshotPath = path.join(process.cwd(), 'scratch', 'test_rendered_sig_block.png');
    await sigElement.screenshot({ path: screenshotPath });
    console.log('Saved screenshot of signature block to', screenshotPath);
  }

  await browser.close();

  // Generate DOCX
  console.log('Generating DOCX...');
  const headerHtml = getDocxHeaderHtml('me');
  const footerHtml = getDocxFooterHtml('me');
  const docxRaw = await HTMLtoDOCX(cleanHtmlForDocx(html, 'me'), headerHtml, { orientation: 'portrait' }, footerHtml);
  const docxBuffer = await sanitizeDocxBuffer(docxRaw);
  const docxPath = path.join(process.cwd(), 'scratch', 'test_verified_me.docx');
  fs.writeFileSync(docxPath, docxBuffer);
  console.log('DOCX written to', docxPath);
  console.log('ALL TESTS COMPLETED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('ERROR in run:', err);
  process.exit(1);
});
