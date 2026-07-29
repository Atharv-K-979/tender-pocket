package com.tenderpocket.services;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle;
import org.apache.poi.xwpf.usermodel.*;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTSectPr;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTPageMar;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Base64;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import java.util.*;
import java.time.LocalDate;

@Service
public class DocumentGeneratorService {

    public byte[] generatePdf(Map<String, String> data) throws Exception {
        String htmlContent = generateHtmlTemplates(data);
        try {
            Files.write(Paths.get("public/debug_generated.html"), htmlContent.getBytes());
        } catch (Exception ex) {}
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        
        PdfRendererBuilder builder = new PdfRendererBuilder();
        builder.useFastMode();

        // Register custom Calibri and Cambria fonts from classpath resources
        try {
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Calibri.ttf"), "Calibri", 400, FontStyle.NORMAL, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Calibri Bold.ttf"), "Calibri", 700, FontStyle.NORMAL, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Calibri Italic.ttf"), "Calibri", 400, FontStyle.ITALIC, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Calibri Bold Italic.ttf"), "Calibri", 700, FontStyle.ITALIC, true);

            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Cambria.ttf"), "Cambria", 400, FontStyle.NORMAL, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Cambria Bold.ttf"), "Cambria", 700, FontStyle.NORMAL, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Cambria Italic.ttf"), "Cambria", 400, FontStyle.ITALIC, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Cambria Bold Italic.ttf"), "Cambria", 700, FontStyle.ITALIC, true);
        } catch (Exception ex) {
            System.err.println("Failed to register custom fonts: " + ex.getMessage());
        }

        builder.withHtmlContent(htmlContent, "/");
        builder.toStream(baos);
        builder.run();
        
        return baos.toByteArray();
    }

    public byte[] generateDocx(Map<String, String> data) throws Exception {
        try (XWPFDocument document = new XWPFDocument();
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            
            // Set margins: Top: 1960, Bottom: 800, Left: 850, Right: 850 dxa
            CTSectPr sectPr = document.getDocument().getBody().addNewSectPr();
            CTPageMar pageMar = sectPr.addNewPgMar();
            pageMar.setLeft(BigInteger.valueOf(850L));
            pageMar.setRight(BigInteger.valueOf(850L));
            pageMar.setTop(BigInteger.valueOf(1960L));
            pageMar.setBottom(BigInteger.valueOf(800L));

            // Generate DOCX pages for all 15 documents
            
            // 1. BID FORM
            writeDoc1(document, data);
            
            // 2. BID SECURITY DECLARATION FORM
            addPageBreak(document);
            writeDoc2(document, data);
            
            // 3. BIDDER PARTICULARS
            addPageBreak(document);
            writeDoc3(document, data);
            
            // 4. DECLARATION CERTIFICATE FOR LOCAL CONTENT
            addPageBreak(document);
            writeDoc4(document, data);
            
            // 5. AVAILABILITY OF SPARES
            addPageBreak(document);
            writeDoc5(document, data);
            
            // 6. COUNTRY OF ORIGIN
            addPageBreak(document);
            writeDoc6(document, data);
            
            // 7. DEMONSTRATION
            addPageBreak(document);
            writeDoc7(document, data);
            
            // 8. NON-BLACKLISTING
            addPageBreak(document);
            writeDoc8(document, data);
            
            // 9. WARRANTY UNDERTAKING
            addPageBreak(document);
            writeDoc9(document, data);
            
            // 10. ACCEPTANCE OF TENDER TERMS
            addPageBreak(document);
            writeDoc10(document, data);
            
            // 11. PRICE DECLARATION
            addPageBreak(document);
            writeDoc11(document, data);
            
            // 12. FINANCIAL STANDING
            addPageBreak(document);
            writeDoc12(document, data);
            
            // 13. SPECIAL WARRANTY
            addPageBreak(document);
            writeDoc13(document, data);
            
            // 14. DETAILS OF AFTER SALES SERVICE STATION
            addPageBreak(document);
            writeDoc14(document, data);
            
            // 15. ESCALATION MATRIX
            addPageBreak(document);
            writeDoc15(document, data);
            
            // 16. TECHNICAL SPECIFICATION & COMPLIANCE SHEET
            addPageBreak(document);
            writeDoc16(document, data);
            
            document.write(baos);
            return baos.toByteArray();
        }
    }

    // DOCX Helper methods
    private void addPageBreak(XWPFDocument doc) {
        XWPFParagraph p = doc.createParagraph();
        p.setPageBreak(true);
    }

    private void writeHeader(XWPFDocument doc, Map<String, String> data, String title, boolean showDate) {
        // Create 3-column table for letterhead
        XWPFTable table = doc.createTable(1, 3);
        
        // Remove borders from the table
        try {
            table.getCTTbl().addNewTblPr().addNewTblBorders();
            org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblBorders borders = table.getCTTbl().getTblPr().getTblBorders();
            borders.addNewLeft().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.NONE);
            borders.addNewRight().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.NONE);
            borders.addNewTop().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.NONE);
            borders.addNewBottom().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.NONE);
            borders.addNewInsideH().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.NONE);
            borders.addNewInsideV().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.NONE);
        } catch (Exception e) {}

        // Cell 0: Logo
        XWPFTableCell cell0 = table.getRow(0).getCell(0);
        cell0.setWidth("1200");
        XWPFParagraph p0 = cell0.getParagraphs().get(0);
        p0.setSpacingAfter(0);
        XWPFRun rLogo = p0.createRun();
        try {
            byte[] logoData = loadImageBytes("public/images/logo.png", "/static/images/logo.png");
            if (logoData != null) {
                try (InputStream logoStream = new java.io.ByteArrayInputStream(logoData)) {
                    rLogo.addPicture(logoStream, XWPFDocument.PICTURE_TYPE_PNG, "logo.png", 857250, 714375);
                }
            }
        } catch (Exception e) {}

        // Cell 1: Text
        XWPFTableCell cell1 = table.getRow(0).getCell(1);
        cell1.setWidth("7500");
        
        XWPFParagraph pComp = cell1.getParagraphs().get(0);
        pComp.setSpacingAfter(40);
        XWPFRun rComp = pComp.createRun();
        rComp.setText(data.getOrDefault("companyName", "").toUpperCase());
        rComp.setBold(true);
        rComp.setFontSize(22);
        rComp.setFontFamily("Calibri");
        rComp.setColor("4472c4");

        // Split company address into two lines at appropriate place
        String addr1 = data.getOrDefault("companyAddress", "");
        String addr2 = "";
        if (addr1.contains("MIDC Satpur,")) {
            String[] parts = addr1.split("MIDC Satpur,");
            addr1 = parts[0] + "MIDC Satpur,";
            if (parts.length > 1) addr2 = parts[1].trim();
        } else {
            String[] commas = addr1.split(",");
            if (commas.length > 3) {
                StringBuilder sb1 = new StringBuilder();
                StringBuilder sb2 = new StringBuilder();
                for (int i = 0; i < commas.length; i++) {
                    if (i < 4) {
                        sb1.append(commas[i]).append(",");
                    } else {
                        sb2.append(commas[i]).append(",");
                    }
                }
                addr1 = sb1.toString();
                addr2 = sb2.toString().trim();
                if (addr2.endsWith(",")) addr2 = addr2.substring(0, addr2.length() - 1);
            }
        }

        XWPFParagraph pAddr1 = cell1.addParagraph();
        pAddr1.setSpacingAfter(40);
        XWPFRun rAddr1 = pAddr1.createRun();
        rAddr1.setText(addr1);
        rAddr1.setFontSize(10);
        rAddr1.setFontFamily("Calibri");

        if (!addr2.isEmpty()) {
            XWPFParagraph pAddr2 = cell1.addParagraph();
            pAddr2.setSpacingAfter(40);
            XWPFRun rAddr2 = pAddr2.createRun();
            rAddr2.setText(addr2);
            rAddr2.setFontSize(10);
            rAddr2.setFontFamily("Calibri");
        }

        XWPFParagraph pInfo = cell1.addParagraph();
        pInfo.setSpacingAfter(0);
        XWPFRun rInfo = pInfo.createRun();
        rInfo.setText("Email ID: " + data.getOrDefault("companyEmail", "") + 
                     "  URL: " + data.getOrDefault("companyWebsite", "") + 
                     "  Contact No.: " + data.getOrDefault("companyContact", ""));
        rInfo.setFontSize(10);
        rInfo.setFontFamily("Calibri");

        // Cell 2: Partner Logo
        XWPFTableCell cell2 = table.getRow(0).getCell(2);
        cell2.setWidth("1300");
        XWPFParagraph p2 = cell2.getParagraphs().get(0);
        p2.setSpacingAfter(0);
        p2.setAlignment(ParagraphAlignment.RIGHT);
        XWPFRun rPartner = p2.createRun();
        try {
            byte[] partnerData = loadImageBytes("public/images/partner.png", "/static/images/partner.png");
            if (partnerData != null) {
                try (InputStream partnerStream = new java.io.ByteArrayInputStream(partnerData)) {
                    rPartner.addPicture(partnerStream, XWPFDocument.PICTURE_TYPE_PNG, "partner.png", 1000125, 714375);
                }
            }
        } catch (Exception e) {}

        // Add divider line below table
        XWPFParagraph pDiv = doc.createParagraph();
        pDiv.setBorderBottom(Borders.SINGLE);
        pDiv.setSpacingAfter(120);

        if (showDate) {
            XWPFParagraph pDate = doc.createParagraph();
            pDate.setAlignment(ParagraphAlignment.RIGHT);
            pDate.setSpacingAfter(240);
            XWPFRun rDate = pDate.createRun();
            rDate.setText("Date: " + data.getOrDefault("date", ""));
            rDate.setBold(true);
            rDate.setFontSize(11);
            rDate.setFontFamily("Cambria");
        }

        if (title != null && !title.isEmpty()) {
            XWPFParagraph pTitle = doc.createParagraph();
            pTitle.setAlignment(ParagraphAlignment.CENTER);
            pTitle.setSpacingAfter(240);
            XWPFRun rTitle = pTitle.createRun();
            rTitle.setText(title);
            rTitle.setBold(true);
            rTitle.setUnderline(UnderlinePatterns.SINGLE);
            rTitle.setFontSize(12);
            rTitle.setFontFamily("Cambria");
        }
    }

    private void writeAddressBlock(XWPFDocument doc, Map<String, String> data) {
        XWPFParagraph p = doc.createParagraph();
        p.setSpacingBefore(120);
        p.setSpacingAfter(120);
        XWPFRun r = p.createRun();
        r.setFontFamily("Cambria");
        r.setFontSize(11);
        r.setText("To,");
        r.addBreak();
        
        String name = data.getOrDefault("authorityName", "").trim();
        String dept = data.getOrDefault("authorityDept", "").trim();
        String addr = data.getOrDefault("authorityAddress", "").trim();
        
        if (!name.isEmpty()) {
            r.setText(name);
            r.addBreak();
        }
        if (!dept.isEmpty() && !dept.equalsIgnoreCase(name)) {
            r.setText(dept);
            r.addBreak();
        }
        if (!addr.isEmpty()) {
            r.setText(addr);
            r.addBreak();
        }
    }

    private void writeSubjectRef(XWPFDocument doc, String subject, Map<String, String> data, String refLabel) {
        XWPFParagraph p = doc.createParagraph();
        p.setSpacingBefore(120);
        p.setSpacingAfter(120);
        
        XWPFRun r1 = p.createRun();
        r1.setFontFamily("Cambria");
        r1.setFontSize(11);
        r1.setBold(true);
        r1.setText("Subject: ");
        
        XWPFRun r2 = p.createRun();
        r2.setFontFamily("Cambria");
        r2.setFontSize(11);
        r2.setText(subject);
        r2.addBreak();
        
        XWPFRun r3 = p.createRun();
        r3.setFontFamily("Cambria");
        r3.setFontSize(11);
        r3.setBold(true);
        r3.setText(refLabel + ": ");
        
        XWPFRun r4 = p.createRun();
        r4.setFontFamily("Cambria");
        r4.setFontSize(11);
        r4.setText("Bid No.: " + data.getOrDefault("bidNumber", "") + ", Date. " + data.getOrDefault("bidDate", "") + ".");
    }

    private void writeSignatoryBlock(XWPFDocument doc, Map<String, String> data, boolean showPlace) {
        XWPFParagraph p = doc.createParagraph();
        p.setSpacingBefore(240);
        XWPFRun r = p.createRun();
        r.setFontFamily("Cambria");
        r.setFontSize(11);
        r.setText("Yours faithfully,");
        r.addBreak();
        r.setBold(true);
        r.setText("For " + data.getOrDefault("companyName", ""));
        r.addBreak();

        XWPFParagraph pSig = doc.createParagraph();
        XWPFRun rSig = pSig.createRun();
        try {
            byte[] stampData = loadImageBytes("public/images/stamp.png", "/static/images/stamp.png");
            if (stampData != null) {
                try (InputStream stampStream = new java.io.ByteArrayInputStream(stampData)) {
                    rSig.addPicture(stampStream, XWPFDocument.PICTURE_TYPE_PNG, "stamp.png", 666750, 666750);
                }
            }
        } catch (Exception e) {}
        try {
            byte[] sigData = loadImageBytes("public/images/signature.png", "/static/images/signature.png");
            if (sigData != null) {
                try (InputStream sigStream = new java.io.ByteArrayInputStream(sigData)) {
                    rSig.addPicture(sigStream, XWPFDocument.PICTURE_TYPE_PNG, "signature.png", 571500, 381000);
                }
            }
        } catch (Exception e) {}

        XWPFParagraph pName = doc.createParagraph();
        XWPFRun rName = pName.createRun();
        rName.setFontFamily("Cambria");
        rName.setFontSize(11);
        rName.setBold(true);
        rName.setText(data.getOrDefault("signatoryName", ""));
        rName.addBreak();
        
        XWPFRun rDesg = pName.createRun();
        rDesg.setFontFamily("Cambria");
        rDesg.setFontSize(11);
        rDesg.setText(data.getOrDefault("signatoryDesignation", ""));
        
        if (showPlace) {
            rDesg.addBreak();
            rDesg.setText("Date: " + data.getOrDefault("date", ""));
            rDesg.addBreak();
            rDesg.setText("Place: " + data.getOrDefault("place", "Nashik"));
        }
    }

    private void addParagraph(XWPFDocument doc, String text, boolean bold, int size, ParagraphAlignment align) {
        XWPFParagraph p = doc.createParagraph();
        p.setAlignment(align);
        XWPFRun r = p.createRun();
        r.setText(text);
        r.setBold(bold);
        r.setFontSize(size);
        r.setFontFamily("Cambria");
    }

    // --- DOCX PAGE IMPLEMENTATIONS ---
    private void writeDoc1(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "BID FORM", true);
        writeAddressBlock(doc, data);
        writeSubjectRef(doc, "Bid Form", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We, the undersigned have examined the above mentioned bidding document, including amendment/ corrigendum (if any), the receipt of which is hereby confirmed. We now offer to supply and deliver " + data.getOrDefault("productDescription", "") + " in conformity with your above referred document for the sum as shown in the Price Schedules attached herewith and made part of this bid. If our bid is accepted, we undertake to supply the goods and perform the services as mentioned in the bidding documents, in accordance with the delivery schedule specified in the List of Requirements.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We further confirm that, if our bid is accepted, we shall provide you with a performance security of required amount in an acceptable form in terms of \"General Conditions Contract\" read with modification, if any \"Special Conditions of Contract\", in Section - V and all other terms and conditions as mentioned in bidding document for due performance of the contract.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We agree to keep our bid valid for acceptance as required in the \"General Instruction to Bidders\", read with modification, if any in \"Special Instructions to Bidders\" or for subsequently extended period, if any, agreed to by us. We also accordingly confirm to abide by this bid up to the aforesaid period and this bid may be accepted any time before the expiry of the aforesaid period. We further confirm that, until a formal contract is executed, this bid read with your written acceptance thereof within the aforesaid period shall constitute a binding contract between us.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We further understand that you are not bound to accept the lowest or any bid you may receive against your above-referred advertised tender enquiry.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We confirm that we do not stand deregistered/banned/blacklisted by any Central Govt. Ministries/Departments/Hospitals/Institutes.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We confirm that we fully agree to the terms and conditions specified in the above mentioned bid document, including amendment/ corrigendum if any.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "\"We hereby certify that if at any time, information furnished by us is proved to be false or incorrect, we are liable for any action as deemed fit by the purchaser in addition to forfeiture of the bid security.\"", true, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc2(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "BID SECURITY DECLARATION FORM", true);
        addParagraph(doc, "(Rule 170 of General Financial Rule 2017)", true, 10, ParagraphAlignment.CENTER);
        writeAddressBlock(doc, data);
        writeSubjectRef(doc, "Bid Security Declaration Form", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We the undersigned declare that;", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We accept that we may be suspended to submit bids for contract(s) with you for a period of Six (06) months from the date of bid opening if we are in a breach of any obligation under the bid conditions, because We:", false, 11, ParagraphAlignment.BOTH);
        
        addParagraph(doc, "  a) have withdrawn/modified our bid during the period of bid validity specified in the form of bid; or", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "  b) having been notified of the acceptance of our bid by the purchaser during the period of bid validity", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "  c) fail or refuse to execute the contract, or", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "  d) Fail or refuse to submit the Performance Security of the amount specified in the bid.", false, 11, ParagraphAlignment.LEFT);
        
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc3(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "BIDDER PARTICULARS", false);
        
        XWPFTable table = doc.createTable();
        table.setWidth("100%");
        
        String[][] tableData = {
            {"Sr. No.", "Particulars", "Details"},
            {"1.", "Name of the Bidder", "M/s. " + data.getOrDefault("companyName", "")},
            {"2.", "Address of the Bidder", data.getOrDefault("companyAddress", "")},
            {"3.", "Name of the Manufacturer", "M/s. " + data.getOrDefault("manufacturerName", "")},
            {"4.", "Address of the Manufacturer", data.getOrDefault("manufacturerAddress", "")},
            {"5.", "Name and address of the person to whom all references shall be made regarding this tender inquiry:", "Name: Mr. " + data.getOrDefault("signatoryName", "") + "\nAddress: " + data.getOrDefault("signatoryAddress", "")},
            {"6.", "Telephone", data.getOrDefault("companyContact", "")},
            {"7.", "Telex", "NA"},
            {"8.", "Fax", "NA"},
            {"9.", "Email address", data.getOrDefault("companyEmail", "")},
            {"10.", "Witness", data.getOrDefault("witnessDetails", "")}
        };

        for (int i = 0; i < tableData.length; i++) {
            XWPFTableRow row = (i == 0) ? table.getRow(0) : table.createRow();
            row.getCell(0).setText(tableData[i][0]);
            
            XWPFTableCell cell1 = (row.getTableCells().size() > 1) ? row.getCell(1) : row.addNewTableCell();
            cell1.setText(tableData[i][1]);
            
            XWPFTableCell cell2 = (row.getTableCells().size() > 2) ? row.getCell(2) : row.addNewTableCell();
            cell2.setText(tableData[i][2]);
            
            if (i == 0) {
                row.getCell(0).getParagraphs().get(0).getRuns().get(0).setBold(true);
                cell1.getParagraphs().get(0).getRuns().get(0).setBold(true);
                cell2.getParagraphs().get(0).getRuns().get(0).setBold(true);
            }
        }

        addParagraph(doc, "\nThanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc4(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "DECLARATION CERTIFICATE FOR LOCAL CONTENT", false);
        addParagraph(doc, "This declaration must form part of all tenders & it contains general information and serves as a declaration form for all bidders. (Before completing this declaration, bidders must study the General Conditions, Definitions, Govt. Directives applicable in respect of Local Content & prescribed tender conditions).", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "LOCAL CONTENT DECLARATION BY CHIEF FINANCIAL OFFICER OR OTHER LEGALLY RESPONSIBLE PERSON NOMINATED IN WRITING BY THE CHIEF EXECUTIVE OR SENIOR MEMBER/PERSON WITH MANAGEMENT RESPONSIBILITY (CORPORATION, PARTNERSHIP OR INDIVIDUAL)", true, 10, ParagraphAlignment.CENTER);
        addParagraph(doc, "IN RESPECT OF BID / TENDER No.: " + data.getOrDefault("bidNumber", "") + ", Date. " + data.getOrDefault("bidDate", "") + ".", true, 11, ParagraphAlignment.CENTER);
        addParagraph(doc, "Issued By: M/s. " + data.getOrDefault("companyName", "") + " .", true, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "NB: The obligation to complete, duly sign and submit his declaration cannot be transferred to an external authorized representative, auditor or any other third party acting on behalf of the bidder.", true, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "I, the undersigned, " + data.getOrDefault("signatoryName", "") + " do hereby declare, in my capacity as " + data.getOrDefault("signatoryDesignation", "") + " of M/s. " + data.getOrDefault("companyName", "") + " the following:", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "a. The facts contained herein are within my own personal knowledge.\n" +
                           "b. I have read and understood the requirement of local content (LC) and same is specified as percentage calculated in accordance with the definition provided at clause 2 of revised Public Procurement (preference to Make in India) Order 2017.\n" +
                           "\"Local content\" as per above order means the amount of value added in India which shall be the total value of items procured (excluding net domestic indirect taxes) minus the value of imported content in the item (including all customs duties) as a proportion of the total value in percent.\n" +
                           "c. I have satisfied myself that the goods/services/works to be delivered in terms of the above-specified bid comply with the local content requirements as specified in the tender for 'Class-I Local Supplier' / 'Class-II Local Supplier', and as above.\n" +
                           "d. I understand that a bidder can seek benefit of either Public Procurement Policy for MSEs -Order 2012 or Public Procurement (preference to Make in India) Order 2017 and not both and once the option is declared / selected it is not permitted to be modified subsequently. Accordingly, I seek the benefit from the below declared purchase preference policy only.", false, 11, ParagraphAlignment.BOTH);

        boolean isMsme = "PPP MSME Order 2012".equalsIgnoreCase(data.get("preferencePolicy"));
        addParagraph(doc, (isMsme ? "[x] " : "[ ] ") + "1) PPP MSME Order 2012 (applicable for MSE manufacturers)", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, (!isMsme ? "[x] " : "[ ] ") + "2) PPP MII 2017 (applicable for Class I suppliers as well as MSE manufacturers)", false, 11, ParagraphAlignment.LEFT);

        XWPFTable table = doc.createTable();
        table.setWidth("100%");
        XWPFTableRow header = table.getRow(0);
        header.getCell(0).setText("Tender No");
        header.addNewTableCell().setText("Local Content Calculated as above %");
        header.addNewTableCell().setText("Location of Local Value Addition");
        header.getCell(0).getParagraphs().get(0).getRuns().get(0).setBold(true);
        header.getCell(1).getParagraphs().get(0).getRuns().get(0).setBold(true);
        header.getCell(2).getParagraphs().get(0).getRuns().get(0).setBold(true);

        XWPFTableRow row = table.createRow();
        row.getCell(0).setText(data.getOrDefault("bidNumber", ""));
        row.getCell(1).setText(data.getOrDefault("localContentPercentage", ""));
        row.getCell(2).setText(data.getOrDefault("localContentLocation", data.getOrDefault("companyAddress", "")));

        addParagraph(doc, "\nf. I accept that the Procurement Authority / Institution / MDL / Nodal Ministry has the right to request that the local content be verified in terms of the requirements of revised Public Procurement (preference to Make in India) Order 2017 dtd.16.09.2020 and I shall furnish the document / information on demand. Failure on my part to furnish the data will be treated as false declaration as per PPP MII Order 2017. In case of contract being awarded, I undertake to retain the relevant documents for 7 years from date of execution.\n" +
                           "g. I understand that the submission of incorrect data, or data that are not verifiable as described in revised Public Procurement (preference to Make in India) Order 2017, may result in the Procurement Authority / Nodal Ministry/ MDL imposing any or all of the remedies as provided for in Clause 9 of the Revised Public Procurement (preference to Make in India) Order 2017 dated 16.09.2020.", false, 11, ParagraphAlignment.BOTH);

        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, true);
    }

    private void writeDoc5(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "DECLARATION FOR AVAILABILITY OF SPARE PARTS", true);
        writeAddressBlock(doc, data);
        String sparesPeriod = data.getOrDefault("sparesAvailabilityPeriod", "Ten (10) years");
        writeSubjectRef(doc, "Declaration for Availability of Spare Parts up to " + sparesPeriod + ".", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We certify that the equipment being/quoted is the latest model and that spares for the equipment will be available for a period of at least " + sparesPeriod + " and we also guarantee that we will keep the organization informed of any update of the equipment over a period of " + sparesPeriod + ".", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc6(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "DECLARATION FOR CERTIFICATE OF COUNTRY OF ORIGIN", true);
        writeAddressBlock(doc, data);
        writeSubjectRef(doc, "Declaration for Certificate of Country of Origin", data, "Origin Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We " + data.getOrDefault("companyName", "") + " introduce ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Equipment's and Hospital Furniture would like to inform you that the quoted product " + data.getOrDefault("productDescription", "") + " is manufactured by us and we are Self-Manufacturer of the same. This product is made entirely in our Company using the raw materials available in India.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We ensure that no foreign raw materials are used in our manufactured products.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "However, we assure you that the products we manufacture are entirely Indian made and that we are the Original Equipment's Manufacture (OEM) of the original products.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc7(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "DECLARATION FOR DEMONSTRATION", true);
        writeAddressBlock(doc, data);
        writeSubjectRef(doc, "Declaration for Demonstration", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We M/s. " + data.getOrDefault("companyName", "") + " having registered office at " + data.getOrDefault("companyAddress", "") + ".", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We, the undersigned, hereby declare our commitment to arranging a demonstration of our product at our own expense. We understand the importance of showcasing the features and capabilities of our product to your satisfaction.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Terms of the Declaration:", true, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "• Demo Arrangement: We commit to organizing and conducting a comprehensive demonstration of our product as per your requirements.\n" +
                           "• Cost Coverage: All expenses related to the demonstration, including travel, accommodation, and any other associated costs, will be borne entirely by us.\n" +
                           "• Location and Timing: We are flexible and willing to conduct the demo at a location of your choice. We will coordinate with your team to determine a suitable date and time for the demonstration.\n" +
                           "• Customization: If there are specific aspects or features you wish to focus on during the demo, please communicate them in advance so that we can tailor our presentation to meet your needs.\n" +
                           "• Feedback and Adjustments: We welcome any feedback you may have during or after the demonstration. If there are areas that require further clarification or adjustments, we commit to addressing them promptly.", false, 11, ParagraphAlignment.BOTH);
        
        addParagraph(doc, "\nBy signing this declaration, both parties affirm their understanding and agreement to the terms outlined herein. We look forward to the opportunity to showcase our product and demonstrate how it can meet and exceed your expectations.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc8(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "TO WHOM SO EVER IT MAY CONCERN", true);
        writeSubjectRef(doc, "Declaration on Non-Blacklisting / Debarring", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We M/s. " + data.getOrDefault("companyName", "") + " having registered office at " + data.getOrDefault("companyAddress", "") + ". Hereby declare that our firm has not been found guilty of malpractice, misconduct, or blacklisted/debarred either by the Public Health Department, Government of Maharashtra, and all State Governments or by any local authority and other State Government/Central Government's Organizations in the past three years.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We take great pride in maintaining a high standard of ethical conduct and compliance with all applicable regulations. Our commitment to integrity and professionalism is reflected in our business practices, and we strive to uphold the trust placed in us by our clients and stakeholders.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc9(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "UNDERTAKING FOR WARRANTY", true);
        writeAddressBlock(doc, data);
        String warranty = data.getOrDefault("warrantyPeriod", "Five (5) years");
        writeSubjectRef(doc, "Undertaking for Warranty", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We, M/s " + data.getOrDefault("companyName", "") + " ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Equipment's and Hospital Furniture do hereby guarantee and warranty all work performed as part of the bid for a period of " + warranty + " from the date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We fully understand and acknowledge the importance of the warranty duration in meeting your requirements. Our commitment to providing a " + warranty + " warranty reflects our confidence in the quality and durability of our products. This undertaking is a testament to our dedication to customer satisfaction and our assurance of the reliability of our offerings.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We are more than willing to address any queries and provide the necessary clarifications.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc10(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "ACCEPTANCE OF TENDER TERMS AND CONDITIONS", true);
        writeAddressBlock(doc, data);
        writeSubjectRef(doc, "Acceptance of Tender Terms and Conditions as per Bid.", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "1. We have downloaded/obtained the tender documents for the above mentioned bid in reference to Supply & Installation of Equipment's from the web site namely GeM Portal.\n" +
                           "2. We hereby certify that we have reviewed entire terms and conditions of the tender documents (including all documents like annexure, schedules, etc., which is form part of the Contract Agreement and we shall abide hereby to the terms / conditions / Warranty / CMC / Delivery / Clauses contained therein.\n" +
                           "3. The corrigendum(s) issued from time to time by your department / organization also has been taken into consideration, while submitting this acceptance letter.\n" +
                           "4. We hereby unconditionally accept the tender conditions of above mentioned tender and its corrigendum(s) in totality / entirely.\n" +
                           "5. In case any provision of this bid / tender are found violated, your department / organization shall be at liberty to reject this and we shall not have any claim/ right against the department in satisfaction of this condition.", false, 11, ParagraphAlignment.BOTH);
        
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc11(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "TO WHOM SO EVER IT MAY CONCERN", true);
        writeSubjectRef(doc, "Price Declaration", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We M/s. " + data.getOrDefault("companyName", "") + " having registered office at " + data.getOrDefault("companyAddress", "") + ". hereby declare that the rates quoted in the tender " + data.getOrDefault("productDescription", "") + " are not higher than the rates quoted to other Government Departments/Government Undertakings or any prevailing contracts, and they are not higher than the Maximum Retail Price (MRP).", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We assure that our pricing is fair, competitive, and in compliance with all applicable regulations. The rates provided in this tender are consistent with our pricing practices across various government entities and ongoing contracts.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "If required, we are willing to provide any additional documentation or evidence to substantiate this declaration.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc12(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "UNDERTAKING FOR FINANCIAL STANDING", true);
        writeAddressBlock(doc, data);
        writeSubjectRef(doc, "Undertaking for Financial Standing", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We, M/s. " + data.getOrDefault("companyName", "") + ", represented by the company, located at " + data.getOrDefault("companyAddress", "") + ", hereby provide the following undertaking regarding our financial standing:\n" +
                           "Business Nature: We are established and reputable indigenous manufacturers of Medical Equipment's and Hospital Furniture.\n" +
                           "Location: Our manufacturing facilities are situated at " + data.getOrDefault("companyAddress", "") + ".", false, 11, ParagraphAlignment.BOTH);
        
        addParagraph(doc, "Financial Standing: We declare that, to the best of our knowledge and belief, as of the date of this undertaking:", true, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "  a. We are not under liquidation, court receivership, or any similar proceedings.\n" +
                           "  b. We are not bankrupt.", false, 11, ParagraphAlignment.LEFT);
        
        addParagraph(doc, "Commitment: We undertake to promptly inform the concerned parties if there are any changes in our financial standing during any agreements or contracts.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Accuracy of Information: The information provided in this undertaking is true and accurate to the best of our knowledge, and we understand the legal consequences of providing false information.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We hereby affix our signature and company seal to confirm the authenticity of this undertaking.", false, 11, ParagraphAlignment.BOTH);
        
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc13(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "UNDERTAKING FOR WARRANTY", true);
        writeAddressBlock(doc, data);
        writeSubjectRef(doc, "Undertaking for Warranty", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We, M/s " + data.getOrDefault("companyName", "") + " ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Cold chain Equipment's do hereby guarantee and warranty all work performed as part of the bid for a period of as per bid terms from the date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We hereby undertake that the " + data.getOrDefault("productDescription", "") + " supplied by us shall carry a warranty period of " + data.getOrDefault("warrantyPeriod", "Five (5) years") + " from the date of final acceptance of goods.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "In addition, we commit to providing an on-site service support for a further " + data.getOrDefault("serviceSupportPeriod", "Five (5) years") + " beyond the warranty period.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "We also confirm that spare parts and necessary accessories for the said equipment shall remain available for a minimum period of " + data.getOrDefault("sparesAvailabilityPeriod", "Ten (10) years") + " from the date of installation.", false, 11, ParagraphAlignment.BOTH);
        addParagraph(doc, "Thanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc14(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "DETAILS OF AFTER SALES SERVICE STATION", false);
        
        XWPFTable table = doc.createTable();
        table.setWidth("100%");
        
        String[] headers = {"Sr. No.", "City & State", "Full Address with Pin code", "Contact Person Name", "Email ID", "Mobile No."};
        XWPFTableRow rowHeader = table.getRow(0);
        for (int i = 0; i < headers.length; i++) {
            XWPFTableCell cell = (i == 0) ? rowHeader.getCell(0) : rowHeader.addNewTableCell();
            cell.setText(headers[i]);
            cell.getParagraphs().get(0).getRuns().get(0).setBold(true);
        }

        String[][] serviceCenters = {
            {"1", "( H.O.) Nashik, Maharashtra.", "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007 Maharashtra", "Mr. Sachin Shisode,\nMr. Shridhar Shigare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "8390900347\n9011104332"},
            {"2.", "Mumbai, Maharashtra.", "410 , 4th floor, Maker Chamber V, Nariman point, Mumbai 400021 Maharashtra", "Mr. Shridhar Shingare,\nMr. Sachin Shisode,", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "9011104332\n8390900347"},
            {"3", "South Delhi.", "Office No.515, 5th Floor, Tower-DLF, Jasola-110025 South Delhi", "Mr. Vinit Sharma,\nMr. Shridhar Shingare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "8527027321\n9011104332"},
            {"4", "Ambala, Haryana.", "B. Block 3031 CCC Zirakpur, Chandigarh-140603 Haryana", "Mr. Deepak Pawaiya,\nMr. Shridhar Shingare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "9175550259\n9011104332"},
            {"5", "Jaipur, Rajasthan.", "Plot No.438, Vivek Vihar Colony, New Sanganer Road, Sodala. Jaipur - 302001, Rajasthan", "Mr. Devendra Hire,\nMr. Shridhar Shingare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "8208463830\n9011104332"},
            {"6", "Lucknow, Uttar Pradesh.", "14 - Manas nagar colony, Jiamau, Hazratganj, Opp. RTD, DGP Jagmohan Yadav Residency, Lucknow – 226001 Uttar Pradesh.", "Mr. Anil Aher,\nMr. Shridhar Shingare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "9146489605\n9011104332"},
            {"7", "Hyderabad, Telangana.", "P NO.478, Lane Number 4 IDA Cherlapally, Hyderabad, Medchal Malkajgiri-500051 Telangana", "Mr. Chandu,\nMr. Shridhar Shingare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "9000959574\n9011104332"},
            {"8.", "Trivandrum, Kerala", "Dot Space Business Center, Opp. Tennis Club, Kowdiar, Devasomboard Road, Trivandrum-695003 Kerala", "Meera Budhan\nMr. Shridhar Shingare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "8589999138\n9011104332"},
            {"9.", "Ahmedabad, Gujarat.", "Pulse Biomed LLP,\nA314, Advance Business Park, Shahibag, Ahmedabad-380004 Gujarat", "Paresh Sohni\nMr. Shridhar Shingare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "9898081574\n9011104332"},
            {"10", "Gandhinagar\nGujarat.", "SEVAMED SOLUTIONS PRIVATE LIMITED\nShop 505, 5th Floor, East Wing, Siddharaj Z2, Kudasan, Gandhinagar. 382421", "Mr. Shridhar Shingare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "9146115073\n9011104332"},
            {"11", "Kolkata, West\nBengal.", "P Bhogilal Pvt Ltd, 117b, Chittaranjan Avenue, Central Avenue, Kolkata - 700073 West Bengal", "Mr. Nilesh Mehta\nMr. Shridhar Shigare", "support@markenworld.com,\ninfo@markenworld.com,\ntender@markenworld.com.", "9175559646\n9011104332"}
        };

        for (int i = 0; i < serviceCenters.length; i++) {
            XWPFTableRow r = table.createRow();
            for (int j = 0; j < 6; j++) {
                XWPFTableCell cell = r.getCell(j);
                String cellText = serviceCenters[i][j];
                if (cellText.contains("\n")) {
                    String[] lines = cellText.split("\n");
                    XWPFParagraph p = cell.getParagraphs().get(0);
                    p.setSpacingAfter(0);
                    XWPFRun run = p.createRun();
                    for (int k = 0; k < lines.length; k++) {
                        run.setText(lines[k]);
                        if (k < lines.length - 1) {
                            run.addBreak();
                        }
                    }
                } else {
                    cell.setText(cellText);
                }
            }
        }

        addParagraph(doc, "\nThanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    private void writeDoc15(XWPFDocument doc, Map<String, String> data) {
        writeHeader(doc, data, "ESCALATION MATRIX FOR SERVICE SUPPORT", true);
        writeAddressBlock(doc, data);
        writeSubjectRef(doc, "Escalation Matrix for Service Support", data, "Reference");
        
        addParagraph(doc, "Dear Sir/Madam,", false, 11, ParagraphAlignment.LEFT);
        addParagraph(doc, "We hereby submit the Escalation Matrix with Telephone Numbers for Service Support for our quoted product as under:", false, 11, ParagraphAlignment.BOTH);

        XWPFTable table = doc.createTable();
        table.setWidth("100%");
        
        String[] headers = {"Sr. No", "Name of Responsible Person", "Designation", "Triggers When", "Contact Number", "Email ID’s"};
        XWPFTableRow rowHeader = table.getRow(0);
        for (int i = 0; i < headers.length; i++) {
            XWPFTableCell cell = (i == 0) ? rowHeader.getCell(0) : rowHeader.addNewTableCell();
            cell.setText(headers[i]);
            cell.getParagraphs().get(0).getRuns().get(0).setBold(true);
        }

        String[][] matrix = {
            {"1.", "Mr. Sanjay Sadade", "General Manager", "Administration", "09225126772", "support@markenworld.com"},
            {"2.", "Mr. Shridhar Shingare", "Tender Manager", "Institution Business Division", "09011104332", "info@markenworld.com"},
            {"3.", "Mr. Eknath Mandal", "Production Manager", "Delays / Technical Error", "09225102371", "support@markenworld.com"},
            {"4.", "Mr. Sachin Shisode", "Service Head", "Servicing Delay", "08390900347", "support@markenworld.com"}
        };

        for (int i = 0; i < matrix.length; i++) {
            XWPFTableRow r = table.createRow();
            for (int j = 0; j < 6; j++) {
                r.getCell(j).setText(matrix[i][j]);
            }
        }

        addParagraph(doc, "\nThanking you and assuring you of our best services at all the times.", false, 11, ParagraphAlignment.LEFT);
        writeSignatoryBlock(doc, data, false);
    }

    // --- HTML TEMPLATES ASSEMBLY FOR PDF ---
    public String generateHtmlTemplates(Map<String, String> rawData) {
        Map<String, String> data = new java.util.HashMap<>();
        for (Map.Entry<String, String> entry : rawData.entrySet()) {
            data.put(entry.getKey(), escapeHtml(entry.getValue()));
        }
        String logoBase64 = "";
        String partnerBase64 = "";
        String stampBase64 = "";
        String sigBase64 = "";
        
        try {
            byte[] logoBytes = Files.readAllBytes(Paths.get("public/images/logo.png"));
            logoBase64 = "data:image/png;base64," + Base64.getEncoder().encodeToString(logoBytes);
        } catch (Exception e) {}
        try {
            byte[] partnerBytes = Files.readAllBytes(Paths.get("public/images/partner.png"));
            partnerBase64 = "data:image/png;base64," + Base64.getEncoder().encodeToString(partnerBytes);
        } catch (Exception e) {}
        try {
            byte[] stampBytes = Files.readAllBytes(Paths.get("public/images/stamp.png"));
            stampBase64 = "data:image/png;base64," + Base64.getEncoder().encodeToString(stampBytes);
        } catch (Exception e) {}
        try {
            byte[] sigBytes = Files.readAllBytes(Paths.get("public/images/signature.png"));
            sigBase64 = "data:image/png;base64," + Base64.getEncoder().encodeToString(sigBytes);
        } catch (Exception e) {}

        String addr1 = data.getOrDefault("companyAddress", "");
        String addr2 = "";
        if (addr1.contains("MIDC Satpur,")) {
            String[] parts = addr1.split("MIDC Satpur,");
            addr1 = parts[0] + "MIDC Satpur,";
            if (parts.length > 1) addr2 = parts[1].trim();
        } else {
            String[] commas = addr1.split(",");
            if (commas.length > 3) {
                StringBuilder sb1 = new StringBuilder();
                StringBuilder sb2 = new StringBuilder();
                for (int i = 0; i < commas.length; i++) {
                    if (i < 4) {
                        sb1.append(commas[i]).append(",");
                    } else {
                        sb2.append(commas[i]).append(",");
                    }
                }
                addr1 = sb1.toString();
                addr2 = sb2.toString().trim();
                if (addr2.endsWith(",")) addr2 = addr2.substring(0, addr2.length() - 1);
            }
        }

        String sparesPeriod = data.getOrDefault("sparesAvailabilityPeriod", "Ten (10) years");
        String warranty = data.getOrDefault("warrantyPeriod", "Five (5) years");
        String serviceSupport = data.getOrDefault("serviceSupportPeriod", "Five (5) years");
        boolean isMsme = "PPP MSME Order 2012".equalsIgnoreCase(data.get("preferencePolicy"));

        // Build address block HTML
        String authorityDept = data.getOrDefault("authorityDept", "").trim();
        String authorityName = data.getOrDefault("authorityName", "").trim();
        String authorityAddress = data.getOrDefault("authorityAddress", "").trim();

        StringBuilder addrHtml = new StringBuilder();
        addrHtml.append("<div class=\"address-block\">To,<br/>");
        if (!authorityName.isEmpty()) addrHtml.append("<span class=\"highlight-yellow\">").append(authorityName).append("</span><br/>");
        if (!authorityDept.isEmpty() && !authorityDept.equalsIgnoreCase(authorityName)) {
            addrHtml.append("<span class=\"highlight-yellow\">").append(authorityDept).append("</span><br/>");
        }
        if (!authorityAddress.isEmpty()) addrHtml.append("<span class=\"highlight-yellow\">").append(authorityAddress).append("</span><br/>");
        addrHtml.append("</div>");

        // Helper to format subject tables
        String sparesYears = extractYearsNumber(sparesPeriod);
        String subjectRefBidForm = renderSubjectRef("Bid Form", data);
        String subjectRefBidSecurity = renderSubjectRef("Bid Security Declaration Form", data);
        String subjectRefLocalContent = renderSubjectRef("Declaration Certificate for Local Content", data);
        String subjectRefSpares = renderSubjectRef("Declaration for Availability of Spare Parts up to <span class=\"highlight-yellow\">" + sparesYears + " Years</span>.", data);
        String subjectRefOrigin = renderSubjectRef("Declaration for Certificate of Country of Origin", data);
        String subjectRefDemo = renderSubjectRef("Declaration for Demonstration", data);
        String subjectRefBlacklist = renderSubjectRef("Declaration on Non-Blacklisting / Debarring", data);
        String subjectRefWarranty = renderSubjectRef("Undertaking for Warranty", data);
        String subjectRefAcceptance = renderSubjectRef("Acceptance of Tender Terms and Conditions as per Bid.", data);
        String subjectRefPrice = renderSubjectRef("Price Declaration", data);
        String subjectRefFinancial = renderSubjectRef("Undertaking for Financial Standing", data);
        String subjectRefEscalation = renderSubjectRef("Escalation Matrix for Service Support", data);

        // Signatory block
        String sigBlock = renderSignatoryBlock(data, stampBase64, sigBase64, false);
        String sigBlockWithPlace = renderSignatoryBlock(data, stampBase64, sigBase64, true);

        // Individual Documents Content HTML
        StringBuilder docsHtml = new StringBuilder();

        // 1. BID FORM
        docsHtml.append(wrapPage(true, "page-doc-1", data, logoBase64, partnerBase64, addr1, addr2, "BID FORM", 
            addrHtml.toString() + subjectRefBidForm + 
            "<p>Dear Sir/Madam,</p>" +
            "<p class=\"justify\">We, the undersigned have examined the above mentioned bidding document, including amendment/ corrigendum (if any), the receipt of which is hereby confirmed. We now offer to supply and deliver <strong>" + highlightProductDescription(data.getOrDefault("productDescription", "")) + "</strong> in conformity with your above referred document for the sum as shown in the Price Schedules attached herewith and made part of this bid. If our bid is accepted, we undertake to supply the goods and perform the services as mentioned in the bidding documents, in accordance with the delivery schedule specified in the List of Requirements.</p>" +
            "<p class=\"justify\">We further confirm that, if our bid is accepted, we shall provide you with a performance security of required amount in an acceptable form in terms of “General Conditions Contract” read with modification, if any “Special Conditions of Contract”, in Section – V and all other terms and conditions as mentioned in bidding document for due performance of the contract.</p>" +
            "<p class=\"justify\">We agree to keep our bid valid for acceptance as required in the “General Instruction to Bidders”, read with modification, if any in “Special Instructions to Bidders” or for subsequently extended period, if any, agreed to by us. We also accordingly confirm to abide by this bid up to the aforesaid period and this bid may be accepted any time before the expiry of the aforesaid period. We further confirm that, until a formal contract is executed, this bid read with your written acceptance thereof within the aforesaid period shall constitute a binding contract between us.</p>" +
            "<p class=\"justify\">We further understand that you are not bound to accept the lowest or any bid you may receive against your above-referred advertised tender enquiry.</p>" +
            "<p class=\"justify\">We confirm that we do not stand deregistered/banned/blacklisted by any Central Govt. Ministries/Departments/Hospitals/Institutes.</p>" +
            "<p class=\"justify\">We confirm that we fully agree to the terms and conditions specified in the above mentioned bid document, including amendment/ corrigendum if any.</p>" +
            "<p class=\"justify font-bold\">“We hereby certify that if at any time, information furnished by us is proved to be false or incorrect, we are liable for any action as deemed fit by the purchaser in addition to forfeiture of the bid security.”</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 2. BID SECURITY DECLARATION FORM
        docsHtml.append(wrapPage(true, "page-doc-2", data, logoBase64, partnerBase64, addr1, addr2, "BID SECURITY DECLARATION FORM",
            "<p style=\"text-align: center; font-weight: bold; font-size: 10pt; margin-top: -10px; margin-bottom: 20px;\">(Rule 170 of General Financial Rule 2017)</p>" +
            addrHtml.toString() + subjectRefBidSecurity +
            "<p>Dear Sir/Madam,</p>" +
            "<p>We the undersigned declare that;</p>" +
            "<p>We accept that we may be suspended to submit bids for contract(s) with you for a period of Six (06) months from the date of bid opening if we are in a breach of any obligation under the bid conditions, because We:</p>" +
            "<p style=\"margin-left: 20px; text-indent: -20px;\">a) have withdrawn/modified our bid during the period of bid validity specified in the form of bid; or</p>" +
            "<p style=\"margin-left: 20px; text-indent: -20px;\">b) having been notified of the acceptance of our bid by the purchaser during the period of bid validity</p>" +
            "<p style=\"margin-left: 20px; text-indent: -20px;\">c) fail or refuse to execute the contract, or</p>" +
            "<p style=\"margin-left: 20px; text-indent: -20px;\">d) Fail or refuse to submit the Performance Security of the amount specified in the bid.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 3. BIDDER PARTICULARS
        docsHtml.append(wrapPage(false, "page-doc-3", data, logoBase64, partnerBase64, addr1, addr2, "BIDDER PARTICULARS",
            "<table class=\"bordered-table bidder-particulars-table\">" +
            "  <thead><tr><th width=\"8%\">Sr. No.</th><th width=\"37%\">Particulars</th><th width=\"55%\">Details</th></tr></thead>" +
            "  <tbody>" +
            "    <tr><td style=\"font-weight: bold;\">1.</td><td>Name of the Bidder</td><td style=\"font-weight: bold;\">M/s. " + data.getOrDefault("companyName", "") + "</td></tr>" +
            "    <tr><td style=\"font-weight: bold;\">2.</td><td>Address of the Bidder</td><td style=\"font-weight: bold;\">" + data.getOrDefault("companyAddress", "") + "</td></tr>" +
            "    <tr><td style=\"font-weight: bold;\">3.</td><td>Name of the Manufacturer</td><td style=\"font-weight: bold;\">M/s. " + data.getOrDefault("manufacturerName", "") + "</td></tr>" +
            "    <tr><td style=\"font-weight: bold;\">4.</td><td>Address of the Manufacturer</td><td style=\"font-weight: bold;\">" + data.getOrDefault("manufacturerAddress", "") + "</td></tr>" +
            "    <tr><td style=\"font-weight: bold;\">5.</td><td>Name and address of representative:</td><td style=\"font-weight: bold;\">Name: Mr. " + data.getOrDefault("signatoryName", "") + "<br/>Address: " + data.getOrDefault("signatoryAddress", "") + "</td></tr>" +
            "    <tr><td style=\"font-weight: bold;\">6.</td><td>Telephone</td><td style=\"font-weight: bold;\">" + data.getOrDefault("companyContact", "") + "</td></tr>" +
            "    <tr><td style=\"font-weight: bold;\">7.</td><td>Telex</td><td style=\"font-weight: bold;\">NA</td></tr>" +
            "    <tr><td style=\"font-weight: bold;\">8.</td><td>Fax</td><td style=\"font-weight: bold;\">NA</td></tr>" +
            "    <tr><td style=\"font-weight: bold;\">9.</td><td>Email address</td><td style=\"font-weight: bold;\">" + data.getOrDefault("companyEmail", "") + "</td></tr>" +
            "    <tr><td style=\"font-weight: bold;\">10.</td><td>Witness</td><td style=\"font-weight: bold;\">" + data.getOrDefault("witnessDetails", "") + "</td></tr>" +
            "  </tbody>" +
            "</table>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 4. DECLARATION CERTIFICATE FOR LOCAL CONTENT
        String msmeCheck = isMsme ? "✔" : "&#160;";
        String miiCheck = !isMsme ? "✔" : "&#160;";
        docsHtml.append(wrapPage(false, "page-doc-4", data, logoBase64, partnerBase64, addr1, addr2, "DECLARATION CERTIFICATE FOR LOCAL CONTENT",
            "<p class=\"justify\">This declaration must form part of all tenders &amp; it contains general information and serves as a declaration form for all bidders. (Before completing this declaration, bidders must study the General Conditions, Definitions, Govt. Directives applicable in respect of Local Content &amp; prescribed tender conditions).</p>" +
            "<p style=\"text-align: center; font-weight: bold; font-size: 9.5pt; margin: 15px 0;\">LOCAL CONTENT DECLARATION BY CHIEF FINANCIAL OFFICER OR NOMINATED REPRESENTATIVE</p>" +
            "<p style=\"text-align: center; font-weight: bold; margin-bottom: 15px;\">IN RESPECT OF BID / TENDER No.: <span class=\"highlight-yellow\">" + data.getOrDefault("bidNumber", "") + "</span>, Date. <span class=\"highlight-yellow\">" + data.getOrDefault("bidDate", "") + "</span>.</p>" +
            "<p style=\"font-weight: bold; margin-bottom: 10px;\">Issued By: M/s. " + data.getOrDefault("companyName", "") + " .</p>" +
            "<p class=\"justify font-bold\">NB: The obligation to complete, duly sign and submit his declaration cannot be transferred to an external authorized representative, auditor or any other third party acting on behalf of the bidder.</p>" +
            "<p class=\"justify\">I, the undersigned, " + data.getOrDefault("signatoryName", "") + " do hereby declare, in my capacity as " + data.getOrDefault("signatoryDesignation", "") + " of M/s. " + data.getOrDefault("companyName", "") + " the following:</p>" +
            "<p class=\"justify\">a. The facts contained herein are within my own personal knowledge.</p>" +
            "<p class=\"justify\">b. I have read and understood the requirement of local content (LC) and same is specified as percentage calculated in accordance with the definition provided at clause 2 of revised Public Procurement (preference to Make in India) Order 2017.</p>" +
            "<p class=\"justify\">c. I have satisfied myself that the goods/services/works to be delivered in terms of the above-specified bid comply with the local content requirements as specified in the tender for ‘Class-I Local Supplier’ / ‘Class-II Local Supplier’, and as above.</p>" +
            "<p class=\"justify\">d. I understand that a bidder can seek benefit of either Public Procurement Policy for MSEs –Order 2012 or Public Procurement (preference to Make in India) Order 2017 and not both. Accordingly, I seek the benefit from the below declared purchase preference policy only.</p>" +
            "<p style=\"margin-left: 30px; line-height: 25px;\">1) <strong>PPP MSME Order 2012</strong> <span class=\"checkbox-box\">" + msmeCheck + "</span> (applicable for MSE manufacturers)</p>" +
            "<p style=\"margin-left: 30px; line-height: 25px;\">2) <strong>PPP MII 2017</strong> <span class=\"checkbox-box\">" + miiCheck + "</span> (applicable for Class I suppliers as well as MSE manufacturers)</p>" +
            "<table class=\"bordered-table\">" +
            "  <thead><tr><th>Tender No</th><th>Local Content Calculated %</th><th>Location of Local Value Addition</th></tr></thead>" +
            "  <tbody><tr><td>" + data.getOrDefault("bidNumber", "") + "</td><td style=\"font-weight: bold;\"><span class=\"highlight-orange\">" + data.getOrDefault("localContentPercentage", "") + "</span></td><td>" + data.getOrDefault("localContentLocation", data.getOrDefault("companyAddress", "")) + "</td></tr></tbody>" +
            "</table>" +
            "<p class=\"justify\">f. I accept that the Procurement Authority / Institution / Nodal Ministry has the right to request that the local content be verified in terms of the requirements of revised Public Procurement (preference to Make in India) Order 2017 dtd.16.09.2020. In case of contract being awarded, I undertake to retain the relevant documents for 7 years from date of execution.</p>" +
            "<p class=\"justify\">g. I understand that the submission of incorrect data, or data that are not verifiable, may result in the Procurement Authority / Nodal Ministry imposing any or all of the remedies as provided for in Clause 9 of the Revised Public Procurement (preference to Make in India) Order 2017 dated 16.09.2020.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlockWithPlace
        ));

        // 5. AVAILABILITY OF SPARES
        docsHtml.append(wrapPage(true, "page-doc-5", data, logoBase64, partnerBase64, addr1, addr2, "",
            addrHtml.toString() + subjectRefSpares +
            "<p style=\"margin-top: 40px;\">Dear Sir/Madam,</p>" +
            "<p class=\"justify\">We certify that the equipment being/quoted is the latest model and that spares for the equipment will be available for a period of at least <strong><span class=\"highlight-yellow\">" + sparesYears + "</span></strong> years and we also guarantee that we will keep the organization informed of any update of the equipment over a period of <strong><span class=\"highlight-yellow\">" + sparesYears + "</span></strong> years.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 6. COUNTRY OF ORIGIN
        docsHtml.append(wrapPage(true, "page-doc-6", data, logoBase64, partnerBase64, addr1, addr2, "DECLARATION FOR CERTIFICATE OF COUNTRY OF ORIGIN",
            addrHtml.toString() + subjectRefOrigin +
            "<p>Dear Sir/Madam,</p>" +
            "<p class=\"justify\">We <strong>" + data.getOrDefault("companyName", "") + "</strong> introduce ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Equipment’s and Hospital Furniture would like to inform you that the quoted product <strong>" + highlightProductDescription(data.getOrDefault("productDescription", "")) + "</strong> is manufactured by us and we are Self-Manufacturer of the same. This product is made entirely in our Company using the raw materials available in India.</p>" +
            "<p class=\"justify\">We ensure that no foreign raw materials are used in our manufactured products.</p>" +
            "<p class=\"justify\">However, we assure you that the products we manufacture are entirely Indian made and that we are the Original Equipment’s Manufacture (OEM) of the original products.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 7. DEMONSTRATION
        docsHtml.append(wrapPage(true, "page-doc-7", data, logoBase64, partnerBase64, addr1, addr2, "",
            addrHtml.toString() + subjectRefDemo +
            "<p>Dear Sir/Madam,</p>" +
            "<p class=\"justify\">We M/s. <strong>" + data.getOrDefault("companyName", "") + "</strong> having registered office at <strong>" + data.getOrDefault("companyAddress", "") + ".</strong></p>" +
            "<p class=\"justify\">We, the undersigned, hereby declare our commitment to arranging a demonstration of our product at our own expense. We understand the importance of showcasing the features and capabilities of our product to your satisfaction.</p>" +
            "<p style=\"font-weight: bold; margin-bottom: 8px;\">Terms of the Declaration:</p>" +
            "<p class=\"justify\" style=\"margin-left: 20px; text-indent: -20px;\"><span style=\"font-weight: bold;\">• Demo Arrangement:</span> We commit to organizing and conducting a comprehensive demonstration of our product as per your requirements.</p>" +
            "<p class=\"justify\" style=\"margin-left: 20px; text-indent: -20px;\"><span style=" + "\"font-weight: bold;\">" + "• Cost Coverage:</span> All expenses related to the demonstration, including travel, accommodation, and any other associated costs, will be borne entirely by us.</p>" +
            "<p class=\"justify\" style=\"margin-left: 20px; text-indent: -20px;\"><span style=\"font-weight: bold;\">• Location and Timing:</span> We are flexible and willing to conduct the demo at a location of your choice. We will coordinate with your team to determine a suitable date and time.</p>" +
            "<p class=\"justify\" style=\"margin-left: 20px; text-indent: -20px;\"><span style=\"font-weight: bold;\">• Customization:</span> If there are specific aspects or features you wish to focus on during the demo, please communicate them in advance.</p>" +
            "<p class=\"justify\" style=\"margin-left: 20px; text-indent: -20px;\"><span style=\"font-weight: bold;\">• Feedback and Adjustments:</span> We welcome any feedback you may have during or after the demonstration.</p>" +
            "<p class=\"justify\" style=\"margin-top: 15px;\">By signing this declaration, both parties affirm their understanding and agreement to the terms outlined herein.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 8. NON-BLACKLISTING
        docsHtml.append(wrapPage(true, "page-doc-8", data, logoBase64, partnerBase64, addr1, addr2, "TO WHOM SO EVER IT MAY CONCERN",
            subjectRefBlacklist +
            "<p>Dear Sir/Madam,</p>" +
            "<p class=\"justify\">We M/s. <strong>" + data.getOrDefault("companyName", "") + "</strong> having registered office at <strong>" + data.getOrDefault("companyAddress", "") + ".</strong> Hereby declare that our firm has not been found guilty of malpractice, misconduct, or blacklisted/debarred either by the Public Health Department, Government of Maharashtra, and all State Governments or by any local authority and other State Government/Central Government's Organizations in the past three years.</p>" +
            "<p class=\"justify\">We take great pride in maintaining a high standard of ethical conduct and compliance with all applicable regulations. Our commitment to integrity and professionalism is reflected in our business practices, and we strive to uphold the trust placed in us by our clients and stakeholders.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 9. WARRANTY UNDERTAKING (STANDARD)
        docsHtml.append(wrapPage(true, "page-doc-9", data, logoBase64, partnerBase64, addr1, addr2, "",
            addrHtml.toString() + subjectRefWarranty +
            "<p>Dear Sir/Madam,</p>" +
            "<p class=\"justify\">We, M/s <strong>" + data.getOrDefault("companyName", "") + "</strong> ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Equipment’s and Hospital Furniture do hereby guarantee and warranty all work performed as part of the bid for a period of <strong>" + warranty + "</strong> from the date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.</p>" +
            "<p class=\"justify\">We fully understand and acknowledge the importance of the warranty duration in meeting your requirements. Our commitment to providing a <strong>" + warranty + "</strong> warranty reflects our confidence in the quality and durability of our products.</p>" +
            "<p>We are more than willing to address any queries and provide the necessary clarifications.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 10. ACCEPTANCE OF TENDER TERMS
        docsHtml.append(wrapPage(true, "page-doc-10", data, logoBase64, partnerBase64, addr1, addr2, "",
            addrHtml.toString() + subjectRefAcceptance +
            "<p>Dear Sir/Madam,</p>" +
            "<p style=\"margin-left: 20px; text-indent: -20px;\">1. We have downloaded/obtained the tender documents for the above mentioned bid in reference to Supply &amp; Installation of Equipment’s from the web site namely GeM Portal.</p>" +
            "<p style=\"margin-left: 20px; text-indent: -20px;\">2. We hereby certify that we have reviewed entire terms and conditions of the tender documents (including all documents like annexure, schedules, etc., which is form part of the Contract Agreement and we shall abide hereby to the terms / conditions / Warranty / CMC / Delivery / Clauses contained therein.</p>" +
            "<p style=\"margin-left: 20px; text-indent: -20px;\">3. The corrigendum(s) issued from time to time by your department / organization also has been taken into consideration, while submitting this acceptance letter.</p>" +
            "<p style=\"margin-left: 20px; text-indent: -20px;\">4. We hereby unconditionally accept the tender conditions of above mentioned tender and its corrigendum(s) in totality / entirely.</p>" +
            "<p style=\"margin-left: 20px; text-indent: -20px;\">5. In case any provision of this bid / tender are found violated, your department / organization shall be at liberty to reject this and we shall not have any claim/ right against the department in satisfaction of this condition.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 11. PRICE DECLARATION
        docsHtml.append(wrapPage(true, "page-doc-11", data, logoBase64, partnerBase64, addr1, addr2, "TO WHOM SO EVER IT MAY CONCERN",
            subjectRefPrice +
            "<p>Dear Sir/Madam,</p>" +
            "<p class=\"justify\">We M/s. <strong>" + data.getOrDefault("companyName", "") + "</strong> having registered office at <strong>" + data.getOrDefault("companyAddress", "") + ".</strong> hereby declare that the rates quoted in the tender <strong>" + highlightProductDescription(data.getOrDefault("productDescription", "")) + "</strong> are not higher than the rates quoted to other Government Departments/Government Undertakings or any prevailing contracts, and they are not higher than the Maximum Retail Price (MRP).</p>" +
            "<p class=\"justify\">We assure that our pricing is fair, competitive, and in compliance with all applicable regulations. The rates provided in this tender are consistent with our pricing practices across various government entities and ongoing contracts.</p>" +
            "<p>If required, we are willing to provide any additional documentation or evidence to substantiate this declaration.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 12. FINANCIAL STANDING
        docsHtml.append(wrapPage(true, "page-doc-12", data, logoBase64, partnerBase64, addr1, addr2, "",
            addrHtml.toString() + subjectRefFinancial +
            "<p>Dear Sir/Madam,</p>" +
            "<p class=\"justify\">We, M/s. <strong>" + data.getOrDefault("companyName", "") + "</strong>, represented by the company, located at <strong>" + data.getOrDefault("companyAddress", "") + ",</strong> hereby provide the following undertaking regarding our financial standing:</p>" +
            "<p class=\"justify\" style=\"margin-bottom: 4px;\"><span style=\"font-weight: bold;\">Business Nature:</span> We are established and reputable indigenous manufacturers of Medical Equipment’s and Hospital Furniture.</p>" +
            "<p class=\"justify\" style=\"margin-top: 0; margin-bottom: 12px;\"><span style=\"font-weight: bold;\">Location:</span> Our manufacturing facilities are situated at <strong>" + data.getOrDefault("companyAddress", "") + ".</strong></p>" +
            "<p class=\"justify font-bold\" style=\"margin-bottom: 6px;\">Financial Standing: We declare that, to the best of our knowledge and belief, as of the date of this undertaking:</p>" +
            "<p style=\"margin: 2px 0 2px 20px;\">a. We are not under liquidation, court receivership, or any similar proceedings.</p>" +
            "<p style=" + "\"margin: 2px 0 10px 20px;\"" + ">b. We are not bankrupt.</p>" +
            "<p class=\"justify\"><span style=\"font-weight: bold;\">Commitment:</span> We undertake to promptly inform the concerned parties if there are any changes in our financial standing during any agreements or contracts.</p>" +
            "<p class=\"justify\"><span style=\"font-weight: bold;\">Accuracy of Information:</span> The information provided in this undertaking is true and accurate to the best of our knowledge, and we understand the legal consequences of providing false information.</p>" +
            "<p>We hereby affix our signature and company seal to confirm the authenticity of this undertaking.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 13. SPECIAL WARRANTY
        docsHtml.append(wrapPage(true, "page-doc-13", data, logoBase64, partnerBase64, addr1, addr2, "",
            addrHtml.toString() + subjectRefWarranty +
            "<p>Dear Sir/Madam,</p>" +
            "<p class=\"justify\">We, M/s <strong>" + data.getOrDefault("companyName", "") + "</strong> ourselves as an Established and Reputable, Indigenous Manufacturers of Medical Cold chain Equipment’s do hereby guarantee and warranty all work performed as part of the bid for a period of as per bid terms from the date of supply. We commit to repairing any defective spare parts associated with our work at no additional charges to the product.</p>" +
            "<p class=\"justify\">We hereby undertake that the <strong>" + highlightProductDescription(data.getOrDefault("productDescription", "")) + "</strong> supplied by us shall carry a <strong>warranty period of <span class=\"highlight-orange\">" + warranty + "</span></strong> from the date of final acceptance of goods.</p>" +
            "<p class=\"justify\">In addition, we commit to providing an <strong>on-site service support</strong> for a further <strong><span class=\"highlight-orange\">" + serviceSupport + "</span></strong> beyond the warranty period.</p>" +
            "<p class=\"justify\">We also confirm that <strong>spare parts and necessary accessories</strong> for the said equipment shall remain <strong>available for a minimum period of <span class=\"highlight-orange\">" + sparesPeriod + "</span></strong> from the date of installation.</p>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 14. DETAILS OF AFTER SALES SERVICE STATION
        String placeLower = data.getOrDefault("place", "").toLowerCase();
        String row1Class = (placeLower.contains("nashik")) ? "class=\"highlight-row\"" : "";
        String row2Class = (placeLower.contains("mumbai")) ? "class=\"highlight-row\"" : "";
        String row3Class = (placeLower.contains("delhi")) ? "class=\"highlight-row\"" : "";
        String row4Class = (placeLower.contains("ambala")) ? "class=\"highlight-row\"" : "";
        String row5Class = (placeLower.contains("jaipur")) ? "class=\"highlight-row\"" : "";
        String row6Class = (placeLower.contains("lucknow")) ? "class=\"highlight-row\"" : "";
        String row7Class = (placeLower.contains("hyderabad")) ? "class=\"highlight-row\"" : "";
        String row8Class = (placeLower.contains("trivandrum")) ? "class=\"highlight-row\"" : "";
        String row9Class = (placeLower.contains("ahmedabad")) ? "class=\"highlight-row\"" : "";
        String row10Class = (placeLower.contains("gandhinagar")) ? "class=\"highlight-row\"" : "";
        String row11Class = (placeLower.contains("kolkata")) ? "class=\"highlight-row\"" : "";

        docsHtml.append(wrapPage(false, "page-doc-14", data, logoBase64, partnerBase64, addr1, addr2, "DETAILS OF AFTER SALES SERVICE STATION",
            "<table class=\"bordered-table service-table\">" +
            "  <thead>" +
            "    <tr><th rowspan=\"2\" width=\"6%\">Sr. No.</th><th rowspan=\"2\" width=\"12%\">City &amp; State</th><th rowspan=\"2\" width=\"34%\">Full Address with Pin code</th><th rowspan=\"2\" width=\"18%\">Contact Person Name</th><th colspan=\"2\" width=\"30%\">Contact Numbers with STD Code</th></tr>" +
            "    <tr><th width=\"18%\">Email ID</th><th width=\"12%\">Mobile No.</th></tr>" +
            "  </thead>" +
            "  <tbody>" +
            "    <tr " + row1Class + "><td>1</td><td>( H.O.) Nashik, Maharashtra.</td><td>Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007 Maharashtra</td><td>Mr. Sachin Shisode,<br/>Mr. Shridhar Shigare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>8390900347<br/>9011104332</td></tr>" +
            "    <tr " + row2Class + "><td>2.</td><td>Mumbai, Maharashtra.</td><td>410 , 4th floor, Maker Chamber V, Nariman point, Mumbai 400021 Maharashtra</td><td>Mr. Shridhar Shingare,<br/>Mr. Sachin Shisode,</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>9011104332<br/>8390900347</td></tr>" +
            "    <tr " + row3Class + "><td>3</td><td>South Delhi.</td><td>Office No.515, 5th Floor, Tower-DLF, Jasola-110025 South Delhi</td><td>Mr. Vinit Sharma,<br/>Mr. Shridhar Shingare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>8527027321<br/>9011104332</td></tr>" +
            "    <tr " + row4Class + "><td>4</td><td>Ambala, Haryana.</td><td>B. Block 3031 CCC Zirakpur, Chandigarh-140603 Haryana</td><td>Mr. Deepak Pawaiya,<br/>Mr. Shridhar Shingare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>9175550259<br/>9011104332</td></tr>" +
            "    <tr " + row5Class + "><td>5</td><td>Jaipur, Rajasthan.</td><td>Plot No.438, Vivek Vihar Colony, New Sanganer Road, Sodala. Jaipur - 302001, Rajasthan</td><td>Mr. Devendra Hire,<br/>Mr. Shridhar Shingare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>8208463830<br/>9011104332</td></tr>" +
            "    <tr " + row6Class + "><td>6</td><td>Lucknow, Uttar Pradesh.</td><td>14 - Manas nagar colony, Jiamau, Hazratganj, Opp. RTD, DGP Jagmohan Yadav Residency, Lucknow – 226001 Uttar Pradesh.</td><td>Mr. Anil Aher,<br/>Mr. Shridhar Shingare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>9146489605<br/>9011104332</td></tr>" +
            "    <tr " + row7Class + "><td>7</td><td>Hyderabad, Telangana.</td><td>P NO.478, Lane Number 4 IDA Cherlapally, Hyderabad, Medchal Malkajgiri-500051 Telangana</td><td>Mr. Chandu,<br/>Mr. Shridhar Shingare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>9000959574<br/>9011104332</td></tr>" +
            "    <tr " + row8Class + "><td>8.</td><td>Trivandrum, Kerala</td><td>Dot Space Business Center, Opp. Tennis Club, Kowdiar, Devasomboard Road, Trivandrum-695003 Kerala</td><td>Meera Budhan<br/>Mr. Shridhar Shingare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>8589999138<br/>9011104332</td></tr>" +
            "    <tr " + row9Class + "><td>9.</td><td>Ahmedabad, Gujarat.</td><td><strong>Pulse Biomed LLP,</strong><br/>A314, Advance Business Park, Shahibag, Ahmedabad-380004 Gujarat</td><td>Paresh Sohni<br/>Mr. Shridhar Shingare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>9898081574<br/>9011104332</td></tr>" +
            "    <tr " + row10Class + "><td>10</td><td>Gandhinagar<br/>Gujarat.</td><td><strong>SEVAMED SOLUTIONS PRIVATE LIMITED</strong><br/>Shop 505, 5th Floor, East Wing, Siddharaj Z2, Kudasan, Gandhinagar. 382421</td><td>Mr. Shridhar Shingare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>9146115073<br/>9011104332</td></tr>" +
            "  </tbody>" +
            "</table>"
        ));

        docsHtml.append(wrapPage(false, "page-doc-14", data, logoBase64, partnerBase64, addr1, addr2, "",
            "<table class=\"bordered-table service-table\">" +
            "  <thead>" +
            "    <tr><th rowspan=\"2\" width=\"6%\">Sr. No.</th><th rowspan=\"2\" width=\"12%\">City &amp; State</th><th rowspan=\"2\" width=\"34%\">Full Address with Pin code</th><th rowspan=\"2\" width=\"18%\">Contact Person Name</th><th colspan=\"2\" width=\"30%\">Contact Numbers with STD Code</th></tr>" +
            "    <tr><th width=\"18%\">Email ID</th><th width=\"12%\">Mobile No.</th></tr>" +
            "  </thead>" +
            "  <tbody>" +
            "    <tr " + row11Class + "><td>11</td><td>Kolkata, West<br/>Bengal.</td><td>P Bhogilal Pvt Ltd, 117b, Chittaranjan Avenue, Central Avenue, Kolkata - 700073 West Bengal</td><td>Mr. Nilesh Mehta<br/>Mr. Shridhar Shigare</td><td>support@markenworld.com,<br/>info@markenworld.com,<br/>tender@markenworld.com.</td><td>9175559646<br/>9011104332</td></tr>" +
            "  </tbody>" +
            "</table>" +
            "<p>Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 15. ESCALATION MATRIX
        docsHtml.append(wrapPage(true, "page-doc-15", data, logoBase64, partnerBase64, addr1, addr2, "",
            addrHtml.toString() + subjectRefEscalation +
            "<p>Dear Sir/Madam,</p>" +
            "<p>We hereby submit the Escalation Matrix with Telephone Numbers for Service Support for our quoted product as under:</p>" +
            "<table class=\"bordered-table escalation-table\">" +
            "  <thead><tr><th width=\"7%\">Sr. No</th><th width=\"20%\">Name of Responsible Person</th><th width=\"18%\">Designation</th><th width=\"18%\">Triggers When</th><th width=\"17%\">Contact Number</th><th width=\"20%\">Email IDs</th></tr></thead>" +
            "  <tbody>" +
            "    <tr><td>1.</td><td>Mr. Sanjay Sadade</td><td>General Manager</td><td>Administration</td><td>09225126772</td><td style=\"font-weight: bold;\">support@markenworld.com</td></tr>" +
            "    <tr><td>2.</td><td>Mr. Shridhar Shingare</td><td>Tender Manager</td><td>Institution Business Division</td><td>09011104332</td><td style=\"font-weight: bold;\">info@markenworld.com</td></tr>" +
            "    <tr><td>3.</td><td>Mr. Eknath Mandal</td><td>Production Manager</td><td>Delays of machine design and Technical Error.</td><td>09225102371</td><td style=\"font-weight: bold;\">support@markenworld.com</td></tr>" +
            "    <tr><td>4.</td><td>Mr. Sachin Shisode</td><td>Service Head</td><td>Servicing Delay</td><td>08390900347</td><td style=\"font-weight: bold;\">support@markenworld.com</td></tr>" +
            "  </tbody>" +
            "</table>" +
            "<p style=\"margin-top: 15px;\">Thanking you and assuring you of our best services at all the times.</p>" + sigBlock
        ));

        // 16. TECHNICAL SPECIFICATION & COMPLIANCE SHEET
        docsHtml.append(wrapPage(true, "page-doc-16", data, logoBase64, partnerBase64, addr1, addr2, "",
            addrHtml.toString() +
            renderSubjectRef("TECHNICAL SPECIFICATION &amp; COMPLIANCE SHEET", data) +
            "<div style=\"margin-top: 15px; margin-bottom: 10px;\">" +
            "<h3 style=\"font-size: 11pt; margin-bottom: 6px; color: #4472c4;\">EQUIPMENT &amp; OFFERED PRODUCT SUMMARY:</h3>" +
            "<table style=\"width: 100%; border-collapse: collapse; border: 1px solid #4472c4; font-size: 10pt;\">" +
            "<tr style=\"background-color: #f2f4f8;\"><td style=\"padding: 6px; font-weight: bold; width: 35%; border: 1px solid #d0d7de;\">Product Description:</td><td style=\"padding: 6px; border: 1px solid #d0d7de;\">" + data.getOrDefault("productDescription", "N/A") + "</td></tr>" +
            "<tr><td style=\"padding: 6px; font-weight: bold; border: 1px solid #d0d7de;\">Offered Model / Brand:</td><td style=\"padding: 6px; border: 1px solid #d0d7de;\">" + data.getOrDefault("offeredModel", data.getOrDefault("productName", "Standard Model")) + "</td></tr>" +
            "<tr style=\"background-color: #f2f4f8;\"><td style=\"padding: 6px; font-weight: bold; border: 1px solid #d0d7de;\">Manufacturer Name:</td><td style=\"padding: 6px; border: 1px solid #d0d7de;\">" + data.getOrDefault("manufacturerName", data.getOrDefault("companyName", "N/A")) + "</td></tr>" +
            "<tr><td style=\"padding: 6px; font-weight: bold; border: 1px solid #d0d7de;\">Warranty &amp; Service Period:</td><td style=\"padding: 6px; border: 1px solid #d0d7de;\">" + data.getOrDefault("warrantyPeriod", "Five (5) years") + "</td></tr>" +
            "</table></div>" +

            "<div style=\"margin-top: 15px; margin-bottom: 15px;\">" +
            "<h3 style=\"font-size: 11pt; margin-bottom: 6px; color: #4472c4;\">TECHNICAL COMPLIANCE TABLE:</h3>" +
            "<table style=\"width: 100%; border-collapse: collapse; border: 1px solid #4472c4; font-size: 9.5pt;\">" +
            "<thead><tr style=\"background-color: #4472c4; color: #ffffff; text-align: left;\">" +
            "<th style=\"padding: 6px; width: 6%; border: 1px solid #4472c4;\">Sr.</th>" +
            "<th style=\"padding: 6px; width: 38%; border: 1px solid #4472c4;\">Tender Parameter / Requirement</th>" +
            "<th style=\"padding: 6px; width: 38%; border: 1px solid #4472c4;\">Offered Specification</th>" +
            "<th style=\"padding: 6px; width: 9%; border: 1px solid #4472c4; text-align: center;\">Compliance</th>" +
            "<th style=\"padding: 6px; width: 9%; border: 1px solid #4472c4;\">Remarks</th></tr></thead><tbody>" +

            "<tr><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center;\">1</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Equipment Design &amp; Construction</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Heavy-duty industrial grade construction with ISO certified standards</td><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center; color: green; font-weight: bold;\">YES</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Compliant</td></tr>" +
            "<tr style=\"background-color: #f9fafb;\"><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center;\">2</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Power Supply / Electrical Input</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">220V - 240V AC, 50 Hz Single Phase input with surge protection</td><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center; color: green; font-weight: bold;\">YES</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Compliant</td></tr>" +
            "<tr><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center;\">3</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Operational Temperature Range</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Standard operating ambient temperature range (2°C to 43°C)</td><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center; color: green; font-weight: bold;\">YES</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Compliant</td></tr>" +
            "<tr style=\"background-color: #f9fafb;\"><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center;\">4</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Quality &amp; Safety Certifications</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">ISO 9001 / ISO 13485 / CE / BIS Certified Equipment</td><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center; color: green; font-weight: bold;\">YES</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Compliant</td></tr>" +
            "<tr><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center;\">5</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Performance Warranty &amp; Service</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">5 Years comprehensive warranty with prompt local service support</td><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center; color: green; font-weight: bold;\">YES</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Compliant</td></tr>" +
            "<tr style=\"background-color: #f9fafb;\"><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center;\">6</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Installation &amp; Commissioning</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Free on-site installation, testing, and operational training</td><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center; color: green; font-weight: bold;\">YES</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Compliant</td></tr>" +
            "<tr><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center;\">7</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Spares Availability Guarantee</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Guaranteed availability of spare parts for at least 10 years</td><td style=\"padding: 5px; border: 1px solid #d0d7de; text-align: center; color: green; font-weight: bold;\">YES</td><td style=\"padding: 5px; border: 1px solid #d0d7de;\">Compliant</td></tr>" +
            "</tbody></table></div>" +
            "<p style=\"margin-top: 10px; font-size: 10pt;\"><strong>Declaration:</strong> We hereby declare and confirm that the model and specifications offered above comply fully with all technical parameter requirements stated in Tender Ref No: <strong>" + data.getOrDefault("bidNumber", "") + "</strong>.</p>" + sigBlock
        ));

        return """
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8" />
              <style>
                @page {
                  size: A4;
                  margin: 0;
                }
                body {
                  margin: 0;
                  padding: 0;
                  background-color: #ffffff;
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
                .company-title {
                  font-family: 'Calibri', sans-serif;
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
                .logo-img {
                  width: 90px;
                  max-height: 75px;
                }
                .partner-img {
                  width: 105px;
                  max-height: 75px;
                }
                .header-divider {
                  border: none;
                  border-top: 0.75pt solid #4472c4;
                  margin: 6px 0 10px 0;
                }
                .checkbox-box {
                  display: inline-block;
                  width: 25px;
                  height: 20px;
                  border: 1.5pt solid #000000;
                  text-align: center;
                  line-height: 20px;
                  font-weight: bold;
                  vertical-align: middle;
                  margin: 0 8px;
                }
                .highlight-yellow {
                  background-color: transparent;
                }
                .highlight-orange {
                  background-color: transparent;
                }
                .highlight-row td {
                  background-color: transparent !important;
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
                  font-family: 'Cambria', serif;
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
                  font-family: 'Cambria', serif;
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
                  font-family: 'Cambria', serif;
                  font-size: 10pt;
                  font-weight: bold;
                }
                .escalation-table td {
                  font-family: 'Cambria', serif;
                  font-size: 12pt;
                  line-height: 1.25;
                }
                .escalation-table th {
                  font-family: 'Cambria', serif;
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
            """ + docsHtml.toString() + """
            </body>
            </html>
            """;
    }

    private String wrapPage(boolean showDate, String pageClass, Map<String, String> data, String logoBase64, String partnerBase64, String addr1, String addr2, String title, String content) {
        String logoHtml = logoBase64.isEmpty() ? "" : "<img src=\"" + logoBase64 + "\" class=\"logo-img\" />";
        String partnerHtml = partnerBase64.isEmpty() ? "" : "<img src=\"" + partnerBase64 + "\" class=\"partner-img\" />";
        String titleHtml = (title != null && !title.isEmpty()) ? "<h2 class=\"document-title\">" + title + "</h2>" : "";
        String addr2Html = addr2.isEmpty() ? "" : "<p class=\"company-addr\">" + addr2 + "</p>";
        String dateHtml = showDate ? "<div class=\"date-row\">Date: <span class=\"highlight-yellow\">" + data.getOrDefault("date", "") + "</span></div>" : "";
        
        return "<div class=\"page " + pageClass + "\">" +
               "  <table class=\"letterhead-table\" style=\"width: 100%; border-collapse: collapse; margin-bottom: 5px;\">" +
               "    <tr>" +
               "      <td style=\"width: 90px; vertical-align: top; text-align: left;\">" + logoHtml + "</td>" +
               "      <td style=\"vertical-align: top; text-align: left; padding: 0 15px;\">" +
               "        <h1 class=\"company-title\">" + data.getOrDefault("companyName", "").toUpperCase() + "</h1>" +
               "        <p class=\"company-addr\">" + addr1 + "</p>" +
               "        " + addr2Html +
               "        <p class=\"company-info\">Email ID: " + data.getOrDefault("companyEmail", "") + " URL: " + data.getOrDefault("companyWebsite", "") + "</p>" +
               "        <p class=\"company-info\">Contact No.: " + data.getOrDefault("companyContact", "") + "</p>" +
               "      </td>" +
               "      <td style=\"width: 105px; vertical-align: top; text-align: right;\">" + partnerHtml + "</td>" +
               "    </tr>" +
               "  </table>" +
               "  <hr class=\"header-divider\" />" +
               "  " + dateHtml +
               "  " + titleHtml +
               "  <div class=\"page-content\">" + content + "</div>" +
               "</div>";
    }

    private String renderSubjectRef(String subject, Map<String, String> data) {
        return "<table class=\"subject-ref-table\">" +
               "  <tr><td width=\"15%\" style=\"font-weight: bold;\">Subject</td><td width=\"2%\" style=\"font-weight: bold;\">:</td><td width=\"83%\" style=\"font-weight: bold;\">" + subject + "</td></tr>" +
               "  <tr><td width=\"15%\" style=\"font-weight: bold;\">Reference</td><td width=\"2%\" style=\"font-weight: bold;\">:</td><td width=\"83%\" style=\"font-weight: normal;\">Bid No.: <span class=\"highlight-yellow\">" + data.getOrDefault("bidNumber", "") + "</span>, Date. <span class=\"highlight-yellow\">" + data.getOrDefault("bidDate", "") + "</span>.</td></tr>" +
               "</table>";
    }

    private String renderSignatoryBlock(Map<String, String> data, String stampBase64, String sigBase64, boolean showPlace) {
        String stampHtml = stampBase64.isEmpty() ? "" : "<img src=\"" + stampBase64 + "\" class=\"stamp-img\" />";
        String sigHtml = sigBase64.isEmpty() ? "" : "<img src=\"" + sigBase64 + "\" class=\"sig-img\" />";
        String placeHtml = showPlace ? "<p style=\"margin: 2px 0;\">Date: <span class=\"highlight-yellow\">" + data.getOrDefault("date", "") + "</span></p><p style=\"margin: 2px 0;\">Place: " + data.getOrDefault("place", "Nashik") + "</p>" : "";
        
        return "<div class=\"signatory-block\">" +
               "  <p style=\"margin-bottom: 4px;\">Yours faithfully,</p>" +
               "  <p style=\"font-weight: bold; margin-top: 0; margin-bottom: 8px;\">For " + data.getOrDefault("companyName", "") + "</p>" +
               "  <div class=\"signature-container\">" + stampHtml + sigHtml + "</div>" +
               "  <p style=\"font-weight: bold; margin-top: 8px; margin-bottom: 2px;\">" + data.getOrDefault("signatoryName", "") + "</p>" +
               "  <p style=\"margin-top: 0; margin-bottom: 8px;\">" + data.getOrDefault("signatoryDesignation", "") + "</p>" +
               placeHtml +
               "</div>";
    }

    private String escapeHtml(String input) {
        if (input == null) return "";
        return input.replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace("\"", "&quot;")
                    .replace("'", "&apos;");
    }

    private String highlightProductDescription(String productDesc) {
        if (productDesc == null || productDesc.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        int i = 0;
        int len = productDesc.length();
        while (i < len) {
            int openIdx = productDesc.indexOf('(', i);
            if (openIdx == -1) {
                sb.append("<span class=\"highlight-yellow\">").append(productDesc.substring(i)).append("</span>");
                break;
            }
            if (openIdx > i) {
                sb.append("<span class=\"highlight-yellow\">").append(productDesc.substring(i, openIdx)).append("</span>");
            }
            int closeIdx = productDesc.indexOf(')', openIdx);
            if (closeIdx == -1) {
                sb.append("<span class=\"highlight-orange\">").append(productDesc.substring(openIdx)).append("</span>");
                break;
            }
            sb.append("<span class=\"highlight-orange\">").append(productDesc.substring(openIdx, closeIdx + 1)).append("</span>");
            i = closeIdx + 1;
        }
        return sb.toString();
    }

    private String extractYearsNumber(String text) {
        if (text == null) return "10";
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\d+").matcher(text);
        if (m.find()) {
            return m.group();
        }
        return "10";
    }

    private byte[] loadImageBytes(String relativePath, String resourcePath) {
        try {
            java.nio.file.Path path = java.nio.file.Paths.get(relativePath);
            if (java.nio.file.Files.exists(path)) {
                return java.nio.file.Files.readAllBytes(path);
            }
        } catch (Exception ignored) {}

        try (java.io.InputStream in = getClass().getResourceAsStream(resourcePath)) {
            if (in != null) {
                return in.readAllBytes();
            }
        } catch (Exception ignored) {}

        return null;
    }

    // --- TECHNICAL SPECIFICATION CLAUSE PARSER & DOCUMENT GENERATION ---
    public List<String[]> parseSpecificationClauses(byte[] fileBytes, String fileName) {
        List<String[]> clauses = new ArrayList<>();
        String text = "";

        if (fileBytes != null && fileBytes.length > 0) {
            if (fileName != null && fileName.toLowerCase().endsWith(".pdf")) {
                try (org.apache.pdfbox.pdmodel.PDDocument pdfDoc = org.apache.pdfbox.pdmodel.PDDocument.load(fileBytes)) {
                    org.apache.pdfbox.text.PDFTextStripper stripper = new org.apache.pdfbox.text.PDFTextStripper();
                    text = stripper.getText(pdfDoc);
                } catch (Exception e) {
                    System.err.println("[DocumentGeneratorService] PDF parsing exception: " + e.getMessage());
                }
            } else if (fileName != null && (fileName.toLowerCase().endsWith(".docx") || fileName.toLowerCase().endsWith(".doc"))) {
                try (java.io.ByteArrayInputStream bais = new java.io.ByteArrayInputStream(fileBytes);
                     org.apache.poi.xwpf.usermodel.XWPFDocument docx = new org.apache.poi.xwpf.usermodel.XWPFDocument(bais)) {
                    StringBuilder sb = new StringBuilder();
                    for (org.apache.poi.xwpf.usermodel.XWPFParagraph p : docx.getParagraphs()) {
                        sb.append(p.getText()).append("\n");
                    }
                    for (org.apache.poi.xwpf.usermodel.XWPFTable table : docx.getTables()) {
                        for (org.apache.poi.xwpf.usermodel.XWPFTableRow row : table.getRows()) {
                            for (org.apache.poi.xwpf.usermodel.XWPFTableCell cell : row.getTableCells()) {
                                sb.append(cell.getText()).append("\t");
                            }
                            sb.append("\n");
                        }
                    }
                    text = sb.toString();
                } catch (Exception e) {
                    System.err.println("[DocumentGeneratorService] DOCX parsing exception: " + e.getMessage());
                }
            }
        }

        if (text != null && !text.trim().isEmpty()) {
            String[] lines = text.split("\r?\n");
            int autoSr = 1;
            String currentSr = "";
            StringBuilder currentText = new StringBuilder();

            for (String rawLine : lines) {
                String line = rawLine.trim();
                if (line.isEmpty() || line.startsWith("Page ") || line.contains("SECTION VI") || line.contains("Annexure")) {
                    continue;
                }

                if (line.matches("^(\\d{1,2}(\\.\\d{1,2}){0,3}):?\\s+.*")) {
                    if (currentText.length() > 0) {
                        clauses.add(new String[]{
                            currentSr.isEmpty() ? String.valueOf(autoSr++) : currentSr,
                            escapeHtml(currentText.toString().trim()),
                            "Comply",
                            "No Deviation",
                            "-"
                        });
                        currentText.setLength(0);
                    }
                    String[] parts = line.split("\\s+", 2);
                    currentSr = parts[0].replaceAll(":$", "");
                    currentText.append(parts.length > 1 ? parts[1] : "");
                } else if (currentText.length() > 0) {
                    currentText.append(" ").append(line);
                } else {
                    currentSr = String.valueOf(autoSr++);
                    currentText.append(line);
                }
            }

            if (currentText.length() > 0) {
                clauses.add(new String[]{
                    currentSr.isEmpty() ? String.valueOf(autoSr++) : currentSr,
                    escapeHtml(currentText.toString().trim()),
                    "Comply",
                    "No Deviation",
                    "-"
                });
            }
        }

        if (clauses.isEmpty()) {
            clauses = List.of(
                new String[]{"1.1", "Ice-lined refrigerators maintain temperatures of +2°C to +8°C minimum 8 hrs. Continuous or intermittent power supply should be sufficient per 24 hrs.", "Comply", "No Deviation", "-"},
                new String[]{"1.2", "Ice-lined refrigerators are required at various levels of health facilities since electricity supplies are rarely perfect.", "Comply", "No Deviation", "-"},
                new String[]{"2.1", "Vaccine storage is required for RI (Routine Immunization), Campaign and new vaccine introduction.", "Comply", "No Deviation", "-"},
                new String[]{"2.2", "Target holdover time should be 20 hrs. or more in a continuous external temperature of +43°C.", "Comply", "No Deviation", "4 Hours 47 Minutes"},
                new String[]{"3.1", "Net Vaccine Storage Capacity: 80-130 liters within basket in place.", "Comply", "No Deviation", "108 Ltr"},
                new String[]{"3.2", "Freeze protection: Grade A, user independent freeze protection.", "Comply", "No Deviation", "-"},
                new String[]{"3.3", "Construction Internal: Stainless 304 grade steel / Corrosion Resistant polymer.", "Comply", "No Deviation", "-"},
                new String[]{"4.1", "Programmable Microprocessor control unit with child lock facility.", "Comply", "No Deviation", "-"},
                new String[]{"5.1", "Minimum warrantee including comprehensive maintenance of sixty months after installation.", "Comply", "No Deviation", "-"},
                new String[]{"8.1", "Should meet Indian Standard 19106:2025 or WHO PQS Standard (WHO/PQS/E03/RF03.6 or latest).", "Comply", "No Deviation", "WHO PQS Certified"}
            );
        }

        return clauses;
    }

    public byte[] generateTechSpecPdf(Map<String, String> data) throws Exception {
        return generateTechSpecPdf(data, null);
    }

    public byte[] generateTechSpecPdf(Map<String, String> data, List<String[]> customClauses) throws Exception {
        String htmlContent = generateTechSpecHtml(data, customClauses);
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        
        com.openhtmltopdf.pdfboxout.PdfRendererBuilder builder = new com.openhtmltopdf.pdfboxout.PdfRendererBuilder();
        builder.useFastMode();

        try {
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Calibri.ttf"), "Calibri", 400, com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle.NORMAL, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Calibri Bold.ttf"), "Calibri", 700, com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle.NORMAL, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Calibri Italic.ttf"), "Calibri", 400, com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle.ITALIC, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Calibri Bold Italic.ttf"), "Calibri", 700, com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle.ITALIC, true);

            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Cambria.ttf"), "Cambria", 400, com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle.NORMAL, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Cambria Bold.ttf"), "Cambria", 700, com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle.NORMAL, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Cambria Italic.ttf"), "Cambria", 400, com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle.ITALIC, true);
            builder.useFont(() -> DocumentGeneratorService.class.getResourceAsStream("/fonts/Cambria Bold Italic.ttf"), "Cambria", 700, com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder.FontStyle.ITALIC, true);
        } catch (Exception ex) {}

        builder.withHtmlContent(htmlContent, "/");
        builder.toStream(baos);
        builder.run();
        
        return baos.toByteArray();
    }

    public void writeDoc16(org.apache.poi.xwpf.usermodel.XWPFDocument document, Map<String, String> data) {
        writeDoc16(document, data, null);
    }

    public void writeDoc16(org.apache.poi.xwpf.usermodel.XWPFDocument document, Map<String, String> data, List<String[]> customClauses) {
        writeHeader(document, data, "Technical Compliance Clause by Clause", true);

        List<String[]> clauses = (customClauses != null && !customClauses.isEmpty()) 
                ? customClauses 
                : parseSpecificationClauses(null, null);

        org.apache.poi.xwpf.usermodel.XWPFParagraph pSchedule = document.createParagraph();
        pSchedule.setSpacingBefore(100);
        pSchedule.setSpacingAfter(40);
        org.apache.poi.xwpf.usermodel.XWPFRun rSchedule = pSchedule.createRun();
        rSchedule.setBold(true);
        rSchedule.setFontSize(11);
        rSchedule.setText("Schedule No. 1");

        org.apache.poi.xwpf.usermodel.XWPFTable compTable = document.createTable(clauses.size() + 2, 5);
        setTableBordersSingle(compTable);

        org.apache.poi.xwpf.usermodel.XWPFTableRow infoRow = compTable.getRow(0);
        infoRow.getCell(0).getCTTc().addNewTcPr().addNewHMerge().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STMerge.RESTART);
        for (int c = 1; c < 5; c++) {
            infoRow.getCell(c).getCTTc().addNewTcPr().addNewHMerge().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STMerge.CONTINUE);
        }
        org.apache.poi.xwpf.usermodel.XWPFParagraph pInfo = infoRow.getCell(0).getParagraphs().get(0);
        pInfo.setAlignment(org.apache.poi.xwpf.usermodel.ParagraphAlignment.CENTER);
        org.apache.poi.xwpf.usermodel.XWPFRun rInfo1 = pInfo.createRun();
        rInfo1.setBold(true);
        rInfo1.setText(data.getOrDefault("productDescription", data.getOrDefault("productName", "Medical Equipment")) + "\n");
        org.apache.poi.xwpf.usermodel.XWPFRun rInfo2 = pInfo.createRun();
        rInfo2.setText("Make: MarkEn | Model No.: " + data.getOrDefault("offeredModel", "MILR-04"));

        org.apache.poi.xwpf.usermodel.XWPFTableRow headerRow = compTable.getRow(1);
        setCellHeader(headerRow.getCell(0), "Sr. No.", "800");
        setCellHeader(headerRow.getCell(1), "Specification", "4800");
        setCellHeader(headerRow.getCell(2), "Compliance (Yes/No)", "1400");
        setCellHeader(headerRow.getCell(3), "Deviations, if any", "1400");
        setCellHeader(headerRow.getCell(4), "Remarks", "1200");

        for (int i = 0; i < clauses.size(); i++) {
            String[] rowData = clauses.get(i);
            org.apache.poi.xwpf.usermodel.XWPFTableRow tableRow = compTable.getRow(i + 2);
            tableRow.getCell(0).setText(rowData[0]);
            tableRow.getCell(1).setText(rowData[1]);
            tableRow.getCell(2).setText(rowData.length > 2 ? rowData[2] : "Comply");
            tableRow.getCell(3).setText(rowData.length > 3 ? rowData[3] : "No Deviation");
            tableRow.getCell(4).setText(rowData.length > 4 ? rowData[4] : "-");
        }

        org.apache.poi.xwpf.usermodel.XWPFParagraph pDecl = document.createParagraph();
        pDecl.setSpacingBefore(180);
        pDecl.setSpacingAfter(80);
        org.apache.poi.xwpf.usermodel.XWPFRun rDecl = pDecl.createRun();
        rDecl.setText("Declaration: We hereby confirm and declare that the model and specifications offered above comply fully with all technical parameter requirements stated in Tender Ref No: ");
        org.apache.poi.xwpf.usermodel.XWPFRun rDeclRef = pDecl.createRun();
        rDeclRef.setBold(true);
        rDeclRef.setText(data.getOrDefault("bidNumber", "") + ".");

        writeSignatoryBlock(document, data, true);
    }

    public byte[] generateTechSpecDocx(Map<String, String> data) throws Exception {
        return generateTechSpecDocx(data, null);
    }

    public byte[] generateTechSpecDocx(Map<String, String> data, List<String[]> customClauses) throws Exception {
        try (org.apache.poi.xwpf.usermodel.XWPFDocument document = new org.apache.poi.xwpf.usermodel.XWPFDocument();
             java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream()) {

            org.openxmlformats.schemas.wordprocessingml.x2006.main.CTSectPr sectPr = document.getDocument().getBody().addNewSectPr();
            org.openxmlformats.schemas.wordprocessingml.x2006.main.CTPageMar pageMar = sectPr.addNewPgMar();
            pageMar.setTop(java.math.BigInteger.valueOf(1960));
            pageMar.setBottom(java.math.BigInteger.valueOf(800));
            pageMar.setLeft(java.math.BigInteger.valueOf(850));
            pageMar.setRight(java.math.BigInteger.valueOf(850));

            writeDoc16(document, data, customClauses);

            document.write(baos);
            return baos.toByteArray();
        }
    }

    private void setTableBordersSingle(org.apache.poi.xwpf.usermodel.XWPFTable table) {
        try {
            table.getCTTbl().addNewTblPr().addNewTblBorders();
            org.openxmlformats.schemas.wordprocessingml.x2006.main.CTTblBorders borders = table.getCTTbl().getTblPr().getTblBorders();
            borders.addNewLeft().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.SINGLE);
            borders.addNewRight().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.SINGLE);
            borders.addNewTop().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.SINGLE);
            borders.addNewBottom().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.SINGLE);
            borders.addNewInsideH().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.SINGLE);
            borders.addNewInsideV().setVal(org.openxmlformats.schemas.wordprocessingml.x2006.main.STBorder.SINGLE);
        } catch (Exception e) {}
    }

    private void setSummaryRow(org.apache.poi.xwpf.usermodel.XWPFTableRow row, String label, String val) {
        row.getCell(0).setWidth("3200");
        org.apache.poi.xwpf.usermodel.XWPFParagraph p0 = row.getCell(0).getParagraphs().get(0);
        org.apache.poi.xwpf.usermodel.XWPFRun r0 = p0.createRun();
        r0.setBold(true);
        r0.setText(label);

        row.getCell(1).setWidth("5800");
        org.apache.poi.xwpf.usermodel.XWPFParagraph p1 = row.getCell(1).getParagraphs().get(0);
        org.apache.poi.xwpf.usermodel.XWPFRun r1 = p1.createRun();
        r1.setText(val);
    }

    private void setCellHeader(org.apache.poi.xwpf.usermodel.XWPFTableCell cell, String text, String width) {
        cell.setWidth(width);
        cell.setColor("4472C4");
        org.apache.poi.xwpf.usermodel.XWPFParagraph p = cell.getParagraphs().get(0);
        org.apache.poi.xwpf.usermodel.XWPFRun r = p.createRun();
        r.setBold(true);
        r.setColor("FFFFFF");
        r.setText(text);
    }

    private String buildCompleteHtml(String bodyContent) {
        return """
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8" />
              <style>
                @page {
                  size: A4;
                  margin: 0;
                }
                body {
                  margin: 0;
                  padding: 0;
                  background-color: #ffffff;
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
                p { margin-top: 0; margin-bottom: 8px; }
                .company-title { color: #4472c4; font-size: 18pt; font-family: 'Calibri', sans-serif; font-weight: bold; margin: 0; }
                .company-addr { font-size: 8.5pt; color: #333333; margin: 1px 0; }
                .company-info { font-size: 8.5pt; color: #555555; margin: 1px 0; }
                .header-divider { border: 0; border-top: 1.5px solid #4472c4; margin: 8px 0 12px 0; }
                .subject-ref-table { width: 100%; margin-bottom: 12px; font-size: 10pt; }
                .logo-img { max-width: 80px; max-height: 60px; }
                .partner-img { max-width: 95px; max-height: 60px; }
                .signature-container { position: relative; height: 55px; margin: 5px 0; }
                .sig-img { position: absolute; left: 45px; top: -5px; width: 60px; }
                .stamp-img { position: absolute; left: 0px; top: 0px; width: 70px; }
              </style>
            </head>
            <body>
            """ + bodyContent + """
            </body>
            </html>
            """;
    }

    public String generateTechSpecHtml(Map<String, String> rawData) {
        return generateTechSpecHtml(rawData, null);
    }

    public String generateTechSpecHtml(Map<String, String> rawData, List<String[]> customClauses) {
        Map<String, String> data = new java.util.HashMap<>();
        for (Map.Entry<String, String> entry : rawData.entrySet()) {
            data.put(entry.getKey(), escapeHtml(entry.getValue()));
        }
        String logoBase64 = "";
        String partnerBase64 = "";
        String stampBase64 = "";
        String sigBase64 = "";
        
        byte[] logoBytes = loadImageBytes("public/images/logo.png", "/static/images/logo.png");
        if (logoBytes != null) logoBase64 = "data:image/png;base64," + Base64.getEncoder().encodeToString(logoBytes);

        byte[] partnerBytes = loadImageBytes("public/images/partner.png", "/static/images/partner.png");
        if (partnerBytes != null) partnerBase64 = "data:image/png;base64," + Base64.getEncoder().encodeToString(partnerBytes);

        byte[] stampBytes = loadImageBytes("public/images/stamp.png", "/static/images/stamp.png");
        if (stampBytes != null) stampBase64 = "data:image/png;base64," + Base64.getEncoder().encodeToString(stampBytes);

        byte[] sigBytes = loadImageBytes("public/images/signature.png", "/static/images/signature.png");
        if (sigBytes != null) sigBase64 = "data:image/png;base64," + Base64.getEncoder().encodeToString(sigBytes);

        String addr1 = data.getOrDefault("companyAddress", "");
        String addr2 = "";
        if (addr1.contains("MIDC Satpur,")) {
            String[] parts = addr1.split("MIDC Satpur,");
            addr1 = parts[0] + "MIDC Satpur,";
            if (parts.length > 1) addr2 = parts[1].trim();
        }

        List<String[]> clauses = (customClauses != null && !customClauses.isEmpty()) 
                ? customClauses 
                : parseSpecificationClauses(null, null);

        StringBuilder html = new StringBuilder();
        html.append("<div style=\"text-align: center; font-size: 13pt; font-weight: bold; margin-top: 10px; margin-bottom: 4px;\">Technical Compliance Clause by Clause</div>");
        html.append("<div style=\"text-align: left; font-size: 11pt; font-weight: bold; margin-bottom: 8px;\">Schedule No. 1</div>");

        html.append("<table style=\"width: 100%; border-collapse: collapse; border: 1.5px solid #000000; margin-bottom: 12px; font-size: 10pt;\">");
        html.append("<thead>");
        html.append("<tr style=\"background-color: #f2f4f8;\">");
        html.append("<th colspan=\"5\" style=\"padding: 8px; text-align: center; font-size: 11pt; border: 1px solid #000000;\">");
        html.append("<div>").append(data.getOrDefault("productDescription", data.getOrDefault("productName", "Medical Equipment"))).append("</div>");
        html.append("<div style=\"font-weight: normal; font-size: 10pt; margin-top: 2px;\">Make: MarkEn &nbsp;|&nbsp; Model No. : ").append(data.getOrDefault("offeredModel", "MILR-04")).append("</div>");
        html.append("</th></tr>");

        html.append("<tr style=\"background-color: #ffffff; font-weight: bold; text-align: center;\">");
        html.append("<th style=\"width: 8%; border: 1px solid #000000; padding: 6px;\">Sr. No.</th>");
        html.append("<th style=\"width: 48%; border: 1px solid #000000; padding: 6px; text-align: left;\">Specification</th>");
        html.append("<th style=\"width: 15%; border: 1px solid #000000; padding: 6px;\">Compliance (Yes/No)</th>");
        html.append("<th style=\"width: 16%; border: 1px solid #000000; padding: 6px;\">Deviations, if any</th>");
        html.append("<th style=\"width: 13%; border: 1px solid #000000; padding: 6px;\">Remarks</th></tr></thead><tbody>");

        for (int i = 0; i < clauses.size(); i++) {
            String[] rowData = clauses.get(i);
            String bg = (i % 2 == 1) ? " style=\"background-color: #f9fafb;\"" : "";
            html.append("<tr").append(bg).append(">");
            html.append("<td style=\"padding: 5px; border: 1px solid #000000; text-align: center;\">").append(rowData[0]).append("</td>");
            html.append("<td style=\"padding: 5px; border: 1px solid #000000;\">").append(rowData[1]).append("</td>");
            html.append("<td style=\"padding: 5px; border: 1px solid #000000; text-align: center;\">").append(rowData.length > 2 ? rowData[2] : "Comply").append("</td>");
            html.append("<td style=\"padding: 5px; border: 1px solid #000000; text-align: center;\">").append(rowData.length > 3 ? rowData[3] : "No Deviation").append("</td>");
            html.append("<td style=\"padding: 5px; border: 1px solid #000000; text-align: center;\">").append(rowData.length > 4 ? rowData[4] : "-").append("</td>");
            html.append("</tr>");
        }

        html.append("</tbody></table>");
        html.append("<p style=\"margin-top: 10px; font-size: 10pt;\"><strong>Declaration:</strong> We hereby declare and confirm that the model and specifications offered above comply fully with all technical parameter requirements stated in Tender Ref No: <strong>").append(data.getOrDefault("bidNumber", "")).append("</strong>.</p>");
        html.append(renderSignatoryBlock(data, stampBase64, sigBase64, true));

        String pageContent = wrapPage(true, "page-tech-spec", data, logoBase64, partnerBase64, addr1, addr2,
                "Technical Compliance Clause by Clause", html.toString());

        return buildCompleteHtml(pageContent);
    }
}
