package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import com.tenderpocket.notifications.Digest.DueRow;
import com.tenderpocket.notifications.Digest.PendingRow;
import com.tenderpocket.notifications.Digest.WorkLine;
import org.apache.poi.common.usermodel.HyperlinkType;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.CreationHelper;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.Font;
import org.apache.poi.ss.usermodel.Hyperlink;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/**
 * The Excel attachment: every row of a mail, with full titles and authorities, so nothing is
 * lost when the mail body cannot show everything. One row per tender in the Due list and one
 * row per waiting action in the Pending list, in the same order and groups as the mail, with a
 * column saying whether the row is also in the mail body.
 */
public final class DigestExcel {

    private DigestExcel() {}

    public static final String CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    /** Excel's limit for one cell. */
    private static final int MAX_CELL = 32_000;

    public static String fileName(Digest d) {
        String login = d.recipient().username().replaceAll("[^A-Za-z0-9._-]", "_");
        return "TenderPocket_" + login + "_" + (d.type() == Digest.DigestType.DUE ? "Due" : "Pending") + "_" + d.date() + ".xlsx";
    }

    /**
     * @param shownTenderKeys keys (see {@link #key}) of the rows that are also in the mail body
     */
    public static byte[] build(Digest d, Set<String> shownTenderKeys, String appUrl, LocalDateTime generatedAt) {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Styles st = new Styles(wb);
            Sheet sheet = wb.createSheet(d.type() == Digest.DigestType.DUE ? "Due tenders" : "Waiting tenders");
            int rows = d.type() == Digest.DigestType.DUE
                    ? writeDue(sheet, st, d, shownTenderKeys, appUrl)
                    : writePending(sheet, st, d, shownTenderKeys, appUrl);
            sheet.createFreezePane(0, 1);
            int lastCol = sheet.getRow(0).getLastCellNum() - 1;
            sheet.setAutoFilter(new CellRangeAddress(0, Math.max(0, rows), 0, lastCol));
            writeAbout(wb.createSheet("About"), st, d, rows, shownTenderKeys.size(), generatedAt);
            wb.write(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Could not build the Excel attachment: " + e.getMessage(), e);
        }
    }

    /** Identifies a row: the tender for Due rows, tender plus action for Pending rows. */
    public static String key(Tender t, PendingActionKey action) {
        return t.getId() + (action == null ? "" : "|" + action.name());
    }

    private static int writeDue(Sheet sheet, Styles st, Digest d, Set<String> shown, String appUrl) {
        String[] headers = {"#", "Section", "Tender ID", "TenderPocket ID", "Title", "Authority", "Due date", "Due time",
                "Days left", "Waiting on (who: action, days waiting)", "Longest wait (days)", "Shown in mail", "Link"};
        int[] widths = {6, 18, 24, 22, 70, 40, 13, 9, 9, 60, 12, 12, 45};
        header(sheet, st, headers, widths);
        List<DueRow> due = new ArrayList<>(d.dueRows());
        due.sort(DigestBuilder.DUE_ORDER);
        List<DueRow> missed = new ArrayList<>(d.missedRows());
        missed.sort(DigestBuilder.MISSED_ORDER);

        int r = 0;
        for (DueRow row : due) {
            r++;
            String section = row.daysLeft() == 0 ? "Due today" : row.daysLeft() == 1 ? "Due in 1 day" : "Due in " + row.daysLeft() + " days";
            dueLine(sheet.createRow(r), st, r, section, row, shown, appUrl);
        }
        for (DueRow row : missed) {
            r++;
            dueLine(sheet.createRow(r), st, r, "Missed yesterday", row, shown, appUrl);
        }
        return r;
    }

    private static void dueLine(Row x, Styles st, int n, String section, DueRow row, Set<String> shown, String appUrl) {
        Tender t = row.tender();
        StringBuilder waiting = new StringBuilder();
        long longest = 0;
        for (WorkLine w : row.works()) {
            if (waiting.length() > 0) waiting.append("; ");
            waiting.append(w.ownerLabel()).append(": ").append(w.key().getLabel()).append(" (").append(w.waitingDays())
                    .append(w.waitingDays() == 1 ? " day)" : " days)");
            longest = Math.max(longest, w.waitingDays());
        }
        int c = 0;
        num(x, c++, n, st.text);
        text(x, c++, section, st.text);
        text(x, c++, DigestTemplates.displayId(t), st.text);
        text(x, c++, t.getId(), st.text);
        text(x, c++, t.getTitle(), st.wrap);
        text(x, c++, t.getAuthority(), st.wrap);
        date(x, c++, row.dueDate(), st);
        text(x, c++, row.dueTime(), st.text);
        num(x, c++, row.daysLeft(), st.text);
        text(x, c++, row.works().isEmpty() ? "No open action" : waiting.toString(), st.wrap);
        num(x, c++, longest, st.text);
        text(x, c++, shown.contains(key(t, null)) ? "Yes" : "No", st.text);
        link(x, c, DigestTemplates.link(appUrl, t), st);
    }

