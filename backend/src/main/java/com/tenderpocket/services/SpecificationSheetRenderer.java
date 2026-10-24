package com.tenderpocket.services;

import java.io.*;
import java.math.BigInteger;
import java.util.*;
import java.util.regex.Matcher;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.xwpf.usermodel.*;
import org.apache.poi.wp.usermodel.HeaderFooterType;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.*;

/**
 * A4 portrait Technical Compliance Data Sheet renderer.
 *
 * <p>Design intent (confirmed against reference sample PDF):
 * <ul>
 *   <li>Col 1 – Sr. no.</li>
 *   <li>Col 2 – Tender requirement (extracted from specification PDF)</li>
 *   <li>Col 3 – Compliance: pre-filled "Yes" — the company declares it complies with every clause.</li>
 *   <li>Col 4 – Offered specification: mirrors the tender requirement text — the company's offered
 *       product meets the specification exactly as stated. This is intentional; there is no separate
 *       offered-specification data model. If a particular clause has a deviation, the human operator
 *       edits the exported DOCX/XLSX before submission.</li>
 *   <li>Col 5 – Any deviations: pre-filled "No Deviation".</li>
 * </ul>
 *
 * <p>The compliance pre-fill is a deliberate design decision matching the sample document provided
 * by Mark Enterprises. It is NOT fabrication of evidence — this is a compliance declaration form
 * that the operator reviews and amends where needed before submission.
 *
 * <p>Deliberately kept separate from bid-pack templates.
 */
final class SpecificationSheetRenderer {
    private static final String[] HEADERS = {"Sr. no.", "Blood Bag Refrigerator Technical Specification\n(Tender Requirement)",
            "Compliance\nYes / No", "MarkEn - Offered Specification", "Any\nDeviations"};
    private static final String[] GENERIC_HEADERS = {"Sr. no.", "Technical Specification\n(Tender Requirement)",
            "Compliance\nYes / No", "MarkEn - Offered Specification", "Any\nDeviations"};
    private static final int[] WIDTHS = {6, 38, 12, 32, 12};
    private static final String TITLE = "TECHNICAL COMPLIANCE DATA SHEET";

    static String html(Map<String, String> data, List<SpecificationSheetContent.Product> products,
                       byte[] logo, byte[] partner) {
        return html(data, products, logo, partner, false);
    }

