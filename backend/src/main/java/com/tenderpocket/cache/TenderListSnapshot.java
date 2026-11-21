package com.tenderpocket.cache;

import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.services.TenderStatusResolver;
import com.tenderpocket.utils.TenderDateSort;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * An in-memory copy of every tender in the shape the tender list returns, so that listing,
 * filtering and paging tenders does not read the whole table from the database on every request.
 *
 * The copy is rebuilt on the next request after any committed tender change made through the
 * application ({@link DataVersion}), when the day changes (a tender's displayed status depends on
 * the date), and at the latest every {@link #MAX_AGE_MILLIS} so that rows edited directly in the
 * database are picked up too.
 *
 * Items are shared between requests and must never be modified; callers copy an item before
 * changing it.
 */
@Service
public class TenderListSnapshot {

    /** Longest time a snapshot is reused when nothing was changed through the application. */
    static final long MAX_AGE_MILLIS = 60_000;

    /** A tender in list shape, with its status resolved for the snapshot's day, plus its date sort keys. */
    public record Item(Tender tender, long scrapedAtKey, long dueDateKey) {}

    private record Snapshot(List<Item> items, long version, String todayIST, LocalDate serverToday, long builtAtMillis) {}

    @Autowired
    private TenderRepository tenderRepository;

    private volatile Snapshot current;
    private final Object buildLock = new Object();

    /**
     * Returns every tender in list shape, with the status resolved for {@code todayIST}, in no particular order.
     */
    public List<Item> items(String todayIST) {
        Snapshot snapshot = current;
        if (isFresh(snapshot, todayIST)) {
            return snapshot.items();
        }
        synchronized (buildLock) {
            snapshot = current;
            if (isFresh(snapshot, todayIST)) {
                return snapshot.items();
            }
            // Read the counter before the rows: a change committed while building moves the counter
            // on, so this snapshot is treated as stale on the next request instead of being trusted.
            long version = DataVersion.tenderData();
            LocalDate serverToday = LocalDate.now();
            List<Tender> rows = tenderRepository.findAll();
            List<Item> items = new ArrayList<>(rows.size());
            for (Tender row : rows) {
                Tender copy = summaryCopy(row);
                copy.setStatus(TenderStatusResolver.resolve(row, todayIST));
                items.add(new Item(copy, TenderDateSort.key(copy.getScrapedAt()), TenderDateSort.key(copy.getDueDate())));
            }
            Snapshot built = new Snapshot(Collections.unmodifiableList(items), version, todayIST, serverToday, System.currentTimeMillis());
            current = built;
            return built.items();
        }
    }

    private static boolean isFresh(Snapshot snapshot, String todayIST) {
        return snapshot != null
                && snapshot.version() == DataVersion.tenderData()
                && snapshot.todayIST().equals(todayIST)
                && snapshot.serverToday().equals(LocalDate.now())
                && System.currentTimeMillis() - snapshot.builtAtMillis() < MAX_AGE_MILLIS;
    }

    /**
     * The tender as the list returns it: every field except the large text fields that only the
     * tender page needs (the same fields the list has always left out).
     */
    public static Tender summaryCopy(Tender source) {
        Tender copy = new Tender();
        BeanUtils.copyProperties(source, copy);
        copy.setAiDetailsSummary(null);
        copy.setAiHistorySummary(null);
        copy.setDownloadedDocs(null);
        copy.setLossReason(null);
        return copy;
    }
}
