// @ts-ignore
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { getCompanyProfile } from '../src/lib/companyProfiles';
import { resolveBrandImagePath, getBase64Image } from '../src/lib/documentLayout';
import { generateHtmlTemplates } from '../src/lib/documentTemplates';

export function getDocxHeaderHtml(companyKey: string): string {
  const profile = getCompanyProfile(companyKey);
  const isThemeA = profile.theme === 'A';

  if (isThemeA) {
    const roundLogoPath = resolveBrandImagePath(profile.assetPaths.logoRound || '');
    const markEnLogoPath = resolveBrandImagePath(profile.assetPaths.logoMarkEn);
    const roundLogoBase64 = getBase64Image(roundLogoPath);
    const markEnLogoBase64 = getBase64Image(markEnLogoPath);

    return `
      <table border="0" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; border: none; font-family: Cambria, serif;">
        <tr>
          <td style="border: none; padding: 0 6pt 0 0; vertical-align: middle;">
            <img src="${roundLogoBase64}" width="55" height="55" style="width: 55px; height: 55px;" />
          </td>
          <td style="border: none; padding: 0 6pt; vertical-align: middle;">
            <p style="margin: 0 0 1.5pt 0; font-family: Cambria, serif; font-size: 15pt; font-weight: bold; color: #4472C4; line-height: 1.1;">MARK ENTERPRISES</p>
            <p style="margin: 0 0 1pt 0; font-family: Cambria, serif; font-size: 8pt; color: #000; line-height: 1.15;">Shed No. 1, Plot No. 93/2, Street No. 17</p>
            <p style="margin: 0 0 1pt 0; font-family: Cambria, serif; font-size: 8pt; color: #000; line-height: 1.15;">MIDC Satpur, Nashik – 422007, Maharashtra, India</p>
            <p style="margin: 0 0 1pt 0; font-family: Cambria, serif; font-size: 8pt; color: #000; line-height: 1.15;">Email ID: info@markenworld.com URL: www.markenworld.com</p>
            <p style="margin: 0; font-family: Cambria, serif; font-size: 8pt; color: #000; line-height: 1.15;">Contact No.: 09175559646 / 090111 04332</p>
          </td>
          <td style="border: none; padding: 0 0 0 6pt; text-align: right; vertical-align: middle;">
            <img src="${markEnLogoBase64}" width="130" height="35" style="width: 130px; height: 35px;" />
          </td>
        </tr>
      </table>
      <p style="margin: 2pt 0 0 0; padding: 0; line-height: 1pt; font-size: 1pt; border-top: 1.5pt solid #595959;">&nbsp;</p>
    `.trim();
  } else {
    const markEnLogoPath = resolveBrandImagePath(profile.assetPaths.logoMarkEn);
    const markEnLogoBase64 = getBase64Image(markEnLogoPath);
    return `
      <p style="text-align: center; margin: 0 0 4pt 0;">
        <img src="${markEnLogoBase64}" width="155" height="42" style="width: 155px; height: 42px;" />
      </p>
    `.trim();
  }
}

async function testFull() {
  for (const companyKey of ['me', 'healthtech']) {
    console.log(`Testing full Word generation with native header and footer for ${companyKey}...`);
    const headerHtml = getDocxHeaderHtml(companyKey);
    console.log(`Header length for ${companyKey}:`, headerHtml.length);
  }
}

testFull().catch(console.error);
