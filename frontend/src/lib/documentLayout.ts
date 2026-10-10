import fs from 'fs';
import path from 'path';
import { CompanyProfile, getCompanyProfile } from './companyProfiles';

// Image path resolution helper across dev/build environments
export function resolveBrandImagePath(subPath: string): string {
  const candidates = [
    path.join(process.cwd(), 'public', subPath),
    path.join(process.cwd(), 'frontend', 'public', subPath),
    path.resolve(__dirname, '../../public', subPath),
    path.resolve(__dirname, '../../../public', subPath),
    path.resolve(process.cwd(), '..', 'frontend', 'public', subPath)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

// Convert image to base64 Data URL
export function getBase64Image(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) {
      const bitmap = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      return `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${bitmap.toString('base64')}`;
    }
  } catch (e) {
    console.error('Error loading image base64:', filePath, e);
  }
  return '';
}

export interface RenderOptions {
  showSignature?: boolean;
  showStamp?: boolean;
  docDate?: string;
  bidDate?: string;
  bidNumber?: string;
}

export class DocumentLayoutRenderer {
  private profile: CompanyProfile;
  private logoRoundBase64 = '';
  private logoMarkEnBase64 = '';
  private watermarkBase64 = '';
  private stampBase64 = '';
  private signatureBase64 = '';
  private footerBarBase64 = '';

  constructor(profile: CompanyProfile) {
    this.profile = profile;
    this.loadAssets();
  }

  private loadAssets() {
    const assets = this.profile.assetPaths;

    // Load Round Logo (Theme A)
    if (assets.logoRound) {
      let p = resolveBrandImagePath(assets.logoRound);
      if (!fs.existsSync(p)) p = resolveBrandImagePath('images/letterheads/me_portrait_logo.png');
      this.logoRoundBase64 = getBase64Image(p);
    }

    // Load MarkEn Logo (Theme A right, Theme B centered header)
    if (assets.logoMarkEn) {
      let p = resolveBrandImagePath(assets.logoMarkEn);
      if (!fs.existsSync(p)) {
        p = this.profile.theme === 'A'
          ? resolveBrandImagePath('images/letterheads/me_portrait_partner.png')
          : resolveBrandImagePath('images/marken_logo.png');
      }
      this.logoMarkEnBase64 = getBase64Image(p);
    }

    // Load Watermark (Theme B)
    if (assets.watermark || this.profile.theme === 'B') {
      let p = assets.watermark ? resolveBrandImagePath(assets.watermark) : resolveBrandImagePath('images/watermark.png');
      this.watermarkBase64 = getBase64Image(p);
    }

    // Load Stamp
    if (assets.stamp) {
      let p = resolveBrandImagePath(assets.stamp);
      if (!fs.existsSync(p)) {
        p = this.profile.theme === 'B'
          ? resolveBrandImagePath('images/healthtech_stamp.png')
          : resolveBrandImagePath('images/stamp.png');
      }
      this.stampBase64 = getBase64Image(p);
    }

    // Load Signature
    if (assets.signature) {
      let p = resolveBrandImagePath(assets.signature);
      if (!fs.existsSync(p)) {
        p = this.profile.theme === 'B'
          ? resolveBrandImagePath('images/healthtech_sig.png')
          : resolveBrandImagePath('images/signature.png');
      }
      this.signatureBase64 = getBase64Image(p);
    }

    // Load Footer Bar
    if (assets.footerBar) {
      let p = resolveBrandImagePath(assets.footerBar);
      if (!fs.existsSync(p)) {
        p = this.profile.theme === 'B'
          ? resolveBrandImagePath('images/healthtech_footer_bar.png')
          : resolveBrandImagePath('images/me_footer_bar.png');
      }
      this.footerBarBase64 = getBase64Image(p);
    }
  }

