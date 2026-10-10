export type CompanyTheme = 'A' | 'B';

export interface CompanyProfile {
  theme: CompanyTheme;
  companyKey: 'me' | 'healthtech';
  legalName: string;
  shortName: string;
  salutation: string;
  refLabel: string;
  addressLines: string[];
  fullAddress: string;
  phones: string[];
  phoneDisplay: string;
  emails: string[];
  emailDisplay: string;
  website: string;
  cin?: string;
  registeredOffice?: string;
  corporateOffice?: string;
  globalSalesOffice?: string;
  manufacturerName: string;
  manufacturerAddress: string;
  signatoryName: string;
  signatoryDesignation: string;
  signatoryAddress?: string;
  witnessDetails?: string;
  place: string;
  udyamNo?: string;
  localContentPct: string;
  preferencePolicy: string;
  brandColors: {
    primary: string;
    headerRule: string;
    barNavy: string;
    barCyan: string;
    tableHeader: string;
    tableBorder: string;
    tableAltRow: string;
    footerTitle: string;
  };
  assetPaths: {
    logoRound?: string;
    logoMarkEn: string;
    watermark?: string;
    stamp: string;
    signature: string;
    footerBar: string;
  };
}

export const COMPANY_PROFILES: Record<'me' | 'healthtech', CompanyProfile> = {
  me: {
    theme: 'A',
    companyKey: 'me',
    legalName: 'MARK ENTERPRISES',
    shortName: 'M/s. Mark Enterprises',
    salutation: 'Respected Sir/Madam,',
    refLabel: 'Reference',
    addressLines: [
      'Shed No. 1, Plot No. 93/2, Street No. 17',
      'MIDC Satpur, Nashik – 422007, Maharashtra, India',
      'Email ID: info@markenworld.com URL: www.markenworld.com',
      'Contact No.: 09175559646 / 090111 04332'
    ],
    fullAddress: 'Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India',
    phones: ['09175559646', '090111 04332'],
    phoneDisplay: '09175559646 / 090111 04332',
    emails: ['info@markenworld.com'],
    emailDisplay: 'info@markenworld.com',
    website: 'www.markenworld.com',
    manufacturerName: 'M/s. Mark Enterprises',
    manufacturerAddress: 'Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra',
    signatoryName: 'Shreedhar Shingare',
    signatoryDesignation: 'Authorized Signatory – Tender manager',
    signatoryAddress: 'Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India',
    witnessDetails: 'Mr. Korra Praveen Naik',
    place: 'Nashik, Maharashtra.',
    udyamNo: 'MH23B0040110/UDYAM-MH-19-0016285',
    localContentPct: '100%',
    preferencePolicy: 'PPP MII 2017',
    brandColors: {
      primary: '#4472C4',
      headerRule: '#4472C4',
      barNavy: '#1F1F6E',
      barCyan: '#0095D9',
      tableHeader: '#4F81BD',
      tableBorder: '#4F81BD',
      tableAltRow: '#DCE6F1',
      footerTitle: '#1F1F6E'
    },
    assetPaths: {
      logoRound: 'assets/brand/mark-enterprises/logo-round.png',
      logoMarkEn: 'assets/brand/mark-enterprises/logo-markEn.png',
      stamp: 'assets/brand/mark-enterprises/stamp.png',
      signature: 'assets/brand/mark-enterprises/signature.png',
      footerBar: 'assets/brand/mark-enterprises/footer-bar.png'
    }
  },
  healthtech: {
    theme: 'B',
    companyKey: 'healthtech',
    legalName: 'MARKEN HEALTHTECH LIMITED',
    shortName: 'Marken Healthtech Limited',
    salutation: 'Dear Sir/Madam,',
    refLabel: 'Reference',
    addressLines: [
      '93/1 Street No.17, MIDC, Satpur, Nashik- 422007. MH. India',
      '410, Maker Chambers V, Nariman Point, Mumbai- 400021. MH. India',
      '05, A-44, VDS Tower, Sector 2, Noida- 201301. UP. India'
    ],
    fullAddress: '93/1 Street No.17, MIDC, Satpur, Nashik- 422007. MH. India',
    phones: ['+91 91 3030 5959'],
    phoneDisplay: '+91 91 3030 5959',
    emails: ['info@markenworld.com'],
    emailDisplay: 'info@markenworld.com',
    website: 'www.markenworld.com',
    cin: 'U32509MH2024PLC422114',
    registeredOffice: '93/1 Street No.17, MIDC, Satpur, Nashik- 422007. MH. India',
    corporateOffice: '410, Maker Chambers V, Nariman Point, Mumbai- 400021. MH. India',
    globalSalesOffice: '05, A-44, VDS Tower, Sector 2, Noida- 201301. UP. India',
    manufacturerName: 'Marken Healthtech Ltd',
    manufacturerAddress: 'Shed No.1, Plot No.93/1, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra.',
    signatoryName: 'Korra Praveen Naik',
    signatoryDesignation: 'Authorized Signatory',
    signatoryAddress: '1-1-51/46, Kapra, ECIL post, S.T.Colony, VTC: Ranga Reddy, District: Hyderabad, State: Andhra Pradesh, PIN Code: 500062',
    witnessDetails: 'Mr. Shreedhar Shingare (Cell No.: 09011104332)',
    place: 'Nashik',
    udyamNo: 'UDYAM-MH-19-0016285',
    localContentPct: '100%',
    preferencePolicy: 'PPP MII 2017',
    brandColors: {
      primary: '#1F3C88',
      headerRule: '#1F3C88',
      barNavy: '#1F1F6E',
      barCyan: '#0095D9',
      tableHeader: '#4F81BD',
      tableBorder: '#4F81BD',
      tableAltRow: '#DCE6F1',
      footerTitle: '#1F3C88'
    },
    assetPaths: {
      logoMarkEn: 'assets/brand/marken-healthtech/logo-markEn.png',
      watermark: 'assets/brand/marken-healthtech/watermark.png',
      stamp: 'assets/brand/marken-healthtech/stamp.png',
      signature: 'assets/brand/marken-healthtech/signature.png',
      footerBar: 'assets/brand/marken-healthtech/footer-bar.png'
    }
  }
};

export function getCompanyProfile(companyKeyOrName?: string): CompanyProfile {
  const key = (companyKeyOrName || '').toLowerCase();
  if (key.includes('healthtech') || key.includes('medtech') || key === 'b') {
    const base = COMPANY_PROFILES.healthtech;
    if (key.includes('medtech')) {
      return {
        ...base,
        legalName: 'MARKEN MEDTECH LIMITED',
        shortName: 'Marken Medtech Limited',
        manufacturerName: 'Marken Medtech Ltd'
      };
    }
    return base;
  }
  return COMPANY_PROFILES.me;
}
