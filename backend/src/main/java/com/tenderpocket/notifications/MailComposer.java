package com.tenderpocket.notifications;

import com.tenderpocket.notifications.Digest.DueRow;
import com.tenderpocket.notifications.Digest.PendingRow;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Turns a Digest into the mail that is actually sent.
 *
 * 1. If every row fits in the body with full details (at most {@code maxRows} rows and under
 *    {@link #BODY_BUDGET_BYTES}, so Gmail never clips the message), that is the mail.
 * 2. Otherwise an Excel file with every row, in full, is attached, and the body lists the most
 *    urgent rows in a compact form (full title, action, wait and due date; the authority is in
 *    the Excel file), as many as fit: at most {@code maxRows}, under the size budget.
 *
 * Every row is therefore always in the body, the attachment, or both, and the body says so.
 */
public final class MailComposer {

    private MailComposer() {}

    /** Kept below Gmail's ~102 KB clipping point, with room to spare. */
    public static final int BODY_BUDGET_BYTES = 95_000;

    public record Attachment(String fileName, String contentType, byte[] bytes, int rows) {}

    public record ComposedMail(String subject, String html, String text, Attachment attachment, int totalRows, int bodyRows) {
        public int htmlBytes() { return html.getBytes(StandardCharsets.UTF_8).length; }
    }

    /**
     * The rows that go in the body (most important first, then put in display order).
     *
     * @param compact rows leave out the authority line (only used when the Excel file is attached)
     */
    public record MailView(Digest digest, List<DueRow> dueRows, List<DueRow> missedRows, List<PendingRow> pendingRows,
                           String attachmentName, boolean compact) {
        public boolean hasAttachment() { return attachmentName != null; }

        public int bodyRows() { return dueRows.size() + missedRows.size() + pendingRows.size(); }
    }

    public static ComposedMail compose(Digest d, String appUrl, int maxRows, LocalDateTime now) {
        int total = d.rowCount();
        String fileName = DigestExcel.fileName(d);
        int limit = Math.max(0, Math.min(maxRows, total));

        // 1. Does everything fit, with full details?
        boolean attach = true;
        int shown = 0;
        if (limit == total && fits(view(d, total, null, false), appUrl)) {
            attach = false;
            shown = total;
        } else if (fits(view(d, limit, fileName, true), appUrl)) {
            // 2. Excel attached; the compact body holds the full limit.
            shown = limit;
        } else {
            // 2b. Long rows: the largest count that fits. Size grows with the row count, so a
            // binary search finds it in a handful of renders.
            int lo = 0;
            int hi = limit - 1;
            while (lo <= hi) {
                int mid = (lo + hi) >>> 1;
                if (fits(view(d, mid, fileName, true), appUrl)) {
                    shown = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
        }

        MailView view = view(d, shown, attach ? fileName : null, attach);
        String html = DigestTemplates.html(view, appUrl);
        String text = DigestTemplates.text(view, appUrl);

        Attachment attachment = null;
        if (attach) {
            byte[] xlsx = DigestExcel.build(d, shownKeys(view), appUrl, now);
            attachment = new Attachment(fileName, DigestExcel.CONTENT_TYPE, xlsx, total);
        }

        String subject = DigestTemplates.subject(d) + (attach ? " (full list attached)" : "");
        return new ComposedMail(subject, html, text, attachment, total, shown);
    }

    private static boolean fits(MailView v, String appUrl) {
        return bytes(DigestTemplates.html(v, appUrl)) <= BODY_BUDGET_BYTES;
    }

    /** The first {@code n} rows by importance, arranged for display. */
    static MailView view(Digest d, int n, String attachmentName) {
        return view(d, n, attachmentName, attachmentName != null);
    }

    static MailView view(Digest d, int n, String attachmentName, boolean compact) {
        if (d.type() == Digest.DigestType.DUE) {
            List<DueRow> due = new ArrayList<>(d.dueRows());
            due.sort(DigestBuilder.DUE_ORDER);
            List<DueRow> missed = new ArrayList<>(d.missedRows());
            missed.sort(DigestBuilder.MISSED_ORDER);
            int takeDue = Math.min(n, due.size());
            int takeMissed = Math.min(n - takeDue, missed.size());
            return new MailView(d, List.copyOf(due.subList(0, takeDue)), List.copyOf(missed.subList(0, takeMissed)),
                    List.of(), attachmentName, compact);
        }
        List<PendingRow> all = new ArrayList<>(d.pendingRows());
        all.sort(DigestBuilder.PENDING_PRIORITY);
        List<PendingRow> shown = new ArrayList<>(all.subList(0, Math.min(n, all.size())));
        shown.sort(d.isAdmin() ? DigestBuilder.ADMIN_PENDING_DISPLAY : DigestBuilder.PENDING_DISPLAY);
        return new MailView(d, List.of(), List.of(), List.copyOf(shown), attachmentName, compact);
    }

    static Set<String> shownKeys(MailView v) {
        Set<String> keys = new HashSet<>();
        for (DueRow r : v.dueRows()) keys.add(DigestExcel.key(r.tender(), null));
        for (DueRow r : v.missedRows()) keys.add(DigestExcel.key(r.tender(), null));
        for (PendingRow r : v.pendingRows()) keys.add(DigestExcel.key(r.tender(), r.work().key()));
        return keys;
    }

    private static int bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8).length;
    }
}
