package com.tenderpocket.utils;

import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class TenderClassifier {

    // Official GeM Bid format: e.g. GEM/2026/B/7570015, GEM/2025/R/6859576, GEM_2026_B_12345
    private static final Pattern GEM_BID_PATTERN = Pattern.compile("(?i)\\bGEM[/_]\\d{4}[/_][A-Z][/_]\\d+\\b");

    // Known Non-GeM CPPP tender pattern: e.g. 2024_IMSRP_810792_2
    private static final Pattern CPPP_BID_PATTERN = Pattern.compile("(?i)\\b\\d{4}_[A-Z0-9]+_\\d+_\\d+\\b");

    // Known Non-GeM official procurement portals
    private static final String[] KNOWN_NON_GEM_DOMAINS = {
            "eprocure.gov.in", "etenders.gov.in", "defproc.gov.in",
            "mahatenders.gov.in", "apeprocurement.gov.in", "mptenders.gov.in",
            "wbtenders.gov.in", "haryanaeprocurement.gov.in", "tenderwizard.com",
            "tendersontime.com", "isro.gov.in", "drdo.gov.in", "ireps.gov.in"
    };

    private TenderClassifier() {}

    /**
     * Checks if a reference number is a placeholder (e.g. N/A, NA, null, -, blank).
     */
    public static boolean isPlaceholderRefNo(String refNo) {
        if (refNo == null) return true;
        String s = refNo.trim();
        if (s.isEmpty()) return true;
        return s.equalsIgnoreCase("N/A")
                || s.equalsIgnoreCase("NA")
                || s.equalsIgnoreCase("null")
                || s.equals("-")
                || s.equals("--")
                || s.equalsIgnoreCase("TBD")
                || s.equalsIgnoreCase("None");
    }

    /**
     * Extracts an official GeM bid number from given text fields, if present.
     */
    public static String extractGemBidNumber(String... inputs) {
        if (inputs == null) return null;
        for (String input : inputs) {
            if (input == null || isPlaceholderRefNo(input)) continue;
            Matcher m = GEM_BID_PATTERN.matcher(input);
            if (m.find()) {
                return m.group(0).toUpperCase().replace('_', '/');
            }
        }
        return null;
    }

    /**
     * Checks if the given input is a valid official GeM bid number.
     */
    public static boolean isValidGemBidNumber(String refNo) {
        if (isPlaceholderRefNo(refNo)) return false;
        return GEM_BID_PATTERN.matcher(refNo.trim()).matches();
    }

    /**
     * Extracts the canonical lowercase hostname from a URL or domain string.
     * Safely handles query parameters, deceptive subdomains, and malformed inputs.
     */
    public static String extractHost(String urlOrDomain) {
        if (urlOrDomain == null || urlOrDomain.isBlank()) return null;
        String s = urlOrDomain.trim();

        try {
            URI uri;
            if (!s.contains("://")) {
                uri = URI.create("https://" + s);
            } else {
                uri = URI.create(s);
            }
            String host = uri.getHost();
            if (host != null && !host.isBlank()) {
                return host.toLowerCase();
            }
        } catch (Exception ignored) {}

        // Fallback robust manual extraction without crashing on malformed URLs
        try {
            String stripped = s.replaceFirst("^[a-zA-Z]+://", "");
            int slashIdx = stripped.indexOf('/');
            if (slashIdx >= 0) stripped = stripped.substring(0, slashIdx);
            int qIdx = stripped.indexOf('?');
            if (qIdx >= 0) stripped = stripped.substring(0, qIdx);
            int hashIdx = stripped.indexOf('#');
            if (hashIdx >= 0) stripped = stripped.substring(0, hashIdx);
            int colonIdx = stripped.indexOf(':');
            if (colonIdx >= 0) stripped = stripped.substring(0, colonIdx);
            stripped = stripped.trim().toLowerCase();
            return stripped.isEmpty() ? null : stripped;
        } catch (Exception ignored) {}

        return null;
    }

    /**
     * Checks if the URL or domain belongs to the official GeM portal.
     * Strictly verifies hostname boundaries (gem.gov.in or *.gem.gov.in).
     */
    public static boolean isOfficialGemDomain(String urlOrDomain) {
        String host = extractHost(urlOrDomain);
        if (host == null || host.isBlank()) return false;
        return host.equals("gem.gov.in") || host.endsWith(".gem.gov.in");
    }

    /**
     * Checks if the URL or domain belongs to a verified Non-GeM government procurement portal.
     * Strictly validates host domain boundaries, rejecting deceptive hosts and query parameter substrings.
     */
    public static boolean isVerifiedNonGemDomain(String urlOrDomain) {
        String host = extractHost(urlOrDomain);
        if (host == null || host.isBlank()) return false;

        // Exclude GeM first
        if (isOfficialGemDomain(urlOrDomain)) return false;

        // Known Non-GeM central & state procurement portals
        for (String domain : KNOWN_NON_GEM_DOMAINS) {
            if (host.equals(domain) || host.endsWith("." + domain)) {
                return true;
            }
        }

        // Any legitimate government portal (*.gov.in) that is not GeM
        if (host.equals("gov.in") || host.endsWith(".gov.in")) {
            return true;
        }

        return false;
    }

    /**
     * Classifies a tender into "GeM", "Non GeM", or "Unverified" based on verified evidence.
     * Handles conflicting evidence independently and returns "Unverified" on genuine conflicts.
     * A historical GeM bid number appearing only in the title cannot override a verified non-GeM originating portal.
     *
     * @param refNo official reference / bid number
     * @param url destination or original portal URL
     * @param nameofWebsite originating website domain or name (from Tender247 details)
     * @param title tender title / brief
     * @return "GeM", "Non GeM", or "Unverified"
     */
    public static String classify(String refNo, String url, String nameofWebsite, String title) {
        // 1. Authoritative GeM portal / bid evidence
        boolean authoritativeGemSource = isValidGemBidNumber(refNo)
                || isOfficialGemDomain(url)
                || isOfficialGemDomain(nameofWebsite);

        // 2. Authoritative Non-GeM portal / bid evidence
        boolean nonGemBid = refNo != null && !isPlaceholderRefNo(refNo) && CPPP_BID_PATTERN.matcher(refNo.trim()).matches();
        boolean authoritativeNonGemSource = isVerifiedNonGemDomain(url)
                || isVerifiedNonGemDomain(nameofWebsite)
                || nonGemBid;

        // 3. Title-only GeM bid mention
        boolean gemBidInTitle = extractGemBidNumber(title) != null;

        // 4. Resolve conflicts:
        // Case A: Both authoritative GeM source and authoritative Non-GeM source exist -> genuine conflict!
        if (authoritativeGemSource && authoritativeNonGemSource) {
            return "Unverified";
        }

        // Case B: Authoritative GeM source with no conflicting non-GeM source
        if (authoritativeGemSource) {
            return "GeM";
        }

        // Case C: Authoritative Non-GeM source.
        // A historical GeM bid number appearing only in a title does not override a verified non-GeM portal.
        if (authoritativeNonGemSource) {
            return "Non GeM";
        }

        // Case D: No authoritative portal/ref on either side, but title contains a valid GeM bid number
        if (gemBidInTitle) {
            return "GeM";
        }

        // Case E: Insufficient evidence (e.g. aggregator tracking link only, no verified bid number)
        return "Unverified";
    }
}
