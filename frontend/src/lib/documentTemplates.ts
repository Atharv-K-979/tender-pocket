import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { getCompanyProfile, CompanyProfile } from './companyProfiles';
import { DocumentLayoutRenderer, RenderOptions, resolveBrandImagePath, getBase64Image } from './documentLayout';

export function resolveImagePath(subPath: string): string {
  return resolveBrandImagePath(subPath);
}

export function generateHtmlTemplates(data: any): string {
  const profile = getCompanyProfile(data.companyKey || data.companyName);
  const renderer = new DocumentLayoutRenderer(profile);

  const isThemeA = profile.theme === 'A';
  const bidNumber = data.bidNumber || data.ref_no || 'GEM/2026/B/8015551';
  const bidDate = data.bidDate || '09-09-2026';
  const docDate = data.date || data.docDate || (isThemeA ? '26-09-2026' : '10-01-2026');
  const authorityName = (data.authorityName || data.authority || 'MANAGING DIRECTOR\nUP MEDICAL SUPPLIES CORPORATION LIMITED (UPMSCL)').trim();
  const authorityDept = (data.authorityDept || 'Medical Health And Family Welfare Department').trim();
  const authorityAddress = (data.authorityAddress || data.location || 'Lucknow, Uttar Pradesh').trim();
  const productDescription = data.productDescription || data.productName || (isThemeA ? 'Biosafety Cabinet' : 'Walk In Cooler (MWIC-04)');
  const offeredModel = data.offeredModel || data.model || (isThemeA ? 'MBSC-03' : 'MWIC-04');
  const offeredMake = data.offeredMake || data.brand || 'MarkEn';
  const qty = data.qty || data.bid_qty || (isThemeA ? '67' : '1');
  const udyamNo = data.udyamNo || profile.udyamNo || 'MH23B0040110/UDYAM-MH-19-0016285';
  const localContentPct = data.localContentPercentage || profile.localContentPct || '100%';
  const localContentLocation = data.localContentLocation || profile.manufacturerAddress;
  const preferencePolicy = data.preferencePolicy || profile.preferencePolicy || 'PPP MII 2017';
  const blacklistYears = data.blacklistYears || (isThemeA ? '(5) Five' : 'three');
  const bidSecurityPeriod = data.bidSecurityPeriod || (isThemeA ? '180 Days' : 'Six (06) months');
  const place = data.place || profile.place;

  const renderOpts: RenderOptions = {
    showSignature: data.showSignature !== false,
    showStamp: data.showStamp !== false,
    docDate,
    bidDate,
    bidNumber
  };

  // Helper: Address Block
  const renderAddressBlock = () => {
    let lines: string[] = [];
    if (isThemeA) {
      lines.push('To,');
    } else {
      lines.push('To');
    }

    if (authorityName) {
      authorityName.split('\n').forEach((l: string) => {
        const tr = l.trim();
        if (tr) lines.push(`<strong>${tr}</strong>`);
      });
    }
    if (authorityDept) lines.push(authorityDept);
    if (authorityAddress) lines.push(authorityAddress);

    return `<div class="address-block">${lines.join('<br/>')}</div>`;
  };

  // Helper: Subject & Reference Block
  const renderSubjectRef = (subject?: string, refLabel = profile.refLabel) => {
    if (isThemeA) {
      return `
        <div class="subject-ref-block">
          ${subject ? `<p style="margin: 1px 0;"><strong>Subject: ${subject}</strong></p>` : ''}
          <p style="margin: 1px 0;"><strong>${refLabel}: Bid No.: ${bidNumber}, Dated: ${bidDate}.</strong></p>
        </div>
      `;
    } else {
      return `
        <div class="subject-ref-block">
          <table class="subject-ref-table">
            ${subject ? `
              <tr>
                <td style="width: 14%; font-weight: bold;">Subject</td>
                <td style="width: 2%; font-weight: bold;">:</td>
                <td style="width: 84%;">${subject}</td>
              </tr>
            ` : ''}
            <tr>
              <td style="width: 14%; font-weight: bold;">${refLabel}</td>
              <td style="width: 2%; font-weight: bold;">:</td>
              <td style="width: 84%;">Bid No.: ${bidNumber}, Dated: ${bidDate}.</td>
            </tr>
          </table>
        </div>
      `;
    }
  };

  const pages: string[] = [];

  // =========================================================================
  // DOCUMENT 1: BIDDER PARTICULARS / INFORMATION
  // =========================================================================
  pages.push(renderer.wrapPage(`
    <table class="data-table" style="font-size: 9pt; line-height: 1.18; margin: 4px 0 6px 0;">
      ${isThemeA ? `
        <thead>
          <tr>
            <th style="width: 44%;">Particulars</th>
            <th style="width: 56%;">Details</th>
          </tr>
        </thead>
      ` : `
        <thead>
          <tr>
            <th style="width: 7%;" class="center">Sr.</th>
            <th style="width: 38%;">Particulars</th>
            <th style="width: 55%;">Details</th>
          </tr>
        </thead>
      `}
      <tbody>
        <tr>
          ${!isThemeA ? `<td class="center">1.</td>` : ''}
          <td><strong>Name of the Bidder</strong></td>
          <td>${profile.shortName}</td>
        </tr>
        <tr>
          ${!isThemeA ? `<td class="center">2.</td>` : ''}
          <td><strong>Address of the Bidder</strong></td>
          <td>: ${profile.fullAddress}</td>
        </tr>
        <tr>
          ${!isThemeA ? `<td class="center">3.</td>` : ''}
          <td><strong>Name of the Manufacturer</strong></td>
          <td>: ${profile.manufacturerName}</td>
        </tr>
        <tr>
          ${!isThemeA ? `<td class="center">4.</td>` : ''}
          <td><strong>Address of the Manufacturer</strong></td>
          <td>: ${profile.manufacturerAddress}</td>
        </tr>
        <tr>
          ${!isThemeA ? `<td class="center">5.</td>` : ''}
          <td><strong>Name and address of the person<br/>To whom all references shall be made regarding this tender inquiry.</strong></td>
          <td>: Mr. ${profile.signatoryName}<br/>Address: ${profile.signatoryAddress || profile.fullAddress}</td>
        </tr>
        <tr>
          ${!isThemeA ? `<td class="center">6.</td>` : ''}
          <td><strong>Mobile no</strong></td>
          <td>: ${profile.phones[1] || profile.phones[0]}</td>
        </tr>
        <tr>
          ${!isThemeA ? `<td class="center">7.</td>` : ''}
          <td><strong>Telephone</strong></td>
          <td>: 0253-299 5112</td>
        </tr>
        <tr>
          ${!isThemeA ? `<td class="center">8.</td>` : ''}
          <td><strong>Telex / Fax</strong></td>
          <td>: NA</td>
        </tr>
        <tr>
          ${!isThemeA ? `<td class="center">9.</td>` : ''}
          <td><strong>Email address</strong></td>
          <td>: info@markworld.com / tender@markenworld.com</td>
        </tr>
        <tr>
          ${!isThemeA ? `<td class="center">10.</td>` : ''}
          <td><strong>Witness</strong></td>
          <td>: ${profile.witnessDetails || 'Mr. Shreedhar Shingare (Cell No.: 09011104332)'}</td>
        </tr>
      </tbody>
    </table>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: isThemeA ? 'BIDDER PARTICULARS' : 'BIDDER INFORMATION',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-1'
  }));

  // =========================================================================
  // DOCUMENT 2: OEM DECLARATION
  // =========================================================================
  pages.push(renderer.wrapPage(`
    <p class="center bold" style="margin-bottom: 8px; text-decoration: underline;">TO WHOM SO EVER IT MAY CONCERN</p>
    <p class="justify">We <strong>${profile.shortName}</strong> who are established and reputable manufacturers or producers of <strong>Medical, Blood bank, hospital, & Cold Chain Equipment and Furniture</strong> having production facilities at <strong>${profile.manufacturerAddress}</strong>.</p>
    <p class="justify">We declare that we are original equipment Manufacturer (OEM) of quoted product.</p>

    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 10%;" class="center">Sr no</th>
          <th style="width: 40%;">List of quoted items</th>
          <th style="width: 20%;">Model</th>
          <th style="width: 20%;">Mfg. Brand / Make</th>
          <th style="width: 10%;" class="center">Qty</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="center">01</td>
          <td><strong>${productDescription}</strong></td>
          <td>${offeredModel}</td>
          <td>${offeredMake}</td>
          <td class="center">${qty}</td>
        </tr>
      </tbody>
    </table>

    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'OEM DECLARATION',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-2'
  }));

  // =========================================================================
  // DOCUMENT 3: MANUFACTURER DECLARATION
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef(undefined, 'Reference')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We, <strong>${profile.legalName}</strong>, who are proven and reputable manufacturers of <strong>Blood Bank Equipment, Medical Cold Chain Equipment, Medical Equipment’s and Furniture and Hospital Furniture, Refrigerated Van, Mobile Dental Van, Mobile Health Unit</strong> having factories at <strong>${profile.manufacturerAddress}</strong>, hereby declare that we are participating in the above referred tender as <strong>Original Equipment Manufacturer (OEM)</strong>.</p>
    <p class="justify">Since we are the OEM, we are submitting the bid directly and no separate authorization in favour of any dealer/distributor is required.</p>
    <p class="justify">We further confirm that no other supplier or firm or individual is authorized by us to submit a bid, process the same further and enter into a contract against your requirement as contained in the above referred tender documents for the above goods manufactured by us.</p>
    <p class="justify">We also hereby extend our <strong>full warranty and CAMC</strong>, as applicable, as per tender terms & conditions pertaining to the above referred tender / bid.</p>
    <p class="justify">We hereby confirm that we shall be fully responsible for the satisfactory execution of the contract and the spares for the equipment shall be available for at least <strong>10 years</strong> from the date of supply of equipment.</p>
    <p class="justify">We also confirm that the price quoted by us is final and shall not exceed the price which we would have quoted to any other bidder or authority for similar supply.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'MANUFACTURER DECLARATION',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-3'
  }));

  // =========================================================================
  // DOCUMENT 4: BID FORM (Compact typography to guarantee safe footer boundary)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Bid Form')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We, the undersigned have examined the above mentioned bidding document, including amendment/ corrigendum (if any), the receipt of which is hereby confirmed. We now offer to supply and deliver <strong>${productDescription}</strong> in conformity with your above referred document for the sum as shown in the Price Schedules attached herewith and made part of this bid. If our bid is accepted, we undertake to supply the goods and perform the services as mentioned in the bidding documents, in accordance with the delivery schedule specified in the List of Requirements.</p>
    <p class="justify">We further confirm that, if our bid is accepted, we shall provide you with a performance security of required amount in an acceptable form in terms of “General Conditions Contract” read with modification, if any “Special Conditions of Contract”, in Section – V and all other terms and conditions as mentioned in bidding document for due performance of the contract.</p>
    <p class="justify">We agree to keep our bid valid for acceptance as required in the “General Instruction to Bidders”, read with modification, if any in “Special Instructions to Bidders” or for subsequently extended period, if any, agreed to by us. We also accordingly confirm to abide by this bid up to the aforesaid period and this bid may be accepted any time before the expiry of the aforesaid period. We further confirm that, until a formal contract is executed, this bid read with your written acceptance thereof within the aforesaid period shall constitute a binding contract between us.</p>
    <p class="justify">We further understand that you are not bound to accept the lowest or any bid you may receive against your above-referred advertised tender enquiry.</p>
    <p class="justify">We confirm that we do not stand <strong>deregistered/banned/blacklisted</strong> by any Central Govt. Ministries/Departments/Hospitals/Institutes.</p>
    <p class="justify">We confirm that we fully agree to the terms and conditions specified in the above mentioned bid document, including amendment/ corrigendum if any.</p>
    <p class="justify"><strong>“We hereby certify that if at any time, information furnished by us is proved to be false or incorrect, we are liable for any action as deemed fit by the purchaser in addition to forfeiture of the bid security.”</strong></p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'BID FORM',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-4 compact-doc'
  }));

  // =========================================================================
  // DOCUMENT 5: BID SECURITY DECLARATION FORM
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Bid Security Declaration Form')}
    <p><strong>${profile.salutation}</strong></p>
    <p>We the undersigned declare that;</p>
    <p class="justify">We accept that we may be suspended to submit bids for contract(s) with you for a period of <strong>${bidSecurityPeriod}</strong> from the Date of bid opening if we are in a breach of any obligation under the bid conditions, because We</p>
    <ol type="a" style="margin-left: 18px;">
      <li>have withdrawn/modified our bid during the period of bid validity specified in the form of bid; or</li>
      <li>having been notified of the acceptance of our bid by the purchaser during the period of bid validity</li>
      <li>fail or refuse to execute the contract, or</li>
      <li>Fail or refuse to submit the Performance Security of the amount specified in the bid.</li>
    </ol>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'BID SECURITY DECLARATION FORM',
    subtitle: '(Rule 170 of General Financial Rule 2017)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-5'
  }));

  // =========================================================================
  // DOCUMENT 6: UNDERTAKING (Acceptance of Tender Terms and Conditions)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Acceptance of Tender Terms and Conditions as per Bid.')}
    <p><strong>${profile.salutation}</strong></p>
    <ol type="a" style="margin-left: 18px;">
      <li>We have downloaded/obtained the tender documents for the above-mentioned bid in reference to Supply & Installation of Equipment’s from the web site namely <strong>GeM Portal</strong>.</li>
      <li>We hereby certify that we have reviewed entire terms and conditions of the tender documents (including all documents like annexure, schedules, etc., which is form part of the Contract Agreement and we shall abide hereby to the terms / conditions / Warranty / CMC / Delivery / Clauses contained therein.</li>
      <li>The corrigendum(s) issued from time to time by your department / organization also has been taken into consideration, while submitting this acceptance letter.</li>
      <li>We hereby unconditionally accept the tender conditions of above mentioned tender and its corrigendum(s) in totality / entirely.</li>
      <li>In case any provision of this bid / tender is found violated, your department / organization shall be at liberty to reject this and we shall not have any claim/ right against the department in satisfaction of this condition.</li>
    </ol>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: isThemeA ? 'UNDERTAKING' : 'ACCEPTANCE OF TENDER TERMS AND CONDITIONS',
    subtitle: isThemeA ? '(Acceptance of Tender Terms and Conditions as per Bid)' : undefined,
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-6'
  }));

  // =========================================================================
  // DOCUMENT 7: DECLARATION (Availability of Spare Parts up to 10 Years)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef(undefined, 'Reference')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We certify that the equipment being/quoted is the latest model and that spares for the equipment will be available for a period of at least <strong>10 years</strong> and we also guarantee that we will keep the organization informed of any update of the equipment over a period of 10 years.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'DECLARATION',
    subtitle: '(for Availability of Spare Parts up to 10 Years)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-7'
  }));

  // =========================================================================
  // DOCUMENT 8: UNDERTAKING FOR WARRANTY
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Undertaking for Warranty', 'Reference')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We, <strong>${profile.shortName}</strong> ourselves as an Established and Reputable, Indigenous Manufacturers of <strong>Blood Bank, Cold Chain, Medical, Hospital Equipment’s and Furniture</strong>, do hereby guarantee and warranty all work performed as part of the bid for a period of <strong>as per bid terms</strong> from the Date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.</p>
    <p class="justify">We, do hereby confirm our participation in the tender for the supply of <strong>${productDescription}</strong>, as per the specifications outlined in the bid documents.</p>
    <p class="justify">Having thoroughly reviewed the bid, including the warranty period and terms and conditions specified in the bid documents, we would like to express our acceptance of the stated terms. We understand and acknowledge the importance of complying with the conditions set forth in the bid to ensure a smooth and successful collaboration.</p>
    <p class="justify">By submitting this confirmation, we affirm our commitment to adhere to the warranty terms and conditions as outlined in the bid documents. We assure you that, if awarded the contract, we will fulfill our obligations with the utmost professionalism and in accordance with the agreed-upon terms.</p>
    <p class="justify">We fully understand and acknowledge the importance of the warranty duration in meeting your requirements. Our commitment to providing a as per bid terms warranty reflects our confidence in the quality and durability of our products.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'UNDERTAKING FOR WARRANTY',
    subtitle: isThemeA ? '(Acceptance of Warranty Period and Terms and Conditions)' : undefined,
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-8 compact-doc'
  }));

  // =========================================================================
  // DOCUMENT 9: PRICE DECLARATION
  // =========================================================================
  pages.push(renderer.wrapPage(`
    <p class="center bold" style="margin-bottom: 8px; text-decoration: underline;">TO WHOM SO EVER IT MAY CONCERN</p>
    ${renderAddressBlock()}
    ${renderSubjectRef('Price Declaration')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We <strong>${profile.shortName}</strong> having registered office at <strong>${profile.manufacturerAddress}</strong>, hereby declare that the rates quoted in the tender submitted for <strong>${productDescription}</strong>, are not higher than the rates quoted to other Government Departments/Government Undertakings or any prevailing contracts, and they are not higher than the Maximum Retail Price (MRP).</p>
    <p class="justify">We assure that our pricing is fair, competitive, and in compliance with all applicable regulations. The rates provided in this tender are consistent with our pricing practices across various government entities and ongoing contracts.</p>
    <p class="justify">If required, we are willing to provide any additional documentation or evidence to substantiate this declaration.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'PRICE DECLARATION',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-9'
  }));

  // =========================================================================
  // DOCUMENT 10: DECLARATION (for Demonstration)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Declaration for Demonstration')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We <strong>${profile.shortName}</strong> having registered office at <strong>${profile.manufacturerAddress}</strong>. We, the undersigned, hereby declare our commitment to arranging a demonstration of our product at our own expense. We understand the importance of showcasing the features and capabilities of our product to your satisfaction.</p>
    <p><strong>Terms of the Declaration:</strong></p>
    <p class="justify"><strong>Demo Arrangement:</strong> We commit to organizing and conducting a comprehensive demonstration of our product as per your requirements.</p>
    <p class="justify"><strong>Cost Coverage:</strong> All expenses related to the demonstration, including travel, accommodation, and any other associated costs, will be borne entirely by us.</p>
    <p class="justify"><strong>Location and Timing:</strong> We are flexible and willing to conduct the demo at a location of your choice. We will coordinate with your team to determine a suitable Date and time for the demonstration.</p>
    <p class="justify"><strong>Customization:</strong> If there are specific aspects or features you wish to focus on during the demo, please communicate them in advance so that we can tailor our presentation to meet your needs.</p>
    <p class="justify"><strong>Feedback and Adjustments:</strong> We welcome any feedback you may have during or after the demonstration. If there are areas that require further clarification or adjustments, we commit to addressing them promptly.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'DECLARATION',
    subtitle: '(for Demonstration)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-10 compact-doc'
  }));

  // =========================================================================
  // DOCUMENT 11: DECLARATION (on Non-Blacklisting / Debarring)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    <p class="center bold" style="margin-bottom: 8px; text-decoration: underline;">TO WHOM SO EVER IT MAY CONCERN</p>
    ${renderAddressBlock()}
    ${renderSubjectRef('Declaration on Non-Blacklisting / Debarring')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We <strong>${profile.shortName}</strong> having registered office at <strong>${profile.manufacturerAddress}</strong>. Hereby declare that our firm has not been found guilty of malpractice, misconduct, or blacklisted/debarred either by the Public Health Department, Government of Maharashtra, and all State Governments or by any local authority and other State Government/Central Government's Organizations in <strong>the past ${blacklistYears} years</strong>.</p>
    <p class="justify">We take great pride in maintaining a high standard of ethical conduct and compliance with all applicable regulations. Our commitment to integrity and professionalism is reflected in our business practices, and we strive to uphold the trust placed in us by our clients and stakeholders.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'DECLARATION',
    subtitle: '(on Non-Blacklisting / Debarring)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-11'
  }));

  // =========================================================================
  // DOCUMENT 12: UNDERTAKING (For Financial Standing)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Undertaking for Financial Standing')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We, <strong>${profile.shortName}</strong>, represented by the company, located at <strong>${profile.manufacturerAddress}</strong>, hereby provide the following undertaking regarding our financial standing:</p>
    <p class="justify"><strong>Business Nature:</strong> We are established and reputable indigenous manufacturers of <strong>Blood Bank Equipment, Medical Cold Chain Equipment, Medical Equipment’s and Furniture and Hospital Furniture, Refrigerated Van, Mobile Dental Van, Mobile Health Unit</strong>.</p>
    <p class="justify"><strong>Location:</strong> Our manufacturing facilities are situated at <strong>${profile.manufacturerAddress}</strong>.</p>
    <p><strong>Financial Standing:</strong> We declare that, to the best of our knowledge and belief, as of the Date of this undertaking:</p>
    <p style="margin-left: 18px;">a. We are not under liquidation, court receivership, or any similar proceedings.<br/>b. We are not bankrupt.</p>
    <p class="justify"><strong>Commitment:</strong> We undertake to promptly inform the concerned parties if there are any changes in our financial standing during any agreements or contracts.</p>
    <p class="justify"><strong>Accuracy of Information:</strong> The information provided in this undertaking is true and accurate to the best of our knowledge, and we understand the legal consequences of providing false information.</p>
    <p>We hereby affix our signature and company seal to confirm the authenticity of this undertaking.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'UNDERTAKING',
    subtitle: '(For Financial Standing)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-12 compact-doc'
  }));

  // =========================================================================
  // DOCUMENT 13: DECLARATION (For Certificate of Country of Origin)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Declaration for Certificate Of Country of Origin Reference', 'Reference')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We <strong>${profile.shortName}</strong> introduce ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Equipment’s and Hospital Furniture would like to inform you that the quoted product <strong>${productDescription}</strong>, is manufactured by us and we are Self-Manufacturer of the same. This product is made entirely in our Company using the raw materials available in India.</p>
    <p class="justify">We ensure that no foreign raw materials are used in our manufactured products i.e. <strong>${productDescription}</strong>, However, we assure you that the products we manufacture are entirely Indian made and that we are the Original Equipment’s Manufacture (OEM) of the original products.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'DECLARATION',
    subtitle: '(For Certificate of Country of Origin)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-13'
  }));

  // =========================================================================
  // DOCUMENT 14: DECLARATION CERTIFICATE FOR LOCAL CONTENT (Page 1)
  // =========================================================================
  const isPppMsme = preferencePolicy.toUpperCase().includes('MSME');
  pages.push(renderer.wrapPage(`
    <p class="justify" style="font-size: 9pt; margin-bottom: 3px;">This declaration must form part of all tenders & it contains general information and serves as a declaration form for all bidders. (Before completing this declaration, bidders must study the General Conditions, Definitions, Govt. Directives applicable in respect of Local Content & prescribed tender conditions).</p>
    <p class="justify bold" style="font-size: 9pt; margin-bottom: 3px;">LOCAL CONTENT DECLARATION BY CHIEF FINANCIAL OFFICER OR OTHER LEGALLY RESPONSIBLE PERSON NOMINATED IN WRITING BY THE CHIEF EXECUTIVE OR SENIOR MEMBER/PERSON WITH MANAGEMENT RESPONSIBILITY (CORPORATION, PARTNERSHIP OR INDIVIDUAL)</p>
    <p class="justify bold" style="font-size: 9pt; margin-bottom: 3px;">IN RESPECT OF BID / TENDER No.: ${bidNumber}, Dated: ${bidDate}, Issued By: ${profile.shortName}.</p>
    <p class="justify" style="font-size: 9pt; margin-bottom: 3px;">NB: The obligation to complete, duly sign and submit his declaration cannot be transferred to an external authorized representative, auditor or any other third party acting on behalf of the bidder.</p>
    <p class="justify" style="font-size: 9pt; margin-bottom: 3px;">I, the undersigned, <strong>${profile.signatoryName}</strong> do hereby declare, in my capacity as <strong>Partner / Authorized Signatory</strong> of <strong>${profile.shortName}</strong> the following:</p>
    <ol type="a" style="margin: 2px 0 3px 16px; font-size: 9pt;">
      <li>The facts contained herein are within my own personal knowledge.</li>
      <li>I have read and understood the requirement of local content (LC) and same is specified as percentage calculated in accordance with the definition provided at clause 2 of revised Public Procurement (preference to Make in India) Order 2017.</li>
      <li>“Local content” as per above order means the amount of value added in India which shall be the total value of items procured (excluding net domestic indirect taxes) minus the value of imported content in the item (including all customs duties) as a proportion of the total value in percent.</li>
      <li>I have satisfied myself that the goods/services/works to be delivered in terms of the above-specified bid comply with the local content requirements as specified in the tender for ‘Class-I Local Supplier’ / ‘Class-II Local Supplier’, and as above.</li>
      <li>I understand that a bidder can seek benefit of either Public Procurement Policy for MSEs–Order 2012 or Public Procurement (preference to Make in India) Order 2017 and not both and once the option is declared / selected it is not permitted to be modified subsequently. Accordingly, I seek the benefit from the below declared purchase preference policy only.</li>
      <li>I seek benefits against the following policy only (Select only one Option):</li>
    </ol>

    <table style="width: 100%; border-collapse: collapse; margin: 3px 0 4px 0; font-size: 9pt;">
      <tr>
        <td style="width: 32px; vertical-align: middle; padding: 2px 0;">
          <div style="width: 20px; height: 20px; border: 1.5px solid #000; display: flex; align-items: center; justify-content: center; font-size: 13pt; font-weight: bold;">
            ${isPppMsme ? '✔' : '&nbsp;'}
          </div>
        </td>
        <td style="vertical-align: middle; padding: 2px 4px;">
          <strong>1) PPP MSME Order 2012</strong> (applicable for MSE manufacturers)
        </td>
      </tr>
      <tr>
        <td style="width: 32px; vertical-align: middle; padding: 2px 0;">
          <div style="width: 20px; height: 20px; border: 1.5px solid #000; display: flex; align-items: center; justify-content: center; font-size: 13pt; font-weight: bold;">
            ${!isPppMsme ? '✔' : '&nbsp;'}
          </div>
        </td>
        <td style="vertical-align: middle; padding: 2px 4px;">
          <strong>2) PPP MII 2017</strong> (applicable for Class I suppliers as well as MSE manufacturers)
        </td>
      </tr>
    </table>
    <p style="font-size: 9pt; margin: 2px 0;">e) The local content calculated using the definition given above are as under:</p>
  `, {
    title: 'DECLARATION CERTIFICATE FOR LOCAL CONTENT',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-14-1'
  }));

  // =========================================================================
  // DOCUMENT 15: DECLARATION CERTIFICATE FOR LOCAL CONTENT (Page 2)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    <p style="margin-bottom: 4px;">g) The local content calculated using the definition given above are as under:</p>
    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 30%;">Tender No</th>
          <th style="width: 25%;" class="center">Local Content Calculated as above %</th>
          <th style="width: 45%;">Location of Local Value Addition</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>${bidNumber}</strong><br/>Dated: ${bidDate}</td>
          <td class="center" style="font-size: 11pt; font-weight: bold;">${localContentPct}</td>
          <td>${localContentLocation}</td>
        </tr>
      </tbody>
    </table>

    <p class="justify">h) I accept that the Procurement Authority / Institution / MDL / Nodal Ministry has the right to request that the local content be verified in terms of the requirements of revised Public Procurement (preference to Make in India) Order 2017 dtd.16.09.2020 and I shall furnish the document / information on demand. Failure on my part to furnish the data will be treated as false declaration as per PPP MII Order 2017. In case of contract being awarded, I undertake to retain the relevant documents for 7 years from date of execution.</p>
    <p class="justify">i) I understand that the submission of incorrect data, or data that are not verifiable as described in revised Public Procurement (preference to Make in India) Order 2017, may result in the Procurement Authority / Nodal Ministry / MDL imposing any or all of the remedies as provided for in Clause 9 of the Revised Public Procurement (preference to Make in India) Order 2017 dated 16.09.2020.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: isThemeA ? undefined : 'DECLARATION CERTIFICATE FOR LOCAL CONTENT (CONTD.)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-14-2'
  }));

  // =========================================================================
  // DOCUMENT 16: ESCALATION MATRIX (For Service Support)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Escalation Matrix for Service Support')}
    <p><strong>${profile.salutation}</strong></p>
    <p>We hereby submit the Escalation Matrix with Telephone Numbers for Service Support for our quoted product as under:</p>

    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 8%;" class="center">Sr. No</th>
          <th style="width: 24%;">Name of Responsible Person</th>
          <th style="width: 18%;">Designation</th>
          <th style="width: 18%;">Triggers When</th>
          <th style="width: 14%;">Contact Number</th>
          <th style="width: 18%;">Email ID's</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="center">1.</td>
          <td>Mr. Sanjay Sadade</td>
          <td>General Manager</td>
          <td>Administration</td>
          <td>09225126772</td>
          <td>support@markenworld.com</td>
        </tr>
        <tr>
          <td class="center">2.</td>
          <td>Mr. Shridhar Shingare</td>
          <td>Tender Manager</td>
          <td>Institution Business Division</td>
          <td>09011104332</td>
          <td>info@markenworld.com</td>
        </tr>
        <tr>
          <td class="center">3.</td>
          <td>Mr. Eknath Mandal</td>
          <td>Production Manager</td>
          <td>Delays of machine design and Technical Error.</td>
          <td>09225102371</td>
          <td>support@markenworld.com</td>
        </tr>
        <tr>
          <td class="center">4.</td>
          <td>Mr. Sachin Shisode</td>
          <td>Service Head</td>
          <td>Servicing Delay</td>
          <td>08390900347</td>
          <td>support@markenworld.com</td>
        </tr>
      </tbody>
    </table>

    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: isThemeA ? 'ESCALATION MATRIX' : 'ESCALATION MATRIX FOR SERVICE SUPPORT',
    subtitle: isThemeA ? '(For Service Support)' : undefined,
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-15'
  }));

  // =========================================================================
  // DOCUMENT 17: DETAILS OF AFTER SALES SERVICE STATION (Page 1)
  // Matching exact client layout: 9 stations for Theme A, 10 for Theme B
  // =========================================================================
  const stationsThemeA = [
    { city: '(H.O.) Nashik, Maharashtra.', addr: 'Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007 Maharashtra', contact: 'Mr. Sachin Shisode,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Delhi.', addr: 'B-50, South Extension, Part -1, New Delhi – 110049.', contact: 'Adarsh Kumar Arora', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Ambala, Haryana.', addr: '5337, Punjabi Mohalla, Ambala Cantt, Ambala, Haryana, 133001', contact: 'Mr. Deepak Pawaiya,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Jaipur, Rajasthan.', addr: 'Plot No.438, Vivek Vihar Colony, New Sanganer Road, Sodala. Jaipur - 302001, Rajasthan', contact: 'Mr. Devendra Hire,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Lucknow, Uttar Pradesh.', addr: '14 - Manas nagar colony, Jiamau, Hazratganj, Opp. RTD, DGP Jagmohan Yadav Residency, Lucknow – 226001 Uttar Pradesh.', contact: 'Mr. Anil Aher,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Hyderabad, Telangana.', addr: 'P NO.478, Lane Number 4 IDA Cherlapally, Hyderabad, Medchal Malkajgiri-500051 Lucknow, Uttar Pradesh', contact: 'Mr. Chandu,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Ahmedabad, Gujarat.', addr: 'M/s. Sevamed Solutions Private Limited, Ahmedabad, Gujarat – 382421', contact: 'Mr. Paresh Sohni,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Jammu, Jammu & Kashmir', addr: 'M/s. Facio Marketing Solutions, 1st Floor, GQ Building, Near Rahat Hospital, Bathindi Morh, Sunjwan Road, Jammu - 181152', contact: 'Mr. Zeeshan,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Kolkata, West Bengal.', addr: 'P Bhogilal Pvt Ltd, 117b, Chittaranjan Avenue, Central Avenue, Kolkata - 700073 West Bengal', contact: 'Mr. Nilesh Mehta,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Amritsar, Punjab', addr: 'Kaze Pharmaceuticals Private Limited. 1st Floor Sco 14, Cabin No. 1, Mansa Devi Complex, Sector 5, Swastik Vihar, Panchkula, Haryana', contact: 'Mr. Santosh chaudhari,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Bhubaneshwar, Odisha', addr: 'GITANJALI ASSOCIATES, Cuttack Road, 128, Laxmi Sagar, Bhubaneshwar 715006 Odisha', contact: 'Mr. Mohd Ismile Alimulah', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Kamrup, Assam.', addr: 'J.M. Distributor, Ground Floor, 10, Surana Building, Jail Road, Fancy Bazar, Kamrup Metropolitan, Assam, 781001', contact: 'Mr. Pratik Chaudhari,\nMr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Ernakulam, Kerala', addr: 'ASA Diagnostics Private Limited, Ist Floor, 54/2824-D, Muttathil Lane, Kochi, Ernakulam, Kerala, 682020', contact: 'Mr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Bhopal, Madhya Pradesh', addr: 'Imagers Sales PVT. Ltd. C-13/7 Simi Apartment Phase 3 Padmanabh Nagar, Near Prabhat Petrol Pump, Infront of OM Hospital, Bhopal (M.P.) - 462023', contact: 'Mr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' },
    { city: 'Bangalore Karnataka', addr: 'M/s KK Allianze, No.178/2, Govindarao Street, Seshadripuram, Bangalore-560020', contact: 'Mr. Shridhar Shingare', email: 'info@markenworld.com\nsupport@markenworld.com\ntender@markenworld.com', mob: '9175559646\n9011104332' }
  ];

  const stationsThemeB = [
    { city: '( H.O.) Nashik, Maharashtra.', addr: 'Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007 Maharashtra', contact: 'Mr. Sachin Shisode,', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '8390900347\n9175559646' },
    { city: 'Mumbai, Maharashtra.', addr: '410 , 4th floor, Maker Chamber V, Nariman point, Mumbai 400021 Maharashtra', contact: 'Mr. Shridhar Shingare,', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '9011104332\n9175559646' },
    { city: 'South Delhi.', addr: 'Office No.515, 5th Floor, Tower-DLF, Jasola-110025 South Delhi', contact: 'Mr. Vinit Sharma,', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '8527027321\n9175559646' },
    { city: 'Ambala, Haryana.', addr: 'B. Block 3031 CCC Zirakpur, Chandigarh-140603 Haryana', contact: 'Mr. Deepak Pawaiya,', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '9175550259\n9175559646' },
    { city: 'Jaipur, Rajasthan.', addr: 'Plot No.438, Vivek Vihar Colony, New Sanganer Road, Sodala. Jaipur - 302001, Rajasthan', contact: 'Mr. Devendra Hire,', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '8208463830\n9175559646' },
    { city: 'Lucknow, Uttar Pradesh.', addr: '14 - Manas nagar colony, Jiamau, Hazratganj, Opp. RTD, DGP Jagmohan Yadav Residency, Lucknow – 226001 Uttar Pradesh.', contact: 'Mr. Anil Aher,', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '9146489605\n9175559646' },
    { city: 'Hyderabad, Telangana.', addr: 'P NO.478, Lane Number 4 IDA Cherlapally, Hyderabad, Medchal Malkajgiri-500051 Telangana', contact: 'Mr. Chandu,', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '9000959574\n9175559646' },
    { city: 'Trivandrum, Kerala', addr: 'Manasa Enterprises Dot Space Business Center, Opp. Tennis Club, Kowdiar, Devasomboard Road, Trivandrum-695003 Kerala', contact: 'Meera Budhan', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '8589999138\n9175559646' },
    { city: 'Ahmedabad, Gujarat.', addr: 'Pulse Biomed LLP, A314, Advance Business Park, Shahibag, Ahmedabad-380004 Gujarat', contact: 'Paresh Sohni', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '9898081574\n9175559646' },
    { city: 'Jammu, Jammu & Kashmir', addr: 'Vista Electronic Care, 05-JDA, Behind Laxmi Naryan Mandir, New Rehari, Jammu, Jammu & Kashmir 180001', contact: 'Vikram Gupta', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '7006171371\n9175559646' },
    { city: 'Amritsar, Punjab', addr: 'Jai Shiva Enterprises, Sale and Service 185, New Colony, Near Amar Jyoti School, Amritsar', contact: 'Sanjay Kumar', email: 'sanjay.kumar3333@gmail.com', mob: '9216275044' },
    { city: 'Kolkata, West Bengal.', addr: 'P Bhogilal Pvt Ltd, 117b, Chittaranjan Avenue, Central Avenue, Kolkata - 700073 West Bengal', contact: 'Nilesh Pratapray Mehta', email: 'support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.', mob: '9175559646' },
    { city: 'Karnataka.', addr: 'SB4-30/6, Bhoomi Complex, Main Road, Siddakatte, Bantwal Taluka, Sangabettu, Dakshina Kannada, Karnataka, 574237', contact: 'Sunil Kotin Ref Karnataka', email: 'info@markenworld.com,\ntender@markenworld.com.', mob: '9594947178' },
    { city: 'Madhya Pradesh', addr: 'C-13/7 Simi Apartment Phase 3 Padmanabh Nagar, Near Prabhat Petrol Pump, Infront of OM Hospital, Bhopal (M.P.) - 462023', contact: 'Shruti Yadav', email: 'info@markenworld.com,\ntender@markenworld.com.', mob: '9011104332' },
    { city: 'Assam', addr: 'JM Distributor Surana Building, Jail Road, Fancy Bazar, Guwahati - 7810001', contact: 'Mr. Pratik Chaudhari', email: 'info@markenworld.com,\ntender@markenworld.com.', mob: '9864030081' },
    { city: 'Bihar', addr: 'FAIRDEAL MEDITECH Flat No 306, Wazeer Apartment, New Patliputra Colony, Patliputra Patna, Bihar, 800013 India', contact: 'Mr. Shubham', email: 'info@markenworld.com,\ntender@markenworld.com.', mob: '9431018743' }
  ];

  const stations = isThemeA ? stationsThemeA : stationsThemeB;
  const splitIndex = isThemeA ? 9 : 10;
  const p1Stations = stations.slice(0, splitIndex);
  const p2Stations = stations.slice(splitIndex);

  pages.push(renderer.wrapPage(`
    <table class="data-table" style="font-size: 8.5pt; line-height: 1.15; margin: 4px 0 6px 0;">
      <thead>
        <tr>
          <th style="width: 5%;" class="center">Sr. No.</th>
          <th style="width: 17%;">City & State</th>
          <th style="width: 32%;">Full Address with Pin code</th>
          <th style="width: 16%;">Contact Person Name</th>
          <th style="width: 30%;">Contact Numbers with STD Code<br/><span style="font-weight: normal; font-size: 8pt;">Email ID / Mobile No.</span></th>
        </tr>
      </thead>
      <tbody>
        ${p1Stations.map((st, idx) => `
          <tr>
            <td class="center" style="padding: 2px 3px;"><strong>${idx + 1}</strong></td>
            <td style="padding: 2px 3px;"><strong>${st.city}</strong></td>
            <td style="padding: 2px 3px;">${st.addr}</td>
            <td style="padding: 2px 3px;">${st.contact.replace(/\n/g, '<br/>')}</td>
            <td style="padding: 2px 3px;">${st.email.replace(/\n/g, '<br/>')}<br/><strong>${st.mob.replace(/\n/g, '<br/>')}</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `, {
    title: 'DETAILS OF AFTER SALES SERVICE STATION',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-16-1'
  }));

  // =========================================================================
  // DOCUMENT 18: DETAILS OF AFTER SALES SERVICE STATION (Page 2)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    <table class="data-table" style="font-size: 8.5pt; line-height: 1.15; margin: 4px 0 6px 0;">
      <thead>
        <tr>
          <th style="width: 5%;" class="center">Sr. No.</th>
          <th style="width: 17%;">City & State</th>
          <th style="width: 32%;">Full Address with Pin code</th>
          <th style="width: 16%;">Contact Person Name</th>
          <th style="width: 30%;">Contact Numbers with STD Code<br/><span style="font-weight: normal; font-size: 8pt;">Email ID / Mobile No.</span></th>
        </tr>
      </thead>
      <tbody>
        ${p2Stations.map((st, idx) => `
          <tr>
            <td class="center" style="padding: 2px 3px;"><strong>${idx + splitIndex + 1}</strong></td>
            <td style="padding: 2px 3px;"><strong>${st.city}</strong></td>
            <td style="padding: 2px 3px;">${st.addr}</td>
            <td style="padding: 2px 3px;">${st.contact.replace(/\n/g, '<br/>')}</td>
            <td style="padding: 2px 3px;">${st.email.replace(/\n/g, '<br/>')}<br/><strong>${st.mob.replace(/\n/g, '<br/>')}</strong></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: isThemeA ? undefined : 'DETAILS OF AFTER SALES SERVICE STATION (CONTD.)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-16-2'
  }));

  // =========================================================================
  // DOCUMENT 19: UNDERTAKING (Regarding Experience and Turnover Exemption)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef(undefined, 'Reference')}
    <p><strong>${profile.salutation}</strong></p>
    <p class="justify">We <strong>${profile.shortName}</strong> hereby submit this undertaking in reference to the tender for the supply of <strong>${productDescription}</strong>. We wish to bring to your attention that our Company is duly registered under the Micro, Small and Medium Enterprises Development (MSME) Act, and possesses a valid Udyog Adhar registration with <strong>UAM No. ${udyamNo}</strong> for the specified products.</p>
    <p class="justify">As per the Public Procurement Policy for Micro and Small Enterprises (MSEs) Order, 2012, issued by the Ministry of Micro, Small and Medium Enterprises, and its subsequent Orders/Notifications, MSEs are entitled to an exemption from the Experience and Turnover Criteria. Therefore, we hereby request your esteemed organization to kindly consider and grant us exemption from submitting Experience and Turnover Criteria for the tender.</p>
    <p class="justify">In accordance with the policy, we have uploaded the necessary supporting documents to prove our eligibility for exemption. These documents include our Udyog Adhar certificate and any other required documentation.</p>
    <p class="justify">We assure you that our company is fully committed to meeting all other technical and quality requirements outlined in the tender document.</p>
    <p class="justify">Thank you for considering our request. We look forward to the opportunity to participate in the tender process and contribute to the success of the project.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'UNDERTAKING',
    subtitle: '(Regarding Experience and Turnover Exemption)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-17'
  }));

  // =========================================================================
  // DOCUMENT 20: UNDERTAKING (Regarding Earnest Money Deposit (EMD) Exemption)
  // =========================================================================
  pages.push(renderer.wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef(undefined, 'Reference')}
    <p class="justify">We, <strong>${profile.shortName}</strong> a Micro and Small Enterprise (MSEM) & Udyam Registration Number <strong>${udyamNo}</strong>, am submitting this undertaking in connection with our participation in the tender for the "<strong>${productDescription}</strong>"</p>
    <p class="justify">As per the Public Procurement Policy for Micro and Small Enterprises (MSEs) Order, 2012, dated 23.03.2012, issued by the Ministry of Micro, Small and Medium Enterprises, and its subsequent Orders/Notifications, MSEs are granted exemption from the Experience and Turnover Criteria.</p>
    <p class="justify">We hereby request your kind consideration for the exemption from the submission of Experience, Turnover, and Earnest Money Deposit (EMD) Criteria for the aforementioned tender. As an MSE, we fall under the ambit of the exemption policies outlined in the orders.</p>
    <p class="justify">To support our request, we have uploaded the necessary documents proving our eligibility for exemption from the Experience and Turnover Criteria. We believe that our MSE status qualifies us for this exemption, in accordance with the established procurement policies.</p>
    <p class="justify">By providing this undertaking, we affirm that the information provided is true and accurate. We understand the importance of compliance with the applicable policies and assure you of our commitment to fulfilling all other requirements and obligations outlined in the tender documents.</p>
    <p class="justify">Thank you for your understanding and cooperation. We look forward to the opportunity to contribute to and collaborate on this project.</p>
    <p class="closing-line">Thanking you and assuring you of our best services at all the times.</p>
    ${renderer.renderSignatoryBlock(renderOpts, { place, date: docDate })}
  `, {
    title: 'UNDERTAKING',
    subtitle: '(Regarding Earnest Money Deposit (EMD) Exemption)',
    docDate: isThemeA ? undefined : docDate,
    pageClass: 'page-doc-18'
  }));

  // Assemble all pages with base CSS styles
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Generated Bid Documents - ${bidNumber}</title>
      <style>
        ${renderer.getGlobalStyles()}
      </style>
    </head>
    <body>
      ${pages.join('\n')}
    </body>
    </html>
  `;
}

export function generateTechnicalSpecificationHtml(
  data: any,
  rawSpecs: { sr: number, parameter: string, value: string, offered?: string, compliance?: string, deviation?: string }[]
): string {
  const profile = getCompanyProfile(data.companyKey || data.companyName);
  const renderer = new DocumentLayoutRenderer(profile);

  const bidNumber = data.bidNumber || data.ref_no || 'GEM/2026/B/8015551';
  const bidDate = data.bidDate || '09-09-2026';
  const docDate = data.date || data.docDate || (profile.theme === 'A' ? '26-09-2026' : '10-01-2026');
  const productDescription = data.productDescription || data.productName || 'Equipment / Goods';
  const offeredMake = data.offeredMake || data.brand || 'MarkEn';
  const offeredModel = data.offeredModel || data.model || 'Standard';

  const renderOpts: RenderOptions = {
    showSignature: data.showSignature !== false,
    showStamp: data.showStamp !== false,
    docDate,
    bidDate,
    bidNumber
  };

  const specs = rawSpecs.length > 0 ? rawSpecs : [
    { sr: 1, parameter: 'Product Specification Compliance', value: 'As per GeM Bid Specification', offered: 'Complied as per tender specifications', compliance: 'Complied', deviation: 'No Deviation' },
    { sr: 2, parameter: 'Make & Model', value: 'Original Manufacturer Standard', offered: `${offeredMake} / ${offeredModel}`, compliance: 'Complied', deviation: 'No Deviation' }
  ];

  // Paginate specifications: ~12-14 rows per A4 page so tables never overlap or clip
  const rowsPerPage = 12;
  const specPages: typeof specs[] = [];
  for (let i = 0; i < specs.length; i += rowsPerPage) {
    specPages.push(specs.slice(i, i + rowsPerPage));
  }

  const pagesHtml: string[] = [];

  specPages.forEach((pageItems, pageIdx) => {
    const isFirstPage = pageIdx === 0;
    const isLastPage = pageIdx === specPages.length - 1;

    const content = `
      ${isFirstPage ? `
        <div style="margin-bottom: 6px; font-size: 10pt;">
          <table style="width: 100%; border-collapse: collapse; border: none; margin-bottom: 4px;">
            <tr>
              <td style="border: none; padding: 2px 0;"><strong>Tender / Bid No.:</strong> ${bidNumber}</td>
              <td style="border: none; padding: 2px 0; text-align: right;"><strong>Date:</strong> ${bidDate}</td>
            </tr>
            <tr>
              <td style="border: none; padding: 2px 0;"><strong>Product:</strong> ${productDescription}</td>
              <td style="border: none; padding: 2px 0; text-align: right;"><strong>Offered Model:</strong> ${offeredMake} ${offeredModel}</td>
            </tr>
          </table>
        </div>
      ` : ''}

      <table class="data-table" style="font-size: 9pt; line-height: 1.18;">
        <thead>
          <tr>
            <th style="width: 6%;" class="center">Sr.</th>
            <th style="width: 34%;">Technical Specification Parameter</th>
            <th style="width: 25%;">Required Specification</th>
            <th style="width: 25%;">Offered Specification</th>
            <th style="width: 10%;" class="center">Compliance</th>
          </tr>
        </thead>
        <tbody>
          ${pageItems.map(s => `
            <tr>
              <td class="center" style="padding: 2px 4px;">${s.sr}</td>
              <td style="padding: 2px 4px;"><strong>${s.parameter}</strong></td>
              <td style="padding: 2px 4px;">${s.value || 'As per Bid'}</td>
              <td style="padding: 2px 4px;">${s.offered || s.value || 'Complied'}</td>
              <td class="center" style="padding: 2px 4px; font-weight: bold; color: #10b981;">${s.compliance || 'Yes'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${isLastPage ? `
        <p class="closing-line">We hereby certify that all technical specifications offered above are 100% compliant with the tender requirements without any deviation.</p>
        ${renderer.renderSignatoryBlock(renderOpts, { place: profile.place, date: docDate })}
      ` : `
        <div style="text-align: right; font-size: 8.5pt; color: #64748b; margin-top: 4px;">
          Page ${pageIdx + 1} of ${specPages.length} (Continued on next page)
        </div>
      `}
    `;

    pagesHtml.push(renderer.wrapPage(content, {
      title: isFirstPage ? 'TECHNICAL SPECIFICATION COMPLIANCE SHEET' : undefined,
      docDate: profile.theme === 'B' ? docDate : undefined,
      pageClass: `page-spec-${pageIdx + 1}`
    }));
  });

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Technical Specification Sheet - ${bidNumber}</title>
      <style>
        ${renderer.getGlobalStyles()}
      </style>
    </head>
    <body>
      ${pagesHtml.join('\n')}
    </body>
    </html>
  `;
}


/**
 * Generates the clean HTML string for Word (.docx) native header
 * Locked cleanly to top edge of every page.
 */
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
          <td style="border: none; padding: 0 8pt 0 0; vertical-align: middle;">
            <img src="${roundLogoBase64}" width="55" height="55" style="width: 55px; height: 55px;" />
          </td>
          <td style="border: none; padding: 0 8pt; vertical-align: middle;">
            <p style="margin: 0 0 1.5pt 0; font-family: Cambria, serif; font-size: 15pt; font-weight: bold; color: #4472C4; line-height: 1.1;">MARK ENTERPRISES</p>
            <p style="margin: 0 0 1pt 0; font-family: Cambria, serif; font-size: 8pt; color: #000; line-height: 1.15;">Shed No. 1, Plot No. 93/2, Street No. 17</p>
            <p style="margin: 0 0 1pt 0; font-family: Cambria, serif; font-size: 8pt; color: #000; line-height: 1.15;">MIDC Satpur, Nashik – 422007, Maharashtra, India</p>
            <p style="margin: 0 0 1pt 0; font-family: Cambria, serif; font-size: 8pt; color: #000; line-height: 1.15;">Email ID: info@markenworld.com URL: www.markenworld.com</p>
            <p style="margin: 0; font-family: Cambria, serif; font-size: 8pt; color: #000; line-height: 1.15;">Contact No.: 09175559646 / 090111 04332</p>
          </td>
          <td style="border: none; padding: 0 0 0 8pt; text-align: right; vertical-align: middle;">
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

/**
 * Sanitizes HTML content for html-to-docx:
 * - Strips watermarks and footers (Word native header & footer are used)
 * - Renders signature and stamp left-aligned directly above signatory name
 * - Formats tables and headings cleanly for Word
 */
export function cleanHtmlForDocx(html: string, companyKey?: string): string {
  if (!html) return '';

  let cleaned = html;

  // 1. Remove watermarks and web/PDF footers completely from Word document body
  cleaned = cleaned.replace(/<!--\s*FOOTER_START\s*-->[\s\S]*?<!--\s*FOOTER_END\s*-->/gi, '');
  cleaned = cleaned.replace(/<div class="watermark-container"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div class="theme-[ab]-footer-bar"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<table[^>]*class="[^"]*theme-b-footer-table[^"]*"[\s\S]*?<\/table>/gi, '');
  cleaned = cleaned.replace(/<div class="theme-b-footer-block"[^>]*>[\s\S]*?(?:<\/div>\s*<\/div>|(?=<!--\s*(?:PAGE|HEADER)|$))/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*theme-b-footer-[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  // Absolute safeguard: ensure no CIN or corporate office footer info appears in Word body below signature
  cleaned = cleaned.replace(/<table[^>]*>[\s\S]*?CIN No:[\s\S]*?<\/table>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*>[\s\S]*?CIN No:[\s\S]*?<\/div>/gi, '');

  // 1b. Page break after each subdocument page in Word:
  // After document is signed (with Place & Date), end that page and begin next subdocument on the next page
  cleaned = cleaned.replace(/<\/div>\s*(?=<div class="page\b)/g, '</div><div class="page-break" style="page-break-after: always;"></div>');

  // 1c. Subdocument headings: 18 font size, centered aligned
  cleaned = cleaned.replace(
    /<div class="doc-title-container"[^>]*>([\s\S]*?)<\/div>/gi,
    (match: string, inner: string) => {
      const titleMatch = inner.match(/<h2[^>]*class="doc-title"[^>]*>([\s\S]*?)<\/h2>/i);
      const subtitleMatch = inner.match(/<div[^>]*class="doc-subtitle"[^>]*>([\s\S]*?)<\/div>/i);
      let res = '';
      if (titleMatch) {
        res += `<p style="text-align: center; font-size: 18pt; font-weight: bold; text-decoration: underline; margin: 6pt 0 6pt 0;">${titleMatch[1].trim()}</p>`;
      }
      if (subtitleMatch) {
        res += `<p style="text-align: center; font-size: 11pt; font-weight: bold; font-style: italic; margin: 0 0 6pt 0;">${subtitleMatch[1].trim()}</p>`;
      }
      return res || match;
    }
  );
  cleaned = cleaned.replace(/<h2[^>]*class="doc-title"[^>]*>([\s\S]*?)<\/h2>/gi, '<p style="text-align: center; font-size: 18pt; font-weight: bold; text-decoration: underline; margin: 6pt 0 6pt 0;">$1</p>');

  // 2. Remove table/cell width locks so Word manages widths fluidly
  cleaned = cleaned.replace(/<(td|th|col|table)([^>]*?)\bwidth="[^"]*"/gi, '<$1$2');
  cleaned = cleaned.replace(/<(td|th)([^>]*?)style="([^"]*)"/gi, (match, tag, beforeStyle, styleContent) => {
    const cleanedStyle = styleContent
      .split(';')
      .filter((rule: string) => !rule.trim().toLowerCase().startsWith('width'))
      .join(';');
    return `<${tag}${beforeStyle}${cleanedStyle.trim() ? `style="${cleanedStyle}"` : ''}`;
  });

  // 3. Strip duplicate body headers (native Word header handles letterhead at page top)
  cleaned = cleaned.replace(/<!--\s*HEADER_START\s*-->[\s\S]*?<!--\s*HEADER_END\s*-->/gi, (match) => {
    const dateMatch = match.match(/<div class="theme-b-date-row">([\s\S]*?)<\/div>/i);
    return dateMatch ? `<p style="text-align: right; margin: 0 0 6pt 0; font-size: 10pt;">${dateMatch[1]}</p>` : '';
  });

  // Secondary defensive cleanup for any standalone header elements
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*theme-a-header[^"]*"[\s\S]*?<div[^>]*class="[^"]*theme-a-divider[^"]*"[^>]*><\/div>\s*<\/div>/gi, '');
  cleaned = cleaned.replace(/<table[^>]*class="[^"]*theme-a-header-table[^"]*"[^>]*>[\s\S]*?<\/table>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*theme-a-company-name[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*theme-a-address-line[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*theme-a-divider[^"]*"[^>]*><\/div>/gi, '');
  cleaned = cleaned.replace(/<div[^>]*class="[^"]*theme-b-header[^"]*"[^>]*>[\s\S]*?<\/div>/gi, (match) => {
    const dateMatch = match.match(/<div class="theme-b-date-row">([\s\S]*?)<\/div>/i);
    return dateMatch ? `<p style="text-align: right; margin: 0 0 6pt 0; font-size: 10pt;">${dateMatch[1]}</p>` : '';
  });

  // 4. Render stamp and signature side by side in Word, aligned LEFT directly above the name with authentic proportions
  cleaned = cleaned.replace(
    /<div class="sign-stamp-wrap[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    (match: string, inner: string) => {
      const isThemeB = companyKey
        ? companyKey.toLowerCase().includes('healthtech')
        : (/MARKEN HEALTHTECH/i.test(cleaned) || /theme-b-sign/i.test(match) || /theme-b-sign/i.test(inner));

      const stampMatch = inner.match(/<img[^>]*class="[^"]*stamp-img[^"]*"[^>]*>/i);
      const sigMatch = inner.match(/<img[^>]*class="[^"]*sign-img[^"]*"[^>]*>/i);

      let sigImg = sigMatch ? sigMatch[0].replace(/style="[^"]*"/gi, '').replace(/\b(width|height)="[^"]*"/gi, '') : '';
      let stampImg = stampMatch ? stampMatch[0].replace(/style="[^"]*"/gi, '').replace(/\b(width|height)="[^"]*"/gi, '') : '';

      // Authentic aspect ratios matching actual PNG dimensions:
      // ME signature: 249x176 (ratio ~1.42) -> width="85" height="60"
      // Healthtech signature: 280x91 (ratio ~0.325) -> width="115" height="37"
      // Stamps: circular (1:1) -> width="68" height="68"
      if (sigImg) {
        if (isThemeB) {
          sigImg = sigImg.replace(/<img\b/i, '<img width="115" height="37" style="width: 115px; height: 37px; object-fit: contain; display: inline-block;" ');
        } else {
          sigImg = sigImg.replace(/<img\b/i, '<img width="85" height="60" style="width: 85px; height: 60px; object-fit: contain; display: inline-block;" ');
        }
      }
      if (stampImg) {
        stampImg = stampImg.replace(/<img\b/i, '<img width="68" height="68" style="width: 68px; height: 68px; object-fit: contain; display: inline-block;" ');
      }

      if (sigImg && stampImg) {
        return `<p style="text-align: left; margin: 3pt 0 4pt 0; line-height: 1;">${sigImg}&nbsp;&nbsp;&nbsp;&nbsp;${stampImg}</p>`;
      } else if (sigImg) {
        return `<p style="text-align: left; margin: 3pt 0 4pt 0; line-height: 1;">${sigImg}</p>`;
      } else if (stampImg) {
        return `<p style="text-align: left; margin: 3pt 0 4pt 0; line-height: 1;">${stampImg}</p>`;
      }
      return match;
    }
  );

  cleaned = cleaned.replace(/<hr\b[^>]*>/gi, '<p style="margin: 2pt 0 4pt 0; padding: 0; line-height: 1pt; font-size: 1pt; border-top: 1.5pt solid #4472C4;">&nbsp;</p>');
  cleaned = cleaned.replace(/<br\s*\/?>\s*<\/div>/gi, '</div>');
  cleaned = cleaned.replace(/<br\s*\/?>\s*<\/p>/gi, '</p>');

  return cleaned;
}

export function getDocxFooterHtml(companyKey: string): string {
  const profile = getCompanyProfile(companyKey);
  const isHealthtech = profile.theme === 'B';

  if (isHealthtech) {
    const barPath = resolveBrandImagePath(profile.assetPaths.footerBar);
    const barBase64 = getBase64Image(barPath);
    return `
      <table border="0" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; border: none; font-family: Calibri, 'Times New Roman', sans-serif;">
        <tr>
          <td style="border: none; padding: 0; vertical-align: bottom; font-size: 7.2pt; line-height: 1.15; color: #00176D;">
            <p style="margin: 0; font-size: 8.5pt; font-weight: bold; color: #00176D; line-height: 1.1;">${profile.legalName}</p>
            ${profile.cin ? `<p style="margin: 1pt 0 0 0; font-size: 7.2pt; font-weight: bold; color: #00176D; line-height: 1.1;">CIN No: ${profile.cin}</p>` : ''}
            ${profile.registeredOffice ? `<p style="margin: 1pt 0 0 0; font-size: 6.8pt; color: #00176D; line-height: 1.15;"><strong>Regd. Off &amp; Factory:</strong> ${profile.registeredOffice}</p>` : ''}
            ${profile.corporateOffice ? `<p style="margin: 1pt 0 0 0; font-size: 6.8pt; color: #00176D; line-height: 1.15;"><strong>Corp. Off.:</strong> ${profile.corporateOffice}</p>` : ''}
            ${profile.globalSalesOffice ? `<p style="margin: 1pt 0 0 0; font-size: 6.8pt; color: #00176D; line-height: 1.15;"><strong>Global Sales Off.:</strong> ${profile.globalSalesOffice}</p>` : ''}
          </td>
          <td style="border: none; padding: 0; vertical-align: bottom; text-align: right; font-size: 7.2pt; line-height: 1.25; color: #00176D;">
            <p style="margin: 0; font-size: 7.2pt; color: #00176D; line-height: 1.2;">&#9742; ${profile.phoneDisplay || profile.phones[0]}</p>
            <p style="margin: 1pt 0 0 0; font-size: 7.2pt; color: #00176D; line-height: 1.2;">&#9993; ${profile.emailDisplay || profile.emails[0]}</p>
            <p style="margin: 1pt 0 0 0; font-size: 7.2pt; color: #00176D; line-height: 1.2;">&#127760; ${profile.website}</p>
          </td>
        </tr>
      </table>
      <p style="margin: 2pt 0 0 0; padding: 0; line-height: 1pt; font-size: 1pt; text-align: center;">
        <img src="${barBase64}" width="650" height="7" style="height: 7px; width: 100%; display: block;" />
      </p>
    `.trim();
  } else {
    const barPath = resolveBrandImagePath(profile.assetPaths.footerBar);
    const barBase64 = getBase64Image(barPath);
    return `
      <p style="margin: 0 0 2pt 0; padding: 0; line-height: 1pt; font-size: 1pt; border-top: 0.75pt solid #595959;">&nbsp;</p>
      <p style="margin: 0; padding: 0; line-height: 1pt; font-size: 1pt; text-align: center;"><img src="${barBase64}" width="650" height="7" style="height: 7px; width: 100%; display: block;" /></p>
    `.trim();
  }
}

/**
 * Validates, repairs and rescales OpenXML DOCX archive generated by html-to-docx:
 * 1. Strips duplicate Override entries for .rels
 * 2. Normalizes image dimensions in EMUs: prevents giant signatures, stamps, and logos
 * 3. Enforces <w:keepNext/> on signature paragraphs to prevent splitting across pages
 * 4. Normalizes <w:sectPr> with locked A4 size, footer/header margins at page edges
 */
export async function sanitizeDocxBuffer(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    let ctText = await ctFile.async('text');
    ctText = ctText.replace(/<Override PartName="\/_rels\/\.rels"[^>]*\/>\s*/gi, '');
    ctText = ctText.replace(/<Override PartName="\/word\/_rels\/document\.xml\.rels"[^>]*\/>\s*/gi, '');
    zip.file('[Content_Types].xml', ctText);
  }

  const relsFiles = Object.keys(zip.files).filter(name => name.endsWith('.rels'));
  for (const name of relsFiles) {
    const file = zip.file(name);
    if (!file) continue;
    let relsText = await file.async('text');
    if (relsText.includes('TargetMode="Internal"')) {
      relsText = relsText.replace(/\s*TargetMode="Internal"/gi, '');
      zip.file(name, relsText);
    }
  }

  const xmlFiles = Object.keys(zip.files).filter(name => name.endsWith('.xml'));
  for (const name of xmlFiles) {
    const file = zip.file(name);
    if (!file) continue;
    let xmlText = await file.async('text');
    let changed = false;

    // Rescale oversized images in Word OpenXML:
    if (name === 'word/document.xml') {
      xmlText = xmlText.replace(/<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/gi, (match, cxStr, cyStr) => {
        let cx = parseInt(cxStr, 10);
        let cy = parseInt(cyStr, 10);
        if (cx > 1700000) {
          const ratio = cy / cx;
          if (ratio < 0.35) {
            cx = 1512000; // ~42mm wide logo
            cy = Math.round(cx * ratio);
          } else {
            cx = 1200000;
            cy = Math.round(cx * ratio);
          }
          changed = true;
          return `<wp:extent cx="${cx}" cy="${cy}"/>`;
        }
        return match;
      });

      xmlText = xmlText.replace(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/gi, (match, cxStr, cyStr) => {
        let cx = parseInt(cxStr, 10);
        let cy = parseInt(cyStr, 10);
        if (cx > 1700000) {
          const ratio = cy / cx;
          if (ratio < 0.35) {
            cx = 1512000;
            cy = Math.round(cx * ratio);
          } else {
            cx = 1200000;
            cy = Math.round(cx * ratio);
          }
          changed = true;
          return `<a:ext cx="${cx}" cy="${cy}"/>`;
        }
        return match;
      });

      // Ensure A4 portrait dimensions and page bottom footer lock in sectPr
      xmlText = xmlText.replace(/<w:pgSz\b[^>]*\/>/gi, '<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>');
      xmlText = xmlText.replace(/<w:pgMar\b[^>]*\/>/gi, '<w:pgMar w:top="720" w:right="800" w:bottom="1650" w:left="800" w:header="280" w:footer="280" w:gutter="0"/>');
      changed = true;
    }

    if (/<(wp|a):ext(?:ent)?\s*\/>/i.test(xmlText)) {
      xmlText = xmlText.replace(/<wp:extent\s*\/>/gi, '<wp:extent cx="950000" cy="950000"/>');
      xmlText = xmlText.replace(/<a:ext\s*\/>/gi, '<a:ext cx="950000" cy="950000"/>');
      changed = true;
    }

    if (/<w:(top|bottom|left|right|insideH|insideV) [^>]*?w:sz="none"[^>]*?\/>/i.test(xmlText)) {
      xmlText = xmlText.replace(/<w:(top|bottom|left|right|insideH|insideV) [^>]*?w:sz="none"[^>]*?\/>/gi, '<w:$1 w:val="none" w:sz="0" w:space="0" w:color="auto"/>');
      changed = true;
    }

    if (/w:sz="none"/gi.test(xmlText)) {
      xmlText = xmlText.replace(/w:sz="none"/gi, 'w:val="none" w:sz="0"');
      changed = true;
    }

    if (/w:w="\d+\.\d+"/gi.test(xmlText)) {
      xmlText = xmlText.replace(/w:w="(\d+)\.\d+"/gi, 'w:w="$1"');
      changed = true;
    }

    if (name === 'word/document.xml') {
      // Ensure horizontal cell outlines for tables in Word
      xmlText = xmlText.replace(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/g, (match, inner) => {
        let updated = inner;
        if (/<w:top\b/i.test(updated)) {
          updated = updated.replace(/<w:top\s+[^>]*\/>/gi, '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>');
        } else {
          updated = `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>` + updated;
        }
        if (/<w:bottom\b/i.test(updated)) {
          updated = updated.replace(/<w:bottom\s+[^>]*\/>/gi, '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>');
        } else {
          updated = updated + `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
        }
        return `<w:tcBorders>${updated}</w:tcBorders>`;
      });

      xmlText = xmlText.replace(/<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/g, (match, inner) => {
        let updated = inner;
        if (/<w:insideH\b/i.test(updated)) {
          updated = updated.replace(/<w:insideH\s+[^>]*\/>/gi, '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>');
        } else {
          updated = updated + `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
        }
        if (/<w:top\b/i.test(updated)) {
          updated = updated.replace(/<w:top\s+[^>]*\/>/gi, '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>');
        } else {
          updated = `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>` + updated;
        }
        if (/<w:bottom\b/i.test(updated)) {
          updated = updated.replace(/<w:bottom\s+[^>]*\/>/gi, '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>');
        } else {
          updated = updated + `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
        }
        return `<w:tblBorders>${updated}</w:tblBorders>`;
      });

      xmlText = xmlText.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (pMatch: string) => {
        if (/Yours faithfully|On behalf of|For and on behalf of|Thanking you and assuring you/i.test(pMatch)) {
          if (!pMatch.includes('<w:keepNext/>')) {
            if (pMatch.includes('<w:pPr>')) {
              return pMatch.replace('<w:pPr>', '<w:pPr><w:keepNext/>');
            } else {
              return pMatch.replace(/^(<w:p\b[^>]*>)/, '$1<w:pPr><w:keepNext/></w:pPr>');
            }
          }
        }
        return pMatch;
      });

      // Remove standalone page-break paragraphs between subdocuments (which cause a blank page with a single space/line)
      // and attach native <w:pageBreakBefore/> directly into the following heading paragraph's <w:pPr>
      xmlText = xmlText.replace(
        /<w:p>\s*<w:r>\s*<w:br w:type="page"\/>\s*<\/w:r>\s*<\/w:p>\s*(<w:p\b[^>]*>[\s\S]*?<w:pPr>)/gi,
        (match, pStart) => {
          return `${pStart}<w:pageBreakBefore/>`;
        }
      );
      // Remove any empty spacer paragraphs between Date and next heading
      xmlText = xmlText.replace(/<w:p>\s*(?:<w:pPr>[\s\S]*?<\/w:pPr>)?\s*<\/w:p>\s*(?=<w:p\b[^>]*>[\s\S]*?<w:pageBreakBefore\/>)/gi, '');
      changed = true;
    }

    if (name.includes('footer') && name.endsWith('.xml')) {
      xmlText = xmlText.replace(/<w:p>\s*<w:pPr>\s*<w:spacing[^>]*\/>\s*<\/w:pPr>\s*<w:r>\s*<w:rPr\/>\s*<\/w:r>\s*<\/w:p>\s*(?=<w:p>\s*<w:pPr>[\s\S]*?<w:drawing>)/gi, '');
      changed = true;
    }

    if (/w:(header|footer|gutter)="undefined"/gi.test(xmlText)) {
      xmlText = xmlText.replace(/w:(header|footer)="undefined"/gi, 'w:$1="280"');
      xmlText = xmlText.replace(/w:gutter="undefined"/gi, 'w:gutter="0"');
      changed = true;
    }

    if (changed) {
      zip.file(name, xmlText);
    }
  }

  return (await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })) as Buffer;
}

