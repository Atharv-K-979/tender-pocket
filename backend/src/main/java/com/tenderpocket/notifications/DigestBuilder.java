package com.tenderpocket.notifications;

import com.tenderpocket.models.Tender;
import com.tenderpocket.notifications.Digest.DeliveryLine;
import com.tenderpocket.notifications.Digest.DigestType;
import com.tenderpocket.notifications.Digest.DueRow;
import com.tenderpocket.notifications.Digest.OwnerSummary;
import com.tenderpocket.notifications.Digest.PendingRow;
import com.tenderpocket.notifications.Digest.WorkLine;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Decides which rows each login sees, and in what order of importance. It never drops a row:
 * MailComposer decides how many fit in the mail body and puts all of them in the Excel file
 * when the body cannot hold everything.
 *
 * Due mail: live tenders due today up to dueWindowDays ahead. MIS and Admin see all of them;
 * an executive sees the tenders assigned to them; anyone else sees the ones currently waiting
 * on them. Admin also gets tenders whose due date was yesterday and that were never filed.
 *
 * Pending mail: actions that have waited more than pendingDays, on tenders due later than the
 * Due window (or with no due date), plus filed tenders still awaiting MIS confirmation. Each
 * login sees the actions it owns; Admin sees all of them. A tender in a login's Due mail is
 * therefore never also in that login's Pending mail the same day.
 */
public class DigestBuilder {

    private final int pendingDays;
    private final int dueWindowDays;

    public DigestBuilder(int pendingDays, int dueWindowDays) {
        this.pendingDays = pendingDays;
        this.dueWindowDays = dueWindowDays;
    }

    /**
     * Due mail order of importance, also the order rows are shown in: nearest deadline first;
     * on the same day, tenders already being worked on before undecided ones; then by time.
     */
    public static final Comparator<DueRow> DUE_ORDER = Comparator.comparingInt(DueRow::daysLeft)
            .thenComparing(r -> r.inProgress() ? 0 : 1)
            .thenComparing(r -> r.dueTime() == null ? "99:99" : r.dueTime())
            .thenComparing(r -> title(r.tender()))
            .thenComparing(r -> String.valueOf(r.tender().getId()));

    /** Missed-yesterday order (Admin): tenders someone was working on first. */
    public static final Comparator<DueRow> MISSED_ORDER = Comparator.comparing((DueRow r) -> r.inProgress() ? 0 : 1)
            .thenComparing(r -> title(r.tender()))
            .thenComparing(r -> String.valueOf(r.tender().getId()));

    /**
     * Pending mail order of importance, used to choose which rows go in the body: work already
     * under way first, then rows that never reach the Due mail (no due date, or filed and
     * awaiting confirmation), then the nearest deadline, then the longest wait.
     */
    public static final Comparator<PendingRow> PENDING_PRIORITY = Comparator.comparing((PendingRow r) -> r.inProgress() ? 0 : 1)
            .thenComparing(r -> band(r) >= 3 ? 0 : 1)
            .thenComparing(r -> r.daysLeft() == null ? Integer.MIN_VALUE : r.daysLeft())
            .thenComparing(Comparator.comparingLong((PendingRow r) -> r.work().waitingDays()).reversed())
            .thenComparing(r -> title(r.tender()))
            .thenComparing(r -> String.valueOf(r.tender().getId()));

    /** How a team member's Pending rows are listed: by due-date group, longest wait first. */
    public static final Comparator<PendingRow> PENDING_DISPLAY = Comparator.comparingInt(DigestBuilder::band)
            .thenComparing(Comparator.comparingLong((PendingRow r) -> r.work().waitingDays()).reversed())
            .thenComparing(r -> r.dueDate() == null ? LocalDate.MAX : r.dueDate())
            .thenComparing(r -> title(r.tender()))
            .thenComparing(r -> String.valueOf(r.tender().getId()));

