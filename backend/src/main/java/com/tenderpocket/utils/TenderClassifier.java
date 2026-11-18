package com.tenderpocket.utils;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class TenderClassifier {

    public static final String GEM = "GeM";
    public static final String NON_GEM = "Non GeM";

    /**
     * An Organization Tender ID (ref_no) that starts with the word GEM, in any letter case: matches
     * GEM/2026/B/7570015, GEM_2026_B_12345 and "GeM Bid 123", but not "GEMINI-2026" or a department
     * number that only mentions GEM later on (e.g. "PHED/GEM/2026/14").
     * TenderIdCleanupMigration and the frontend's classifyByRefNo use the same rule.
     */
    private static final Pattern GEM_PREFIX = Pattern.compile("(?i)^\\s*gem([^a-z]|$)");

    // Official GeM Bid format: e.g. GEM/2026/B/7570015, GEM/2025/R/6859576, GEM_2026_B_12345
    private static final Pattern GEM_BID_PATTERN = Pattern.compile("(?i)\\bGEM[/_]\\d{4}[/_][A-Z][/_]\\d+\\b");

    private TenderClassifier() {}

    /**
     * Tender type is decided only by the Organization Tender ID (ref_no):
     * if it starts with the word GEM the tender is "GeM", otherwise (no ref_no, or a ref_no that does
     * not start with GEM) it is "Non GeM". The T247 ID, links, portal and title play no part.
     */
    public static String classify(String refNo) {
        return refNo != null && GEM_PREFIX.matcher(refNo).find() ? GEM : NON_GEM;
    }

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
}