  public getGlobalStyles(): string {
    const isThemeA = this.profile.theme === 'A';
    const bodyFont = isThemeA ? "'Times New Roman', Times, serif" : "Cambria, Georgia, serif";
    const bodySize = isThemeA ? "11pt" : "10.5pt";
    const bodyAlign = isThemeA ? "left" : "justify";
    const sideMargin = isThemeA ? "14mm" : "18mm";
    const bottomPadding = isThemeA ? "20mm" : "28mm";
    const maxBodyHeight = isThemeA ? "245mm" : "238mm";

    return `
      @page {
        size: A4 portrait;
        margin: 0;
      }

      * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      html, body {
        margin: 0;
        padding: 0;
        background-color: #f1f5f9;
        font-family: ${bodyFont};
        font-size: ${bodySize};
        color: #000000;
        line-height: 1.32;
      }

      @media screen {
        body {
          padding: 20px 0;
        }
        .page {
          margin: 0 auto 30px auto;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
        }
      }

      .page {
        width: 210mm;
        min-height: 297mm;
        height: 297mm;
        position: relative;
        background-color: #ffffff;
        page-break-after: always;
        overflow: hidden;
        padding: 0;
      }

      .page-inner {
        position: relative;
        width: 100%;
        height: 100%;
        padding-left: ${sideMargin};
        padding-right: ${sideMargin};
        padding-top: 8mm;
        padding-bottom: ${bottomPadding};
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        z-index: 2;
      }

      /* Watermark Container (Theme B) */
      .watermark-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 115mm;
        height: 115mm;
        opacity: 0.08;
        z-index: 1;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .watermark-container img {
        width: 100%;
        height: auto;
        display: block;
      }

      /* THEME A HEADER */
      .theme-a-header {
        width: 100%;
        margin-bottom: 4px;
      }
      .theme-a-header-table {
        width: 100%;
        border-collapse: collapse;
        border: none;
        margin-bottom: 2px;
      }
      .theme-a-header-table td {
        border: none;
        padding: 0;
        vertical-align: middle;
      }
      .theme-a-company-name {
        margin: 0 0 2px 0;
        font-family: Cambria, Georgia, 'Times New Roman', serif;
        font-size: 22pt;
        font-weight: bold;
        color: #4472C4;
        letter-spacing: 0.5px;
        line-height: 1.1;
      }
      .theme-a-address-line {
        margin: 1px 0;
        font-family: Cambria, 'Times New Roman', serif;
        font-size: 9pt;
        color: #000000;
        line-height: 1.15;
      }
      .theme-a-divider {
        width: 100%;
        height: 1.2px;
        background-color: #595959;
        margin: 3px 0 8px 0;
      }

      /* THEME B HEADER */
      .theme-b-header {
        width: 100%;
        text-align: center;
        margin-bottom: 4px;
      }
      .theme-b-logo {
        width: 160px;
        height: 44px;
        max-width: 44mm;
        object-fit: contain;
        margin: 0 auto 3px auto;
        display: block;
      }
      .theme-b-date-row {
        width: 100%;
        text-align: right;
        font-size: 10pt;
        font-weight: normal;
        margin-bottom: 4px;
        color: #000;
      }

      /* DOCUMENT TITLE */
      .doc-title-container {
        text-align: center;
        margin: 4px 0 8px 0;
      }
      .doc-title {
        font-size: 13pt;
        font-weight: bold;
        text-decoration: underline;
        text-transform: uppercase;
        margin: 0;
        padding: 0;
        letter-spacing: 0.3px;
      }
      .doc-subtitle {
        font-size: 11pt;
        font-style: italic;
        font-weight: bold;
        margin: 2px 0 0 0;
      }

      /* ADDRESS & REFERENCE */
      .address-block {
        margin-bottom: 8px;
        font-size: 10.5pt;
        line-height: 1.28;
      }
      .address-block strong {
        font-weight: bold;
      }
      .subject-ref-block {
        margin-bottom: 8px;
        font-size: 10.5pt;
        line-height: 1.28;
      }
      .subject-ref-table {
        width: 100%;
        border-collapse: collapse;
        border: none;
        margin: 2px 0;
      }
      .subject-ref-table td {
        border: none;
        padding: 1px 0;
        vertical-align: top;
      }

      /* CONTENT BODY WITH STRICT FOOTER CLEARANCE */
      .doc-body {
        max-height: ${maxBodyHeight};
        font-size: ${bodySize};
        line-height: 1.32;
        text-align: ${bodyAlign};
        overflow: hidden;
      }
      .doc-body p {
        margin: 0 0 5px 0;
      }
      .doc-body p.justify {
        text-align: justify;
      }
      .doc-body p.center {
        text-align: center;
      }
      .doc-body p.bold {
        font-weight: bold;
      }
      .doc-body ul, .doc-body ol {
        margin: 3px 0 6px 16px;
        padding: 0;
      }
      .doc-body li {
        margin-bottom: 3px;
      }
      .closing-line {
        font-weight: bold;
        font-style: italic;
        margin: 8px 0 8px 0 !important;
      }

      /* COMPACT DOCUMENT STYLES (For dense single-page documents like BID FORM) */
      .compact-doc .doc-body {
        font-size: ${isThemeA ? '10pt' : '9.5pt'};
        line-height: 1.22;
      }
      .compact-doc .doc-body p {
        margin: 0 0 3px 0;
      }
      .compact-doc .address-block {
        margin-bottom: 5px;
        font-size: 10pt;
        line-height: 1.2;
      }
      .compact-doc .subject-ref-block {
        margin-bottom: 5px;
        font-size: 10pt;
      }
      .compact-doc .sign-stamp-wrap.theme-a-sign-wrap {
        min-height: 44px;
        gap: 16px;
        margin: 1px 0 2px 0;
      }
      .compact-doc .sign-img.theme-a-sign {
        width: 68px;
        height: 48px;
      }
      .compact-doc .stamp-img.theme-a-stamp {
        width: 48px;
        height: 48px;
      }
      .compact-doc .sign-stamp-wrap.theme-b-sign-wrap {
        min-height: 36px;
        gap: 16px;
        margin: 1px 0 2px 0;
      }
      .compact-doc .sign-img.theme-b-sign {
        width: 95px;
        height: 31px;
      }
      .compact-doc .stamp-img.theme-b-stamp {
        width: 48px;
        height: 48px;
      }

      /* TABLES */
      table.data-table {
        width: 100%;
        border-collapse: collapse;
        border: 1px solid #4F81BD;
        margin: 6px 0 8px 0;
        font-size: 9.5pt;
        line-height: 1.2;
        page-break-inside: avoid;
      }
      table.data-table th {
        background-color: #4F81BD;
        color: #ffffff;
        font-weight: bold;
        padding: 3px 5px;
        border: 1px solid #4F81BD;
        text-align: left;
      }
      table.data-table th.center, table.data-table td.center {
        text-align: center;
      }
      table.data-table td {
        padding: 3px 5px;
        border: 1px solid #4F81BD;
        vertical-align: top;
      }
      table.data-table tr:nth-child(even) td {
        background-color: #DCE6F1;
      }

      /* SIGNATURE BLOCK */
      .signature-block {
        margin-top: 6px;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .signature-block p {
        margin: 1px 0;
        line-height: 1.22;
        font-size: 10pt;
      }
      .sign-stamp-wrap {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 20px;
        margin: 3px 0 4px 0;
      }
      .sign-stamp-wrap.theme-a-sign-wrap {
        min-height: 56px;
      }
      .sign-stamp-wrap.theme-b-sign-wrap {
        min-height: 46px;
      }
      .sign-img {
        object-fit: contain;
        display: inline-block;
      }
      .sign-img.theme-a-sign {
        width: 82px;
        height: 58px;
      }
      .sign-img.theme-b-sign {
        width: 115px;
        height: 37px;
      }
      .stamp-img {
        object-fit: contain;
        display: inline-block;
      }
      .stamp-img.theme-a-stamp {
        width: 64px;
        height: 64px;
      }
      .stamp-img.theme-b-stamp {
        width: 64px;
        height: 64px;
      }

      /* FOOTERS */
      .theme-a-footer-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        height: 5mm;
        display: flex;
        overflow: hidden;
        z-index: 10;
      }
      .theme-a-footer-bar .bar-navy {
        flex: 1;
        background-color: #1F1F6E;
      }
      .theme-a-footer-bar .bar-cyan {
        width: 8%;
        background-color: #0095D9;
      }

      .theme-b-footer-block {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        padding: 0 18mm 5mm 18mm;
        z-index: 10;
        font-family: Calibri, 'Times New Roman', sans-serif;
      }
      .theme-b-footer-table {
        width: 100%;
        border-collapse: collapse;
        border: none;
        margin-bottom: 2px;
      }
      .theme-b-footer-table td {
        border: none;
        padding: 0;
        vertical-align: bottom;
      }
      .theme-b-footer-left {
        font-size: 7.2pt;
        line-height: 1.22;
        color: #00176D;
      }
      .theme-b-footer-title {
        font-size: 9.5pt;
        font-weight: bold;
        color: #00176D;
        margin-bottom: 1px;
      }
      .theme-b-footer-cin {
        font-size: 7.5pt;
        font-weight: bold;
        color: #00176D;
        margin-bottom: 1px;
      }
      .theme-b-footer-right {
        text-align: right;
        font-size: 7.5pt;
        line-height: 1.3;
        color: #00176D;
        white-space: nowrap;
      }
      .theme-b-footer-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        height: 5mm;
        display: flex;
        overflow: hidden;
        z-index: 10;
      }
      .theme-b-footer-bar .bar-navy {
        width: 63%;
        background-color: #00176D;
      }
      .theme-b-footer-bar .bar-cyan {
        width: 37%;
        background-color: #0095D9;
      }
    `;
  }