    static String html(Map<String, String> data, List<SpecificationSheetContent.Product> products,
                       byte[] logo, byte[] partner, boolean combined) {
        if (combined) products = List.of(SpecificationSheetContent.combined(products));
        StringBuilder out = new StringBuilder("""
            <!DOCTYPE html><html><head><meta charset="utf-8"/><style>
            @page { size:A4 portrait; margin:32mm 8mm 12mm;
              @top-center { content:element(letterhead); }
              @bottom-center { content:"Page " counter(page); font-family:Cambria,serif; font-size:9pt; } }
            body { font-family:Cambria,serif; font-size:10pt; line-height:1.15; color:#000; margin:0; padding:0; }
            .letterhead { position:running(letterhead); width:100%; font-family:Calibri,sans-serif;
              border-bottom:1pt solid #000; padding-bottom:3pt; margin-bottom:2pt; }
            .letterhead table { width:100%; border-collapse:collapse; }
            .letterhead td { border:0; vertical-align:top; padding:0 3pt; }
            .company { font-size:20pt; color:#4472c4; font-weight:bold; }
            .contact { font-size:9pt; line-height:1.15; }
            .doc-title { font-size:12pt; font-weight:bold; text-align:center; margin:4pt 0 10pt; text-transform:uppercase; letter-spacing:0.5pt; }
            .meta-block { width:100%; margin-bottom:10pt; font-size:10pt; page-break-after:avoid; }
            .meta-block table { width:100%; border-collapse:collapse; }
            .meta-block td { border:0; vertical-align:top; padding:1.5pt 2pt; font-family:Cambria,serif; }
            .meta-label { width:22%; font-weight:bold; white-space:nowrap; }
            .meta-sep { width:2%; text-align:center; font-weight:bold; }
            .meta-val { width:76%; }
            .recipient-block { margin-bottom:8pt; line-height:1.2; font-size:10pt; }
            h2 { font-size:11pt; margin:8pt 0; page-break-after:avoid; }
            .sheet { width:100%; border-collapse:collapse; table-layout:fixed; -fs-table-paginate:paginate; margin-top:4pt; }
            .sheet th { background-color:#f6c5ac; color:#000; font-weight:bold; border:0.5pt solid #000;
              padding:4pt 3pt; vertical-align:middle; text-align:center; font-size:9.5pt; word-wrap:break-word; }
            .sheet td { border:0.5pt solid #000; padding:3pt 4pt; vertical-align:top; font-size:9pt; word-wrap:break-word; line-height:1.15; }
            .sheet tr { page-break-inside:avoid; }
            .sheet tr.long { page-break-inside:auto; }
            .sheet thead { display:table-header-group; }
            .sheet .heading { font-weight:bold; background-color:#fff2ec; page-break-after:avoid; }
            .reference { text-align:center; font-weight:bold; }
            .compliance-cell { text-align:center; font-weight:bold; }
            .deviations-cell { text-align:center; }
            .product-box { text-align:center; font-weight:bold; border:0.5pt solid #000; padding:4pt; margin-bottom:8pt; page-break-after:avoid; }
            .closing-block { margin-top:14pt; page-break-inside:avoid; font-size:10pt; line-height:1.25; }
            .closing-signatory { margin-top:8pt; line-height:1.25; font-size:10pt; }
            .next { page-break-before:always; }
            </style></head><body>
            """);
        String companyName = data.getOrDefault("companyName", "");
        String companyAddress = data.getOrDefault("companyAddress", "");
        String companyEmail = data.getOrDefault("companyEmail", "");
        String companyWebsite = data.getOrDefault("companyWebsite", "");
        String companyContact = data.getOrDefault("companyContact", "");

        out.append("<div class=\"letterhead\"><table><tr><td style=\"width:12%\">")
                .append(image(logo, 62)).append("</td><td>");
        if (!companyName.isBlank()) {
            out.append("<div class=\"company\">")
                    .append(escape(companyName.toUpperCase(Locale.ROOT)))
                    .append("</div>");
        }
        out.append("<div class=\"contact\">");
        if (!companyAddress.isBlank()) out.append(escape(companyAddress)).append("<br/>");
        if (!companyEmail.isBlank() || !companyWebsite.isBlank()) {
            if (!companyEmail.isBlank()) out.append("Email ID: ").append(escape(companyEmail));
            if (!companyWebsite.isBlank()) out.append(" URL: ").append(escape(companyWebsite));
            out.append("<br/>");
        }
        if (!companyContact.isBlank()) out.append("Contact No.: ").append(escape(companyContact));
        out.append("</div></td><td style=\"width:20%;text-align:right\">")
                .append(image(partner, 82)).append("</td></tr></table></div>");

        int ordinal = 0;
        for (var product : products) {
            out.append("<div").append(ordinal++ == 0 ? "" : " class=\"next\"").append(">");
            out.append("<div class=\"doc-title\">").append(TITLE).append("</div>");

            // Recipient block if available
            String recipientName = data.getOrDefault("recipientName", "");
            String recipientAddress = data.getOrDefault("recipientAddress", "");
            if (!recipientName.isBlank() || !recipientAddress.isBlank()) {
                out.append("<div class=\"recipient-block\"><strong>To,</strong><br/>");
                if (!recipientName.isBlank()) out.append(escape(recipientName)).append("<br/>");
                if (!recipientAddress.isBlank()) out.append(escape(recipientAddress).replace("\n", "<br/>")).append("<br/>");
                out.append("</div>");
            }

            // Metadata block (Subject, Reference Bid Number, Product, Qty, Make, Model no)
            String subject = data.getOrDefault("subject", "");
            if (subject.isBlank()) {
                String pName = product.name();
                if (pName == null || pName.isBlank()) pName = data.getOrDefault("productName", data.getOrDefault("productDescription", ""));
                subject = pName.isBlank() ? "Technical Compliance Data Sheet" : "Technical Compliance Data Sheet - " + pName;
            }
            String bidNumber = data.getOrDefault("bidNumber", "");
            String bidDate = data.getOrDefault("date", "");
            String productDisplayName = product.name();
            if (combined && (productDisplayName == null || productDisplayName.isBlank() || productDisplayName.equalsIgnoreCase("Combined Technical Specifications"))) {
                productDisplayName = data.getOrDefault("productName", data.getOrDefault("productDescription", product.name()));
            } else if (productDisplayName == null || productDisplayName.isBlank()) {
                productDisplayName = data.getOrDefault("productName", data.getOrDefault("productDescription", ""));
            }
            String qty = data.getOrDefault("qty", data.getOrDefault("bidQty", ""));
            String make = data.getOrDefault("offeredMake", "");
            String model = data.getOrDefault("offeredModel", "");

            boolean hasMeta = !subject.isBlank() || !bidNumber.isBlank() || !productDisplayName.isBlank()
                    || !qty.isBlank() || !make.isBlank() || !model.isBlank();

            if (hasMeta) {
                out.append("<div class=\"meta-block\"><table>");
                if (!subject.isBlank()) {
                    out.append("<tr><td class=\"meta-label\">Subject</td><td class=\"meta-sep\">:</td><td class=\"meta-val\"><strong>")
                            .append(escape(subject)).append("</strong></td></tr>");
                }
                if (!bidNumber.isBlank()) {
                    String refDisplay = escape(bidNumber) + (bidDate.isBlank() ? "" : ", Dated: " + escape(bidDate));
                    out.append("<tr><td class=\"meta-label\">Reference Bid Number</td><td class=\"meta-sep\">:</td><td class=\"meta-val\"><strong>")
                            .append(refDisplay).append("</strong></td></tr>");
                }
                if (!productDisplayName.isBlank()) {
                    out.append("<tr><td style=\"padding-top:4pt\" class=\"meta-label\">Product</td><td style=\"padding-top:4pt\" class=\"meta-sep\">:</td><td style=\"padding-top:4pt\" class=\"meta-val\"><strong>")
                            .append(escape(productDisplayName)).append("</strong></td></tr>");
                }
                if (!qty.isBlank()) {
                    out.append("<tr><td class=\"meta-label\">Qty</td><td class=\"meta-sep\">:</td><td class=\"meta-val\"><strong>")
                            .append(escape(qty)).append("</strong></td></tr>");
                }
                if (!make.isBlank() && !"-".equals(make.trim())) {
                    out.append("<tr><td class=\"meta-label\">Make</td><td class=\"meta-sep\">:</td><td class=\"meta-val\"><strong>")
                            .append(escape(make)).append("</strong></td></tr>");
                }
                if (!model.isBlank() && !"-".equals(model.trim())) {
                    out.append("<tr><td class=\"meta-label\">Model no</td><td class=\"meta-sep\">:</td><td class=\"meta-val\"><strong>")
                            .append(escape(model)).append("</strong></td></tr>");
                }
                out.append("</table></div>");
            }

            if (!combined && (product.schedule() != null && !product.schedule().isBlank())) {
                out.append("<h2>Schedule No. ").append(escape(product.schedule())).append("</h2>");
            }

            // Headers: customized for specific product if named
            String col2Header = productDisplayName.toLowerCase(Locale.ROOT).contains("blood bag")
                    ? "Blood Bag Refrigerator Technical Specification<br/>(Tender Requirement)"
                    : (!productDisplayName.isBlank() && !combined && !productDisplayName.equalsIgnoreCase("Combined Technical Specifications")
                            ? escape(productDisplayName) + " Technical Specification<br/>(Tender Requirement)"
                    : "Technical Specification<br/>(Tender Requirement)");
            String col4Header = (make.isBlank() || "-".equals(make.trim())) ? "Offered Specification" : escape(make) + " - Offered Specification";

            out.append("<table class=\"sheet\"><colgroup>");
            for (int width : WIDTHS) out.append("<col style=\"width:").append(width).append("%\"/>");
            out.append("</colgroup><thead><tr>");
            out.append("<th>Sr. no.</th>");
            out.append("<th>").append(col2Header).append("</th>");
            out.append("<th>Compliance<br/>Yes / No</th>");
            out.append("<th>").append(col4Header).append("</th>");
            out.append("<th>Any<br/>Deviations</th>");
            out.append("</tr></thead><tbody>");

            int displayPosition = 0;
            for (var row : product.rows()) {
                if (combined && row.heading()) {
                    out.append("<tr class=\"heading\"><td colspan=\"5\">")
                            .append(escape(row.wording())).append("</td></tr>");
                    continue;
                }
                String reference = displayedReference(row, ++displayPosition);
                String cleanWording = combined ? emphasize(row.wording()).replace("\n", "<br/>") : emphasize(row.wording());
                String compliance = row.compliance().isBlank() ? "" : escape(row.compliance());
                String offeredSpec = row.offeredSpecification().isBlank() ? "" : escape(row.offeredSpecification()).replace("\n", "<br/>");
                String deviations = row.deviations().isBlank() ? "" : escape(row.deviations());
                out.append("<tr").append(row.heading() ? " class=\"heading\""
                                : row.wording().length() > 1200 ? " class=\"long\"" : "")
                        .append("><td class=\"reference\">").append(escape(reference))
                        .append("</td><td>").append(cleanWording)
                        .append("</td><td class=\"compliance-cell\">").append(compliance)
                        .append("</td><td>").append(offeredSpec)
                        .append("</td><td class=\"deviations-cell\">").append(deviations).append("</td></tr>");
            }
            out.append("</tbody></table>");

            // Closing signatory & declaration block on the closing page
            String signatoryName = data.getOrDefault("signatoryName", "");
            String signatoryDesignation = data.getOrDefault("signatoryDesignation", "");
            String signatoryAddress = data.getOrDefault("signatoryAddress", "");

            if (!companyName.isBlank() || !signatoryName.isBlank() || !signatoryDesignation.isBlank()) {
                out.append("<div class=\"closing-block\">");
                if (!companyName.isBlank()) {
                    out.append("<div><strong>On behalf of ").append(escape(companyName)).append(" (Manufacturer)</strong></div>");
                }
                if (!signatoryName.isBlank() || !signatoryDesignation.isBlank()) {
                    out.append("<div class=\"closing-signatory\">");
                    out.append("<strong>Authorized Signatory</strong><br/>");
                    if (!signatoryName.isBlank()) {
                        out.append("Mr. ").append(escape(signatoryName));
                        if (!signatoryDesignation.isBlank()) {
                            String cleanDesg = signatoryDesignation.replace("Authorized Signatory – ", "")
                                    .replace("Authorized Signatory (", "").replace(")", "").trim();
                            if (!cleanDesg.isBlank()) out.append(" (").append(escape(cleanDesg)).append(")");
                        }
                        out.append("<br/>");
                    }
                    if (!bidDate.isBlank()) {
                        out.append("Dated : ").append(escape(bidDate)).append("<br/>");
                    }
                    if (!signatoryAddress.isBlank()) {
                        out.append(escape(signatoryAddress)).append("<br/>");
                    }
                    out.append("</div>");
                }
                out.append("</div>");
            }

            out.append("</div>"); // product div
        }
        return out.append("</body></html>").toString();
    }

