const { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  Table, 
  TableRow, 
  TableCell, 
  PageBreak, 
  AlignmentType, 
  BorderStyle, 
  WidthType, 
} = require("docx");
const fs = require('fs');
const path = require('path');

function runTest() {
  const outputPath = path.join(__dirname, '..', 'public', 'test-bid-documents.docx');
  console.log(`Generating test DOCX at: ${outputPath}`);

  const publicDir = path.dirname(outputPath);
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const borderStyle = { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" };

  // Helper to create page header block
  function createHeaderBlock(data, title) {
    const children = [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: String(data.companyName).toUpperCase(),
            bold: true,
            size: 44, // 22pt
            font: "Calibri",
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: data.companyAddress,
            size: 20, // 10pt
            font: "Calibri",
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: `Email ID: ${data.companyEmail}  URL: ${data.companyWebsite}  Contact No.: ${data.companyContact}`,
            size: 20, // 10pt
            font: "Calibri",
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 120, after: 240 },
        children: [
          new TextRun({
            text: `Date: ${data.date}`,
            bold: true,
            size: 22, // 11pt
            font: "Cambria",
          }),
        ],
      }),
    ];

    if (title) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [
            new TextRun({
              text: title.toUpperCase(),
              bold: true,
              underline: {},
              size: 24, // 12pt
              font: "Cambria",
            }),
          ],
        })
      );
    }

    return children;
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

  const docChildren = [];

  // Table 1: Bidder Particulars
  const bidderParticularsTableRows = [
    new TableRow({
      children: [
        new TableCell({ width: { size: 8, type: WidthType.PERCENTAGE }, borders: { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle }, children: [new Paragraph({ children: [new TextRun({ text: "Sr. No.", bold: true, font: "Calibri", size: 20 })] })] }),
        new TableCell({ width: { size: 32, type: WidthType.PERCENTAGE }, borders: { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle }, children: [new Paragraph({ children: [new TextRun({ text: "Particulars", bold: true, font: "Calibri", size: 20 })] })] }),
        new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, borders: { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle }, children: [new Paragraph({ children: [new TextRun({ text: "Value", bold: true, font: "Calibri", size: 20 })] })] })
      ]
    })
  ];

  const bidderTable = new Table({
    alignment: AlignmentType.CENTER,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: bidderParticularsTableRows
  });
  docChildren.push(bidderTable);

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: 1960,
            bottom: 800,
            left: 850,
            right: 850,
          }
        }
      },
      children: docChildren,
    }],
  });

  Packer.toBuffer(doc).then((buffer) => {
    fs.writeFileSync(outputPath, buffer);
    console.log("DOCX generated successfully!");
  }).catch((err) => {
    console.error("Error generating DOCX:", err);
  });
}

runTest();