  public renderHeader(docDate?: string): string {
    if (this.profile.theme === 'A') {
      const addr = this.profile.addressLines;
      return `
        <!-- HEADER_START -->
        <div class="theme-a-header">
          <table class="theme-a-header-table">
            <tr>
              <td style="width: 24mm; vertical-align: middle;">
                ${this.logoRoundBase64 ? `<img src="${this.logoRoundBase64}" width="65" height="65" style="width: 22mm; height: 22mm; object-fit: contain; display: block;" />` : ''}
              </td>
              <td style="padding: 0 10px; vertical-align: middle;">
                <div class="theme-a-company-name">${this.profile.legalName}</div>
                ${addr.map(line => `<div class="theme-a-address-line">${line}</div>`).join('')}
              </td>
              <td style="width: 44mm; text-align: right; vertical-align: middle;">
                ${this.logoMarkEnBase64 ? `<img src="${this.logoMarkEnBase64}" width="150" height="40" style="width: 40mm; height: 16mm; object-fit: contain; display: block; margin-left: auto;" />` : ''}
              </td>
            </tr>
          </table>
          <div class="theme-a-divider"></div>
        </div>
        <!-- HEADER_END -->
      `;
    } else {
      // Theme B
      return `
        <!-- HEADER_START -->
        <div class="theme-b-header">
          ${this.logoMarkEnBase64 ? `<img src="${this.logoMarkEnBase64}" width="160" height="44" class="theme-b-logo" style="width: 44mm; height: 16mm; object-fit: contain;" />` : ''}
          ${docDate ? `<div class="theme-b-date-row">Date: ${docDate}</div>` : ''}
        </div>
        <!-- HEADER_END -->
      `;
    }
  }

