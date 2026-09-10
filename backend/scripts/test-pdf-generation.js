const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Helper to convert local image to base64
function getBase64Image(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const bitmap = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      return `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${bitmap.toString('base64')}`;
    }
  } catch (e) {
    console.error('Error loading image base64:', e);
  }
  return '';
}

function generateHtmlTemplates(data) {
  const logoPath = path.join(__dirname, '..', 'public', 'images', 'logo.png');
  const partnerPath = path.join(__dirname, '..', 'public', 'images', 'partner.png');
  const stampPath = path.join(__dirname, '..', 'public', 'images', 'stamp.png');
  const sigPath = path.join(__dirname, '..', 'public', 'images', 'signature.png');
  
  const logoBase64 = getBase64Image(logoPath);
  const partnerBase64 = getBase64Image(partnerPath);
  const stampBase64 = getBase64Image(stampPath);
  const sigBase64 = getBase64Image(sigPath);

  // Split company address into two lines at appropriate place
  let addr1 = data.companyAddress || '';
  let addr2 = '';
  if (addr1.includes('MIDC Satpur,')) {
    const parts = addr1.split('MIDC Satpur,');
    addr1 = parts[0] + 'MIDC Satpur,';
    addr2 = parts[1].trim();
  } else {
    const commas = addr1.split(',');
    if (commas.length > 3) {
      addr1 = commas.slice(0, 4).join(',') + ',';
      addr2 = commas.slice(4).join(',').trim();
    }
  }

  // Address block helper
  const renderAddressBlock = () => {
    const dept = (data.authorityDept || '').trim();
    const name = (data.authorityName || '').trim();
    const addr = (data.authorityAddress || '').trim();
    
    let html = `<div class="address-block">To,<br/>`;
    if (name) html += `${name}<br/>`;
    if (dept && dept.toLowerCase() !== name.toLowerCase()) {
      html += `${dept}<br/>`;
    }
    if (addr) html += `${addr}<br/>`;
    html += `</div>`;
    return html;
  };

  // Subject and reference table helper
  const renderSubjectRef = (subject, refLabel = 'Reference') => `
    <table class="subject-ref-table">
      <tr>
        <td width="15%" style="font-weight: bold;">Subject</td>
        <td width="2%" style="font-weight: bold;">:</td>
        <td width="83%" style="font-weight: normal;">${subject}</td>
      </tr>
      <tr>
        <td width="15%" style="font-weight: bold;">${refLabel}</td>
        <td width="2%" style="font-weight: bold;">:</td>
        <td width="83%" style="font-weight: normal;">Bid No.: ${data.bidNumber}, Date. ${data.bidDate}.</td>
      </tr>
    </table>
  `;

  // Signatory block helper
  const renderSignatoryBlock = (showPlace = false) => `
    <div class="signatory-block">
      <p style="margin-bottom: 4px;">Yours faithfully,</p>
      <p style="font-weight: bold; margin-top: 0; margin-bottom: 8px;">For ${data.companyName}</p>
      <div class="signature-container">
        ${stampBase64 ? `<img src="${stampBase64}" class="stamp-img" />` : ''}
        ${sigBase64 ? `<img src="${sigBase64}" class="sig-img" />` : ''}
      </div>
      <p style="font-weight: bold; margin-top: 8px; margin-bottom: 2px;">${data.signatoryName}</p>
      <p style="margin-top: 0; margin-bottom: 8px;">${data.signatoryDesignation}</p>
      ${showPlace ? `
        <p style="margin: 2px 0;">Date: ${data.date}</p>
        <p style="margin: 2px 0;">Place: ${data.place}</p>
      ` : ''}
    </div>
  `;

  // Common page wrapper function
  const wrapPage = (content, title, pageClass = '') => `
    <div class="page ${pageClass}">
      <div class="letterhead">
        <div class="logo-container">
          ${logoBase64 ? `<img src="${logoBase64}" class="logo-img" />` : ''}
        </div>
        <div class="header-text">
          <h1 class="company-title">${data.companyName.toUpperCase()}</h1>
          <p class="company-addr">${addr1}</p>
          ${addr2 ? `<p class="company-addr">${addr2}</p>` : ''}
          <p class="company-info">Email ID: ${data.companyEmail} URL: ${data.companyWebsite}</p>
          <p class="company-info">Contact No.: ${data.companyContact}</p>
        </div>
        <div class="partner-container">
          ${partnerBase64 ? `<img src="${partnerBase64}" class="partner-img" />` : ''}
        </div>
      </div>
      <hr class="header-divider" />
      <div class="date-row">Date: ${data.date}</div>
      ${title ? `<h2 class="document-title">${title}</h2>` : ''}
      <div class="page-content">
        ${content}
      </div>
    </div>
  `;

  const pages = [];

  // --- DOCUMENT 1: BID FORM ---
  pages.push(wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Bid Form')}
    <p>Dear Sir/Madam,</p>
    <p class="justify">We, the undersigned have examined the above mentioned bidding document, including amendment/ corrigendum (if any), the receipt of which is hereby confirmed. We now offer to supply and deliver <strong>${data.productDescription}</strong> in conformity with your above referred document for the sum as shown in the Price Schedules attached herewith and made part of this bid. If our bid is accepted, we undertake to supply the goods and perform the services as mentioned in the bidding documents, in accordance with the delivery schedule specified in the List of Requirements.</p>
    <p class="justify">We further confirm that, if our bid is accepted, we shall provide you with a performance security of required amount in an acceptable form in terms of “General Conditions Contract” read with modification, if any “Special Conditions of Contract”, in Section – V and all other terms and conditions as mentioned in bidding document for due performance of the contract.</p>
    <p class="justify">We agree to keep our bid valid for acceptance as required in the “General Instruction to Bidders”, read with modification, if any in “Special Instructions to Bidders” or for subsequently extended period, if any, agreed to by us. We also accordingly confirm to abide by this bid up to the aforesaid period and this bid may be accepted any time before the expiry of the aforesaid period. We further confirm that, until a formal contract is executed, this bid read with your written acceptance thereof within the aforesaid period shall constitute a binding contract between us.</p>
    <p class="justify">We further understand that you are not bound to accept the lowest or any bid you may receive against your above-referred advertised tender enquiry.</p>
    <p class="justify">We confirm that we do not stand deregistered/banned/blacklisted by any Central Govt. Ministries/Departments/Hospitals/Institutes.</p>
    <p class="justify">We confirm that we fully agree to the terms and conditions specified in the above mentioned bid document, including amendment/ corrigendum if any.</p>
    <p class="justify font-bold">“We hereby certify that if at any time, information furnished by us is proved to be false or incorrect, we are liable for any action as deemed fit by the purchaser in addition to forfeiture of the bid security.”</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, 'BID FORM', 'page-doc-1'));

  // --- DOCUMENT 2: BID SECURITY DECLARATION FORM ---
  pages.push(wrapPage(`
    <p style="text-align: center; font-weight: bold; font-size: 10pt; margin-top: -10px; margin-bottom: 20px;">(Rule 170 of General Financial Rule 2017)</p>
    ${renderAddressBlock()}
    ${renderSubjectRef('Bid Security Declaration Form')}
    <p>Dear Sir/Madam,</p>
    <p>We the undersigned declare that;</p>
    <p>We accept that we may be suspended to submit bids for contract(s) with you for a period of Six (06) months from the date of bid opening if we are in a breach of any obligation under the bid conditions, because We:</p>
    <p style="margin-left: 20px; text-indent: -20px;">a) have withdrawn/modified our bid during the period of bid validity specified in the form of bid; or</p>
    <p style="margin-left: 20px; text-indent: -20px;">b) having been notified of the acceptance of our bid by the purchaser during the period of bid validity</p>
    <p style="margin-left: 20px; text-indent: -20px;">c) fail or refuse to execute the contract, or</p>
    <p style="margin-left: 20px; text-indent: -20px;">d) Fail or refuse to submit the Performance Security of the amount specified in the bid.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, 'BID SECURITY DECLARATION FORM', 'page-doc-2'));

  // --- DOCUMENT 3: BIDDER PARTICULARS ---
  pages.push(wrapPage(`
    <table class="bordered-table bidder-particulars-table">
      <thead>
        <tr>
          <th width="8%">Sr. No.</th>
          <th width="37%">Particulars</th>
          <th width="55%">Details</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="font-weight: bold;">1.</td>
          <td style="font-weight: normal;">Name of the Bidder</td>
          <td style="font-weight: bold;">M/s. ${data.companyName}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">2.</td>
          <td style="font-weight: normal;">Address of the Bidder</td>
          <td style="font-weight: bold;">${data.companyAddress}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">3.</td>
          <td style="font-weight: normal;">Name of the Manufacturer</td>
          <td style="font-weight: bold;">M/s. ${data.manufacturerName}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">4.</td>
          <td style="font-weight: normal;">Address of the Manufacturer</td>
          <td style="font-weight: bold;">${data.manufacturerAddress}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">5.</td>
          <td style="font-weight: normal;">Name and address of the person to whom all references shall be made regarding this tender inquiry:</td>
          <td style="font-weight: bold;">Name: Mr. ${data.signatoryName}<br/>Address: ${data.signatoryAddress}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">6.</td>
          <td style="font-weight: normal;">Telephone</td>
          <td style="font-weight: bold;">${data.companyContact}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">7.</td>
          <td style="font-weight: normal;">Telex</td>
          <td style="font-weight: bold;">NA</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">8.</td>
          <td style="font-weight: normal;">Fax</td>
          <td style="font-weight: bold;">NA</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">9.</td>
          <td style="font-weight: normal;">Email address</td>
          <td style="font-weight: bold;">${data.companyEmail}</td>
        </tr>
        <tr>
          <td style="font-weight: bold;">10.</td>
          <td style="font-weight: normal;">Witness</td>
          <td style="font-weight: bold;">${data.witnessDetails}</td>
        </tr>
      </tbody>
    </table>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, 'BIDDER PARTICULARS', 'page-doc-3'));

  // --- DOCUMENT 4: DECLARATION CERTIFICATE FOR LOCAL CONTENT ---
  const isMsme = data.preferencePolicy === 'PPP MSME Order 2012';
  pages.push(wrapPage(`
    <p class="justify">This declaration must form part of all tenders & it contains general information and serves as a declaration form for all bidders. (Before completing this declaration, bidders must study the General Conditions, Definitions, Govt. Directives applicable in respect of Local Content & prescribed tender conditions).</p>
    <p style="text-align: center; font-weight: bold; font-size: 9.5pt; margin: 15px 0;">LOCAL CONTENT DECLARATION BY CHIEF FINANCIAL OFFICER OR OTHER LEGALLY RESPONSIBLE PERSON NOMINATED IN WRITING BY THE CHIEF EXECUTIVE OR SENIOR MEMBER/PERSON WITH MANAGEMENT RESPONSIBILITY (CORPORATION, PARTNERSHIP OR INDIVIDUAL)</p>
    <p style="text-align: center; font-weight: bold; margin-bottom: 15px;">IN RESPECT OF BID / TENDER No.: ${data.bidNumber}, Date. ${data.bidDate}.</p>
    <p style="font-weight: bold; margin-bottom: 10px;">Issued By: M/s. ${data.companyName} .</p>
    <p class="justify font-bold">NB: The obligation to complete, duly sign and submit his declaration cannot be transferred to an external authorized representative, auditor or any other third party acting on behalf of the bidder.</p>
    <p class="justify">I, the undersigned, ${data.signatoryName} do hereby declare, in my capacity as ${data.signatoryDesignation} of M/s. ${data.companyName} the following:</p>
    <p class="justify">a. The facts contained herein are within my own personal knowledge.</p>
    <p class="justify">b. I have read and understood the requirement of local content (LC) and same is specified as percentage calculated in accordance with the definition provided at clause 2 of revised Public Procurement (preference to Make in India) Order 2017.</p>
    <p class="justify">“Local content” as per above order means the amount of value added in India which shall be the total value of items procured (excluding net domestic indirect taxes) minus the value of imported content in the item (including all customs duties) as a proportion of the total value in percent.</p>
    <p class="justify">c. I have satisfied myself that the goods/services/works to be delivered in terms of the above-specified bid comply with the local content requirements as specified in the tender for ‘Class-I Local Supplier’ / ‘Class-II Local Supplier’, and as above.</p>
    <p class="justify">d. I understand that a bidder can seek benefit of either Public Procurement Policy for MSEs –Order 2012 or Public Procurement (preference to Make in India) Order 2017 and not both and once the option is declared / selected it is not permitted to be modified subsequently. Accordingly, I seek the benefit from the below declared purchase preference policy only.</p>
    <p style="margin-left: 20px; text-indent: -20px;">i. I seek benefits against the following policy only (Select only one Option):</p>
    <p style="margin-left: 30px;">${isMsme ? "[x]" : "[ ]"} 1) PPP MSME Order 2012 (applicable for MSE manufacturers)</p>
    <p style="margin-left: 30px;">${!isMsme ? "[x]" : "[ ]"} 2) PPP MII 2017 (applicable for Class I suppliers as well as MSE manufacturers)</p>
    <p class="justify">e. The local content calculated using the definition given above are as under:</p>
    
    <table class="bordered-table">
      <thead>
        <tr>
          <th>Tender No</th>
          <th>Local Content Calculated as above %</th>
          <th>Location of Local Value Addition</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${data.bidNumber}</td>
          <td style="font-weight: bold;">${data.localContentPercentage}</td>
          <td>${data.localContentLocation}</td>
        </tr>
      </tbody>
    </table>
    
    <p class="justify">f. I accept that the Procurement Authority / Institution / MDL / Nodal Ministry has the right to request that the local content be verified in terms of the requirements of revised Public Procurement (preference to Make in India) Order 2017 dtd.16.09.2020 and I shall furnish the document / information on demand. Failure on my part to furnish the data will be treated as false declaration as per PPP MII Order 2017. In case of contract being awarded, I undertake to retain the relevant documents for 7 years from date of execution.</p>
    <p class="justify">g. I understand that the submission of incorrect data, or data that are not verifiable as described in revised Public Procurement (preference to Make in India) Order 2017, may result in the Procurement Authority / Nodal Ministry/ MDL imposing any or all of the remedies as provided for in Clause 9 of the Revised Public Procurement (preference to Make in India) Order 2017 dated 16.09.2020.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock(true)}
  `, 'DECLARATION CERTIFICATE FOR LOCAL CONTENT', 'page-doc-4'));

  // --- DOCUMENT 5: AVAILABILITY OF SPARES ---
  pages.push(wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef(`Declaration for Availability of Spare Parts up to ${data.sparesAvailabilityPeriod}.`)}
    <p style="margin-top: 40px;">Dear Sir/Madam,</p>
    <p class="justify">We certify that the equipment being/quoted is the latest model and that spares for the equipment will be available for a period of at least <strong>${data.sparesAvailabilityPeriod}</strong> and we also guarantee that we will keep the organization informed of any update of the equipment over a period of <strong>${data.sparesAvailabilityPeriod}</strong>.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, undefined, 'page-doc-5'));

  // --- DOCUMENT 6: COUNTRY OF ORIGIN ---
  pages.push(wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Declaration for Certificate of Country of Origin', 'Origin Reference')}
    <p>Dear Sir/Madam,</p>
    <p class="justify">We <strong>${data.companyName}</strong> introduce ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Equipment’s and Hospital Furniture would like to inform you that the quoted product <strong>${data.productDescription}</strong> is manufactured by us and we are Self-Manufacturer of the same. This product is made entirely in our Company using the raw materials available in India.</p>
    <p class="justify">We ensure that no foreign raw materials are used in our manufactured products.</p>
    <p class="justify">However, we assure you that the products we manufacture are entirely Indian made and that we are the Original Equipment’s Manufacture (OEM) of the original products.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, 'DECLARATION FOR CERTIFICATE OF COUNTRY OF ORIGIN', 'page-doc-6'));

  // --- DOCUMENT 7: DEMONSTRATION ---
  pages.push(wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Declaration for Demonstration')}
    <p>Dear Sir/Madam,</p>
    <p class="justify">We M/s. <strong>${data.companyName}</strong> having registered office at <strong>${data.companyAddress}.</strong></p>
    <p class="justify">We, the undersigned, hereby declare our commitment to arranging a demonstration of our product at our own expense. We understand the importance of showcasing the features and capabilities of our product to your satisfaction.</p>
    <p style="font-weight: bold; margin-bottom: 8px;">Terms of the Declaration:</p>
    
    <p class="justify" style="margin-left: 20px; text-indent: -20px;"><span style="font-weight: bold;">• Demo Arrangement:</span> We commit to organizing and conducting a comprehensive demonstration of our product as per your requirements.</p>
    <p class="justify" style="margin-left: 20px; text-indent: -20px;"><span style="font-weight: bold;">• Cost Coverage:</span> All expenses related to the demonstration, including travel, accommodation, and any other associated costs, will be borne entirely by us.</p>
    <p class="justify" style="margin-left: 20px; text-indent: -20px;"><span style="font-weight: bold;">• Location and Timing:</span> We are flexible and willing to conduct the demo at a location of your choice. We will coordinate with your team to determine a suitable date and time for the demonstration.</p>
    <p class="justify" style="margin-left: 20px; text-indent: -20px;"><span style="font-weight: bold;">• Customization:</span> If there are specific aspects or features you wish to focus on during the demo, please communicate them in advance so that we can tailor our presentation to meet your needs.</p>
    <p class="justify" style="margin-left: 20px; text-indent: -20px;"><span style="font-weight: bold;">• Feedback and Adjustments:</span> We welcome any feedback you may have during or after the demonstration. If there are areas that require further clarification or adjustments, we commit to addressing them promptly.</p>
    
    <p class="justify" style="margin-top: 15px;">By signing this declaration, both parties affirm their understanding and agreement to the terms outlined herein. We look forward to the opportunity to showcase our product and demonstrate how it can meet and exceed your expectations.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, undefined, 'page-doc-7'));

  // --- DOCUMENT 8: NON-BLACKLISTING ---
  pages.push(wrapPage(`
    ${renderSubjectRef('Declaration on Non-Blacklisting / Debarring')}
    <p>Dear Sir/Madam,</p>
    <p class="justify">We M/s. <strong>${data.companyName}</strong> having registered office at <strong>${data.companyAddress}.</strong> Hereby declare that our firm has not been found guilty of malpractice, misconduct, or blacklisted/debarred either by the Public Health Department, Government of Maharashtra, and all State Governments or by any local authority and other State Government/Central Government's Organizations in the past three years.</p>
    <p class="justify">We take great pride in maintaining a high standard of ethical conduct and compliance with all applicable regulations. Our commitment to integrity and professionalism is reflected in our business practices, and we strive to uphold the trust placed in us by our clients and stakeholders.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, 'TO WHOM SO EVER IT MAY CONCERN', 'page-doc-8'));

  // --- DOCUMENT 9: WARRANTY UNDERTAKING (STANDARD) ---
  pages.push(wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Undertaking for Warranty')}
    <p>Dear Sir/Madam,</p>
    <p class="justify">We, M/s <strong>${data.companyName}</strong> ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Equipment’s and Hospital Furniture do hereby guarantee and warranty all work performed as part of the bid for a period of <strong>${data.warrantyPeriod}</strong> from the date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.</p>
    <p class="justify">We fully understand and acknowledge the importance of the warranty duration in meeting your requirements. Our commitment to providing a <strong>${data.warrantyPeriod}</strong> warranty reflects our confidence in the quality and durability of our products. This undertaking is a testament to our dedication to customer satisfaction and our assurance of the reliability of our offerings.</p>
    <p>We are more than willing to address any queries and provide the necessary clarifications.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, undefined, 'page-doc-9'));

  // --- DOCUMENT 10: ACCEPTANCE OF TENDER TERMS ---
  pages.push(wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Acceptance of Tender Terms and Conditions as per Bid.')}
    <p>Dear Sir/Madam,</p>
    <p style="margin-left: 20px; text-indent: -20px;">1. We have downloaded/obtained the tender documents for the above mentioned bid in reference to Supply & Installation of Equipment’s from the web site namely GeM Portal.</p>
    <p style="margin-left: 20px; text-indent: -20px;">2. We hereby certify that we have reviewed entire terms and conditions of the tender documents (including all documents like annexure, schedules, etc., which is form part of the Contract Agreement and we shall abide hereby to the terms / conditions / Warranty / CMC / Delivery / Clauses contained therein.</p>
    <p style="margin-left: 20px; text-indent: -20px;">3. The corrigendum(s) issued from time to time by your department / organization also has been taken into consideration, while submitting this acceptance letter.</p>
    <p style="margin-left: 20px; text-indent: -20px;">4. We hereby unconditionally accept the tender conditions of above mentioned tender and its corrigendum(s) in totality / entirely.</p>
    <p style="margin-left: 20px; text-indent: -20px;">5. In case any provision of this bid / tender are found violated, your department / organization shall be at liberty to reject this and we shall not have any claim/ right against the department in satisfaction of this condition.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, undefined, 'page-doc-10'));

  // --- DOCUMENT 11: PRICE DECLARATION ---
  pages.push(wrapPage(`
    ${renderSubjectRef('Price Declaration')}
    <p>Dear Sir/Madam,</p>
    <p class="justify">We M/s. <strong>${data.companyName}</strong> having registered office at <strong>${data.companyAddress}.</strong> hereby declare that the rates quoted in the tender <strong>${data.productDescription}</strong> are not higher than the rates quoted to other Government Departments/Government Undertakings or any prevailing contracts, and they are not higher than the Maximum Retail Price (MRP).</p>
    <p class="justify">We assure that our pricing is fair, competitive, and in compliance with all applicable regulations. The rates provided in this tender are consistent with our pricing practices across various government entities and ongoing contracts.</p>
    <p>If required, we are willing to provide any additional documentation or evidence to substantiate this declaration.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, 'TO WHOM SO EVER IT MAY CONCERN', 'page-doc-11'));

  // --- DOCUMENT 12: FINANCIAL STANDING ---
  pages.push(wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Undertaking for Financial Standing')}
    <p>Dear Sir/Madam,</p>
    <p class="justify">We, M/s. <strong>${data.companyName}</strong>, represented by the company, located at <strong>${data.companyAddress},</strong> hereby provide the following undertaking regarding our financial standing:</p>
    <p class="justify" style="margin-bottom: 4px;"><span style="font-weight: bold;">Business Nature:</span> We are established and reputable indigenous manufacturers of Medical Equipment’s and Hospital Furniture.</p>
    <p class="justify" style="margin-top: 0; margin-bottom: 12px;"><span style="font-weight: bold;">Location:</span> Our manufacturing facilities are situated at <strong>${data.companyAddress}.</strong></p>
    
    <p class="justify font-bold" style="margin-bottom: 6px;">Financial Standing: We declare that, to the best of our knowledge and belief, as of the date of this undertaking:</p>
    <p style="margin: 2px 0 2px 20px;">a. We are not under liquidation, court receivership, or any similar proceedings.</p>
    <p style="margin: 2px 0 10px 20px;">b. We are not bankrupt.</p>
    
    <p class="justify"><span style="font-weight: bold;">Commitment:</span> We undertake to promptly inform the concerned parties if there are any changes in our financial standing during any agreements or contracts.</p>
    <p class="justify"><span style="font-weight: bold;">Accuracy of Information:</span> The information provided in this undertaking is true and accurate to the best of our knowledge, and we understand the legal consequences of providing false information.</p>
    
    <p>We hereby affix our signature and company seal to confirm the authenticity of this undertaking.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, undefined, 'page-doc-12'));

  // --- DOCUMENT 13: SPECIAL WARRANTY ---
  pages.push(wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Undertaking for Warranty')}
    <p>Dear Sir/Madam,</p>
    <p class="justify">We, M/s <strong>${data.companyName}</strong> ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Cold chain Equipment’s do hereby guarantee and warranty all work performed as part of the bid for a period of as per bid terms from the date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.</p>
    <p class="justify">We hereby undertake that the <strong>${data.productDescription}</strong> supplied by us shall carry a <strong>warranty period of ${data.warrantyPeriod}</strong> from the date of final acceptance of goods.</p>
    <p class="justify">In addition, we commit to providing an <strong>on-site service support</strong> for a further <strong>${data.serviceSupportPeriod}</strong> beyond the warranty period.</p>
    <p class="justify">We also confirm that <strong>spare parts and necessary accessories</strong> for the said equipment shall remain <strong>available for a minimum period of ${data.sparesAvailabilityPeriod}</strong> from the date of installation.</p>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, undefined, 'page-doc-13'));

  // --- DOCUMENT 14: DETAILS OF AFTER SALES SERVICE STATION ---
  pages.push(wrapPage(`
    <table class="bordered-table service-table">
      <thead>
        <tr>
          <th rowspan="2" width="6%">Sr. No.</th>
          <th rowspan="2" width="12%">City & State</th>
          <th rowspan="2" width="34%">Full Address with Pin code</th>
          <th rowspan="2" width="18%">Contact Person Name</th>
          <th colspan="2" width="30%">Contact Numbers with STD Code</th>
        </tr>
        <tr>
          <th width="18%">Email ID</th>
          <th width="12%">Mobile No.</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1 (H.O.)</td>
          <td>Nashik, Maharashtra.</td>
          <td>Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007 Maharashtra</td>
          <td>Mr. Sachin Shisode,<br/>Mr. Shridhar Shigare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>8390900347<br/>9011104332</td>
        </tr>
        <tr>
          <td>2.</td>
          <td>Mumbai, Maharashtra.</td>
          <td>410 , 4th floor, Maker Chamber V, Nariman point, Mumbai 400021 Maharashtra</td>
          <td>Mr. Shridhar Shingare,<br/>Mr. Sachin Shisode,</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>9011104332<br/>8390900347</td>
        </tr>
        <tr>
          <td>3</td>
          <td>South Delhi.</td>
          <td>Office No.515, 5th Floor, Tower-DLF, Jasola-110025 South Delhi</td>
          <td>Mr. Vinit Sharma,<br/>Mr. Shridhar Shingare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>8527027321<br/>9011104332</td>
        </tr>
        <tr>
          <td>4</td>
          <td>Ambala, Haryana.</td>
          <td>B. Block 3031 CCC Zirakpur, Chandigarh-140603 Haryana</td>
          <td>Mr. Deepak Pawaiya,<br/>Mr. Shridhar Shingare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>9175550259<br/>9011104332</td>
        </tr>
        <tr>
          <td>5</td>
          <td>Jaipur, Rajasthan.</td>
          <td>Plot No.438, Vivek Vihar Colony, New Sanganer Road, Sodala. Jaipur - 302001, Rajasthan</td>
          <td>Mr. Devendra Hire,<br/>Mr. Shridhar Shingare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>8208463830<br/>9011104332</td>
        </tr>
        <tr>
          <td>6</td>
          <td>Lucknow, Uttar Pradesh.</td>
          <td>14 - Manas nagar colony, Jiamau, Hazratganj, Opp. RTD, DGP Jagmohan Yadav Residency, Lucknow – 226001 Uttar Pradesh.</td>
          <td>Mr. Anil Aher,<br/>Mr. Shridhar Shingare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>9146489605<br/>9011104332</td>
        </tr>
        <tr>
          <td>7</td>
          <td>Hyderabad, Telangana.</td>
          <td>P NO.478, Lane Number 4 IDA Cherlapally, Hyderabad, Medchal Malkajgiri-500051 Telangana</td>
          <td>Mr. Chandu,<br/>Mr. Shridhar Shingare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>9000959574<br/>9011104332</td>
        </tr>
        <tr>
          <td>8.</td>
          <td>Trivandrum, Kerala</td>
          <td>Dot Space Business Center, Opp. Tennis Club, Kowdiar, Devasomboard Road, Trivandrum-695003 Kerala</td>
          <td>Meera Budhan<br/>Mr. Shridhar Shingare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>8589999138<br/>9011104332</td>
        </tr>
        <tr>
          <td>9.</td>
          <td>Ahmedabad, Gujarat.</td>
          <td><strong>Pulse Biomed LLP,</strong><br/>A314, Advance Business Park, Shahibag, Ahmedabad-380004 Gujarat</td>
          <td>Paresh Sohni<br/>Mr. Shridhar Shingare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>9898081574<br/>9011104332</td>
        </tr>
        <tr>
          <td>10</td>
          <td>Gandhinagar<br/>Gujarat.</td>
          <td><strong>SEVAMED SOLUTIONS PRIVATE LIMITED</strong><br/>Shop 505, 5th Floor, East Wing, Siddharaj Z2, Kudasan, Gandhinagar. 382421</td>
          <td>Mr. Shridhar Shingare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>9146115073<br/>9011104332</td>
        </tr>
        <tr>
          <td>11</td>
          <td>Kolkata, West<br/>Bengal.</td>
          <td>P Bhogilal Pvt Ltd, 117b, Chittaranjan Avenue, Central Avenue, Kolkata - 700073 West Bengal</td>
          <td>Mr. Nilesh Mehta<br/>Mr. Shridhar Shigare</td>
          <td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td>
          <td>9175559646<br/>9011104332</td>
        </tr>
      </tbody>
    </table>
    <p>Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, 'DETAILS OF AFTER SALES SERVICE STATION', 'page-doc-14'));

  // --- DOCUMENT 15: ESCALATION MATRIX ---
  pages.push(wrapPage(`
    ${renderAddressBlock()}
    ${renderSubjectRef('Escalation Matrix for Service Support')}
    <p>Dear Sir/Madam,</p>
    <p>We hereby submit the Escalation Matrix with Telephone Numbers for Service Support for our quoted product as under:</p>
    
    <table class="bordered-table escalation-table">
      <thead>
        <tr>
          <th width="7%">Sr. No</th>
          <th width="20%">Name of Responsible Person</th>
          <th width="18%">Designation</th>
          <th width="18%">Triggers When</th>
          <th width="17%">Contact Number</th>
          <th width="20%">Email ID’s</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1.</td>
          <td>Mr. Sanjay Sadade</td>
          <td>General Manager</td>
          <td>Administration</td>
          <td>09225126772</td>
          <td style="font-weight: bold;">support@markenworld.com</td>
        </tr>
        <tr>
          <td>3.</td>
          <td>Mr. Shridhar Shingare</td>
          <td>Tender Manager</td>
          <td>Institution Business Division</td>
          <td>09011104332</td>
          <td style="font-weight: bold;">info@markenworld.com</td>
        </tr>
        <tr>
          <td>4.</td>
          <td>Mr. Eknath Mandal</td>
          <td>Production Manager</td>
          <td>Delays of machine design and Technical Error.</td>
          <td>09225102371</td>
          <td style="font-weight: bold;">support@markenworld.com</td>
        </tr>
        <tr>
          <td>5.</td>
          <td>Mr. Sachin Shisode</td>
          <td>Service Head</td>
          <td>Servicing Delay</td>
          <td>08390900347</td>
          <td style="font-weight: bold;">support@markenworld.com</td>
        </tr>
      </tbody>
    </table>
    <p style="margin-top: 15px;">Thanking you and assuring you of our best services at all the times.</p>
    ${renderSignatoryBlock()}
  `, undefined, 'page-doc-15'));

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        @page {
          size: A4;
          margin: 0;
        }
        body {
          margin: 0;
          padding: 0;
          background-color: #ffffff;
          -webkit-print-color-adjust: exact;
        }
        .page {
          box-sizing: border-box;
          width: 210mm;
          padding: 30px 42.5px 40px 42.5px;
          position: relative;
          page-break-after: always;
          font-family: 'Cambria', serif;
          font-size: 11pt;
          line-height: 1.25;
          color: #000000;
        }
        .page-doc-1 { font-size: 11pt; }
        .page-doc-2 { font-size: 14pt; }
        .page-doc-3 { font-size: 14pt; }
        .page-doc-4 { font-size: 11pt; }
        .page-doc-5 { font-size: 12pt; }
        .page-doc-6 { font-size: 14pt; }
        .page-doc-7 { font-size: 11pt; }
        .page-doc-8 { font-size: 12pt; }
        .page-doc-9 { font-size: 12pt; }
        .page-doc-10 { font-size: 12pt; }
        .page-doc-11 { font-size: 12pt; }
        .page-doc-12 { font-size: 12pt; }
        .page-doc-13 { font-size: 12pt; }
        .page-doc-14 { font-size: 11pt; }
        .page-doc-15 { font-size: 12pt; }

        .page-doc-1 .document-title { font-size: 12pt; }
        .page-doc-2 .document-title { font-size: 16pt; }
        .page-doc-3 .document-title { font-size: 16pt; }
        .page-doc-4 .document-title { font-size: 11pt; }
        .page-doc-6 .document-title { font-size: 16pt; }
        .page-doc-8 .document-title { font-size: 12pt; }
        .page-doc-9 .document-title { font-size: 14pt; }
        .page-doc-11 .document-title { font-size: 12pt; }
        .page-doc-12 .document-title { font-size: 14pt; }
        .page-doc-13 .document-title { font-size: 14pt; }
        .page-doc-14 .document-title { font-size: 14pt; }

        .page-doc-2 .address-block { font-size: 12pt; }
        .page-doc-3 .address-block { font-size: 14pt; }
        .page-doc-6 .address-block { font-size: 14pt; }

        p {
          margin-top: 0;
          margin-bottom: 8px;
        }
        /* Style for letterhead */
        .letterhead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          min-height: 75px;
          font-family: 'Calibri', sans-serif;
          color: #000000;
        }
        .logo-container {
          width: 90px;
        }
        .logo-img {
          width: 90px;
          max-height: 75px;
        }
        .partner-container {
          width: 105px;
        }
        .partner-img {
          width: 105px;
          max-height: 75px;
        }
        .header-text {
          flex: 1;
          margin-left: 15px;
          margin-right: 15px;
          text-align: left;
        }
        .company-title {
          font-family: 'Calibri-Bold', 'Calibri', sans-serif;
          font-size: 22pt;
          font-weight: bold;
          margin: 0;
          line-height: 1.1;
          color: #4472c4;
        }
        .company-addr {
          font-size: 10pt;
          margin: 2px 0 0 0;
          line-height: 1.1;
          color: #000000;
        }
        .company-info {
          font-size: 10pt;
          margin: 2px 0 0 0;
          line-height: 1.1;
          color: #000000;
        }
        .header-divider {
          border: none;
          border-top: 0.75pt solid #4472c4;
          margin: 6px 0 10px 0;
        }
        .date-row {
          text-align: right;
          font-size: 11pt;
          margin-bottom: 10px;
        }
        .document-title {
          text-align: center;
          text-decoration: underline;
          font-size: 12pt;
          font-weight: bold;
          margin-top: 10px;
          margin-bottom: 15px;
          text-transform: uppercase;
        }
        .address-block {
          text-align: left;
          font-size: 11pt;
          margin-bottom: 15px;
          line-height: 1.35;
        }
        .subject-ref-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
        }
        .subject-ref-table td {
          padding: 2px 0;
          vertical-align: top;
          border: none;
        }
        .justify {
          text-align: justify;
        }
        .font-bold {
          font-weight: bold;
        }
        /* Tables */
        .bidder-particulars-table {
          width: 100%;
          border-collapse: collapse;
          margin: 15px 0;
        }
        .bidder-particulars-table td {
          border: none;
          padding: 5px 0;
          vertical-align: top;
          font-family: 'Cambria', serif;
          font-size: 14pt;
        }
        .bidder-particulars-table th {
          font-family: 'Cambria-Bold', 'Cambria', serif;
          font-size: 14pt;
          font-weight: bold;
        }
        .bordered-table {
          width: 100%;
          border-collapse: collapse;
          margin: 15px 0;
        }
        .bordered-table th, .bordered-table td {
          border: 0.5pt solid #4472c4;
          padding: 6px 8px;
          text-align: left;
          vertical-align: top;
        }
        .bordered-table th {
          background-color: #c6d9f1;
          font-family: 'Cambria-Bold', 'Cambria', serif;
          font-size: 10pt;
          font-weight: bold;
        }
        .bordered-table td {
          font-family: 'Cambria', serif;
          font-size: 10pt;
        }
        .service-table td {
          font-family: 'Cambria', serif;
          font-size: 10pt;
          line-height: 1.25;
        }
        .service-table th {
          font-family: 'Cambria-Bold', 'Cambria', serif;
          font-size: 10pt;
          font-weight: bold;
        }
        .escalation-table td {
          font-family: 'Cambria', serif;
          font-size: 12pt;
          line-height: 1.25;
        }
        .escalation-table th {
          font-family: 'Cambria-Bold', 'Cambria', serif;
          font-size: 12pt;
          font-weight: bold;
        }
        tr {
          page-break-inside: avoid;
        }
        .signatory-block {
          margin-top: 15px;
          text-align: left;
          page-break-inside: avoid;
        }
        .signature-container {
          position: relative;
          height: 55px;
          margin: 5px 0;
        }
        .sig-img {
          position: absolute;
          left: 45px;
          top: -5px;
          width: 60px;
        }
        .stamp-img {
          position: absolute;
          left: 0px;
          top: 0px;
          width: 70px;
        }
      </style>
    </head>
    <body>
      ${pages.join('')}
    </body>
    </html>
  `;
}

async function runTest() {
  const outputPath = path.join(__dirname, '..', 'public', 'test-bid-documents.pdf');
  console.log(`Generating test PDF at: ${outputPath}`);

  const publicDir = path.dirname(outputPath);
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const data = {
    date: "05-06-2026",
    authorityName: "Director General Medical Services (Army)",
    authorityDept: "Department of Military Affairs, Indian Army Ministry of Defence",
    authorityAddress: "New Delhi – 110023",
    bidNumber: "GEM/2026/B/7431487",
    bidDate: "01-06-2026",
    productDescription: "Passive Blood Transportation Box Capacity 8 to 16 bags (MCBX-01), Passive Blood transportation Box Capacity 20 to 30 bags (MCBX-05), Active Blood transportation Box Capacity 20 to 30 bags (MACB-03)",
    companyName: "Mark Enterprises",
    companyAddress: "Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India",
    companyEmail: "info@markenworld.com",
    companyWebsite: "www.markenworld.com",
    companyContact: "09175559646 / 090111 04332",
    manufacturerName: "M/s. Mark Enterprises",
    manufacturerAddress: "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra",
    signatoryName: "Korra Praveen Naik",
    signatoryDesignation: "Partner",
    signatoryAddress: "1-1-51/46, Kapra, ECIL post, S.T.Colony, VTC: Ranga Reddy, District: Hyderabad, State: Andhra Pradesh, PIN Code: 500062",
    witnessDetails: "Mr. Shreedhar Shingare (Cell No.: 09011104332)",
    localContentPercentage: "100%",
    localContentLocation: "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra",
    preferencePolicy: "PPP MII 2017",
    warrantyPeriod: "Five (5) years",
    serviceSupportPeriod: "Five (5) years",
    sparesAvailabilityPeriod: "Ten (10) years",
    place: "Nashik"
  };

  const htmlContent = generateHtmlTemplates(data);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0px',
        bottom: '0px',
        left: '0px',
        right: '0px'
      }
    });
    console.log('PDF Generation Complete!');
  } finally {
    await browser.close();
  }
}

runTest().catch(err => {
  console.error('Test PDF generation failed:', err);
  process.exit(1);
});
