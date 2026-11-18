package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import com.tenderpocket.notifications.Digest.DeliveryLine;
import com.tenderpocket.notifications.Digest.DueRow;
import com.tenderpocket.notifications.Digest.OwnerSummary;
import com.tenderpocket.notifications.Digest.PendingRow;
import com.tenderpocket.notifications.Digest.WorkLine;
import com.tenderpocket.notifications.MailComposer.MailView;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Renders the mail body for the rows MailComposer chose. The HTML uses tables, a small head
 * style block and inline styles, so Gmail and Outlook show it the same way. Titles and
 * authorities are never shortened; when the body cannot show every row, it says so and the
 * attached Excel file has all of them. A plain-text part with the same rows is always included.
 */
public final class DigestTemplates {

    private DigestTemplates() {}

    private static final DateTimeFormatter SHORT = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);
    private static final DateTimeFormatter LONG = DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.ENGLISH);
    private static final DateTimeFormatter DUE = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    private static final String INK = "#121e28";
    private static final String MUTED = "#55636f";
    private static final String LINE = "#d6dde3";
    private static final String SUNK = "#eef1f4";
    private static final String RED = "#b8322b";
    private static final String RED_BG = "#fbe7e5";
    private static final String AMBER = "#9a620f";
    private static final String AMBER_BG = "#fbefd8";
    private static final String BLUE = "#0a3d57";
    private static final String BLUE_BG = "#e6f0f7";
    private static final String FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    private static final String MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

    /** Shared rules. Gmail, Outlook and Apple Mail keep a head style block; repeating these inline would push big mails past Gmail's clipping limit. */
    private static final String STYLE = "<style>"
            + ".c{padding:8px;border-bottom:1px solid " + LINE + ";vertical-align:top;word-break:break-word;overflow-wrap:anywhere}"
            + ".nw{white-space:nowrap;word-break:normal;overflow-wrap:normal}"
            + ".id{font-family:" + MONO + ";font-size:11px;color:" + MUTED + "}"
            + ".m{font-size:12px;color:" + MUTED + "}"
            + ".t{color:" + INK + ";text-decoration:underline}"
            + ".b{display:inline-block;font-family:" + MONO + ";font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;white-space:nowrap}"
            + ".r{color:" + RED + ";background:" + RED_BG + "}"
            + ".a{color:" + AMBER + ";background:" + AMBER_BG + "}"
            + "</style>";

    // ── Subjects ────────────────────────────────────────────────────────────

    /** Subject from the full digest (every row, not just the ones in the body). */
    public static String subject(Digest d) {
        String suffix = " · TenderPocket · " + d.date().format(SHORT);
        if (d.type() == Digest.DigestType.DUE) {
            long today = d.dueTodayCount();
            long later = d.dueRows().size() - today;
            int missed = d.missedRows().size();
            String main;
            if (today > 0 && later > 0) {
                main = "Due soon: " + today + " today, " + later + " in next " + d.dueWindowDays() + " days";
            } else if (today > 0) {
                main = "Due today: " + plural(today, "tender");
            } else if (later > 0) {
                main = "Due soon: " + plural(later, "tender") + " in next " + d.dueWindowDays() + " days";
            } else {
                return "Missed yesterday: " + plural(missed, "tender") + suffix;
            }
            if (missed > 0) main += " · " + missed + " missed yesterday";
            return main + suffix;
        }
        long failures = d.delivery().stream().filter(DeliveryLine::isFailure).count();
        if (d.isAdmin()) {
            if (d.pendingTotal() == 0) {
                return failures > 0 ? "Delivery report: " + plural(failures, "mail") + " failed" + suffix
                        : "Routing check: some work has no one to mail" + suffix;
            }
            long teams = d.ownerSummary().size();
            return "Waiting over " + d.pendingDays() + " days: " + plural(d.pendingTenderCount(), "tender")
                    + " across " + plural(teams, "owner") + suffix;
        }
        return "Waiting on you: " + plural(d.pendingTenderCount(), "tender") + " over " + d.pendingDays() + " days" + suffix;
    }

    // ── HTML ────────────────────────────────────────────────────────────────

    public static String html(MailView v, String appUrl) {
        return v.digest().type() == Digest.DigestType.DUE ? dueHtml(v, appUrl) : pendingHtml(v, appUrl);
    }

    public static String text(MailView v, String appUrl) {
        return v.digest().type() == Digest.DigestType.DUE ? dueText(v, appUrl) : pendingText(v, appUrl);
    }

    private static String dueHtml(MailView v, String appUrl) {
        Digest d = v.digest();
        StringBuilder b = new StringBuilder(16384);
        long today = d.dueTodayCount();
        String lead = d.dueRows().isEmpty()
                ? "No tenders are due in the next " + d.dueWindowDays() + " days."
                : plural(d.dueRows().size(), "tender") + " due by " + d.date().plusDays(d.dueWindowDays()).format(SHORT)
                + (today > 0 ? ", " + today + " of them today" : "") + ". Each row shows who has to act now.";
        open(b, d, "Due in the next " + d.dueWindowDays() + " days", lead);
        attachmentNotice(b, v);
        if (v.hasAttachment()) dueSummary(b, d);

        Map<Integer, List<DueRow>> groups = DigestBuilder.groupInOrder(v.dueRows(), DueRow::daysLeft);
        Map<Integer, Long> totals = countBy(d.dueRows());
        for (Map.Entry<Integer, List<DueRow>> g : groups.entrySet()) {
            int days = g.getKey();
            String label = days == 0 ? "Due today" : days == 1 ? "Due in 1 day" : "Due in " + days + " days";
            groupHeading(b, label + " · " + countText(g.getValue().size(), totals.getOrDefault(days, 0L)), days == 0 ? RED : AMBER);
            dueTable(b, g.getValue(), d, appUrl, v.compact());
        }

        if (!v.missedRows().isEmpty()) {
            groupHeading(b, "Missed yesterday · " + countText(v.missedRows().size(), d.missedRows().size()), RED);
            b.append(p("These were due yesterday and were never marked as submitted. The last column shows who held them.", MUTED, 13));
            dueTable(b, v.missedRows(), d, appUrl, v.compact());
        }
        attachmentFooter(b, v);
        close(b, d, appUrl);
        return b.toString();
    }

    private static void dueTable(StringBuilder b, List<DueRow> rows, Digest d, String appUrl, boolean compact) {
        tableOpen(b, "Tender", "Due", "Waiting on");
        for (DueRow r : rows) {
            b.append("<tr>");
            tenderCell(b, r.tender(), appUrl, compact);
            b.append(td(esc(dueText(r.dueDate(), r.dueTime())), "nw"));
            StringBuilder w = new StringBuilder();
            if (r.works().isEmpty()) {
                w.append("<span class=\"m\">No open action</span>");
            }
            for (int i = 0; i < r.works().size(); i++) {
                if (i > 0) w.append("<br>");
                workHtml(w, r.works().get(i), d.pendingDays());
            }
            b.append(td(w.toString(), ""));
            b.append("</tr>");
        }
        b.append("</table>");
    }

    /** Counts by due day, split into tenders being worked on and undecided ones. */
    private static void dueSummary(StringBuilder b, Digest d) {
        groupHeading(b, "Summary of all " + d.rowCount() + " rows", INK);
        tableOpen(b, "", "Being worked on", "Undecided", "Total");
        Map<Integer, List<DueRow>> byDay = DigestBuilder.groupInOrder(d.dueRows(), DueRow::daysLeft);
        long workTotal = 0;
        long undecidedTotal = 0;
        for (Map.Entry<Integer, List<DueRow>> e : byDay.entrySet()) {
            int days = e.getKey();
            long work = e.getValue().stream().filter(DueRow::inProgress).count();
            long undecided = e.getValue().size() - work;
            workTotal += work;
            undecidedTotal += undecided;
            summaryRow(b, days == 0 ? "Due today" : days == 1 ? "Due in 1 day" : "Due in " + days + " days", work, undecided);
        }
        if (!d.missedRows().isEmpty()) {
            long work = d.missedRows().stream().filter(DueRow::inProgress).count();
            long undecided = d.missedRows().size() - work;
            workTotal += work;
            undecidedTotal += undecided;
            summaryRow(b, "Missed yesterday", work, undecided);
        }
        b.append("<tr>").append(td("<strong>Total</strong>", "")).append(td("<strong>" + workTotal + "</strong>", ""))
                .append(td("<strong>" + undecidedTotal + "</strong>", "")).append(td("<strong>" + (workTotal + undecidedTotal) + "</strong>", ""))
                .append("</tr></table>");
    }

    private static void summaryRow(StringBuilder b, String label, long a, long c) {
        b.append("<tr>").append(td(esc(label), "")).append(td(String.valueOf(a), "")).append(td(String.valueOf(c), ""))
                .append(td(String.valueOf(a + c), "")).append("</tr>");
    }

    private static String dueText(MailView v, String appUrl) {
        Digest d = v.digest();
        StringBuilder t = new StringBuilder();
        textHeader(t, d, "Due in the next " + d.dueWindowDays() + " days");
        textAttachmentNotice(t, v);
        Map<Integer, List<DueRow>> groups = DigestBuilder.groupInOrder(v.dueRows(), DueRow::daysLeft);
        for (Map.Entry<Integer, List<DueRow>> g : groups.entrySet()) {
            int days = g.getKey();
            t.append('\n').append(days == 0 ? "DUE TODAY" : days == 1 ? "DUE IN 1 DAY" : "DUE IN " + days + " DAYS").append('\n');
            for (DueRow r : g.getValue()) dueTextRow(t, r, appUrl);
        }
        if (!v.missedRows().isEmpty()) {
            t.append("\nMISSED YESTERDAY\n");
            for (DueRow r : v.missedRows()) dueTextRow(t, r, appUrl);
        }
        textFooter(t, d, appUrl);
        return t.toString();
    }

    private static void dueTextRow(StringBuilder t, DueRow r, String appUrl) {
        t.append("- ").append(displayId(r.tender())).append(" | ").append(nz(r.tender().getTitle()));
        if (r.tender().getAuthority() != null && !r.tender().getAuthority().isBlank()) t.append(" | ").append(r.tender().getAuthority());
        t.append(" | due ").append(dueText(r.dueDate(), r.dueTime())).append('\n');
        for (WorkLine w : r.works()) {
            t.append("    waiting on ").append(w.ownerLabel()).append(": ").append(w.key().getLabel())
                    .append(" (").append(waitingText(w.waitingDays())).append(")\n");
        }
        String link = link(appUrl, r.tender());
        if (link != null) t.append("    ").append(link).append('\n');
    }

    // ── Pending mail ────────────────────────────────────────────────────────

    private static String pendingHtml(MailView v, String appUrl) {
        Digest d = v.digest();
        StringBuilder b = new StringBuilder(16384);
        String title = d.isAdmin() ? "Waiting over " + d.pendingDays() + " days" : "Waiting on you over " + d.pendingDays() + " days";
        String lead = d.pendingTotal() == 0
                ? "No work has been waiting more than " + d.pendingDays() + " days."
                : d.isAdmin()
                ? plural(d.pendingTotal(), "action") + " on " + plural(d.pendingTenderCount(), "tender")
                  + " have sat with the same owner for more than " + d.pendingDays() + " days."
                : "These steps are yours and have waited more than " + d.pendingDays()
                  + " days. Tenders due within " + d.dueWindowDays() + " days are in your Due mail instead.";
        open(b, d, title, lead);
        attachmentNotice(b, v);

        if (d.isAdmin() && !d.ownerSummary().isEmpty()) {
            groupHeading(b, "By owner", INK);
            tableOpen(b, "Owner", "Waiting", "Oldest", "Also due soon", "Most common");
            for (OwnerSummary s : d.ownerSummary()) {
                b.append("<tr>")
                        .append(td("<strong style=\"color:" + s.team().getColor() + "\">" + esc(s.ownerLabel()) + "</strong>", ""))
                        .append(td(String.valueOf(s.waitingCount()), ""))
                        .append(td(badge(s.oldestDays() + " days", s.oldestDays() > 7), "nw"))
                        .append(td(String.valueOf(s.dueSoonCount()), ""))
                        .append(td(esc(s.topAction()), ""))
                        .append("</tr>");
            }
            b.append("</table>");
        }
        if (v.hasAttachment()) pendingSummary(b, d);

        if (d.isAdmin()) {
            Map<String, List<PendingRow>> byOwner = DigestBuilder.groupInOrder(v.pendingRows(), r -> r.work().ownerLabel());
            Map<String, Long> totals = new LinkedHashMap<>();
            for (PendingRow r : d.pendingRows()) totals.merge(r.work().ownerLabel(), 1L, Long::sum);
            for (Map.Entry<String, List<PendingRow>> g : byOwner.entrySet()) {
                groupHeading(b, g.getKey() + " · " + countText(g.getValue().size(), totals.getOrDefault(g.getKey(), 0L)),
                        g.getValue().get(0).work().team().getColor());
                pendingTable(b, g.getValue(), appUrl, v.compact());
            }
        } else {
            Map<Integer, List<PendingRow>> byBand = DigestBuilder.groupInOrder(v.pendingRows(), DigestBuilder::band);
            Map<Integer, Long> totals = new LinkedHashMap<>();
            for (PendingRow r : d.pendingRows()) totals.merge(DigestBuilder.band(r), 1L, Long::sum);
            for (Map.Entry<Integer, List<PendingRow>> g : byBand.entrySet()) {
                groupHeading(b, bandLabel(g.getKey(), d.dueWindowDays()) + " · " + countText(g.getValue().size(), totals.getOrDefault(g.getKey(), 0L)), MUTED);
                pendingTable(b, g.getValue(), appUrl, v.compact());
            }
        }
        attachmentFooter(b, v);

        if (d.isAdmin() && !d.notes().isEmpty()) {
            groupHeading(b, "Routing problems to fix", RED);
            b.append("<ul style=\"margin:0 0 8px 18px;padding:0;font-size:13px;color:").append(INK).append(";\">");
            for (String note : d.notes()) b.append("<li style=\"margin:2px 0;\">").append(esc(note)).append("</li>");
            b.append("</ul>");
        }

        if (d.isAdmin() && !d.delivery().isEmpty()) {
            groupHeading(b, "Delivery report for today", INK);
            tableOpen(b, "Login", "Mail", "Result");
            for (DeliveryLine line : d.delivery()) {
                String result = line.isFailure()
                        ? badge("FAILED", true) + " " + esc(nz(line.detail()))
                        : esc(line.status()) + (line.detail() == null || line.detail().isBlank() ? "" : " · " + esc(line.detail()));
                b.append("<tr>").append(td(esc(line.username()), "")).append(td(esc(line.mail()), "")).append(td(result, "")).append("</tr>");
            }
            b.append("</table>");
        }
        close(b, d, appUrl);
        return b.toString();
    }

    private static void pendingTable(StringBuilder b, List<PendingRow> rows, String appUrl, boolean compact) {
        tableOpen(b, "Tender", "Action", "Waiting", "Due");
        for (PendingRow r : rows) {
            b.append("<tr>");
            tenderCell(b, r.tender(), appUrl, compact);
            b.append(td(esc(r.work().key().getLabel()), ""));
            b.append(td(badge(r.work().waitingDays() + " days", r.work().waitingDays() > 7), "nw"));
            String due = r.dueDate() == null ? "<span class=\"b r\">No due date</span>" : esc(dueText(r.dueDate(), r.dueTime()));
            b.append(td(due, "nw"));
            b.append("</tr>");
        }
        b.append("</table>");
    }

    /** Counts by action and how long it has waited, over every row. */
    private static void pendingSummary(StringBuilder b, Digest d) {
        String first = d.pendingDays() + 1 <= 7 ? (d.pendingDays() + 1) + "–7 days" : "up to 7 days";
        groupHeading(b, "Summary of all " + d.rowCount() + " rows", INK);
        tableOpen(b, "Action", first, "8–14 days", "15+ days", "Total");
        Map<String, long[]> byAction = new LinkedHashMap<>();
        for (PendingActionKey key : PendingActionKey.values()) byAction.put(key.getLabel(), new long[3]);
        long[] total = new long[3];
        for (PendingRow r : d.pendingRows()) {
            long w = r.work().waitingDays();
            int tier = w <= 7 ? 0 : w <= 14 ? 1 : 2;
            byAction.get(r.work().key().getLabel())[tier]++;
            total[tier]++;
        }
        for (Map.Entry<String, long[]> e : byAction.entrySet()) {
            long[] c = e.getValue();
            if (c[0] + c[1] + c[2] == 0) continue;
            b.append("<tr>").append(td(esc(e.getKey()), "")).append(td(String.valueOf(c[0]), "")).append(td(String.valueOf(c[1]), ""))
                    .append(td(String.valueOf(c[2]), "")).append(td(String.valueOf(c[0] + c[1] + c[2]), "")).append("</tr>");
        }
        b.append("<tr>").append(td("<strong>Total</strong>", ""));
        for (long c : total) b.append(td("<strong>" + c + "</strong>", ""));
        b.append(td("<strong>" + (total[0] + total[1] + total[2]) + "</strong>", "")).append("</tr></table>");
    }

    private static String pendingText(MailView v, String appUrl) {
        Digest d = v.digest();
        StringBuilder t = new StringBuilder();
        textHeader(t, d, d.isAdmin() ? "Waiting over " + d.pendingDays() + " days" : "Waiting on you over " + d.pendingDays() + " days");
        textAttachmentNotice(t, v);
        if (d.isAdmin()) {
            for (OwnerSummary s : d.ownerSummary()) {
                t.append("  ").append(s.ownerLabel()).append(": ").append(s.waitingCount()).append(" waiting, oldest ")
                        .append(s.oldestDays()).append(" days, ").append(s.dueSoonCount()).append(" also due soon\n");
            }
        }
        for (PendingRow r : v.pendingRows()) {
            t.append("- ").append(displayId(r.tender())).append(" | ").append(nz(r.tender().getTitle()));
            if (r.tender().getAuthority() != null && !r.tender().getAuthority().isBlank()) t.append(" | ").append(r.tender().getAuthority());
            t.append(" | ").append(d.isAdmin() ? r.work().ownerLabel() + ": " : "").append(r.work().key().getLabel())
                    .append(" | waiting ").append(r.work().waitingDays()).append(" days | due ")
                    .append(r.dueDate() == null ? "no due date" : dueText(r.dueDate(), r.dueTime())).append('\n');
            String link = link(appUrl, r.tender());
            if (link != null) t.append("    ").append(link).append('\n');
        }
        if (!d.notes().isEmpty()) {
            t.append("\nROUTING PROBLEMS TO FIX\n");
            for (String note : d.notes()) t.append("- ").append(note).append('\n');
        }
        if (!d.delivery().isEmpty()) {
            t.append("\nDELIVERY REPORT FOR TODAY\n");
            for (DeliveryLine line : d.delivery()) {
                t.append("- ").append(line.username()).append(" / ").append(line.mail()).append(": ").append(line.status());
                if (line.detail() != null && !line.detail().isBlank()) t.append(" (").append(line.detail()).append(')');
                t.append('\n');
            }
        }
        textFooter(t, d, appUrl);
        return t.toString();
    }

    static String bandLabel(int band, int dueWindowDays) {
        return switch (band) {
            case 0 -> dueWindowDays + 1 >= 7 ? "Due within a week" : "Due in " + (dueWindowDays + 1) + " to 7 days";
            case 1 -> "Due in 8 to 14 days";
            case 2 -> "Due in 15 days or more";
            case 3 -> "No due date: fix the tender data";
            default -> "Filed: confirm the submission";
        };
    }

    // ── Attachment notices ──────────────────────────────────────────────────

    private static void attachmentNotice(StringBuilder b, MailView v) {
        if (!v.hasAttachment()) return;
        int total = v.digest().rowCount();
        b.append("<div style=\"background:").append(BLUE_BG).append(";border:1px solid #b9d3e6;color:").append(BLUE)
                .append(";padding:10px 12px;border-radius:6px;font-size:13px;line-height:1.5;margin:10px 0 4px;\">")
                .append("<strong>Full list attached.</strong> ");
        if (v.bodyRows() < total) {
            b.append("This mail shows the <strong>").append(v.bodyRows()).append(" most urgent</strong> of <strong>")
                    .append(total).append("</strong> rows. ");
        } else {
            b.append("This mail lists all <strong>").append(total).append("</strong> rows in short form. ");
        }
        b.append("All ").append(total).append(" rows, with full titles, authorities and links, are in the attached Excel file <strong>")
                .append(esc(v.attachmentName())).append("</strong>.</div>");
    }

    private static void attachmentFooter(StringBuilder b, MailView v) {
        if (!v.hasAttachment()) return;
        int total = v.digest().rowCount();
        String text = v.bodyRows() < total
                ? "Shown above: " + v.bodyRows() + " of " + total + " rows. The other " + (total - v.bodyRows())
                  + " are in the attached Excel file " + esc(v.attachmentName()) + ", together with every row shown here."
                : "All " + total + " rows are shown above in short form. The attached Excel file " + esc(v.attachmentName())
                  + " has every row in full, including the authority.";
        b.append(p(text, BLUE, 13));
    }

    private static void textAttachmentNotice(StringBuilder t, MailView v) {
        if (!v.hasAttachment()) return;
        int total = v.digest().rowCount();
        t.append("\nFULL LIST ATTACHED: this mail shows ")
                .append(v.bodyRows() < total ? "the " + v.bodyRows() + " most urgent of " + total : "all " + total)
                .append(" rows. All ").append(total).append(" rows, in full, are in the attached Excel file ").append(v.attachmentName()).append(".\n");
    }

    private static String countText(long shown, long total) {
        return shown == total ? String.valueOf(total) : shown + " of " + total + " (all in the Excel file)";
    }

    private static Map<Integer, Long> countBy(List<DueRow> rows) {
        Map<Integer, Long> out = new LinkedHashMap<>();
        for (DueRow r : rows) out.merge(r.daysLeft(), 1L, Long::sum);
        return out;
    }

    // ── Shared pieces ───────────────────────────────────────────────────────

    private static void open(StringBuilder b, Digest d, String title, String lead) {
        b.append("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
                .append("<title>").append(esc(title)).append("</title>").append(STYLE).append("</head>")
                .append("<body style=\"margin:0;padding:0;background:#f3f5f7;\">")
                .append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f3f5f7;\"><tr><td align=\"center\" style=\"padding:20px 10px;\">")
                .append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:760px;background:#ffffff;border:1px solid ")
                .append(LINE).append(";border-radius:8px;font-family:").append(FONT).append(";color:").append(INK).append(";\">")
                .append("<tr><td style=\"padding:20px 24px 4px;\">");
        b.append("<div style=\"font-size:12px;color:").append(MUTED).append(";letter-spacing:.04em;text-transform:uppercase;\">TenderPocket · ")
                .append(esc(who(d.recipient()))).append(" · ")
                .append(esc(d.date().format(LONG))).append("</div>")
                .append("<div style=\"font-size:22px;font-weight:700;margin-top:6px;line-height:1.25;\">").append(esc(title)).append("</div>")
                .append(p(esc(lead), MUTED, 14))
                .append("</td></tr><tr><td style=\"padding:0 24px 8px;\">");
    }

    private static void close(StringBuilder b, Digest d, String appUrl) {
        b.append("</td></tr><tr><td style=\"padding:14px 24px 20px;border-top:1px solid ").append(LINE)
                .append(";font-size:12px;color:").append(MUTED).append(";line-height:1.5;\">")
                .append("You get at most two TenderPocket mails a day: tenders due in the next ").append(d.dueWindowDays())
                .append(" days, and work waiting on you for more than ").append(d.pendingDays())
                .append(" days. A mail is skipped when there is nothing to report.");
        if (appUrl != null && !appUrl.isBlank()) {
            b.append(" <a href=\"").append(esc(appUrl)).append("\" style=\"color:#0a5f7d;\">Open TenderPocket</a>");
        }
        b.append("</td></tr></table></td></tr></table></body></html>");
    }

    private static void groupHeading(StringBuilder b, String text, String color) {
        b.append("<div style=\"font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:")
                .append(color).append(";margin:18px 0 6px;\">").append(esc(text)).append("</div>");
    }

    private static void tableOpen(StringBuilder b, String... headings) {
        b.append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-collapse:collapse;font-size:13px;\"><tr>");
        for (String h : headings) {
            b.append("<th align=\"left\" style=\"background:").append(SUNK).append(";color:").append(MUTED)
                    .append(";font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;padding:6px 8px;border-bottom:1px solid ")
                    .append(LINE).append(";\">").append(esc(h)).append("</th>");
        }
        b.append("</tr>");
    }

    /** A table cell; padding, border and alignment come from the "c" class in STYLE to keep large mails small. */
    private static String td(String html, String extraClass) {
        return "<td class=\"c" + (extraClass == null || extraClass.isEmpty() ? "" : " " + extraClass) + "\">" + html + "</td>";
    }

    /** @param compact leave out the authority line (it is in the attached Excel file) */
    private static void tenderCell(StringBuilder b, Tender t, String appUrl, boolean compact) {
        String title = nz(t.getTitle());
        String link = link(appUrl, t);
        StringBuilder c = new StringBuilder();
        c.append("<div class=\"id\">").append(esc(displayId(t))).append("</div>");
        if (link != null) {
            c.append("<a class=\"t\" href=\"").append(esc(link)).append("\">").append(esc(title)).append("</a>");
        } else {
            c.append(esc(title));
        }
        if (!compact && t.getAuthority() != null && !t.getAuthority().isBlank()) {
            c.append("<div class=\"m\">").append(esc(t.getAuthority())).append("</div>");
        }
        b.append(td(c.toString(), ""));
    }

    private static void workHtml(StringBuilder w, WorkLine line, int pendingDays) {
        w.append("<strong style=\"color:").append(line.team().getColor()).append("\">").append(esc(line.ownerLabel())).append("</strong> ")
                .append(esc(line.key().getLabel()));
        if (line.waitingDays() > pendingDays) {
            w.append(" ").append(badge(line.waitingDays() + " days", true));
        } else {
            w.append(" <span class=\"m\">").append(esc(waitingText(line.waitingDays()))).append("</span>");
        }
    }

    private static String badge(String text, boolean red) {
        return "<span class=\"b " + (red ? "r" : "a") + "\">" + esc(text) + "</span>";
    }

    private static String p(String html, String color, int size) {
        return "<p style=\"margin:6px 0 4px;font-size:" + size + "px;color:" + color + ";line-height:1.5;\">" + html + "</p>";
    }

    private static void textHeader(StringBuilder t, Digest d, String title) {
        t.append(title.toUpperCase(Locale.ROOT)).append('\n')
                .append("TenderPocket · ").append(who(d.recipient())).append(" · ").append(d.date().format(LONG)).append('\n');
    }

    private static void textFooter(StringBuilder t, Digest d, String appUrl) {
        t.append("\nYou get at most two TenderPocket mails a day. A mail is skipped when there is nothing to report.\n");
        if (appUrl != null && !appUrl.isBlank()) t.append("Open TenderPocket: ").append(appUrl).append('\n');
    }

    /** "rahul (Executive)", or just "Admin" when the login name already says it. */
    private static String who(RecipientDirectory.Recipient r) {
        String label = r.team().getLabel();
        String user = r.username();
        String squashed = label.replace(" ", "").toLowerCase(Locale.ROOT);
        String userSquashed = user.replace(" ", "").toLowerCase(Locale.ROOT);
        return squashed.equals(userSquashed) || squashed.startsWith(userSquashed) ? label : user + " (" + label + ")";
    }

    private static String waitingText(long days) {
        return days == 0 ? "since today" : days == 1 ? "1 day" : days + " days";
    }

    private static String dueText(LocalDate date, String time) {
        if (date == null) return "No due date";
        return date.format(DUE) + (time == null ? "" : ", " + time);
    }

    static String displayId(Tender t) {
        String ref = t.getRefNo();
        return ref != null && !ref.isBlank() && !"N/A".equalsIgnoreCase(ref.trim()) ? ref.trim() : nz(t.getId());
    }

    static String link(String appUrl, Tender t) {
        if (appUrl == null || appUrl.isBlank() || t.getId() == null) return null;
        return appUrl + "/tenders/" + URLEncoder.encode(t.getId(), StandardCharsets.UTF_8).replace("+", "%20");
    }

    private static String plural(long n, String word) {
        return n + " " + word + (n == 1 ? "" : "s");
    }

    private static String nz(String s) { return s == null ? "" : s; }

    static String esc(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder(s.length() + 16);
        for (char c : s.toCharArray()) {
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                default -> out.append(c);
            }
        }
        return out.toString();
    }
}