  public renderFooter(): string {
    if (this.profile.theme === 'A') {
      if (this.footerBarBase64) {
        return `
          <!-- FOOTER_START -->
          <div class="theme-a-footer-bar">
            <img src="${this.footerBarBase64}" width="650" height="6" style="width: 100%; height: 100%; object-fit: fill; display: block;" />
          </div>
          <!-- FOOTER_END -->
        `;
      }
      return `
        <!-- FOOTER_START -->
        <div class="theme-a-footer-bar">
          <div class="bar-navy"></div>
          <div class="bar-cyan"></div>
        </div>
        <!-- FOOTER_END -->
      `;
    } else {
      return `
        <!-- FOOTER_START -->
        <div class="theme-b-footer-block">
          <table class="theme-b-footer-table">
            <tr>
              <td class="theme-b-footer-left">
                <div class="theme-b-footer-title">${this.profile.legalName}</div>
                ${this.profile.cin ? `<div class="theme-b-footer-cin">CIN No: ${this.profile.cin}</div>` : ''}
                ${this.profile.registeredOffice ? `<div><strong>Regd. Off &amp; Factory:</strong> ${this.profile.registeredOffice}</div>` : ''}
                ${this.profile.corporateOffice ? `<div><strong>Corp. Off.:</strong> ${this.profile.corporateOffice}</div>` : ''}
                ${this.profile.globalSalesOffice ? `<div><strong>Global Sales Off.:</strong> ${this.profile.globalSalesOffice}</div>` : ''}
              </td>
              <td class="theme-b-footer-right">
                <div>&#9742; ${this.profile.phoneDisplay || this.profile.phones[0]}</div>
                <div>&#9993; ${this.profile.emailDisplay || this.profile.emails[0]}</div>
                <div>&#127760; ${this.profile.website}</div>
              </td>
            </tr>
          </table>
          <div class="theme-b-footer-bar">
            ${this.footerBarBase64 ? `
              <img src="${this.footerBarBase64}" width="650" height="6" style="width: 100%; height: 100%; object-fit: fill; display: block;" />
            ` : `
              <div class="bar-navy"></div>
              <div class="bar-cyan"></div>
            `}
          </div>
        </div>
        <!-- FOOTER_END -->
      `;
    }
  }

