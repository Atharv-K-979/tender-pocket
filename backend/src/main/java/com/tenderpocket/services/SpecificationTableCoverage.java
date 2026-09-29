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
                        && label.matcher(SpecificationSheetContent.value(row, 10) + " "
                                + SpecificationSheetContent.value(row, 1)).find());
                if (!present) missing.add("PDF p. " + page + ": " + field);
            }
        }
        return missing;
    }
}
