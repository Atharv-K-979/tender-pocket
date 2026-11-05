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

export function formatDate(d?: any): string {
  if (!d) {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    return `${day}-${month}-${year}`;
  }
  let s = String(d).trim();
  s = s.replace(/^Date\s*[:.]\s*/i, '').trim();

  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3];
    return `${day}-${month}-${year}`;
  }

  const ymd = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymd) {
    const year = ymd[1];
    const month = ymd[2].padStart(2, '0');
    const day = ymd[3].padStart(2, '0');
    return `${day}-${month}-${year}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}-${month}-${year}`;
  }

  return s;
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
  private orientation: 'portrait' | 'landscape';
  private logoRoundBase64 = '';
  private logoMarkEnBase64 = '';
  private watermarkBase64 = '';
  private stampBase64 = '';
  private signatureBase64 = '';
  private stampSigBase64 = '';
  private footerBarBase64 = '';

  constructor(profile: CompanyProfile, orientation: 'portrait' | 'landscape' = 'portrait') {
    this.profile = profile;
    this.orientation = orientation;
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

    // Load Combined Stamp & Signature
    let pStampSig = (assets as any).stampSig ? resolveBrandImagePath((assets as any).stampSig) : '';
    if (!pStampSig || !fs.existsSync(pStampSig)) {
      pStampSig = this.profile.theme === 'A'
        ? resolveBrandImagePath('images/me_stamp_sig.png')
        : resolveBrandImagePath('images/healthtech_stamp_sig.png');
    }
    if (fs.existsSync(pStampSig)) {
      this.stampSigBase64 = getBase64Image(pStampSig);
    }

    // Load Footer Bar
    if (assets.footerBar) {
      let p = '';
      if (this.orientation === 'landscape' && this.profile.theme === 'B') {
        const landCandidate = resolveBrandImagePath('assets/brand/marken-healthtech/footer-bar-landscape.png');
        if (fs.existsSync(landCandidate)) {
          p = landCandidate;
        }
      }
      if (!p) {
        p = resolveBrandImagePath(assets.footerBar);
      }
      if (!fs.existsSync(p)) {
        p = this.profile.theme === 'B'
          ? (this.orientation === 'landscape'
              ? resolveBrandImagePath('images/letterheads/healthtech_landscape_footer.png')
              : resolveBrandImagePath('images/healthtech_footer_bar.png'))
          : resolveBrandImagePath('images/me_footer_bar.png');
      }
      this.footerBarBase64 = getBase64Image(p);
    }
  }

  public getStampSigBase64(): string {
    return this.stampSigBase64;
  }

  public getStampBase64(): string {
    return this.stampBase64;
  }

  public getSignatureBase64(): string {
    return this.signatureBase64;
  }

  public getGlobalStyles(orientation?: 'portrait' | 'landscape'): string {
    const isLandscape = (orientation || this.orientation) === 'landscape';
    const isThemeA = this.profile.theme === 'A';
    // Bid documents: Cambria (Headings) + Cambria (Body) for both companies.
    // Portrait A4: 12pt body, 16pt headings. Landscape keeps its compact sizes, since the single-page
    // declarations do not fit an A4 landscape page at 12pt.
    const bodyFont = "Cambria, 'Cambria Math', Georgia, serif";
    const headingFont = bodyFont;
    const bodySize = isLandscape ? (isThemeA ? "11pt" : "10pt") : "12pt";
    const headingSize = isLandscape ? "14pt" : "16pt";
    const bodyLineHeight = '1.15';
    const bodyAlign = "justify";
    const sideMargin = isLandscape ? (isThemeA ? "12mm" : "14mm") : (isThemeA ? "10mm" : "17.5mm");
    const bottomPadding = isLandscape ? (isThemeA ? "9mm" : "41mm") : (isThemeA ? "9mm" : "32mm");

    return `
      @page {
        size: ${isLandscape ? 'A4 landscape' : 'A4 portrait'};
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
        line-height: ${bodyLineHeight};
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
        width: ${isLandscape ? '297mm' : '210mm'};
        min-height: ${isLandscape ? '210mm' : '297mm'};
        position: relative;
        background-color: #ffffff;
        page-break-after: always;
        break-after: page;
        padding: 0;
        box-sizing: border-box;
      }

      .page-inner {
        position: relative;
        width: 100%;
        min-height: 100%;
        padding-left: ${sideMargin};
        padding-right: ${sideMargin};
        padding-top: ${isLandscape ? '5mm' : (isThemeA ? '8mm' : '6mm')};
        padding-bottom: ${bottomPadding};
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        z-index: 2;
        box-sizing: border-box;
      }

      /* Watermark Container: Centered emblem, completely transparent background, no full-page dark box */
      .watermark-container {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: ${isLandscape ? '120mm' : '125mm'};
        height: ${isLandscape ? '120mm' : '125mm'};
        opacity: 0.075;
        z-index: 1;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .watermark-container img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: transparent;
        display: block;
        filter: grayscale(100%);
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
        font-size: ${bodySize};
        font-weight: normal;
        margin-bottom: 4px;
        color: #000;
      }

      /* DOCUMENT TITLE */
      .doc-title-container {
        text-align: center;
        margin: ${isThemeA ? '8px 0 6px 0' : '10px 0 6px 0'};
      }
      .doc-title {
        font-family: ${headingFont};
        font-size: ${headingSize};
        font-weight: bold;
        text-decoration: underline;
        text-transform: uppercase;
        margin: 0;
        padding: 0;
        letter-spacing: 0.2px;
      }
      .doc-subtitle {
        font-family: ${headingFont};
        font-size: 14pt;
        font-style: italic;
        font-weight: ${isThemeA ? 'bold' : 'normal'};
        margin: 3px 0 0 0;
      }

      /* ADDRESS & REFERENCE */
      .address-block {
        margin-bottom: ${isThemeA ? '7pt' : '6pt'};
        font-size: ${bodySize};
        line-height: ${bodyLineHeight};
      }
      .address-block strong {
        font-weight: bold;
      }
      .subject-ref-block {
        margin-bottom: ${isThemeA ? '7pt' : '6pt'};
        font-size: ${bodySize};
        line-height: ${bodyLineHeight};
      }
      .subject-ref-table {
        width: 100%;
        border-collapse: collapse;
        border: none;
        margin: 2px 0;
        font-size: ${bodySize};
      }
      .subject-ref-table td {
        border: none;
        padding: 1px 0;
        vertical-align: top;
      }

      /* CONTENT BODY WITH STRICT FOOTER CLEARANCE */
      .doc-body {
        font-size: ${bodySize};
        line-height: ${bodyLineHeight};
        text-align: ${bodyAlign};
      }
      .doc-body p {
        margin: 0 0 ${isThemeA ? '7pt' : '6pt'} 0;
        line-height: ${bodyLineHeight};
      }
      .doc-body p.justify {
        text-align: justify;
        text-justify: inter-word;
        margin-bottom: ${isThemeA ? '7pt' : '6pt'};
        line-height: ${bodyLineHeight};
      }
      .doc-body p.center {
        text-align: center;
      }
      .doc-body p.bold {
        font-weight: bold;
      }
      .doc-body ul, .doc-body ol {
        margin: 3px 0 6px 18px;
        padding: 0;
        font-size: ${bodySize};
      }
      .doc-body li {
        margin-bottom: 3.5px;
        line-height: ${bodyLineHeight};
      }
      .closing-line {
        font-family: ${bodyFont};
        font-size: ${bodySize};
        font-weight: ${isThemeA ? 'bold' : 'normal'};
        font-style: ${isThemeA ? 'italic' : 'normal'};
        margin: 8pt 0 6pt 0 !important;
      }

      /* COMPACT DOCUMENT STYLES - preserves matching font sizes with clean paragraph gaps */
      .compact-doc .doc-body {
        font-size: ${bodySize};
        line-height: ${bodyLineHeight};
      }
      .compact-doc .doc-body p {
        margin: 0 0 ${isThemeA ? '5.5pt' : '3pt'} 0;
      }
      .compact-doc .doc-body p.justify {
        margin-bottom: ${isThemeA ? '5.5pt' : '3pt'};
        line-height: ${bodyLineHeight};
      }
      .compact-doc .address-block {
        margin-bottom: ${isThemeA ? '5.5pt' : '4pt'};
        font-size: ${bodySize};
        line-height: ${bodyLineHeight};
      }
      .compact-doc .subject-ref-block {
        margin-bottom: ${isThemeA ? '5.5pt' : '4pt'};
        font-size: ${bodySize};
        line-height: ${bodyLineHeight};
      }
      .compact-doc .doc-title-container {
        margin: ${isThemeA ? '5px 0 3px 0' : '6px 0 4px 0'};
      }
      .compact-doc .closing-line {
        margin: 6pt 0 4pt 0 !important;
      }
      .compact-doc .signature-block {
        margin-top: 3px;
      }
      .compact-doc .signature-block p {
        margin: 0;
        line-height: ${bodyLineHeight};
        font-size: ${bodySize};
      }
      .compact-doc .sign-stamp-wrap.theme-a-sign-wrap {
        min-height: 36px;
        gap: 12px;
        margin: 1px 0 2px 0;
      }
      .compact-doc .sign-img.theme-a-sign {
        width: 100px !important;
        height: 66px !important;
      }
      .compact-doc .stamp-img.theme-a-stamp {
        width: 70px !important;
        height: 70px !important;
      }
      .compact-doc .sign-stamp-wrap.theme-b-sign-wrap {
        min-height: 36px;
        gap: 16px;
        margin: 1px 0 2px 0;
      }
      .compact-doc .sign-img.theme-b-sign {
        width: 133px;
        height: 44px;
      }
      .compact-doc .stamp-img.theme-b-stamp {
        width: 70px;
        height: 70px;
      }
      .compact-doc .stamp-sig-img,
      .compact-doc .theme-a-stamp-sig,
      .compact-doc .signature-block img[alt="Signature &amp; Stamp"],
      .compact-doc .signature-block img[alt="Signature & Stamp"] {
        width: 170px !important;
        height: 74px !important;
        object-fit: contain;
      }
      ${!isThemeA && !isLandscape ? `
      /* Healthtech Bid Form (first page): larger signature, close to the other pages' 210x98. */
      .page-doc-4.compact-doc .signature-block img[alt="Signature &amp; Stamp"],
      .page-doc-4.compact-doc .signature-block img[alt="Signature & Stamp"] {
        width: 190px !important;
        height: 88px !important;
      }
      ` : ''}
      ${!isLandscape ? `
      /* Bid Form is the longest single-page document (and repeats the product name): slightly tighter
         lines so long item lists and the signature still fit on the page. */
      .page-doc-4.compact-doc .doc-body,
      .page-doc-4.compact-doc .doc-body p,
      .page-doc-4.compact-doc .doc-body p.justify,
      .page-doc-4.compact-doc .address-block,
      .page-doc-4.compact-doc .subject-ref-block {
        line-height: 1.1;
      }
      ` : ''}

      /* TABLES */
      table.data-table {
        width: 100%;
        border-collapse: collapse;
        border: 1px solid #000000;
        margin: 6px 0 8px 0;
        font-size: ${bodySize};
        line-height: 1.25;
        page-break-inside: avoid;
        background-color: transparent !important;
      }
      table.data-table th {
        background-color: #4F81BD;
        color: #ffffff;
        font-weight: bold;
        padding: ${isLandscape ? "6px 9px" : "6px 8px"};
        border: 1px solid #000000;
        text-align: left;
      }
      /* Table cells never inherit the justified body alignment: justified text in narrow
         columns stretches word gaps (e-mail ids, names, item lists). */
      .doc-body table td,
      .doc-body table th,
      .doc-body table td p,
      .doc-body table td div {
        text-align: left;
        text-justify: auto;
      }
      table.data-table th.center, table.data-table td.center,
      .doc-body table td.center, .doc-body table th.center {
        text-align: center;
      }
      table.data-table td {
        padding: ${isLandscape ? "6px 9px" : "6px 8px"};
        border: 1px solid #000000;
        vertical-align: middle;
        background-color: transparent !important;
      }
      /* BIDDER PARTICULARS / INFORMATION (Doc 1) */
      ${isThemeA ? `
      table.table-bidder-info {
        margin: 6px 0 10px 0;
        border: 1px solid #4F81BD !important;
      }
      table.table-bidder-info th {
        background-color: #4F81BD !important;
        color: #ffffff !important;
        border: 1px solid #4F81BD !important;
      }
      table.table-bidder-info td {
        border-top: 1px solid #4F81BD !important;
        border-bottom: 1px solid #4F81BD !important;
        border-left: 1px solid #4F81BD !important;
        border-right: 1px solid #4F81BD !important;
      }
      /* In portrait mode: remove middle partition between columns and match Image 3 style */
      .portrait-mode table.table-bidder-info th:first-child,
      .portrait-mode table.table-bidder-info td:first-child {
        border-right: none !important;
      }
      .portrait-mode table.table-bidder-info th:last-child,
      .portrait-mode table.table-bidder-info td:last-child {
        border-left: none !important;
      }
      .portrait-mode table.table-bidder-info td:nth-child(2) {
        border-right: none !important;
      }
      .portrait-mode table.table-bidder-info td:nth-child(3) {
        border-left: none !important;
      }
      ` : `
      table.table-bidder-info {
        margin: 6px 0 10px 0;
        width: 100%;
        border-collapse: collapse !important;
        border: 1px solid #000000 !important;
      }
      table.table-bidder-info th,
      table.table-bidder-info td {
        border: 1px solid #000000 !important;
      }
      `}
      table.table-bidder-info th,
      table.table-bidder-info td {
        padding: ${isThemeA ? (isLandscape ? '8px 12px' : '9px 12px') : (isLandscape ? '7px 10px' : '8px 10px')} !important;
        font-size: ${bodySize} !important;
        line-height: ${isThemeA ? '1.22' : '1.22'} !important;
      }
      .portrait-mode table.table-bidder-info th,
      .portrait-mode table.table-bidder-info td {
        padding: ${isThemeA ? '9px 12px' : '8px 10px'} !important;
        font-size: ${bodySize} !important;
        line-height: ${isThemeA ? '1.22' : '1.22'} !important;
      }
      /* Clean white tables without blue fill (OEM Declaration & HT Local Content) */
      table.table-white-header th {
        background-color: transparent !important;
        color: #000000 !important;
        font-weight: bold;
        font-size: ${bodySize};
      }
      /* Theme B Escalation Matrix (#C5D9EF header with black text) */
      table.table-ht-matrix th {
        background-color: #C5D9EF !important;
        color: #000000 !important;
        font-weight: bold;
        font-size: ${isLandscape ? '10pt' : '11pt'} !important;
      }
      table.table-ht-matrix td {
        font-size: ${isLandscape ? '9.8pt' : '11pt'} !important;
      }
      /* Theme B Service Stations (#D4DCE3 header with black text) */
      table.table-ht-stations {
        width: 100%;
        border-collapse: collapse !important;
        border: 1px solid #000000 !important;
      }
      table.table-ht-stations th,
      table.table-ht-stations td {
        border: 1px solid #000000 !important;
        padding: 2.5px 4px !important;
        font-size: ${isLandscape ? '9.2pt' : '10.5pt'} !important;
        line-height: 1.15 !important;
        vertical-align: middle;
      }
      table.table-ht-stations th {
        background-color: #D4DCE3 !important;
        color: #000000 !important;
        font-weight: bold;
        font-size: ${isLandscape ? '9.5pt' : '10.5pt'} !important;
        padding: 3px 4px !important;
      }
      table.table-ht-stations tr {
        min-height: 0 !important;
      }
      /* Theme A Escalation Matrix with #4F81BD / #95B3D7 borders */
      table.table-me-matrix {
        border: 1px solid #4F81BD !important;
      }
      table.table-me-matrix th {
        border: 1px solid #4F81BD !important;
        background-color: #4F81BD !important;
        color: #ffffff !important;
        font-size: ${bodySize} !important;
      }
      table.table-me-matrix td {
        border: 1px solid #95B3D7 !important;
        font-size: ${bodySize} !important;
      }
      /* Theme A Service Stations with #4F81BD header */
      table.table-me-stations th,
      table.table-me-stations td {
        padding: 2.5px 4px !important;
        font-size: ${isLandscape ? '10.5pt' : '11pt'} !important;
        line-height: 1.15 !important;
        vertical-align: middle;
      }
      table.table-me-stations th {
        background-color: #4F81BD !important;
        color: #ffffff !important;
        font-weight: bold;
        font-size: ${isLandscape ? '10.5pt' : '11pt'} !important;
        padding: 3.5px 4px !important;
      }
      table.table-me-stations tr {
        min-height: 0 !important;
      }
      .link-blue {
        color: #0000FF !important;
      }

      /* SIGNATURE BLOCK */
      .signature-block {
        margin-top: 6px;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .signature-block p {
        margin: 0;
        line-height: ${bodyLineHeight};
        font-size: ${bodySize};
      }
      .sign-stamp-wrap {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 16px;
        margin: 2px 0 3px 0;
      }
      .sign-stamp-wrap.theme-a-sign-wrap {
        min-height: 48px;
      }
      .sign-stamp-wrap.theme-b-sign-wrap {
        min-height: 42px;
      }
      .sign-img {
        object-fit: contain;
        display: inline-block;
      }
      .sign-img.theme-a-sign {
        width: 110px;
        height: 73px;
      }
      .sign-img.theme-b-sign {
        width: 147px;
        height: 49px;
      }
      .stamp-img {
        object-fit: contain;
        display: inline-block;
      }
      .stamp-img.theme-a-stamp {
        width: 82px;
        height: 82px;
      }
      .stamp-img.theme-b-stamp {
        width: 82px;
        height: 82px;
      }

      /* FOOTERS */
      .theme-a-footer-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        height: 5.5mm;
        display: flex;
        overflow: hidden;
        z-index: 10;
      }
      .theme-a-footer-bar img {
        width: 100%;
        height: 100%;
        object-fit: fill;
        display: block;
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
        font-size: 7.5pt;
        line-height: 1.25;
        color: #001254;
      }
      .theme-b-footer-title {
        font-size: 10pt;
        font-weight: bold;
        color: #001254;
        margin-bottom: 1.5px;
        letter-spacing: 0.2px;
      }
      .theme-b-footer-cin {
        font-size: 7.8pt;
        font-weight: bold;
        color: #001254;
        margin-bottom: 1.5px;
      }
      .theme-b-footer-right {
        text-align: right;
        font-size: 7.8pt;
        font-weight: 600;
        line-height: 1.35;
        color: #001254;
        white-space: nowrap;
      }
      .theme-b-footer-graphic {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        height: ${isLandscape ? "39mm" : "89.6pt"};
        z-index: 10;
        margin: 0;
        padding: 0;
      }
      .theme-b-footer-graphic img {
        width: 100%;
        height: 100%;
        object-fit: fill;
        object-position: bottom;
        display: block;
      }

      .theme-b-footer-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        width: 100%;
        height: 5.5mm;
        display: flex;
        overflow: hidden;
        z-index: 10;
      }
      .theme-b-footer-bar .bar-navy {
        width: 63%;
        background-color: #001254;
      }
      .theme-b-footer-bar .bar-cyan {
        width: 37%;
        background-color: #0090D6;
      }
    `;
  }

  public renderHeader(docDate?: string): string {
    const formattedDate = (this.profile.theme === 'B' ? '' : (docDate ? formatDate(docDate) : ''));
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
          ${formattedDate ? `<div class="theme-a-date-row" style="text-align: right; font-size: 12pt; margin: 2px 0 6px 0;">Date: ${formattedDate}</div>` : ''}
        </div>
        <!-- HEADER_END -->
      `;
    } else {
      // Theme B
      return `
        <!-- HEADER_START -->
        <div class="theme-b-header">
          ${this.logoMarkEnBase64 ? `<img src="${this.logoMarkEnBase64}" width="160" height="44" class="theme-b-logo" style="width: 44mm; height: 16mm; object-fit: contain;" />` : ''}
          ${formattedDate ? `<div class="theme-b-date-row">Date: ${formattedDate}</div>` : ''}
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
        <div class="theme-b-footer-graphic">
          ${this.footerBarBase64 ? `
            <img src="${this.footerBarBase64}" width="596" height="90" style="width: 100%; height: 100%; object-fit: fill; display: block;" />
          ` : `
            <div class="theme-b-footer-bar">
              <div class="bar-navy"></div>
              <div class="bar-cyan"></div>
            </div>
          `}
        </div>
        <!-- FOOTER_END -->
      `;
    }
  }

  public renderWatermark(): string {
    if (this.profile.theme === 'B' && this.watermarkBase64) {
      return `
        <div class="watermark-container">
          <img src="${this.watermarkBase64}" alt="Watermark" />
        </div>
      `;
    }
    return '';
  }

  public renderSignatoryBlock(opts: RenderOptions = {}, extraLines: { place?: string; date?: string; showPlaceDate?: boolean } = {}): string {
    const showSignature = opts.showSignature !== false;
    const showStamp = opts.showStamp !== false;
    const isThemeA = this.profile.theme === 'A';
    const isLandscape = this.orientation === 'landscape';

    if (isLandscape) {
      if (isThemeA) {
        return `
          <div class="signature-block signature-block-landscape" style="margin-top: 4px;">
            <p style="margin-bottom: 2px; font-size: 12pt;">On behalf of <strong>${this.profile.shortName}</strong></p>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
              <div style="font-size: 11.5pt; line-height: 1.25; min-width: 190px;">
                <div>Name: <strong>${this.profile.signatoryName}</strong></div>
                <div>${this.profile.signatoryDesignation}</div>
                <div>Place: ${extraLines.place || this.profile.place} | Date: ${formatDate(extraLines.date || opts.docDate || '26-09-2026')}</div>
              </div>
              ${this.stampSigBase64 ? `<img src="${this.stampSigBase64}" width="185" height="94" class="stamp-sig-img" style="width: 185px; height: 94px; object-fit: contain; margin-left: 6px;" />` : `
                ${showSignature && this.signatureBase64 ? `<img src="${this.signatureBase64}" width="118" height="70" class="sign-img theme-a-sign" style="width: 118px; height: 70px; object-fit: contain;" />` : ''}
                ${showStamp && this.stampBase64 ? `<img src="${this.stampBase64}" width="76" height="76" class="stamp-img theme-a-stamp" style="width: 76px; height: 76px; object-fit: contain;" />` : ''}
              `}
            </div>
          </div>
        `;
      } else {
        return `
          <div class="signature-block signature-block-landscape" style="margin-top: 4px;">
            <p style="margin-bottom: 2px; font-weight: bold; font-size: 10pt;">Yours faithfully,</p>
            <p style="margin-top: 0; margin-bottom: 3px; font-weight: bold; font-size: 10pt;">For and on behalf of ${this.profile.legalName}</p>
            <div style="display: flex; align-items: center; gap: 12px; margin-top: 2px;">
              <div style="font-size: 9.5pt; line-height: 1.25; min-width: 210px;">
                <div style="font-weight: bold;">${this.profile.signatoryName}</div>
                <div>${this.profile.signatoryDesignation}</div>
              </div>
              ${this.stampSigBase64 ? `<img src="${this.stampSigBase64}" width="190" height="92" class="stamp-sig-img" style="width: 190px; height: 92px; object-fit: contain; margin-left: 6px;" alt="Signature &amp; Stamp" />` : `
                ${showSignature && this.signatureBase64 ? `<img src="${this.signatureBase64}" width="133" height="64" class="sign-img theme-b-sign" style="width: 133px; height: 64px; object-fit: contain;" />` : ''}
                ${showStamp && this.stampBase64 ? `<img src="${this.stampBase64}" width="76" height="76" class="stamp-img theme-b-stamp" style="width: 76px; height: 76px; object-fit: contain;" />` : ''}
              `}
            </div>
          </div>
        `;
      }
    }

    if (isThemeA) {
      return `
        <div class="signature-block">
          <p style="margin-bottom: 2px; font-size: 12pt;">On behalf of <strong>${this.profile.shortName}</strong></p>
          <div style="margin: 2px 0 3px 0;">
            ${this.stampSigBase64 ? `<img src="${this.stampSigBase64}" width="185" height="80" class="stamp-sig-img theme-a-stamp-sig" style="width: 185px; height: 80px; object-fit: contain; display: block;" alt="Signature &amp; Stamp" />` : `
              <div class="sign-stamp-wrap theme-a-sign-wrap">
                ${showSignature && this.signatureBase64 ? `<img src="${this.signatureBase64}" width="110" height="73" class="sign-img theme-a-sign" style="width: 110px; height: 73px;" />` : ''}
                ${showStamp && this.stampBase64 ? `<img src="${this.stampBase64}" width="82" height="82" class="stamp-img theme-a-stamp" style="width: 82px; height: 82px;" />` : ''}
              </div>
            `}
          </div>
          <p style="margin: 0; line-height: 1.15; font-size: 12pt;">Name: ${this.profile.signatoryName}</p>
          <p style="margin: 0; line-height: 1.15; font-size: 12pt;">${this.profile.signatoryDesignation}</p>
          <p style="margin: 0; line-height: 1.15; font-size: 12pt;">Place: ${extraLines.place || this.profile.place}</p>
          <p style="margin: 0; line-height: 1.15; font-size: 12pt;">Date: ${formatDate(extraLines.date || opts.docDate || '26-09-2026')}</p>
        </div>
      `;
    } else {
      // Theme B
      return `
        <div class="signature-block">
          <p style="margin-bottom: 2px; font-weight: bold; font-size: 12pt;">Yours faithfully,</p>
          <p style="margin-top: 0; margin-bottom: 3px; font-weight: bold; font-size: 12pt;">For and on behalf of ${this.profile.legalName}</p>
          <div style="margin: 2px 0 3px 0;">
            ${this.stampSigBase64 ? `<img src="${this.stampSigBase64}" width="210" height="98" style="width: 210px; height: 98px; object-fit: contain; display: block;" alt="Signature &amp; Stamp" />` : `
              <div class="sign-stamp-wrap theme-b-sign-wrap">
                ${showSignature && this.signatureBase64 ? `<img src="${this.signatureBase64}" width="147" height="49" class="sign-img theme-b-sign" style="width: 147px; height: 49px;" />` : ''}
                ${showStamp && this.stampBase64 ? `<img src="${this.stampBase64}" width="82" height="82" class="stamp-img theme-b-stamp" style="width: 82px; height: 82px;" />` : ''}
              </div>
            `}
          </div>
          <p style="margin: 0; line-height: 1.20; font-size: 12pt;">${this.profile.signatoryName}</p>
          <p style="margin: 0; line-height: 1.20; font-size: 12pt;">${this.profile.signatoryDesignation}</p>
        </div>
      `;
    }
  }

  public wrapPage(content: string, options: { title?: string; subtitle?: string; docDate?: string; pageClass?: string; dateBelowTitle?: boolean } = {}): string {
    const { title, subtitle, docDate, pageClass = '', dateBelowTitle = false } = options;
    const isLandscape = this.orientation === 'landscape';
    const modeClass = isLandscape ? 'landscape-mode' : 'portrait-mode';
    const shouldPlaceDateBelow = this.profile.theme !== 'B' && (dateBelowTitle || title === 'BID FORM');
    const formattedDate = (this.profile.theme === 'B' ? undefined : (docDate ? formatDate(docDate) : undefined));

    return `
      <div class="page ${modeClass} ${pageClass}">
        ${this.renderWatermark()}
        <div class="page-inner">
          ${this.renderHeader(shouldPlaceDateBelow ? undefined : docDate)}
          ${title ? `
            <div class="doc-title-container">
              <h2 class="doc-title">${title}</h2>
              ${subtitle ? `<div class="doc-subtitle">${subtitle}</div>` : ''}
            </div>
          ` : ''}
          ${shouldPlaceDateBelow && formattedDate ? `
            <div class="theme-b-date-row" style="text-align: right; margin: 2px 0 8px 0; font-size: 12pt;">Date: ${formattedDate}</div>
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