  public renderWatermark(): string {
    if (this.profile.theme === 'B' && this.watermarkBase64) {
      return `
        <div class="watermark-container">
          <img src="${this.watermarkBase64}" width="420" height="420" style="width: 115mm; height: 115mm; object-fit: contain;" />
        </div>
      `;
    }
    return '';
  }

  public renderSignatoryBlock(opts: RenderOptions = {}, extraLines: { place?: string; date?: string; showPlaceDate?: boolean } = {}): string {
    const showSignature = opts.showSignature !== false;
    const showStamp = opts.showStamp !== false;
    const isThemeA = this.profile.theme === 'A';

    if (isThemeA) {
      return `
        <div class="signature-block">
          <p style="margin-bottom: 2px;">On behalf of <strong>${this.profile.shortName}</strong></p>
          <div class="sign-stamp-wrap theme-a-sign-wrap">
            ${showSignature && this.signatureBase64 ? `<img src="${this.signatureBase64}" width="82" height="58" class="sign-img theme-a-sign" style="width: 82px; height: 58px;" />` : ''}
            ${showStamp && this.stampBase64 ? `<img src="${this.stampBase64}" width="64" height="64" class="stamp-img theme-a-stamp" style="width: 64px; height: 64px;" />` : ''}
          </div>
          <p>Name: <strong>${this.profile.signatoryName}</strong></p>
          <p>${this.profile.signatoryDesignation}</p>
          <p>Place: ${extraLines.place || this.profile.place}</p>
          <p>Date: ${extraLines.date || opts.docDate || new Date().toLocaleDateString('en-GB')}</p>
        </div>
      `;
    } else {
      // Theme B
      return `
        <div class="signature-block">
          <p style="margin-bottom: 2px; font-weight: bold;">Yours faithfully,</p>
          <p style="margin-top: 0; margin-bottom: 4px; font-weight: bold;">For and on behalf of ${this.profile.legalName}</p>
          <div class="sign-stamp-wrap theme-b-sign-wrap">
            ${showSignature && this.signatureBase64 ? `<img src="${this.signatureBase64}" width="115" height="37" class="sign-img theme-b-sign" style="width: 115px; height: 37px;" />` : ''}
            ${showStamp && this.stampBase64 ? `<img src="${this.stampBase64}" width="64" height="64" class="stamp-img theme-b-stamp" style="width: 64px; height: 64px;" />` : ''}
          </div>
          <p style="font-weight: bold; margin-bottom: 2px;">${this.profile.signatoryName}</p>
          <p style="margin-top: 0;">${this.profile.signatoryDesignation}</p>
          <p style="margin-top: 3px;">Place: ${extraLines.place || this.profile.place}</p>
          <p>Date: ${extraLines.date || opts.docDate || new Date().toLocaleDateString('en-GB')}</p>
        </div>
      `;
    }
  }

  public wrapPage(content: string, options: { title?: string; subtitle?: string; docDate?: string; pageClass?: string } = {}): string {
    const { title, subtitle, docDate, pageClass = '' } = options;

    return `
      <div class="page ${pageClass}">
        ${this.renderWatermark()}
        <div class="page-inner">
          ${this.renderHeader(docDate)}
          ${title ? `
            <div class="doc-title-container">
              <h2 class="doc-title">${title}</h2>
              ${subtitle ? `<div class="doc-subtitle">${subtitle}</div>` : ''}
            </div>
          ` : ''}
          <div class="doc-body">
            ${content}
          </div>
        </div>
        ${this.renderFooter()}
      </div>
    `;
  }
}
