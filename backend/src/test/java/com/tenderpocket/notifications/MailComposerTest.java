package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.tenderpocket.notifications.NotifyTestData.*;
import static com.tenderpocket.notifications.PendingActionKey.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * The guarantees behind "nothing is lost": the body shows at most 200 rows and stays under
 * Gmail's clipping size; whenever it cannot show every row, the Excel file is attached and
 * holds every row with its full text.
 */
class MailComposerTest {

    private final LocalDate today = LocalDate.of(2026, 11, 12);
    private final LocalDateTime now = today.atTime(9, 0);
    private final RecipientDirectory dir = directory();
    private final DigestBuilder builder = new DigestBuilder(3, 3);
    private static final String APP = "http://13.232.232.54:8085";

    private ClockSnapshot.TenderEntry entry(Tender t, PendingActionKey key, List<String> owners, int waiting) {
        return new ClockSnapshot.TenderEntry(t, List.of(new ClockSnapshot.WorkItem(key, dir.resolve(new PendingWork(key, owners)),
                today.minusDays(waiting).atTime(10, 0))));
    }

    private static Tender titled(Tender t, int i) {
        t.setTitle("Supply, installation and commissioning of medical equipment item " + i + " for the district hospital");
        t.setAuthority("Department of Health and Family Welfare, Government of Example State");
        return t;
    }

    private Tender due(Tender t, int days) {
        t.setDueDate(today.plusDays(days) + " 15:00:00");
        return t;
    }

    /** MIS with {@code n} undecided tenders waiting 4+ days, due 4..33 days ahead. */
    private Digest misPending(int n) {
        List<ClockSnapshot.TenderEntry> entries = new ArrayList<>();
        for (int i = 1; i <= n; i++) {
            entries.add(entry(due(titled(undecided(String.format("P%04d", i)), i), 4 + (i % 30)), DECIDE, List.of(), 4 + (i % 9)));
        }
        return builder.buildPending(dir.find("misteam"), builder.prepare(new ClockSnapshot(now, entries, dir), today), today, List.of());
    }

    private static List<String> bodyIds(String html) {
        List<String> ids = new ArrayList<>();
        Matcher m = Pattern.compile("/tenders/([^\"]+)\"").matcher(html);
        while (m.find()) ids.add(m.group(1));
        return ids;
    }