    /** How Admin's Pending rows are listed: grouped by owner, then as for a team member. */
    public static final Comparator<PendingRow> ADMIN_PENDING_DISPLAY = Comparator.comparingInt((PendingRow r) -> r.work().team().ordinal())
            .thenComparing(r -> r.work().ownerLabel().toLowerCase(Locale.ROOT))
            .thenComparing(PENDING_DISPLAY);

    /** A tender's due date and works, with waiting days counted for one day. */
    public record TenderView(Tender tender, LocalDate dueDate, String dueTime, Integer daysLeft, boolean filed,
                             List<ClockSnapshot.WorkItem> items, List<WorkLine> works) {}

    public List<TenderView> prepare(ClockSnapshot snapshot, LocalDate today) {
        List<TenderView> views = new ArrayList<>();
        for (ClockSnapshot.TenderEntry entry : snapshot.tenders()) {
            Tender t = entry.tender();
            LocalDate due = NotifyDates.parseDate(t.getDueDate());
            Integer daysLeft = due == null ? null : (int) ChronoUnit.DAYS.between(today, due);
            List<WorkLine> lines = entry.works().stream()
                    .map(item -> new WorkLine(item.key(), item.owner().team(), item.owner().ownerLabel(), waitingDays(item, today)))
                    .toList();
            views.add(new TenderView(t, due, NotifyDates.dueTime(t.getDueDate(), t.getTime()), daysLeft,
                    PendingWorkResolver.isSubmitted(t), entry.works(), lines));
        }
        return views;
    }

    public Digest buildDue(RecipientDirectory.Recipient recipient, List<TenderView> views, LocalDate today) {
        boolean seesAll = recipient.team() == Team.ADMIN || recipient.team() == Team.MIS;
        List<DueRow> rows = new ArrayList<>();
        List<DueRow> missed = new ArrayList<>();
        for (TenderView v : views) {
            if (v.filed() || v.daysLeft() == null) continue;
            if (v.daysLeft() >= 0 && v.daysLeft() <= dueWindowDays && (seesAll || involves(recipient, v))) {
                rows.add(dueRow(v));
            } else if (v.daysLeft() == -1 && recipient.team() == Team.ADMIN) {
                missed.add(dueRow(v));
            }
        }
        rows.sort(DUE_ORDER);
        missed.sort(MISSED_ORDER);
        return new Digest(DigestType.DUE, recipient, today, pendingDays, dueWindowDays, rows, missed,
                List.of(), 0, 0, List.of(), List.of(), List.of());
    }

    public Digest buildPending(RecipientDirectory.Recipient recipient, List<TenderView> views, LocalDate today,
                               List<DeliveryLine> delivery) {
        boolean admin = recipient.team() == Team.ADMIN;
        List<PendingRow> all = new ArrayList<>();
        List<PendingRow> mine = new ArrayList<>();
        for (TenderView v : views) {
            boolean inPendingWindow = v.filed() || (v.daysLeft() == null || v.daysLeft() > dueWindowDays);
            if (!inPendingWindow) continue;
            for (int i = 0; i < v.items().size(); i++) {
                ClockSnapshot.WorkItem item = v.items().get(i);
                WorkLine line = v.works().get(i);
                if (line.waitingDays() <= pendingDays) continue;
                if (v.filed() && item.key() != PendingActionKey.SUBMIT_CONFIRM) continue;
                PendingRow row = new PendingRow(v.tender(), v.dueDate(), v.dueTime(), v.daysLeft(), v.filed(), line);
                all.add(row);
                if (receives(recipient, item)) mine.add(row);
            }
        }

        List<PendingRow> rows = new ArrayList<>(admin ? all : mine);
        rows.sort(PENDING_PRIORITY);
        int tenders = (int) rows.stream().map(r -> r.tender().getId()).distinct().count();

        List<OwnerSummary> summary = admin ? summarise(rows, views) : List.of();
        List<String> notes = admin ? routingNotes(views) : List.of();
        List<DeliveryLine> report = admin && delivery != null ? List.copyOf(delivery) : List.of();
        return new Digest(DigestType.PENDING, recipient, today, pendingDays, dueWindowDays, List.of(), List.of(),
                List.copyOf(rows), rows.size(), tenders, summary, notes, report);
    }

