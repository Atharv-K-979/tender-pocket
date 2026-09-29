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

    static List<String> sourceModelCodes(String context) {
        Set<String> models = new LinkedHashSet<>();
        Matcher matches = Pattern.compile("(?im)\\bMODEL\\s*(?:(?:NO\\.?|NUMBER)\\s*)?[:#-]*\\s*"
                + "([A-Z0-9][A-Z0-9 ./-]{0,60}?)(?=\\s*[,;\\r\\n]|\\s+(?:VOLTS?|CAPACITY|WATTS?|MAKE|TYPE|REFRIGERANT)\\b|$)")
                .matcher(context);
        while (matches.find()) {
            String code = matches.group(1).trim().replaceFirst("(?i)^(?:ITEM\\s+)?DESCRIPTION\\s+", "")
                    .replaceFirst("(?i)^ITEM\\s+", "");
            if (code.matches(".*[A-Za-z].*") && code.matches(".*\\d.*"))
                models.add(code.replaceAll("\\s+", "").toUpperCase(Locale.ROOT));
        }
        return List.copyOf(models);
    }

    static List<String[]> normalize(List<String[]> rows) {
        List<String[]> result = new ArrayList<>();
        Map<String, String> spelling = new LinkedHashMap<>();
        Set<String> explicitModels = new LinkedHashSet<>();
        for (String[] row : rows) explicitModels.addAll(sourceModelCodes(SpecificationSheetContent.value(row, 1)));
        for (String[] row : rows) {
            String[] copy = row.clone();
            String name = cleanedName(row);
            String wording = SpecificationSheetContent.value(row, 1);
            List<String> describedModels = sourceModelCodes(wording);
            boolean itemDescription = wording.matches("(?is)^[\\p{L} /()&:,-]{1,120}\\bMODEL\\b.*")
                    && !wording.matches("(?is)^(?:compatible|for|suitable|supports|connect|works|use|fit|interface"
                            + "|designed|shall|must|should|provide|install|can|the supplied)\\b.*");
            if (itemDescription && describedModels.size() == 1) name = describedModels.get(0);
            else {
                // Match an already identified model exactly inside a longer label, never by fuzzy similarity.
                List<String> identified = new ArrayList<>();
                for (String model : explicitModels) {
                    StringBuilder pattern = new StringBuilder("(?i)(?<![\\p{L}\\p{N}])");
                    for (char character : model.toCharArray())
                        pattern.append(Pattern.quote(String.valueOf(character))).append("\\s*");
                    pattern.append("(?![\\p{L}\\p{N}./-])");
                    if (Pattern.compile(pattern.toString()).matcher(name).find()) identified.add(model);
                }
                if (identified.size() == 1) name = identified.get(0);
            }
            // Keep the first spelling while matching harmless model-label/spacing differences.
            String key = key(name);
            spelling.putIfAbsent(key, name);
            copy[5] = spelling.get(key);
            result.add(copy);
        }
        // A generic clause label can inherit a product only when its cited pages identify exactly one
        // more-specific product. Never guess between two models described on the same page.
        List<String[]> evidence = result.stream().map(String[]::clone).toList();
        for (String[] row : result) {
            String label = row[5];
            String labelKey = key(label);
            if (label.matches(".*\\d.*") || label.isBlank()) continue;
            boolean tableLabel = label.matches("(?i)(?:item description|technical specifications? of items?|" + SECTION + ")");
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
        Map<String, List<String>> descriptions = new LinkedHashMap<>();
        for (String[] row : result) {
            if (!"heading".equals(SpecificationSheetContent.value(row, 8))) {
                descriptions.computeIfAbsent(row[5], ignored -> new ArrayList<>()).add(row[1]);
            }
        }
        Map<String, String> names = new LinkedHashMap<>();
        descriptions.forEach((label, wording) -> names.put(label, displayName(label, wording)));
        for (String[] row : result) row[5] = names.getOrDefault(row[5], row[5]);
        Map<String, String> canonicalNames = new LinkedHashMap<>();
        for (String[] row : result) row[5] = canonicalNames.computeIfAbsent(key(row[5]), ignored -> row[5]);
        List<String> labels = result.stream().map(row -> row[5]).distinct().toList();
        for (String[] row : result) {
            String label = row[5];
            if (!label.matches("(?i)(?=.*[a-z])(?=.*\\d)[a-z0-9./-]+")) continue;
            StringBuilder code = new StringBuilder();
            for (char character : label.toCharArray())
                code.append(Pattern.quote(String.valueOf(character))).append("\\s*");
            Pattern namedModel = Pattern.compile("(?i)^.*\\p{L}{3}.*[\\s(:-]" + code + "[).]*$");
            List<String> matches = labels.stream().filter(other -> !other.equals(label)
                    && namedModel.matcher(other).matches()).toList();
            if (matches.size() == 1) row[5] = matches.get(0);
        }
        return result;
    }

    /** Recover a name only from an explicit description of this exact model, not a nearby product. */
    static String displayName(String label, List<String> descriptions) {
        if (label == null || label.length() > 70
                || !label.matches("(?s).*\\p{L}.*") || !label.matches("(?s).*\\d.*")
                || !label.matches("[\\p{L}\\p{N} .+/-]+")) return label;
        for (String token : label.trim().split("\\s+")) {
            if (token.matches("\\p{L}{5,}")) return label; // Already contains a product name.
        }
        String compactCode = label.replaceAll("\\s+", "");
        StringBuilder code = new StringBuilder();
        for (char character : compactCode.toCharArray()) {
            code.append(Pattern.quote(String.valueOf(character))).append("\\s*");
        }
        Pattern description = Pattern.compile("(?i)^\\s*([\\p{L}][\\p{L} /()&:,-]{1,119}?)"
                + "\\s*,?\\s+MODEL\\b\\s*(?:(?:NO\\.?|NUMBER)\\s*)?[:#.-]*\\s*"
                + code + "(?=$|[,;:)\\s]|\\.(?:\\s|$))(?![\\p{L}\\p{N}])");
        Map<String, String> names = new LinkedHashMap<>();
        for (String wording : descriptions) {
            if (wording == null) continue;
            Matcher match = description.matcher(wording);
            if (!match.find()) continue;
            String name = match.group(1).trim().replaceAll("\\s+", " ")
                    .replaceFirst("(?i)^ITEM\\s+DESCRIPTION\\s*:?\\s*", "")
                    .replaceFirst("(?i)\\s*,?\\s+TYPE\\s*[:-].*$", "").replaceAll("[,\\s]+$", "");
            if (name.isBlank() || name.matches("(?i)(?:item\\s+description|description|item|model)")) continue;
            names.putIfAbsent(name.toLowerCase(Locale.ROOT), name);
        }
        return names.size() == 1 ? names.values().iterator().next() + " - " + label : label;
    }

    private static String cleanedName(String[] row) {
        String name = SpecificationSheetContent.value(row, 5);
        while (SUFFIX.matcher(name).find()) name = SUFFIX.matcher(name).replaceFirst("").trim();
        return name;
    }

    private static String key(String name) {
        return name.toLowerCase(Locale.ROOT).replaceAll("\\bmodel\\b", "")
                .replaceAll("\\s+-\\s+", " ")
                .replaceAll("[^\\p{L}\\p{N}.+/-]", "");
    }

    private static Set<String> pages(String sources) {
        Set<String> result = new LinkedHashSet<>();
        Matcher matcher = PAGE.matcher(sources);
        while (matcher.find()) result.add(matcher.group(1));
        return result;
    }
}