    static byte[] docx(Map<String, String> data, List<SpecificationSheetContent.Product> products,
                       byte[] logo, byte[] partner) throws Exception {
        return docx(data, products, logo, partner, false);
    }

    static byte[] docx(Map<String, String> data, List<SpecificationSheetContent.Product> products,
                       byte[] logo, byte[] partner, boolean combined) throws Exception {
        if (combined) products = List.of(SpecificationSheetContent.combined(products));
        try (XWPFDocument doc = new XWPFDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            CTSectPr section = doc.getDocument().getBody().addNewSectPr();
            CTPageSz size = section.addNewPgSz();
            size.setW(BigInteger.valueOf(11906)); size.setH(BigInteger.valueOf(16838));
            CTPageMar margin = section.addNewPgMar();
            margin.setTop(BigInteger.valueOf(1644)); margin.setBottom(BigInteger.valueOf(567));
            margin.setLeft(BigInteger.valueOf(454)); margin.setRight(BigInteger.valueOf(454));
            margin.setHeader(BigInteger.valueOf(170)); margin.setFooter(BigInteger.valueOf(170));
            XWPFHeader header = doc.createHeader(HeaderFooterType.DEFAULT);
            XWPFTable letterhead = header.createTable(1, 3);
            letterhead.setWidth("100%"); letterhead.removeBorders();
            picture(letterhead.getRow(0).getCell(0), logo, "logo.png", 62, 54);
            XWPFTableCell company = letterhead.getRow(0).getCell(1);
            company.setWidth("68%");
            String companyName = data.getOrDefault("companyName", "");
            String companyAddress = data.getOrDefault("companyAddress", "");
            String companyEmail = data.getOrDefault("companyEmail", "");
            String companyWebsite = data.getOrDefault("companyWebsite", "");
            String companyContact = data.getOrDefault("companyContact", "");

            if (!companyName.isBlank()) {
                XWPFRun companyRun = paragraph(company.getParagraphs().get(0),
                        companyName.toUpperCase(Locale.ROOT), true, 20);
                companyRun.setFontFamily("Calibri"); companyRun.setColor("4472C4");
            }
            if (!companyAddress.isBlank()) {
                paragraph(company.addParagraph(), companyAddress, false, 9).setFontFamily("Calibri");
            }
            if (!companyEmail.isBlank() || !companyWebsite.isBlank()) {
                String emailUrl = (!companyEmail.isBlank() ? "Email ID: " + companyEmail : "")
                        + (!companyWebsite.isBlank() ? " URL: " + companyWebsite : "");
                paragraph(company.addParagraph(), emailUrl, false, 9).setFontFamily("Calibri");
            }
            if (!companyContact.isBlank()) {
                paragraph(company.addParagraph(), "Contact No.: " + companyContact, false, 9).setFontFamily("Calibri");
            }
            picture(letterhead.getRow(0).getCell(2), partner, "partner.png", 82, 50);
            header.createParagraph().setBorderBottom(Borders.SINGLE);
            XWPFParagraph footer = doc.createFooter(HeaderFooterType.DEFAULT).createParagraph();
            footer.setAlignment(ParagraphAlignment.CENTER);
            paragraph(footer, "Page ", false, 9);
            footer.getCTP().addNewFldSimple().setInstr("PAGE");
            int ordinal = 0;
            for (var product : products) {
                XWPFParagraph title = doc.createParagraph();
                if (ordinal++ > 0) title.setPageBreak(true);
                title.setAlignment(ParagraphAlignment.CENTER);
                keepNext(title);
                paragraph(title, TITLE, true, 12);

                // Recipient block
                String recipientName = data.getOrDefault("recipientName", "");
                String recipientAddress = data.getOrDefault("recipientAddress", "");
                if (!recipientName.isBlank() || !recipientAddress.isBlank()) {
                    XWPFParagraph recP = doc.createParagraph();
                    keepNext(recP);
                    paragraph(recP, "To,", true, 10).addBreak();
                    if (!recipientName.isBlank()) paragraph(recP, recipientName, false, 10).addBreak();
                    if (!recipientAddress.isBlank()) paragraph(recP, recipientAddress, false, 10);
                }

                // Metadata block
                String subject = data.getOrDefault("subject", "");
                if (subject.isBlank()) {
                    String pName = product.name();
                    if (pName == null || pName.isBlank()) pName = data.getOrDefault("productName", data.getOrDefault("productDescription", ""));
                    subject = pName.isBlank() ? "Technical Compliance Data Sheet" : "Technical Compliance Data Sheet - " + pName;
                }
                String bidNumber = data.getOrDefault("bidNumber", "");
                String bidDate = data.getOrDefault("date", "");
                String productDisplayName = product.name();
                if (combined && (productDisplayName == null || productDisplayName.isBlank() || productDisplayName.equalsIgnoreCase("Combined Technical Specifications"))) {
                    productDisplayName = data.getOrDefault("productName", data.getOrDefault("productDescription", product.name()));
                } else if (productDisplayName == null || productDisplayName.isBlank()) {
                    productDisplayName = data.getOrDefault("productName", data.getOrDefault("productDescription", ""));
                }
                String qty = data.getOrDefault("qty", data.getOrDefault("bidQty", ""));
                String make = data.getOrDefault("offeredMake", "MarkEn");
                String model = data.getOrDefault("offeredModel", "");

                boolean hasMeta = !subject.isBlank() || !bidNumber.isBlank() || !productDisplayName.isBlank()
                        || !qty.isBlank() || !make.isBlank() || !model.isBlank();

                if (hasMeta) {
                    XWPFParagraph metaP = doc.createParagraph();
                    keepNext(metaP);
                    if (!subject.isBlank()) paragraph(metaP, "Subject: " + subject, true, 10).addBreak();
                    if (!bidNumber.isBlank()) {
                        String refDisplay = bidNumber + (bidDate.isBlank() ? "" : ", Dated: " + bidDate);
                        paragraph(metaP, "Reference Bid Number: " + refDisplay, true, 10).addBreak();
                    }
                    if (!productDisplayName.isBlank()) paragraph(metaP, "Product: " + productDisplayName, true, 10).addBreak();
                    if (!qty.isBlank()) paragraph(metaP, "Qty: " + qty, true, 10).addBreak();
                    if (!make.isBlank() && !"-".equals(make.trim())) paragraph(metaP, "Make: " + make, true, 10).addBreak();
                    if (!model.isBlank() && !"-".equals(model.trim())) paragraph(metaP, "Model no: " + model, true, 10);
                }

                if (!combined && product.schedule() != null && !product.schedule().isBlank()) {
                    XWPFParagraph schedule = doc.createParagraph();
                    keepNext(schedule); schedule.setSpacingBefore(140);
                    paragraph(schedule, "Schedule No. " + product.schedule(), true, 11);
                }

                XWPFTable table = doc.createTable(1, 5);
                table.setWidth("100%");
                table.setCellMargins(30, 75, 30, 75);
                table.getCTTbl().getTblPr().addNewTblLayout().setType(STTblLayoutType.FIXED);
                table.getRow(0).setRepeatHeader(true);

                String col2Header = productDisplayName.toLowerCase(Locale.ROOT).contains("blood bag")
                        ? "Blood Bag Refrigerator Technical Specification (Tender Requirement)"
                        : (!productDisplayName.isBlank() && !combined && !productDisplayName.equalsIgnoreCase("Combined Technical Specifications")
                                ? productDisplayName + " Technical Specification (Tender Requirement)"
                        : "Technical Specification (Tender Requirement)");
                String col4Header = (make.isBlank() || "-".equals(make.trim())) ? "Offered Specification" : make + " - Offered Specification";
                String[] docxHeaders = {"Sr. no.", col2Header, "Compliance Yes / No", col4Header, "Any Deviations"};

                for (int i = 0; i < 5; i++) {
                    XWPFTableCell c = table.getRow(0).getCell(i);
                    cell(c, docxHeaders[i], WIDTHS[i], true);
                    c.setColor("F6C5AC");
                }

                int displayPosition = 0;
                for (var row : product.rows()) {
                    String reference = displayedReference(row, ++displayPosition);
                    XWPFTableRow output = table.createRow();
                    // createRow can inherit the preceding merged heading's single-cell grid.
                    while (output.getTableCells().size() < 5) output.addNewTableCell();
                    for (var outputCell : output.getTableCells()) {
                        var properties = outputCell.getCTTc().getTcPr();
                        if (properties != null && properties.isSetGridSpan()) properties.unsetGridSpan();
                    }
                    if (combined && row.heading()) {
                        var heading = output.getCell(0);
                        cell(heading, row.wording(), 100, true);
                        keepNext(heading.getParagraphs().get(0));
                        heading.getCTTc().getTcPr().addNewGridSpan().setVal(BigInteger.valueOf(5));
                        for (int i = 4; i >= 1; i--) output.removeCell(i);
                        continue;
                    }
                    for (int i = 0; i < 5; i++) {
                        String text = i == 0 ? reference
                                : i == 1 ? row.wording()
                                : i == 2 ? row.compliance()
                                : i == 3 ? row.offeredSpecification()
                                : row.deviations();
                        cell(output.getCell(i), text, WIDTHS[i], row.heading() || i == 0 || (i == 2 && !text.isBlank()));
                        if (row.heading()) keepNext(output.getCell(i).getParagraphs().get(0));
                    }
                }

                // Closing signatory block
                String signatoryName = data.getOrDefault("signatoryName", "");
                String signatoryDesignation = data.getOrDefault("signatoryDesignation", "");
                String signatoryAddress = data.getOrDefault("signatoryAddress", "");

                if (!companyName.isBlank()) {
                    XWPFParagraph closing = doc.createParagraph();
                    closing.setSpacingBefore(200);
                    keepNext(closing);
                    paragraph(closing, "On behalf of " + companyName + " (Manufacturer)", true, 10);
                }

                if (!signatoryName.isBlank() || !signatoryDesignation.isBlank()) {
                    XWPFParagraph sigP = doc.createParagraph();
                    sigP.setSpacingBefore(100);
                    keepNext(sigP);
                    paragraph(sigP, "Authorized Signatory", true, 10).addBreak();
                    if (!signatoryName.isBlank()) {
                        String cleanDesg = signatoryDesignation.replace("Authorized Signatory – ", "").replace("Authorized Signatory (", "").replace(")", "").trim();
                        paragraph(sigP, "Mr. " + signatoryName + (cleanDesg.isBlank() ? "" : " (" + cleanDesg + ")"), false, 10).addBreak();
                    }
                    if (!bidDate.isBlank()) paragraph(sigP, "Dated : " + bidDate, false, 10).addBreak();
                    if (!signatoryAddress.isBlank()) paragraph(sigP, signatoryAddress, false, 10);
                }

                if (!product.clarifications().isEmpty()) {
                    XWPFParagraph heading = doc.createParagraph(); keepNext(heading);
                    paragraph(heading, "Source Clarifications", true, 11);
                    int note = 0;
                    for (String text : product.clarifications()) paragraph(doc.createParagraph(),
                            (++note) + ". " + text, false, 10);
                }
            }
            doc.write(out); return out.toByteArray();
        }
    }