    /** Every data row of the first sheet, as {TenderPocket ID, Shown in mail}. */
    private static List<String[]> excelRows(byte[] xlsx) throws Exception {
        try (XSSFWorkbook wb = new XSSFWorkbook(new ByteArrayInputStream(xlsx))) {
            Sheet sheet = wb.getSheetAt(0);
            Row header = sheet.getRow(0);
            int idCol = -1, shownCol = -1;
            for (int c = 0; c < header.getLastCellNum(); c++) {
                String h = header.getCell(c).getStringCellValue();
                if (h.equals("TenderPocket ID")) idCol = c;
                if (h.equals("Shown in mail")) shownCol = c;
            }
            List<String[]> out = new ArrayList<>();
            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                Row row = sheet.getRow(r);
                out.add(new String[]{row.getCell(idCol).getStringCellValue(), row.getCell(shownCol).getStringCellValue()});
            }
            return out;
        }
    }

    @Test
    void upTo200RowsGoInTheBodyWithoutAnAttachment() {
        MailComposer.ComposedMail mail = MailComposer.compose(misPending(150), APP, 200, now);
        assertEquals(150, mail.totalRows());
        assertEquals(150, mail.bodyRows());
        assertNull(mail.attachment());
        assertEquals(150, bodyIds(mail.html()).size());
        assertFalse(mail.subject().contains("attached"));
        assertTrue(mail.htmlBytes() < MailComposer.BODY_BUDGET_BYTES);
    }

    /** MIS with {@code n} short rows (short title, no authority). */
    private Digest misPendingShort(int n) {
        List<ClockSnapshot.TenderEntry> entries = new ArrayList<>();
        for (int i = 1; i <= n; i++) {
            Tender t = undecided(String.format("S%04d", i));
            t.setTitle("Item " + i);
            t.setAuthority(null);
            t.setRefNo(null);
            entries.add(entry(due(t, 4 + (i % 30)), DECIDE, List.of(), 5));
        }
        return builder.buildPending(dir.find("misteam"), builder.prepare(new ClockSnapshot(now, entries, dir), today), today, List.of());
    }

    @Test
    void exactly200ShortRowsFitAnd201NeedTheExcel() throws Exception {
        MailComposer.ComposedMail at200 = MailComposer.compose(misPendingShort(200), APP, 200, now);
        assertEquals(200, at200.bodyRows());
        assertNull(at200.attachment());

        MailComposer.ComposedMail at201 = MailComposer.compose(misPendingShort(201), APP, 200, now);
        assertEquals(200, at201.bodyRows());
        assertNotNull(at201.attachment(), "one row more than 200 must produce the Excel file");
        assertEquals(201, at201.attachment().rows());
        assertEquals(201, excelRows(at201.attachment().bytes()).size());
        assertTrue(at201.subject().endsWith("(full list attached)"));
    }

    @Test
    void twoHundredTypicalRowsTooBigForFullDetailsAreAllListedWithTheExcelAttached() throws Exception {
        MailComposer.ComposedMail mail = MailComposer.compose(misPending(200), APP, 200, now);
        assertEquals(200, mail.totalRows());
        assertEquals(200, mail.bodyRows(), "every row is still listed, in short form");
        assertNotNull(mail.attachment(), "full details (authority) did not fit, so they go in the Excel file");
        assertEquals(200, excelRows(mail.attachment().bytes()).size());
        assertTrue(mail.html().contains("lists all <strong>200</strong> rows in short form"));
        assertFalse(mail.html().contains("Department of Health and Family Welfare"), "authority left to the Excel file");
        assertTrue(mail.htmlBytes() <= MailComposer.BODY_BUDGET_BYTES);
    }

    @Test
    void misWith480TendersGets200InTheBodyAndAll480InTheExcel() throws Exception {
        MailComposer.ComposedMail mail = MailComposer.compose(misPending(480), APP, 200, now);
        assertEquals(480, mail.totalRows());
        assertEquals(200, mail.bodyRows());
        assertTrue(mail.htmlBytes() < MailComposer.BODY_BUDGET_BYTES, "body is " + mail.htmlBytes() + " bytes");

        MailComposer.Attachment x = mail.attachment();
        assertNotNull(x);
        assertEquals("TenderPocket_misteam_Pending_2026-11-12.xlsx", x.fileName());
        assertEquals(DigestExcel.CONTENT_TYPE, x.contentType());
        List<String[]> rows = excelRows(x.bytes());
        assertEquals(480, rows.size());

        Set<String> excelIds = new HashSet<>();
        Set<String> shownInExcel = new HashSet<>();
        for (String[] r : rows) {
            excelIds.add(r[0]);
            if (r[1].equals("Yes")) shownInExcel.add(r[0]);
        }
        Set<String> expected = new HashSet<>();
        for (int i = 1; i <= 480; i++) expected.add(String.format("P%04d", i));
        assertEquals(expected, excelIds, "every tender is in the Excel file");

        Set<String> inBody = new HashSet<>(bodyIds(mail.html()));
        assertEquals(200, inBody.size());
        assertEquals(inBody, shownInExcel, "the 'Shown in mail' column matches the body exactly");

        assertTrue(mail.html().contains("Full list attached."));
        assertTrue(mail.html().contains("TenderPocket_misteam_Pending_2026-11-12.xlsx"));
        assertTrue(mail.html().contains("Summary of all 480 rows"));
        assertTrue(mail.text().contains("FULL LIST ATTACHED"));
    }

    @Test
    void theBodyKeepsTheNearestDeadlinesWhenRowsAreCut() {
        Digest d = misPending(480);
        MailComposer.ComposedMail mail = MailComposer.compose(d, APP, 200, now);
        Set<String> inBody = new HashSet<>(bodyIds(mail.html()));
        int maxShown = d.pendingRows().stream().filter(r -> inBody.contains(r.tender().getId())).mapToInt(r -> r.daysLeft()).max().orElseThrow();
        int minCut = d.pendingRows().stream().filter(r -> !inBody.contains(r.tender().getId())).mapToInt(r -> r.daysLeft()).min().orElseThrow();
        assertTrue(maxShown <= minCut, "rows left for the Excel file are due later than every row in the body");
    }

    @Test
    void longRowsThatDoNotFitGmailGoToTheExcelEvenUnder200() throws Exception {
        List<ClockSnapshot.TenderEntry> entries = new ArrayList<>();
        for (int i = 1; i <= 150; i++) {
            Tender t = due(assigned(String.format("L%03d", i), "executive"), i % 4);
            t.setTitle("Rate contract for supply of " + "consumables, reagents, spares and accessories ".repeat(8) + "item " + i);
            t.setAuthority("Directorate of Medical Education and Research, " + "Government Medical College and Hospital ".repeat(3));
            entries.add(entry(t, SPEC_PREP, List.of("executive"), 2));
        }
        Digest d = builder.buildDue(dir.find("executive"), builder.prepare(new ClockSnapshot(now, entries, dir), today), today);
        MailComposer.ComposedMail mail = MailComposer.compose(d, APP, 200, now);

        assertEquals(150, mail.totalRows());
        assertTrue(mail.bodyRows() < 150, "only " + mail.bodyRows() + " long rows fit");
        assertTrue(mail.bodyRows() > 0);
        assertTrue(mail.htmlBytes() <= MailComposer.BODY_BUDGET_BYTES, "body is " + mail.htmlBytes() + " bytes");
        assertNotNull(mail.attachment(), "rows that do not fit must go to the Excel file");
        assertEquals(150, excelRows(mail.attachment().bytes()).size());

        try (XSSFWorkbook wb = new XSSFWorkbook(new ByteArrayInputStream(mail.attachment().bytes()))) {
            String fullTitle = wb.getSheetAt(0).getRow(1).getCell(4).getStringCellValue();
            assertTrue(fullTitle.startsWith("Rate contract for supply of ") && fullTitle.contains(" item "), "full title kept in Excel");
        }
    }

    @Test
    void dueMailKeepsTodayFirstAndWorkUnderWayBeforeUndecidedOnTheSameDay() {
        List<ClockSnapshot.TenderEntry> entries = new ArrayList<>();
        for (int i = 1; i <= 300; i++) {
            Tender t = i % 3 == 0 ? due(titled(assigned("D" + i, "executive"), i), i % 4) : due(titled(undecided("D" + i), i), i % 4);
            entries.add(entry(t, i % 3 == 0 ? SPEC_PREP : DECIDE, i % 3 == 0 ? List.of("executive") : List.of(), 1));
        }
        Digest d = builder.buildDue(dir.find("misteam"), builder.prepare(new ClockSnapshot(now, entries, dir), today), today);
        MailComposer.ComposedMail mail = MailComposer.compose(d, APP, 200, now);
        assertEquals(300, mail.totalRows());
        assertNotNull(mail.attachment());

        MailComposer.MailView v = MailComposer.view(d, mail.bodyRows(), "x.xlsx");
        long todayInBody = v.dueRows().stream().filter(r -> r.daysLeft() == 0).count();
        long todayTotal = d.dueRows().stream().filter(r -> r.daysLeft() == 0).count();
        assertEquals(todayTotal, todayInBody, "every tender due today is in the body");
        for (int i = 1; i < v.dueRows().size(); i++) {
            Digest.DueRow a = v.dueRows().get(i - 1), b = v.dueRows().get(i);
            assertTrue(a.daysLeft() < b.daysLeft() || (a.daysLeft() == b.daysLeft() && (a.inProgress() || !b.inProgress())));
        }
    }

    @Test
    void adminDueIncludesMissedYesterdayInBodyOrExcel() throws Exception {
        List<ClockSnapshot.TenderEntry> entries = new ArrayList<>();
        for (int i = 1; i <= 220; i++) entries.add(entry(due(titled(undecided("A" + i), i), i % 4), DECIDE, List.of(), 1));
        for (int i = 1; i <= 5; i++) entries.add(entry(due(titled(assigned("M" + i, "executive"), i), -1), SPEC_PREP, List.of("executive"), 6));
        Digest d = builder.buildDue(dir.find("admin"), builder.prepare(new ClockSnapshot(now, entries, dir), today), today);
        MailComposer.ComposedMail mail = MailComposer.compose(d, APP, 200, now);
        assertEquals(225, mail.totalRows());
        List<String[]> rows = excelRows(mail.attachment().bytes());
        assertEquals(225, rows.size());
        assertEquals(5, rows.stream().filter(r -> r[0].startsWith("M")).count(), "missed-yesterday rows are in the Excel file");
    }

    @Test
    void largeListsStayFast() {
        long start = System.nanoTime();
        MailComposer.ComposedMail mail = MailComposer.compose(misPending(10_000), APP, 200, now);
        long ms = (System.nanoTime() - start) / 1_000_000;
        assertEquals(10_000, mail.attachment().rows());
        assertEquals(200, mail.bodyRows());
        assertTrue(ms < 20_000, "10,000 rows took " + ms + " ms");
    }
}
