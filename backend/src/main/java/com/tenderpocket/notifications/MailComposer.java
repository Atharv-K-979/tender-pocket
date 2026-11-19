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
 * Turns a login's two lists (Due and Pending) into its one daily mail.
 *
 * The body shows the most urgent rows of each list. When it cannot show every row with full
 * details, an Excel file with both lists, every row in full, is attached and the body says so.
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

    /** A mail with one list only; the other section of the daily mail is left empty. */
    public static ComposedMail compose(Digest d, String appUrl, int maxRows, LocalDateTime now) {
        Digest other = Digest.empty(d.type() == Digest.DigestType.DUE ? Digest.DigestType.PENDING : Digest.DigestType.DUE,
                d.recipient(), d.date(), d.pendingDays(), d.dueWindowDays());
        return d.type() == Digest.DigestType.DUE
                ? composeDaily(d, other, appUrl, maxRows, now)
                : composeDaily(other, d, appUrl, maxRows, now);
    }

    /**
     * The one daily mail of a login: a Due section and a Pending section.
     *
     * 1. If both lists fit in the body with full details (each at most {@code maxRows} rows,
     *    and the whole mail under {@link #BODY_BUDGET_BYTES}), that is the mail.
     * 2. Otherwise an Excel file with both lists, every row in full, is attached, and each
     *    section shows its most urgent rows in compact form: the same number per section
     *    (at most {@code maxRows}), as many as keep the mail under the size budget.
     */
    public static ComposedMail composeDaily(Digest due, Digest pending, String appUrl, int maxRows, LocalDateTime now) {
        int dueTotal = due.rowCount();
        int pendingTotal = pending.rowCount();
        String fileName = DigestExcel.fileName(due);
        int dueLimit = Math.max(0, Math.min(maxRows, dueTotal));
        int pendingLimit = Math.max(0, Math.min(maxRows, pendingTotal));
        int maxPerSection = Math.max(dueLimit, pendingLimit);

        boolean attach = true;
        int perSection = 0;
        if (dueLimit == dueTotal && pendingLimit == pendingTotal
                && fits(view(due, dueTotal, null, false), view(pending, pendingTotal, null, false), appUrl)) {
            attach = false;
            perSection = maxPerSection;
        } else if (fits(view(due, dueLimit, fileName, true), view(pending, pendingLimit, fileName, true), appUrl)) {
            perSection = maxPerSection;
        } else {
            // Long rows: the largest per-section count that fits. Size grows with the count, so a
            // binary search finds it in a handful of renders.
            int lo = 0;
            int hi = maxPerSection - 1;
            while (lo <= hi) {
                int mid = (lo + hi) >>> 1;
                if (fits(view(due, Math.min(mid, dueLimit), fileName, true), view(pending, Math.min(mid, pendingLimit), fileName, true), appUrl)) {
                    perSection = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
        }

        MailView dueView = view(due, Math.min(perSection, dueLimit), attach ? fileName : null, attach);
        MailView pendingView = view(pending, Math.min(perSection, pendingLimit), attach ? fileName : null, attach);
        String html = DigestTemplates.dailyHtml(dueView, pendingView, appUrl);
        String text = DigestTemplates.dailyText(dueView, pendingView, appUrl);

        Attachment attachment = null;
        if (attach) {
            Set<String> shown = shownKeys(dueView);
            shown.addAll(shownKeys(pendingView));
            byte[] xlsx = DigestExcel.build(due, pending, shown, appUrl, now);
            attachment = new Attachment(fileName, DigestExcel.CONTENT_TYPE, xlsx, dueTotal + pendingTotal);
        }

        String subject = DigestTemplates.dailySubject(due, pending) + (attach ? " (full list attached)" : "");
        return new ComposedMail(subject, html, text, attachment, dueTotal + pendingTotal, dueView.bodyRows() + pendingView.bodyRows());
    }

    private static boolean fits(MailView due, MailView pending, String appUrl) {
        return bytes(DigestTemplates.dailyHtml(due, pending, appUrl)) <= BODY_BUDGET_BYTES;
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
