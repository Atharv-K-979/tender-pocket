import { NextResponse } from 'next/server';
import db, { Tender, addActivityLog } from '@/lib/db';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userRole = request.headers.get('x-user-role') || 'Unknown';
  const username = request.headers.get('x-user-username') || 'system';
  try {
    const { id } = await params;

    // Fetch tender details
    const stmt = db.prepare('SELECT * FROM tenders WHERE id = ?');
    const tender = stmt.get(id) as Tender | undefined;

    if (!tender) {
      return NextResponse.json(
        { success: false, error: 'Tender not found' },
        { status: 404 }
      );
    }

    // Prepare template metadata
    const refNo = tender.ref_no || 'N/A';
    const title = tender.title || 'N/A';
    const authority = tender.authority || 'N/A';
    const cost = tender.estimated_cost_raw || (tender.estimated_cost ? `INR ${tender.estimated_cost.toLocaleString('en-IN')}` : 'N/A');
    const emd = tender.emd_raw || (tender.emd ? `INR ${tender.emd.toLocaleString('en-IN')}` : 'N/A');
    const docFee = tender.document_fee_raw || (tender.document_fee ? `INR ${tender.document_fee.toLocaleString('en-IN')}` : 'N/A');
    const location = tender.location || `${tender.place || 'N/A'}, ${tender.state || 'N/A'}`;
    const misExecutive = tender.mis_executive || 'N/A';
    const dueDate = tender.due_date || 'N/A';
    const startDate = tender.start_date || 'N/A';
    const time = tender.time || 'N/A';

    const getMetadataHeader = (templateName: string) => `---
template: "${templateName}"
tender_id: "${id}"
ref_no: "${refNo}"
authority: "${authority}"
estimated_cost: "${cost}"
emd: "${emd}"
closing_date: "${dueDate}"
mis_executive: "${misExecutive}"
generated_at: "${new Date().toISOString()}"
---

# ${templateName.replace(/^\d+_/,'').replace(/_/g, ' ')}

**Tender Reference:** ${refNo}  
**Tender Title:** ${title}  
**Procuring Authority:** ${authority}  
**Location:** ${location}  
**Estimated Cost:** ${cost}  
**EMD Amount:** ${emd}  
**Document Fee:** ${docFee}  
**Submission Due Date:** ${dueDate} ${time !== 'N/A' ? 'at ' + time : ''}  
**MIS Executive:** ${misExecutive}  
**Publish Date:** ${startDate}  

---
`;

    // Define the 17 templates
    const templates = [
      {
        name: '01_Bid_Submission_Letter.md',
        content: `To,
The Procuring Officer,
${authority}
${location}

Subject: Submission of Bid for "${title}" (Tender Ref No: ${refNo})

Dear Sir/Madam,

Having examined the tender documents, we, the undersigned, offer to supply and deliver the goods/services in conformity with the specifications and conditions outlined in the tender documents.

We agree to abide by this bid for the period of validity specified in the bidding documents and it shall remain binding upon us.

Sincerely,
Authorized Signatory
`
      },
      {
        name: '02_Technical_Bid_Details.md',
        content: `## Technical Specifications & Compliance Sheet

We hereby declare that our proposed equipment/service matches or exceeds the technical specifications requested in Tender Ref: ${refNo}.

### Compliance Table
| Requested Specification | Proposed Specification | Deviation (If Any) | Compliance Status |
|---|---|---|---|
| Item Name: ${title} | Fully Compliant | None | Compliant |
| Delivery Timeline | Within schedule | None | Compliant |
| Quality Standard | Certified standard | None | Compliant |
`
      },
      {
        name: '03_Financial_Bid_Cover.md',
        content: `## Financial Bid Declaration

Estimated Tender Cost: ${cost}

We submit our financial quotation separately as per the prescribed BOQ excel sheets. We guarantee that the pricing is competitive and includes all relevant logistics, taxes, and duties as per rules.

Authorized Signatory
`
      },
      {
        name: '04_EMD_Declaration.md',
        content: `## Earnest Money Deposit (EMD) Undertaking

Earnest Money Deposit Required: ${emd}

We hereby submit the EMD details:
* EMD Type: Online / BG / Exemption Claimed
* Reference/Challan No: __________________
* Date of Transaction: __________________

*Note: If Exemption is claimed, MSME/NSIC registration copy is attached herewith.*
`
      },
      {
        name: '05_No_Deviation_Certificate.md',
        content: `## No Deviation Certificate

We hereby certify that we have not taken any deviation, either technical or commercial, from the terms, conditions, and specifications of Tender Ref: ${refNo}.

We agree that any deviation found later in our bid will be treated as non-responsive and our bid may be rejected.
`
      },
      {
        name: '06_Anti_Blacklisting_Undertaking.md',
        content: `## Anti-Blacklisting Declaration

We hereby declare that our firm has not been blacklisted, debarred, or suspended by any Government Department, PSU, or Autonomous body in India as of the bid submission date.
`
      },
      {
        name: '07_Power_of_Attorney.md',
        content: `## Power of Attorney for Authorized Signatory

Be it known that we hereby authorize the following representative to sign, submit, negotiate, and execute all bid documents on behalf of our firm for Tender Ref: ${refNo}:

* Name: __________________
* Designation: __________________
* Specimen Signature: __________________
`
      },
      {
        name: '08_Experience_Details.md',
        content: `## Past Work Experience List

The following are similar contracts executed by our firm over the past three years:

| Client Department | Contract Ref No | Description | Contract Value | Completion Date | Certificate Attached? |
|---|---|---|---|---|---|
| | | | | | |
`
      },
      {
        name: '09_Turnover_Certificate.md',
        content: `## Annual Financial Turnover Certificate

We certify the annual financial turnover of our firm during the last 3 financial years:

* FY 2023-24: __________________
* FY 2022-23: __________________
* FY 2021-22: __________________

*Chartered Accountant Certificate & UDIN attached in bid bundle.*
`
      },
      {
        name: '10_Local_Content_Declaration.md',
        content: `## Local Content Declaration (Make in India)

We certify that the item(s) offered in Tender Ref: ${refNo} have a local content percentage of _________ %, satisfying Class-I / Class-II local supplier requirements as defined under government policies.
`
      },
      {
        name: '11_Site_Visit_Report.md',
        content: `## Site Visit & Pre-Bid Survey Certificate

We certify that our representatives visited the site / reviewed the technical specs for Tender ${refNo} at ${location} and have satisfied ourselves with the site conditions and parameters before submitting this proposal.
`
      },
      {
        name: '12_Conflict_of_Interest_Declaration.md',
        content: `## Conflict of Interest Declaration

We declare that we do not have any conflict of interest with other bidders, consultants, or procuring officers involved in this procurement process.
`
      },
      {
        name: '13_Integrity_Pact.md',
        content: `## Integrity Pact

We pledge to observe the highest standard of ethics during the bidding process and execution of the contract. We will not offer any bribes or enter into collusive practices.
`
      },
      {
        name: '14_Sub_Contracting_Details.md',
        content: `## Sub-Contracting Details

We declare that:
* [ ] No part of this contract will be sub-contracted.
* [ ] The following parts of the contract will be sub-contracted: __________________
`
      },
      {
        name: '15_OEM_Authorization_Form.md',
        content: `## Original Equipment Manufacturer (OEM) Authorization Form

To,
The Procuring Officer,
${authority}

We, as the OEM of product "${title}", hereby authorize our dealer/partner to submit a bid, negotiate, and execute the contract for Tender Ref: ${refNo}.
`
      },
      {
        name: '16_Performance_Security_Guarantee.md',
        content: `## Performance Security Undertaking

We agree that if our bid is accepted, we will submit a Performance Bank Guarantee (PBG) equivalent to ____ % of the total contract value as security for the satisfactory performance of the contract.
`
      },
      {
        name: '17_Checklist_of_Documents.md',
        content: `## Checklist of Uploaded Bid Documents

Please check that the following documents are generated, signed, and uploaded:

- [ ] 01. Bid Submission Letter
- [ ] 02. Technical Bid Details & Compliance
- [ ] 03. Financial Bid Cover
- [ ] 04. EMD Challan / Exemption
- [ ] 05. No Deviation Certificate
- [ ] 06. Anti-Blacklisting Declaration
- [ ] 07. Power of Attorney
- [ ] 08. Past Experience Certificates
- [ ] 09. CA Turnover Certificate
- [ ] 10. Make in India Local Content Declaration
- [ ] 11. Site Visit / Technical Acceptance
- [ ] 12. Conflict of Interest Declaration
- [ ] 13. Integrity Pact signed
- [ ] 14. Sub-Contracting Declaration
- [ ] 15. OEM Authorization (If applicable)
- [ ] 16. PBG Security Undertaking
- [ ] 17. Final Checklist document
`
      }
    ];

    // Create ZIP archive
    const zip = new JSZip();
    for (const t of templates) {
      zip.file(t.name, getMetadataHeader(t.name) + t.content);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Write to public/documents/[id]
    const docDir = path.join(process.cwd(), 'public', 'documents', id);
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
    }

    const zipFileName = `Tender_Templates_${id}.zip`;
    const zipFilePath = path.join(docDir, zipFileName);
    fs.writeFileSync(zipFilePath, zipBuffer);

    // Update downloaded_docs in SQLite
    const templatesZipPath = `/documents/${id}/${zipFileName}`;
    const templatesDocMeta = {
      name: "Generated Bid Templates (17 Files)",
      filename: zipFileName,
      local_path: templatesZipPath,
      created_date: new Date().toLocaleDateString('en-IN')
    };

    const currentDocsStr = tender.downloaded_docs || '[]';
    let currentDocs = [];
    try {
      currentDocs = JSON.parse(currentDocsStr);
      if (!Array.isArray(currentDocs)) currentDocs = [];
    } catch (e) {
      currentDocs = [];
    }

    // Filter out previous templates zip to prevent duplicates
    currentDocs = currentDocs.filter((d: any) => d.local_path !== templatesZipPath);
    currentDocs.push(templatesDocMeta);

    // Update only downloaded_docs metadata (keep existing status)
    const updateStmt = db.prepare('UPDATE tenders SET downloaded_docs = ? WHERE id = ?');
    updateStmt.run(JSON.stringify(currentDocs), id);

    // Log the activity to activity_log
    addActivityLog(username, userRole, 'Generated Templates', id, 'Generated template package');

    console.log(`[API Generate Templates] Successfully generated 17 templates and zipped for Tender ${id}.`);

    return NextResponse.json({
      success: true,
      message: 'Templates generated successfully.',
      downloadUrl: templatesZipPath,
      status: tender.status
    });

  } catch (error: any) {
    console.error('Error generating templates API:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to generate templates.' },
      { status: 500 }
    );
  }
}