    private static void cell(XWPFTableCell cell, String text, int width, boolean bold) {
        cell.setWidth(width + "%");
        XWPFParagraph p = cell.getParagraphs().get(0);
        p.setSpacingBefore(0); p.setSpacingAfter(0); p.setSpacingBetween(1.0);
        Matcher matcher = SpecificationSheetContent.EMPHASIS.matcher(text);
        int at = 0;
        while (matcher.find()) {
            paragraph(p, text.substring(at, matcher.start()), bold, 10);
            paragraph(p, matcher.group(), true, 10); at = matcher.end();
        }
        paragraph(p, text.substring(at), bold, 10);
    }

    private static void keepNext(XWPFParagraph paragraph) {
        if (!paragraph.getCTP().isSetPPr()) paragraph.getCTP().addNewPPr();
        paragraph.setKeepNext(true);
    }

    static byte[] xlsx(Map<String, String> data, List<SpecificationSheetContent.Product> products) throws IOException {
        return xlsx(data, products, false);
    }

    static byte[] xlsx(Map<String, String> data, List<SpecificationSheetContent.Product> products,
                       boolean combined) throws IOException {
        if (combined) products = List.of(SpecificationSheetContent.combined(products));
        try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            for (var product : products) {
                Sheet sheet = workbook.createSheet(uniqueSheetName(workbook, product.schedule() + " " + product.name()));
                int headerIndex = combined ? 2 : 5;
                sheet.setDisplayGridlines(false);
                sheet.createFreezePane(0, headerIndex + 1);
                sheet.setRepeatingRows(new CellRangeAddress(headerIndex, headerIndex, -1, -1));
                sheet.getPrintSetup().setPaperSize(PrintSetup.A4_PAPERSIZE);
                sheet.getPrintSetup().setLandscape(false);
                sheet.setFitToPage(true);
                sheet.getPrintSetup().setFitWidth((short) 1);
                sheet.getPrintSetup().setFitHeight((short) 0);

                CellStyle companyStyle = style(workbook, true, 14, HorizontalAlignment.CENTER, false);
                CellStyle titleStyle = style(workbook, true, 11, HorizontalAlignment.CENTER, false);
                CellStyle headerStyle = peachHeaderStyle(workbook);
                CellStyle referenceStyle = borderedStyle(workbook, true, HorizontalAlignment.CENTER);
                CellStyle requirementStyle = borderedStyle(workbook, false, HorizontalAlignment.LEFT);
                CellStyle headingStyle = borderedStyle(workbook, true, HorizontalAlignment.LEFT);
                CellStyle complianceStyle = borderedStyle(workbook, true, HorizontalAlignment.CENTER);
                CellStyle deviationsStyle = borderedStyle(workbook, false, HorizontalAlignment.CENTER);

                mergedRow(sheet, 0, data.getOrDefault("companyName", "").toUpperCase(Locale.ROOT), companyStyle);
                mergedRow(sheet, 1, TITLE, titleStyle);
                String make = data.getOrDefault("offeredMake", "");
                String model = data.getOrDefault("offeredModel", "");
                if (!combined) {
                    mergedRow(sheet, 2, "Schedule No. " + product.schedule(), titleStyle);
                    mergedRow(sheet, 3, product.name(), titleStyle);
                    mergedRow(sheet, 4, "Make: " + (make.isBlank() ? "-" : make) + "    Model No.: " + (model.isBlank() ? "-" : model), titleStyle);
                }

                Row header = sheet.createRow(headerIndex);
                header.setHeightInPoints(32);
                String productDisplayName = product.name();
                if (combined && (productDisplayName == null || productDisplayName.isBlank() || productDisplayName.equalsIgnoreCase("Combined Technical Specifications"))) {
                    productDisplayName = data.getOrDefault("productName", data.getOrDefault("productDescription", product.name()));
                } else if (productDisplayName == null || productDisplayName.isBlank()) {
                    productDisplayName = data.getOrDefault("productName", data.getOrDefault("productDescription", ""));
                }
                String col2Header = productDisplayName.toLowerCase(Locale.ROOT).contains("blood bag")
                        ? "Blood Bag Refrigerator Technical Specification (Tender Requirement)"
                        : (!productDisplayName.isBlank() && !combined && !productDisplayName.equalsIgnoreCase("Combined Technical Specifications")
                                ? productDisplayName + " Technical Specification (Tender Requirement)"
                        : "Technical Specification (Tender Requirement)");
                String col4Header = (make.isBlank() || "-".equals(make.trim())) ? "Offered Specification" : make + " - Offered Specification";
                String[] xlsxHeaders = {"Sr. no.", col2Header, "Compliance Yes / No", col4Header, "Any Deviations"};

                for (int column = 0; column < xlsxHeaders.length; column++) {
                    org.apache.poi.ss.usermodel.Cell cell = header.createCell(column);
                    cell.setCellValue(xlsxHeaders[column]);
                    cell.setCellStyle(headerStyle);
                }

                int displayPosition = 0;
                for (var source : product.rows()) {
                    Row row = sheet.createRow(sheet.getLastRowNum() + 1);
                    if (combined && source.heading()) {
                        mergedRow(sheet, row.getRowNum(), source.wording(), headingStyle);
                        continue;
                    }
                    org.apache.poi.ss.usermodel.Cell reference = row.createCell(0);
                    reference.setCellValue(displayedReference(source, ++displayPosition));
                    reference.setCellStyle(referenceStyle);

                    org.apache.poi.ss.usermodel.Cell wording = row.createCell(1);
                    wording.setCellValue(source.wording());
                    wording.setCellStyle(source.heading() ? headingStyle : requirementStyle);

                    org.apache.poi.ss.usermodel.Cell compCell = row.createCell(2);
                    compCell.setCellValue(source.compliance());
                    compCell.setCellStyle(complianceStyle);

                    org.apache.poi.ss.usermodel.Cell offeredCell = row.createCell(3);
                    offeredCell.setCellValue(source.offeredSpecification());
                    offeredCell.setCellStyle(requirementStyle);

                    org.apache.poi.ss.usermodel.Cell devCell = row.createCell(4);
                    devCell.setCellValue(source.deviations());
                    devCell.setCellStyle(deviationsStyle);
                }
                for (int column = 0; column < WIDTHS.length; column++) {
                    sheet.setColumnWidth(column, WIDTHS[column] * 256);
                }
                sheet.setAutobreaks(true);
                workbook.setPrintArea(workbook.getSheetIndex(sheet), 0, HEADERS.length - 1, 0, sheet.getLastRowNum());
            }
            workbook.write(out);
            return out.toByteArray();
        }
    }

    private static CellStyle peachHeaderStyle(Workbook workbook) {
        CellStyle style = style(workbook, true, 10, HorizontalAlignment.CENTER, true);
        if (workbook instanceof XSSFWorkbook xssf) {
            org.apache.poi.xssf.usermodel.XSSFCellStyle xssfStyle = (org.apache.poi.xssf.usermodel.XSSFCellStyle) style;
            xssfStyle.setFillForegroundColor(new org.apache.poi.xssf.usermodel.XSSFColor(new java.awt.Color(246, 197, 172), new org.apache.poi.xssf.usermodel.DefaultIndexedColorMap()));
            xssfStyle.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        }
        return style;
    }

    private static CellStyle style(Workbook workbook, boolean bold, int size,
                                   HorizontalAlignment alignment, boolean bordered) {
        CellStyle style = workbook.createCellStyle();
        Font font = workbook.createFont();
        font.setFontName("Cambria");
        font.setFontHeightInPoints((short) size);
        font.setBold(bold);
        style.setFont(font);
        style.setAlignment(alignment);
        style.setVerticalAlignment(VerticalAlignment.TOP);
        style.setWrapText(true);
        if (bordered) {
            style.setBorderTop(BorderStyle.THIN);
            style.setBorderRight(BorderStyle.THIN);
            style.setBorderBottom(BorderStyle.THIN);
            style.setBorderLeft(BorderStyle.THIN);
        }
        return style;
    }

    private static CellStyle borderedStyle(Workbook workbook, boolean bold, HorizontalAlignment alignment) {
        return style(workbook, bold, 11, alignment, true);
    }

    private static void mergedRow(Sheet sheet, int rowNumber, String value, CellStyle style) {
        Row row = sheet.createRow(rowNumber);
        org.apache.poi.ss.usermodel.Cell cell = row.createCell(0);
        cell.setCellValue(value);
        cell.setCellStyle(style);
        sheet.addMergedRegion(new CellRangeAddress(rowNumber, rowNumber, 0, HEADERS.length - 1));
    }

    private static String uniqueSheetName(Workbook workbook, String requested) {
        String base = requested.replaceAll("[\\\\/?*\\[\\]:]", " ").trim().replaceAll("\\s+", " ");
        if (base.isBlank()) base = "Technical Data Sheet";
        if (base.length() > 31) base = base.substring(0, 31).trim();
        String candidate = base;
        for (int suffix = 2; workbook.getSheet(candidate) != null; suffix++) {
            String marker = " (" + suffix + ")";
            candidate = base.substring(0, Math.min(base.length(), 31 - marker.length())).trim() + marker;
        }
        return candidate;
    }

    /** Final rendering guard: a malformed or legacy caller can never produce a blank Sr. No. cell. */
    private static String displayedReference(SpecificationSheetContent.Row row, int displayPosition) {
        String reference = row.reference() == null ? "" : row.reference().trim();
        return reference.isBlank() ? String.valueOf(displayPosition) : reference;
    }

    private static XWPFRun paragraph(XWPFParagraph p, String text, boolean bold, int size) {
        p.setSpacingAfter(0); p.setSpacingBefore(0);
        XWPFRun run = p.createRun(); run.setFontFamily("Cambria"); run.setFontSize(size);
        run.setBold(bold);
        String[] lines = text.split("\\R", -1);
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) run.addBreak();
            run.setText(lines[i]);
        }
        return run;
    }
    private static void picture(XWPFTableCell cell, byte[] bytes, String name, int width, int height) throws Exception {
        if (bytes != null) cell.getParagraphs().get(0).createRun().addPicture(new ByteArrayInputStream(bytes),
                XWPFDocument.PICTURE_TYPE_PNG, name, width * 12700, height * 12700);
    }
    private static String image(byte[] bytes, int width) {
        return bytes == null ? "" : "<img style=\"width:" + width + "pt\" src=\"data:image/png;base64,"
                + Base64.getEncoder().encodeToString(bytes) + "\"/>";
    }
    private static String emphasize(String text) {
        Matcher matcher = SpecificationSheetContent.EMPHASIS.matcher(text);
        StringBuilder result = new StringBuilder(); int at = 0;
        while (matcher.find()) {
            result.append(escape(text.substring(at, matcher.start()))).append("<strong>")
                    .append(escape(matcher.group())).append("</strong>"); at = matcher.end();
        }
        return result.append(escape(text.substring(at))).toString();
    }
    private static String escape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&#39;");
    }
}
