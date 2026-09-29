package com.tenderpocket.services;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;

class SinglePassComplianceTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test void imageRecoveryUsesHighDetailAndMediumEffortWithoutChangingNativePdfDefaults() throws Exception {
        var ai = new AISpecificationIntelligenceService();
        String nativePayload = ReflectionTestUtils.invokeMethod(ai, "buildAzureResponsesPayload",
                "Copy source rows", "%PDF-native".getBytes(java.nio.charset.StandardCharsets.UTF_8),
                AISpecificationIntelligenceService.AzureOutput.COMPLIANCE_ROWS, List.of());
        assertEquals("low", JSON.readTree(nativePayload).path("reasoning").path("effort").asText());
        String imagePayload = ReflectionTestUtils.invokeMethod(ai, "buildAzureResponsesPayload",
                "Copy source rows", new byte[]{(byte)0x89, 'P', 'N', 'G'},
                AISpecificationIntelligenceService.AzureOutput.COMPLIANCE_ROWS, List.of("ZX10"));
        var parsed = JSON.readTree(imagePayload);
        assertEquals("gpt-5-nano", parsed.path("model").asText());
        assertEquals("medium", parsed.path("reasoning").path("effort").asText());
        assertEquals("high", parsed.path("input").get(0).path("content").get(1).path("detail").asText());
        assertEquals("ZX10", parsed.path("text").path("format").path("schema").path("properties")
                .path("rows").path("items").path("properties").path("productCategory").path("enum").get(0).asText());
        assertEquals(List.of("requirement", "continuation"), JSON.convertValue(parsed.path("text").path("format")
                .path("schema").path("properties").path("rows").path("items").path("properties")
                .path("rowType").path("enum"), List.class), "Page continuations must remain representable");
    }

    @Test void pricesDoNotBecomeClauseNumbersButOriginalReferencesSurvive() {
        var ai = new AISpecificationIntelligenceService();
        Set<String> anchors = ReflectionTestUtils.invokeMethod(ai, "numberedSourceClauses",
                "[SOURCE_PAGE pdf=\"37\"]\n9231.75\n221562.00\n14973.58\n539049.00\n"
                + "5416.00\nEach\n12.50\n2\n3.10 Capacity shall be 100 litres.\n"
                + "3.11\nTemperature shall be -20 C.\n3.12.1 Product safety.\n[/SOURCE_PAGE]");
        assertEquals(Set.of("3.10", "3.11", "3.12.1"), anchors);
    }

    @Test void schemaRequiresPerPageDecisionsInTheFirstCall() throws Exception {
        var ai = new AISpecificationIntelligenceService();
        String request = ReflectionTestUtils.invokeMethod(ai, "buildAzureResponsesPayload",
                "[SOURCE_PAGE pdf=\"1\"]\n3.10 Capacity 100 litres.\n[/SOURCE_PAGE]\n"
                + "[SOURCE_PAGE pdf=\"2\"]\n3.10 Warranty five years.\n[/SOURCE_PAGE]",
                null, AISpecificationIntelligenceService.AzureOutput.COMPLIANCE_ROWS, List.of("Pump"));
        var schema = JSON.readTree(request).path("text").path("format").path("schema");
        var decisions = schema.path("properties").path("clauseDecisions");
        assertEquals(2, decisions.path("required").size());
        assertTrue(decisions.path("properties").has("p1:3.10"));
        assertTrue(decisions.path("properties").has("p2:3.10"));
        assertTrue(schema.path("properties").has("readable"));
        assertFalse(schema.path("properties").has("noApplicableRequirements"),
                "An independent empty flag can contradict rows; derive emptiness from validated rows");
    }

    @Test void technicalAndWarrantyClausesAreHandledInOneCall() {
        var calls = new AtomicInteger();
        var ai = stub(calls, """
                {"readable":true,
                 "clauseDecisions":{"p1:3.10":"included","p1:3.11":"included"},
                 "rows":[{"clauseReference":"3.10","requirement":"Capacity shall be 100 litres.",
                   "productCategory":"Pump","sourceReference":"PDF p. 1","rowType":"requirement"},
                  {"clauseReference":"3.11","requirement":"Warranty shall be five years.",
                   "productCategory":"Pump","sourceReference":"PDF p. 1","rowType":"requirement"}]}
                """);
        var rows = ai.processOcrAndSynthesizeClauses(
                "[SOURCE_PAGE pdf=\"1\"]\n3.10 Capacity shall be 100 litres.\n"
                + "3.11 Warranty shall be five years.\n[/SOURCE_PAGE]", new byte[]{1}, Map.of(), List.of("Pump"));
        assertEquals(1, calls.get());
        assertEquals(2, rows.size());
        assertEquals("3.10", rows.get(0)[0]);
    }

    @Test void readableExcludedBatchCompletesInOneCallWithoutAnIndependentEmptyFlag() {
        var calls = new AtomicInteger();
        var result = stub(calls, """
                {"readable":true,"clauseDecisions":{"p1:3.10":"excluded"},"rows":[]}
                """).processOcrAndSynthesizeClauses(
                "[SOURCE_PAGE pdf=\"1\"]\n3.10 Enter bidder details in the portal.\n[/SOURCE_PAGE]",
                new byte[]{1}, Map.of(), List.of("Pump"));
        assertTrue(AISpecificationIntelligenceService.isCompletedEmpty(result));
        assertEquals(1, calls.get());
    }

    @Test void maintenanceAssetsAndBareSupplyNamesAreNotSpecifications() {
        var rows = List.of(
                row("Comprehensive Maintenance of JOHNSON make 13 passengers lift for 12 months."),
                row("Annual comprehensive maintenance of a 2000 Kg lift."),
                row("Providing and fixing of Light"),
                row("Providing and fixing of Fan"),
                row("Providing and fixing of ARD Battery (12A-18 AH)"),
                row("Providing and fixing of Charger Battery (12V-2.5 AH)"),
                row("Maintenance free battery shall have capacity 18 AH."));
        List<String[]> filtered = ReflectionTestUtils.invokeMethod(new AISpecificationIntelligenceService(),
                "complianceRequirementsOnly", rows);
        assertNotNull(filtered);
        assertEquals(3, filtered.size());
        assertEquals("ARD Battery (12A-18 AH)", filtered.get(0)[5]);
        assertEquals("Charger Battery (12V-2.5 AH)", filtered.get(1)[5]);
        assertTrue(filtered.get(2)[1].contains("18 AH"));
    }

    @Test void rateLimitAndValidationRecoveryShareOneBudget() throws Exception {
        var attempts = new AtomicInteger();
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/responses", exchange -> {
            exchange.getRequestBody().readAllBytes();
            int attempt = attempts.incrementAndGet();
            byte[] body = (attempt == 1 ? "{}" : "{\"rows\":[]}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Retry-After", "1");
            exchange.sendResponseHeaders(attempt == 1 ? 429 : 200, body.length);
            try (var out = exchange.getResponseBody()) { out.write(body); }
        });
        server.start();
        var ai = new AISpecificationIntelligenceService();
        ReflectionTestUtils.setField(ai, "azureOpenAiApiKey", "test-key");
        ReflectionTestUtils.setField(ai, "azureOpenAiEndpoint", "http://127.0.0.1:" + server.getAddress().getPort());
        ai.beginBatch();
        try {
            var rows = ai.processOcrAndSynthesizeClauses("Test batch", new byte[]{1}, Map.of(), List.of("Pump"));
            assertTrue(rows.isEmpty());
            assertFalse(AISpecificationIntelligenceService.isCompletedEmpty(rows));
            assertEquals(2, attempts.get());
            assertFalse(ai.canRetryBatch());
        } finally { ai.endBatch(); server.stop(0); }
    }

    @Test void omittedIncludedClauseCannotBeDisguisedAsSuccessfulEmpty() {
        var calls = new AtomicInteger();
        var ai = stub(calls, """
                {"readable":true,"noApplicableRequirements":true,"excludedClauseReferences":[],
                 "clauseDecisions":{"p1:3.10":"included"},"rows":[]}
                """);
        ai.beginBatch();
        try {
            var result = ai.processOcrAndSynthesizeClauses(
                    "[SOURCE_PAGE pdf=\"1\"]\n3.10 Capacity shall be 100 litres.\n[/SOURCE_PAGE]",
                    new byte[]{1}, Map.of(), List.of("Pump"));
            assertTrue(result.isEmpty());
            assertFalse(AISpecificationIntelligenceService.isCompletedEmpty(result));
            assertEquals(2, calls.get());
            ai.processOcrAndSynthesizeClauses("OCR recovery", null, Map.of(), List.of("Pump"));
            assertEquals(2, calls.get(), "OCR must not reset the logical-batch attempt limit");
        } finally { ai.endBatch(); }
    }

    @Test void repeatedReferenceOnAnotherPageNeedsItsOwnIncludedRow() {
        var ai = new AISpecificationIntelligenceService();
        String[] row = {"3.10", "Capacity 100 litres.", "", "", "", "Pump", "-", "PDF p. 1"};
        Boolean valid = ReflectionTestUtils.invokeMethod(ai, "coversComplianceSourceClauses",
                Collections.singletonList(row),
                "[SOURCE_PAGE pdf=\"1\"]\n3.10 Capacity 100 litres.\n[/SOURCE_PAGE]\n"
                + "[SOURCE_PAGE pdf=\"2\"]\n3.10 Capacity 120 litres.\n[/SOURCE_PAGE]",
                "{\"clauseDecisions\":{\"p1:3.10\":\"included\",\"p2:3.10\":\"included\"}}");
        assertEquals(false, valid);
    }

    @Test void unreadableAndNonCompletedResponsesNeverBecomeEmptySuccess() {
        for (String answer : List.of(
                "{\"readable\":false,\"noApplicableRequirements\":true,\"rows\":[]}",
                "{\"status\":\"cancelled\",\"output_text\":\"{\\\"rows\\\":[],\\\"noApplicableRequirements\\\":true}\"}",
                "{\"status\":\"incomplete\",\"output_text\":\"{\\\"rows\\\":[],\\\"noApplicableRequirements\\\":true}\"}")) {
            var calls = new AtomicInteger();
            var result = stub(calls, answer).processOcrAndSynthesizeClauses(
                    "[SOURCE_PAGE pdf=\"1\"]\n[/SOURCE_PAGE]", new byte[]{1}, Map.of(), List.of("Pump"));
            assertFalse(AISpecificationIntelligenceService.isCompletedEmpty(result));
            assertTrue(calls.get() <= 2);
        }
    }

    @Test void oneTextMismatchRetainsAllFiftyOneNativeRowsWithoutRetry() throws Exception {
        var calls = new AtomicInteger();
        var result = JSON.createObjectNode();
        result.put("readable", true);
        var decisions = result.putObject("clauseDecisions");
        var rows = result.putArray("rows");
        StringBuilder source = new StringBuilder("[SOURCE_PAGE pdf=\"33\"]\n");
        for (int i = 1; i <= 51; i++) {
            String reference = "3." + i;
            String wording = "Capacity shall be 100 litres with stainless steel housing and temperature control.";
            source.append(reference).append(' ').append(wording).append('\n');
            decisions.put("p33:" + reference, "included");
            rows.addObject().put("clauseReference", reference)
                    .put("requirement", i == 25 ? wording.replace("100", "200") : wording)
                    .put("productCategory", "Pump").put("sourceReference", "PDF p. 33")
                    .put("rowType", "requirement");
        }
        source.append("[/SOURCE_PAGE]");
        var ai = stub(calls, result.toString());
        var metrics = new ComplianceConversionMetrics("0.05", "0.005", "0.40", "95", "2026-09-19");
        ai.setConversionMetrics(metrics);
        try {
            var accepted = ai.processOcrAndSynthesizeClauses(source.toString(), new byte[]{1}, Map.of(), List.of("Pump"));
            assertEquals(51, accepted.size());
            assertEquals(1, calls.get());
            assertTrue(accepted.get(24)[1].contains("200"), "Do not silently rewrite uncertain values");
            assertTrue(accepted.get(24)[6].contains("Review required"));
            assertEquals(1, ((List<?>) metrics.snapshot().get("warnings")).size());
            var sheets = SpecificationSheetContent.from(accepted);
            assertTrue(sheets.get(0).clarifications().stream().anyMatch(note -> note.contains("3.25")));
        } finally { ai.clearConversionMetrics(); }
    }

    @Test void imperfectClauseMappingWarnsInsteadOfRejectingUsefulRows() {
        var calls = new AtomicInteger();
        var ai = stub(calls, """
                {"readable":true,"clauseDecisions":{"p1:3.10":"included","p1:3.11":"included"},
                 "rows":[{"clauseReference":"3.10","requirement":"Capacity 100 litres.",
                  "sourceReference":"PDF p. 1","productCategory":"Pump","rowType":"requirement"}]}
                """);
        var accepted = ai.processOcrAndSynthesizeClauses(
                "[SOURCE_PAGE pdf=\"1\"]\n3.10 Capacity 100 litres.\n3.11 Voltage 230 V.\n[/SOURCE_PAGE]",
                new byte[]{1}, Map.of(), List.of("Pump"));
        assertEquals(1, accepted.size());
        assertEquals(2, calls.get());
        assertTrue(accepted.get(0)[6].contains("Review clause coverage"));
    }

    @Test void omittedIncludedClauseIsRecoveredWithoutLosingExistingRowsOrRepeatingTheWholeJob() {
        var calls = new AtomicInteger();
        var ai = new AISpecificationIntelligenceService() {
            @Override String postAzureResponse(String prompt, byte[] bytes, AzureOutput output, List<String> products) {
                if (calls.incrementAndGet() == 1) return """
                        {"readable":true,"clauseDecisions":{"p1:3.10":"included","p1:3.11":"included","p1:3.12":"included"},
                         "rows":[{"clauseReference":"3.10","requirement":"Capacity 100 litres.","productCategory":"Pump",
                                  "sourceReference":"PDF p. 1","rowType":"requirement"},
                                 {"clauseReference":"3.12","requirement":"Frequency 50 Hz.","productCategory":"Pump",
                                  "sourceReference":"PDF p. 1","rowType":"requirement"}]}
                        """;
                assertTrue(prompt.contains("COVERAGE RECOVERY"));
                return """
                        {"readable":true,"clauseDecisions":{},
                         "rows":[{"clauseReference":"3.11","requirement":"Voltage 230 V.","productCategory":"Pump",
                                  "sourceReference":"PDF p. 1","rowType":"requirement"}]}
                        """;
            }
        };
        ai.beginBatch();
        try {
            var accepted = ai.processOcrAndSynthesizeClauses(
                    "[SOURCE_PAGE pdf=\"1\"]\n3.10 Capacity 100 litres.\n3.11 Voltage 230 V.\n"
                            + "3.12 Frequency 50 Hz.\n[/SOURCE_PAGE]", new byte[]{1}, Map.of(), List.of("Pump"));
            assertEquals(List.of("3.10", "3.11", "3.12"), accepted.stream().map(row -> row[0]).toList());
            assertEquals(2, calls.get());
            assertFalse(ai.canRetryBatch());
            assertFalse(accepted.get(0)[6].contains("Unrecovered"));
        } finally { ai.endBatch(); }
    }

    @Test void integerClausesAreCoveredButPromptInstructionsAndQuantityOnlyLinesAreNot() {
        Set<String> anchors = ReflectionTestUtils.invokeMethod(new AISpecificationIntelligenceService(),
                "numberedSourceClauses", "1. Extract all requirements.\n[SOURCE_PAGE pdf=\"2\"]\n"
                        + "1 Capacity 100 litres.\n2. Voltage 230 V.\n06\nNos\n[/SOURCE_PAGE]\n3. Return JSON.");
        assertEquals(Set.of("1", "2"), anchors);
    }

    @Test void unnumberedWarrantyRequirementIsRetained() {
        var calls = new AtomicInteger();
        var ai = stub(calls, """
                {"readable":true,"clauseDecisions":{},
                 "rows":[{"clauseReference":"","requirement":"Warranty shall be five years.",
                  "sourceReference":"PDF p. 1","productCategory":"Pump","rowType":"requirement"}]}
                """);
        var accepted = ai.processOcrAndSynthesizeClauses(
                "[SOURCE_PAGE pdf=\"1\"]\nWarranty shall be five years.\n[/SOURCE_PAGE]",
                new byte[]{1}, Map.of(), List.of("Pump"));
        assertEquals(1, accepted.size());
        assertEquals("Warranty shall be five years.", accepted.get(0)[1]);
        assertEquals(1, calls.get());
    }

    @Test void genericCataloguesAndContractorSafetyAreNotProductSpecifications() {
        List<String[]> rows = new ArrayList<>();
        for (String section : List.of("LIST OF PREFFERED MAKES FOR CIVIL / SANITARY WORKS",
                "LIST OF PREFERRED MAKES OF MATERIALS (ELECTRICAL WORKS)", "SAFETY OF WORKERS",
                "PERSONAL PROTECTIVE EQUIPMENTS (PPEs)", "Product Safety")) {
            String[] row = Arrays.copyOf(row(section.startsWith("PERSONAL")
                    ? "The contractor shall provide safety helmets for all workmen."
                    : "Product shall conform to IS 8112."), 12);
            row[10] = section;
            rows.add(row);
        }
        List<String[]> filtered = ReflectionTestUtils.invokeMethod(new AISpecificationIntelligenceService(),
                "complianceRequirementsOnly", rows);
        assertNotNull(filtered);
        assertEquals(1, filtered.size());
        assertEquals("Product Safety", filtered.get(0)[10]);
    }

    @Test void renderCapturedMaintenanceRowsWithoutAnotherApiCall() throws Exception {
        String input = System.getenv("COMPLIANCE_REPLAY_ROWS");
        Assumptions.assumeTrue(input != null && !input.isBlank(), "Opt-in captured-response replay");
        var captured = JSON.readValue(Files.readString(Path.of(input)), String[][].class);
        List<String[]> filtered = ReflectionTestUtils.invokeMethod(new AISpecificationIntelligenceService(),
                "complianceRequirementsOnly", Arrays.asList(captured));
        var products = SpecificationSheetContent.from(filtered);
        assertEquals(2, products.size());
        assertTrue(products.stream().allMatch(product -> product.name().contains("Battery")));
        var generator = new DocumentGeneratorService();
        Path output = Path.of("target/soft-validation-replay");
        Files.createDirectories(output);
        for (int i = 0; i < products.size(); i++) {
            var product = products.get(i);
            byte[] pdf = generator.generateProductSheetPdf(Map.of(), product);
            byte[] docx = generator.generateProductSheetDocx(Map.of(), product);
            Files.write(output.resolve(product.fileStem(i + 1) + ".pdf"), pdf);
            Files.write(output.resolve(product.fileStem(i + 1) + ".docx"), docx);
            try (var document = PDDocument.load(pdf)) { assertTrue(document.getNumberOfPages() > 0); }
            try (var document = new org.apache.poi.xwpf.usermodel.XWPFDocument(
                    new java.io.ByteArrayInputStream(docx))) {
                assertTrue(document.getTables().get(0).getText().contains("Battery"));
            }
        }
    }

    @Test void actualUploadedMaintenanceTenderCompletes() throws Exception {
        String input = System.getenv("COMPLIANCE_LIVE_PDF");
        Assumptions.assumeTrue(input != null && !input.isBlank(), "Explicit live Azure opt-in");
        var generator = new DocumentGeneratorService();
        var metrics = new ComplianceConversionMetrics("0.05", "0.005", "0.40",
                System.getenv("TECHSPEC_USD_TO_INR_RATE"), System.getenv("TECHSPEC_USD_TO_INR_RATE_DATE"));
        byte[] inputBytes = Files.readAllBytes(Path.of(input));
        boolean maintenanceFixture;
        try (var source = PDDocument.load(inputBytes)) {
            maintenanceFixture = source.getNumberOfPages() == 37;
        }
        if ("true".equalsIgnoreCase(System.getenv("COMPLIANCE_LIVE_LAST_PAGE"))) {
            try (var source = PDDocument.load(inputBytes); var page = new PDDocument();
                 var out = new java.io.ByteArrayOutputStream()) {
                page.importPage(source.getPage(source.getNumberOfPages() - 1));
                page.save(out);
                inputBytes = out.toByteArray();
            }
        }
        var rows = generator.parseSpecificationClauses(inputBytes, "maintenance.pdf",
                Map.of(), (stage, message, percent, done, total, clauses) ->
                        System.out.println("[SinglePassLive] " + stage + ": " + message), metrics);
        Path out = Path.of("target/single-pass-live");
        Files.createDirectories(out);
        Files.writeString(out.resolve("rows.json"), JSON.writerWithDefaultPrettyPrinter().writeValueAsString(rows));
        Files.writeString(out.resolve("metrics.json"), JSON.writerWithDefaultPrettyPrinter().writeValueAsString(metrics.snapshot()));
        assertTrue(!rows.isEmpty() || AISpecificationIntelligenceService.isCompletedEmpty(rows),
                "The actual upload must complete, not return an unvalidated/partial result");
        var products = SpecificationSheetContent.from(rows);
        if (maintenanceFixture) {
            assertFalse(rows.stream().anyMatch(row -> row[1].toLowerCase(Locale.ROOT).contains("comprehensive maintenance")));
            assertEquals(2, products.size(), "Only the two electrically specified replacement batteries qualify");
        } else assertFalse(products.isEmpty(), "The specification fixture contains technical requirements");
        metrics.beginRendering();
        for (int i = 0; i < products.size(); i++) {
            var product = products.get(i);
            assertTrue(product.clauseCount() > 0);
            assertTrue(product.rows().stream().allMatch(row -> !row.reference().isBlank()));
            String stem = product.fileStem(i + 1);
            byte[] pdf = generator.generateProductSheetPdf(Map.of(), product);
            byte[] docx = generator.generateProductSheetDocx(Map.of(), product);
            Files.write(out.resolve(stem + ".pdf"), pdf);
            Files.write(out.resolve(stem + ".docx"), docx);
            try (var document = PDDocument.load(pdf)) { assertTrue(document.getNumberOfPages() > 0); }
        }
        metrics.setResultCounts(products.size(), products.stream().mapToInt(
                SpecificationSheetContent.Product::clauseCount).sum());
        metrics.finish();
        Map<?, ?> counts = (Map<?, ?>) metrics.snapshot().get("document");
        long attempts = ((Number) metrics.snapshot().get("apiAttempts")).longValue();
        long batches = ((Number) counts.get("batches")).longValue();
        assertTrue(attempts >= batches && attempts <= batches * 2,
                "One initial call and at most one recovery per batch; no separate discovery pass");
        Files.writeString(out.resolve("metrics.json"), JSON.writerWithDefaultPrettyPrinter().writeValueAsString(metrics.snapshot()));
        Files.writeString(out.resolve("rows.json"), JSON.writerWithDefaultPrettyPrinter().writeValueAsString(rows));
        System.out.println("[SinglePassLive] " + JSON.writeValueAsString(metrics.snapshot()));
    }

    private AISpecificationIntelligenceService stub(AtomicInteger calls, String answer) {
        return new AISpecificationIntelligenceService() {
            @Override String postAzureResponse(String prompt, byte[] bytes, AzureOutput output, List<String> names) {
                calls.incrementAndGet(); return answer;
            }
        };
    }

    private String[] row(String wording) {
        return new String[]{"", wording, "", "", "", "Equipment", "-", "PDF p. 37", "requirement"};
    }
}
