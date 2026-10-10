// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import fs from 'fs';
import { getCompanyProfile } from '../src/lib/companyProfiles';
import { resolveBrandImagePath, getBase64Image } from '../src/lib/documentLayout';

async function testSig() {
  const profile = getCompanyProfile('healthtech');
  const sigPath = resolveBrandImagePath(profile.assetPaths.signature);
  const stampPath = resolveBrandImagePath(profile.assetPaths.stamp);
  const sigBase64 = getBase64Image(sigPath);
  const stampBase64 = getBase64Image(stampPath);

  const sigImg = `<img src="${sigBase64}" width="125" height="44" style="width: 125px; height: 44px;" />`;
  const stampImg = `<img src="${stampBase64}" width="85" height="85" style="width: 85px; height: 85px;" />`;

  const bodyHtml = `
    <p>Yours faithfully,</p>
    <p>For and on behalf of <strong>Marken Healthtech Limited</strong></p>
    <p style="text-align: left; margin: 3pt 0;">${sigImg}&nbsp;&nbsp;&nbsp;&nbsp;${stampImg}</p>
    <p style="font-weight: bold; margin-top: 4pt; margin-bottom: 2pt;">Korra Praveen Naik</p>
    <p style="margin-top: 0;">Authorized Signatory</p>
  `;

  const docx = await HTMLtoDOCX(bodyHtml, null, { orientation: 'portrait' });
  const zip = await JSZip.loadAsync(docx);
  const docXml = await zip.file('word/document.xml')?.async('text');

  console.log('--- Word XML for signature paragraph ---');
  const matches = docXml?.match(/<w:p\b[\s\S]*?<\/w:p>/g);
  matches?.forEach(p => {
    if (p.includes('drawing') || p.includes('Korra Praveen Naik')) {
      console.log(p);
    }
  });
}

testSig().catch(console.error);
