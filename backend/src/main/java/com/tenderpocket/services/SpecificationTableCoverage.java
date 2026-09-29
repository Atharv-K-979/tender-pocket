package com.tenderpocket.services;

import java.util.*;
import java.util.regex.*;

/** Source-derived checks for labelled item tables; never supplies missing requirement wording. */
final class SpecificationTableCoverage {
    private static final List<String> FIELDS = List.of("Delivery Period", "Inspection", "FOR", "Remark");
    private SpecificationTableCoverage() {}

    static boolean hinted(List<String[]> rows) {
        return rows.stream().anyMatch(row -> (SpecificationSheetContent.value(row, 10) + " "
                + SpecificationSheetContent.value(row, 5)).matches("(?is).*\\bITEM\\s+(?:DESCRIPTION|SPECIFICATION)\\b.*"));
    }

    static List<String> missing(List<String[]> rows, String context) {
        List<String> missing = new ArrayList<>();
        Matcher pages = Pattern.compile("(?s)\\[SOURCE_PAGE pdf=\"(\\d+)\"[^]]*](.*?)\\[/SOURCE_PAGE]")
                .matcher(context);
        while (pages.find()) {
            String page = pages.group(1), text = pages.group(2);
            if (!text.matches("(?is).*\\bITEM\\s+SPECIFICATION\\b.*")) continue;
            for (String field : FIELDS) {
                Pattern label = Pattern.compile("(?i)\\b" + field.replace(" ", "\\s+") + "\\b");
                if (!label.matcher(text).find()) continue;
                boolean present = rows.stream().anyMatch(row ->
                        Pattern.compile("PDF p\\.\\s*" + page + "(?!\\d)")
                                .matcher(SpecificationSheetContent.value(row, 7)).find()
                        && (label.matcher(SpecificationSheetContent.value(row, 10) + " "
                                + SpecificationSheetContent.value(row, 1)).find()
                            || containsSourceValue(SpecificationSheetContent.value(row, 1), text, label))
                        && label.matcher(SpecificationSheetContent.value(row, 1)).replaceAll("")
                                .replaceAll("[\\s:.;-]", "").length() > 1);
                if (!present) missing.add("PDF p. " + page + ": " + field);
            }
            // An item-description cell must carry its model and parameters, not just its brand tail.
            int end = text.toLowerCase(Locale.ROOT).indexOf("offer validity");
            if (end >= 0 && text.substring(0, end).matches("(?is).*\\bMODEL\\b.*")) {
                String description = text.substring(0, end);
                String extracted = rows.stream().filter(row ->
                        Pattern.compile("PDF p\\.\\s*" + page + "(?!\\d)")
                                .matcher(SpecificationSheetContent.value(row, 7)).find())
                        .map(row -> SpecificationSheetContent.value(row, 1))
                        .collect(java.util.stream.Collectors.joining(" "))
                        .toUpperCase(Locale.ROOT).replaceAll("[\\s,;:]+", "");
                Matcher tokens = Pattern.compile("(?i)(?<![a-z0-9])(?:[a-z]+[-/]?)?\\d[a-z0-9./-]*").matcher(description);
                Set<String> absent = new LinkedHashSet<>();
                while (tokens.find()) {
                    String token = tokens.group().replaceAll("[.,:-]+$", "").toUpperCase(Locale.ROOT);
                    if (token.length() > 1 && !extracted.contains(token)) absent.add(token);
                }
                if (!absent.isEmpty()) missing.add("PDF p. " + page + ": Item Description values " + absent);
            }
        }
        return missing;
    }

    private static boolean containsSourceValue(String wording, String page, Pattern label) {
        String reading = wording.toLowerCase(Locale.ROOT).replaceAll("[\\s\\p{Punct}]", "");
        for (String line : page.split("\\R")) {
            Matcher marker = label.matcher(line);
            if (!marker.find()) continue;
            String value = line.substring(marker.end()).toLowerCase(Locale.ROOT)
                    .replaceAll("[\\s\\p{Punct}]", "");
            if (value.length() >= 5 && reading.contains(value)) return true;
        }
        return false;
    }
}