    /** 0: due within a week, 1: 8-14 days, 2: 15+ days, 3: no due date, 4: filed, awaiting confirmation. */
    public static int band(PendingRow row) {
        if (row.filed()) return 4;
        if (row.daysLeft() == null) return 3;
        if (row.daysLeft() <= 7) return 0;
        if (row.daysLeft() <= 14) return 1;
        return 2;
    }

    private List<OwnerSummary> summarise(List<PendingRow> rows, List<TenderView> views) {
        Map<String, List<PendingRow>> byOwner = rows.stream()
                .collect(Collectors.groupingBy(r -> r.work().ownerLabel(), LinkedHashMap::new, Collectors.toList()));
        Map<String, Integer> dueSoon = new LinkedHashMap<>();
        for (TenderView v : views) {
            if (v.filed() || v.daysLeft() == null || v.daysLeft() < 0 || v.daysLeft() > dueWindowDays) continue;
            for (WorkLine line : v.works()) dueSoon.merge(line.ownerLabel(), 1, Integer::sum);
        }
        List<OwnerSummary> out = new ArrayList<>();
        for (Map.Entry<String, List<PendingRow>> e : byOwner.entrySet()) {
            List<PendingRow> list = e.getValue();
            long oldest = list.stream().mapToLong(r -> r.work().waitingDays()).max().orElse(0);
            String top = list.stream()
                    .collect(Collectors.groupingBy(r -> r.work().key().getLabel(), Collectors.counting()))
                    .entrySet().stream()
                    .max(Map.Entry.<String, Long>comparingByValue().thenComparing(Map.Entry.comparingByKey(Comparator.reverseOrder())))
                    .map(x -> x.getKey() + " (" + x.getValue() + ")")
                    .orElse("");
            out.add(new OwnerSummary(e.getKey(), list.get(0).work().team(), list.size(), oldest,
                    dueSoon.getOrDefault(e.getKey(), 0), top));
        }
        return out;
    }

    private static List<String> routingNotes(List<TenderView> views) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (TenderView v : views) {
            for (ClockSnapshot.WorkItem item : v.items()) {
                if (item.owner().note() != null) counts.merge(item.owner().note(), 1, Integer::sum);
            }
        }
        return counts.entrySet().stream()
                .map(e -> e.getKey() + " (" + e.getValue() + (e.getValue() == 1 ? " item)" : " items)"))
                .toList();
    }

    private static DueRow dueRow(TenderView v) {
        return new DueRow(v.tender(), v.dueDate(), v.dueTime(), v.daysLeft(), v.works());
    }

    private static boolean involves(RecipientDirectory.Recipient r, TenderView v) {
        String exec = PendingWorkResolver.assignedExecutive(v.tender());
        if (!exec.isEmpty() && exec.equalsIgnoreCase(r.username())) return true;
        return v.items().stream().anyMatch(item -> receives(r, item));
    }

    private static boolean receives(RecipientDirectory.Recipient r, ClockSnapshot.WorkItem item) {
        return item.owner().recipients().stream().anyMatch(u -> u.equalsIgnoreCase(r.username()));
    }

    private static long waitingDays(ClockSnapshot.WorkItem item, LocalDate today) {
        if (item.pendingSince() == null) return 0;
        return Math.max(0, ChronoUnit.DAYS.between(item.pendingSince().toLocalDate(), today));
    }

    private static String title(Tender t) {
        return t.getTitle() == null ? "" : t.getTitle().toLowerCase(Locale.ROOT);
    }

    /** Groups a list by a key, keeping first-seen order. */
    static <T, K> Map<K, List<T>> groupInOrder(List<T> list, Function<T, K> key) {
        return list.stream().collect(Collectors.groupingBy(key, LinkedHashMap::new, Collectors.toList()));
    }
}
