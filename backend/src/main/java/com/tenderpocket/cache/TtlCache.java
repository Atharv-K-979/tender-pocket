package com.tenderpocket.cache;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * A small in-memory cache whose entries expire after a fixed time.
 *
 * Used for shared read results that may be a few minutes old (analytics, statistics, user lists).
 * Entries are keyed by the caller's role and username where the result depends on them.
 */
public final class TtlCache<K, V> {

    private record Entry<V>(V value, long expiresAtMillis, long version) {}

    /**
     * A computed value and whether it may be kept. A result built after a failed query (shown as
     * empty) must not be kept, so the next request tries again instead of showing it for minutes.
     */
    public record Computed<V>(V value, boolean cacheable) {}

    private final long ttlMillis;
    private final int maxEntries;
    private final Map<K, Entry<V>> entries = new ConcurrentHashMap<>();

    public TtlCache(long ttlMillis, int maxEntries) {
        this.ttlMillis = ttlMillis;
        this.maxEntries = maxEntries;
    }

    /** Returns the cached value, or computes, stores and returns a new one when missing or expired. */
    public V get(K key, Supplier<V> loader) {
        return get(key, 0L, loader);
    }

    /**
     * As {@link #get(Object, Supplier)}, but an entry stored under a different {@code version} also
     * counts as expired.
     */
    public V get(K key, long version, Supplier<V> loader) {
        return getComputed(key, version, () -> new Computed<>(loader.get(), true));
    }

    /** As {@link #get(Object, Supplier)}, but the loader says whether its result may be kept. */
    public V getComputed(K key, Supplier<Computed<V>> loader) {
        return getComputed(key, 0L, loader);
    }

    private V getComputed(K key, long version, Supplier<Computed<V>> loader) {
        long now = System.currentTimeMillis();
        Entry<V> entry = entries.get(key);
        if (entry != null && entry.expiresAtMillis() > now && entry.version() == version) {
            return entry.value();
        }
        Computed<V> computed = loader.get();
        V value = computed.value();
        if (value != null && computed.cacheable()) {
            if (entries.size() >= maxEntries) {
                entries.entrySet().removeIf(e -> e.getValue().expiresAtMillis() <= now);
                if (entries.size() >= maxEntries) {
                    entries.clear();
                }
            }
            entries.put(key, new Entry<>(value, now + ttlMillis, version));
        }
        return value;
    }

    public void clear() {
        entries.clear();
    }
}
