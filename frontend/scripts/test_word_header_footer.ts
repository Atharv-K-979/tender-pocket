// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { getCompanyProfile } from '../src/lib/companyProfiles';
import { resolveBrandImagePath, getBase64Image } from '../src/lib/documentLayout';

async function test() {
  const profile = getCompanyProfile('healthtech');
  const logoMarkEnPath = resolveBrandImagePath(profile.assetPaths.logoMarkEn);
  const logoBase64 = getBase64Image(logoMarkEnPath);
  const barPath = resolveBrandImagePath(profile.assetPaths.footerBar);
  const barBase64 = getBase64Image(barPath);

  // Header HTML
  const headerHtml = `
    <p style="text-align: center; margin: 0 0 4pt 0;">
      <img src="${logoBase64}" width="160" height="42" style="width: 160px; height: 42px;" />
    </p>
  `;

  // Footer HTML with proper formatting and lines
  const footerHtml = `
    <table border="0" cellpadding="0" cellspacing="0" style="border: none !important; border-collapse: collapse;">
      <tr>
        <td style="border: none; padding: 0 10pt 2pt 0; vertical-align: bottom;">
          <p style="margin: 0 0 1.5pt 0; font-size: 9.5pt; font-weight: bold; color: #00176D; line-height: 1.15; font-family: Calibri, sans-serif;">MARKEN HEALTHTECH LIMITED</p>
          <p style="margin: 0 0 1pt 0; font-size: 7.5pt; font-weight: bold; color: #00176D; line-height: 1.15; font-family: Calibri, sans-serif;">CIN No: ${profile.cin}</p>
          <p style="margin: 0 0 1pt 0; font-size: 7.5pt; color: #00176D; line-height: 1.15; font-family: Calibri, sans-serif;"><strong>Regd. Off &amp; Factory:</strong> ${profile.registeredOffice}</p>
          <p style="margin: 0 0 1pt 0; font-size: 7.5pt; color: #00176D; line-height: 1.15; font-family: Calibri, sans-serif;"><strong>Corp. Off.:</strong> ${profile.corporateOffice}</p>
          <p style="margin: 0; font-size: 7.5pt; color: #00176D; line-height: 1.15; font-family: Calibri, sans-serif;"><strong>Global Sales Off.:</strong> ${profile.globalSalesOffice}</p>
        </td>
        <td style="border: none; padding: 0 0 2pt 10pt; text-align: right; vertical-align: bottom;">
          <p style="margin: 0 0 1.5pt 0; font-size: 7.5pt; color: #00176D; line-height: 1.25; font-family: Calibri, sans-serif; text-align: right;">+91 91 3030 5959</p>
          <p style="margin: 0 0 1.5pt 0; font-size: 7.5pt; color: #00176D; line-height: 1.25; font-family: Calibri, sans-serif; text-align: right;">info@markenworld.com</p>
          <p style="margin: 0; font-size: 7.5pt; color: #00176D; line-height: 1.25; font-family: Calibri, sans-serif; text-align: right;">www.markenworld.com</p>
        </td>
      </tr>
    </table>
    <p style="margin: 0; padding: 0; line-height: 1pt; font-size: 1pt; text-align: center;">
      <img src="${barBase64}" width="650" height="7" style="height: 7px; width: 100%;" />
    </p>
  `;

  const bodyHtml = `
    <p>This is test content on page 1.</p>
  `;

  const docx = await HTMLtoDOCX(bodyHtml, headerHtml, {
    header: true,
    footer: true,
    orientation: 'portrait',
    pageSize: { width: 11906, height: 16838 }
  }, footerHtml);

  fs.writeFileSync('test_header_footer.docx', docx);
  console.log('Generated test_header_footer.docx successfully');

  const zip = await JSZip.loadAsync(docx);
  const headerXml = await zip.file('word/header1.xml')?.async('text');
  const footerXml = await zip.file('word/footer1.xml')?.async('text');
  const docXml = await zip.file('word/document.xml')?.async('text');

  console.log('header1.xml exists:', Boolean(headerXml));
  console.log('footer1.xml exists:', Boolean(footerXml));
  console.log('docXml headerReference exists:', docXml?.includes('headerReference'));
  console.log('docXml footerReference exists:', docXml?.includes('footerReference'));
}

test().catch(console.error);