    private static int writePending(Sheet sheet, Styles st, Digest d, Set<String> shown, String appUrl) {
        String[] headers = {"#", d.isAdmin() ? "Owner" : "Group", "Tender ID", "TenderPocket ID", "Title", "Authority", "Action",
                "Owner", "Days waiting", "Due date", "Due time", "Days left", "Shown in mail", "Link"};
        int[] widths = {6, 26, 24, 22, 70, 40, 34, 22, 12, 13, 9, 9, 12, 45};
        header(sheet, st, headers, widths);
        List<PendingRow> rows = new ArrayList<>(d.pendingRows());
        Comparator<PendingRow> order = d.isAdmin() ? DigestBuilder.ADMIN_PENDING_DISPLAY : DigestBuilder.PENDING_DISPLAY;
        rows.sort(order);

        int r = 0;
        for (PendingRow row : rows) {
            r++;
            Row x = sheet.createRow(r);
            Tender t = row.tender();
            int c = 0;
            num(x, c++, r, st.text);
            text(x, c++, d.isAdmin() ? row.work().ownerLabel() : DigestTemplates.bandLabel(DigestBuilder.band(row), d.dueWindowDays()), st.text);
            text(x, c++, DigestTemplates.displayId(t), st.text);
            text(x, c++, t.getId(), st.text);
            text(x, c++, t.getTitle(), st.wrap);
            text(x, c++, t.getAuthority(), st.wrap);
            text(x, c++, row.work().key().getLabel(), st.text);
            text(x, c++, row.work().ownerLabel(), st.text);
            num(x, c++, row.work().waitingDays(), st.text);
            date(x, c++, row.dueDate(), st);
            text(x, c++, row.dueTime(), st.text);
            if (row.daysLeft() == null) text(x, c++, "No due date", st.text); else num(x, c++, row.daysLeft(), st.text);
            text(x, c++, shown.contains(key(t, row.work().key())) ? "Yes" : "No", st.text);
            link(x, c, DigestTemplates.link(appUrl, t), st);
        }
        return r;
    }

    private static void writeAbout(Sheet sheet, Styles st, Digest d, int rows, int shownRows, LocalDateTime generatedAt) {
        String[][] lines = {
                {"Mail", d.type() == Digest.DigestType.DUE ? "Due in the next " + d.dueWindowDays() + " days"
                        : "Waiting more than " + d.pendingDays() + " days"},
                {"For", d.recipient().username() + " (" + d.recipient().team().getLabel() + ")"},
                {"Date", d.date().format(DateTimeFormatter.ofPattern("d MMM yyyy"))},
                {"Rows in this file", String.valueOf(rows)},
                {"Rows also shown in the mail", String.valueOf(shownRows)},
                {"Generated", generatedAt.format(DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm")) + " IST"},
                {"Note", "This file lists every row of the mail, including the ones the mail body had no room for. "
                        + "Use the filter arrows in the header row to sort or search."},
        };
        sheet.setColumnWidth(0, 28 * 256);
        sheet.setColumnWidth(1, 100 * 256);
        for (int i = 0; i < lines.length; i++) {
            Row x = sheet.createRow(i);
            text(x, 0, lines[i][0], st.header);
            text(x, 1, lines[i][1], st.wrap);
        }
    }

    private static void header(Sheet sheet, Styles st, String[] headers, int[] widths) {
        Row h = sheet.createRow(0);
        for (int i = 0; i < headers.length; i++) {
            text(h, i, headers[i], st.header);
            sheet.setColumnWidth(i, widths[i] * 256);
        }
    }

    private static void text(Row x, int col, String value, CellStyle style) {
        Cell cell = x.createCell(col);
        String v = value == null ? "" : value;
        cell.setCellValue(v.length() > MAX_CELL ? v.substring(0, MAX_CELL) : v);
        cell.setCellStyle(style);
    }

    private static void num(Row x, int col, long value, CellStyle style) {
        Cell cell = x.createCell(col);
        cell.setCellValue(value);
        cell.setCellStyle(style);
    }

    private static void date(Row x, int col, LocalDate value, Styles st) {
        Cell cell = x.createCell(col);
        if (value == null) {
            cell.setCellValue("No due date");
            cell.setCellStyle(st.text);
        } else {
            cell.setCellValue(value);
            cell.setCellStyle(st.date);
        }
    }

    private static void link(Row x, int col, String url, Styles st) {
        Cell cell = x.createCell(col);
        if (url == null) {
            cell.setCellValue("");
            cell.setCellStyle(st.text);
            return;
        }
        cell.setCellValue(url);
        Hyperlink h = st.helper.createHyperlink(HyperlinkType.URL);
        h.setAddress(url);
        cell.setHyperlink(h);
        cell.setCellStyle(st.link);
    }

    /** Cell styles are shared: Excel allows only about 64,000 per file. */
    private static final class Styles {
        final CreationHelper helper;
        final CellStyle header;
        final CellStyle text;
        final CellStyle wrap;
        final CellStyle date;
        final CellStyle link;

        Styles(XSSFWorkbook wb) {
            helper = wb.getCreationHelper();
            Font bold = wb.createFont();
            bold.setBold(true);
            header = wb.createCellStyle();
            header.setFont(bold);
            header.setFillForegroundColor(IndexedColors.GREY_25_PERCENT.getIndex());
            header.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            header.setBorderBottom(BorderStyle.THIN);
            header.setVerticalAlignment(VerticalAlignment.TOP);
            header.setWrapText(true);

            text = wb.createCellStyle();
            text.setVerticalAlignment(VerticalAlignment.TOP);

            wrap = wb.createCellStyle();
            wrap.setVerticalAlignment(VerticalAlignment.TOP);
            wrap.setWrapText(true);

            date = wb.createCellStyle();
            date.setVerticalAlignment(VerticalAlignment.TOP);
            date.setDataFormat(helper.createDataFormat().getFormat("dd-mmm-yyyy"));

            Font blue = wb.createFont();
            blue.setUnderline(Font.U_SINGLE);
            blue.setColor(IndexedColors.BLUE.getIndex());
            link = wb.createCellStyle();
            link.setFont(blue);
            link.setVerticalAlignment(VerticalAlignment.TOP);
        }
    }
}
