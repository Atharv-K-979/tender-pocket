package com.tenderpocket.services;

import java.util.*;
import java.util.regex.*;

/** Removes section labels mistaken for product variants without merging real model/rating variants. */
final class SpecificationProductLabels {
    private static final String SECTION = "(?:offer\\s+validity|delivery(?:\\s*/\\s*commercial\\s+terms|\\s+period|\\s*/\\s*site)?"
            + "|inspection(?:\\s*/\\s*quality)?|warranty(?:\\s*/\\s*compliance)?|for|remarks?|general)";
    private static final Pattern SUFFIX = Pattern.compile("(?i)(?:\\s+-\\s*" + SECTION
            + "|\\s*\\(" + SECTION + "\\)|\\s*-?\\s*\\(page\\s+\\d+\\s+entry\\))\\s*$");
    private static final Pattern PAGE = Pattern.compile("(?i)PDF p\\.\\s*(\\d+)");

    private SpecificationProductLabels() {}

    static List<String[]> normalize(List<String[]> rows) {
        List<String[]> result = new ArrayList<>();
        Map<String, String> spelling = new LinkedHashMap<>();
        for (String[] row : rows) {
            String[] copy = row.clone();
            String name = cleanedName(row);
            // Keep the first spelling while matching harmless model-label/spacing differences.
            String key = key(name);
            copy[5] = spelling.computeIfAbsent(key, ignored -> name);
            result.add(copy);
        }
        // A generic clause label can inherit a product only when its cited pages identify exactly one
        // more-specific product. Never guess between two models described on the same page.
        List<String[]> evidence = result.stream().map(String[]::clone).toList();
        for (String[] row : result) {
            String label = row[5];
            String labelKey = key(label);
            if (label.matches(".*\\d.*") || label.isBlank()) continue;
            boolean tableLabel = label.matches("(?i)(?:item description|technical specifications? of items?)");
            Pattern specificModel = Pattern.compile("(?i)^" + Pattern.quote(label) + "\\s*\\([^)]*\\d[^)]*\\)$");
            Set<String> candidates = new LinkedHashSet<>();
            Set<String> cited = pages(SpecificationSheetContent.value(row, 7));
            for (String[] other : evidence) {
                String otherKey = key(other[5]);
                if (otherKey.equals(labelKey) || !(specificModel.matcher(other[5]).matches()
                        || (tableLabel && other[5].matches(".*\\d.*")))) continue;
                if (!Collections.disjoint(cited, pages(SpecificationSheetContent.value(other, 7)))) {
                    candidates.add(other[5]);
                }
            }
            if (candidates.size() == 1) row[5] = candidates.iterator().next();
        }
        return result;
    }

    private static String cleanedName(String[] row) {
        String name = SpecificationSheetContent.value(row, 5);
        while (SUFFIX.matcher(name).find()) name = SUFFIX.matcher(name).replaceFirst("").trim();
        return name;
    }

    private static String key(String name) {
        return name.toLowerCase(Locale.ROOT).replaceAll("\\bmodel\\b", "")
                .replaceAll("[^\\p{L}\\p{N}.+/-]", "");
    }

    private static Set<String> pages(String sources) {
        Set<String> result = new LinkedHashSet<>();
        Matcher matcher = PAGE.matcher(sources);
        while (matcher.find()) result.add(matcher.group(1));
        return result;
    }
}
