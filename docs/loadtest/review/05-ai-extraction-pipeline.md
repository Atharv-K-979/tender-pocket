# 05 — AI specification extraction pipeline

Scope: technical-specification upload → text extraction → scanned-page detection → OCR → Azure OpenAI → Gemini fallback → parsing/validation → rendering → persistence → progress polling. Also covers Excel/DOCX/TXT inputs and the product-datasheet extraction that uses the same AI client.

Source state: branch `load-testing`, commit `68eb28ae` (2026-10-27). Read-only review; nothing was executed.

Labels: **VERIFIED** = read in code. **INFERRED** = reasoned from code or from documented library defaults. **UNKNOWN** = cannot be established from the repo (what would establish it is stated). Deployed values of every env var are **UNKNOWN**; defaults below are the ones written in code, `application.properties` or the compose files.

---

## 0. Summary for load-test planning

| # | Finding | Label | Where |
|---|---------|-------|-------|
| 1 | The whole conversion runs **synchronously on the Tomcat request thread** of `POST /api/tenders/{id}/upload-tech-spec`. Upload, extraction, all AI calls, OCR, rendering and saving finish before the HTTP response returns. There is no job queue. | VERIFIED | `backend/.../controllers/TenderController.java:1800-2146` |
| 2 | Every PDF upload creates its **own** `Executors.newFixedThreadPool(min(5, batches))`. There is **no global limit** on concurrent AI calls. 17 concurrent uploads means up to 85 concurrent Azure requests plus 17 blocked Tomcat threads. | VERIFIED | `backend/.../services/DocumentGeneratorService.java:1931-1932` |
| 3 | AI calls per PDF: best case **1 per batch** (batch = up to 4 text pages, or 1 scanned page). Hard cap **2 Azure HTTP calls per batch**. Gemini fallback calls are **not** counted against that cap (up to 4 models × N keys for each failed Azure call). | VERIFIED | `AISpecificationIntelligenceService.java:49-58, 984-1048, 1387-1442`; `DocumentGeneratorService.java:1510, 2535-2552` |
| 4 | Memory: the whole upload is held as `byte[]`, re-parsed in memory by PDFBox, split into per-batch `byte[]` (up to 12 MB each), then base64-encoded into a JSON string for each request. That is roughly 5× the batch size per in-flight call, with up to 5 calls in flight per upload. Root compose sets `-Xmx3g` with `mem_limit: 5g`. | VERIFIED (code) / INFERRED (multiplier) | `TenderController.java:1873`; `DocumentGeneratorService.java:1508, 2537, 2600-2607`; `AISpecificationIntelligenceService.java:850-859, 999-1000`; `docker-compose.yml:25,32` |
| 5 | The Azure endpoint and key can be swapped for a mock **by env only**: `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY`. The model/deployment name is **hard-coded** to `gpt-5-nano`; the `azure.openai.deployment` property is ignored. The Gemini base URL is **hard-coded**, so Gemini cannot be mocked. Keep `GEMINI_API_KEY` unset during load tests. | VERIFIED | `AISpecificationIntelligenceService.java:39-44, 1679-1697, 1137` |
| 6 | The Gemini fallback calls `pace()`, which holds a **JVM-wide static lock** while sleeping (default 4000 ms between requests). Under fallback, all uploads share one request per 4 s across the whole JVM. | VERIFIED | `AISpecificationIntelligenceService.java:753-768, 1136` |
| 7 | Progress is an **in-memory `ConcurrentHashMap` keyed by tender ID**. Entries are never evicted, are lost on restart, are not shared across instances, and are overwritten by a second upload to the same tender. The client polls once per second. | VERIFIED | `ComplianceProgressService.java:13-17, 30-34`; `frontend/src/app/tenders/[id]/page.tsx:1155-1166`; `frontend/src/app/page.tsx:1326-1338` |
| 8 | Next.js proxies the upload with `fetch` and **no timeout**, so Node/undici defaults apply (believed 300 s headers timeout). If a conversion takes longer, the browser gets an error while Java keeps running and keeps spending on AI. | VERIFIED (no timeout set) / INFERRED (undici default) | `frontend/src/lib/backendProxy.ts:46-51`; `frontend/src/lib/technicalSpecificationBackend.ts:58-65` |

---

## 1. Entry points and request path

| Step | Code | Sync/async | Label |
|------|------|-----------|-------|
| Browser → `POST /api/tenders/{id}/upload-tech-spec` (Next.js route) | `frontend/src/app/api/tenders/[id]/upload-tech-spec/route.ts:3-9` → `proxyToBackend` | async (Node) | VERIFIED |
| `proxyToBackend` buffers multipart with `await request.formData()` and re-posts it to `${BACKEND_URL}` with **no timeout and no abort signal** | `frontend/src/lib/backendProxy.ts:32-51` | — | VERIFIED |
| `BACKEND_URL` default `http://localhost:8090` (root compose: `http://tender-pocket-backend:8090`) | `backendProxy.ts:3`; `docker-compose.yml:93` | — | VERIFIED |
| Spring `@PostMapping("/{id}/upload-tech-spec")` | `backend/.../controllers/TenderController.java:1800-2146` | **synchronous, request thread** | VERIFIED |
| Browser polls `GET /api/tenders/{id}/tech-spec-progress` every 1000 ms while the upload request is open | `frontend/src/app/tenders/[id]/page.tsx:1155-1166`; `frontend/src/app/page.tsx:1326-1338` | — | VERIFIED |
| Next progress route → `fetchSpecificationBackend` → Spring `GET /api/tenders/{id}/tech-spec-progress` | `frontend/src/app/api/tenders/[id]/tech-spec-progress/route.ts:9-24`; `TenderController.java:1785-1789` | — | VERIFIED |
| Next progress route writes `console.log` on **every** poll whose status is not `NOT_STARTED` | `tech-spec-progress/route.ts:16-18` | — | VERIFIED |

Other AI-consuming entry points (same AI client):

| Endpoint | AI use | Label |
|----------|--------|-------|
| `POST /api/products/models/upload` (Next proxy `frontend/src/app/api/products/models/upload/route.ts:3-5` → `ProductCatalogueController.java:51-74` → `ProductCatalogueService.java:70-134`) | 1 `DATASHEET_SPECS` call with the **whole PDF inline** (no 12 MB cap) | VERIFIED |
| Backend-only `POST /api/tenders/{id}/generate-bid-docs` and `POST /api/tenders/{id}/generate-tech-specs` | Call `parseSpecificationClauses(null, null, data)` with empty text, which still issues an AI request when an Azure key is set. See §12 and doc 06. | VERIFIED (call path) / INFERRED (provider accepts empty prompt) |
| `ProductCatalogueService.matchTenderClausesWithEvidence` → `matchClausesWithProductSpecifications` (`MATCH_CLAUSES`) | **Dead code**: grep finds no caller of `matchTenderClausesWithEvidence` | VERIFIED |

The `/compliance-progress.js` helper script is loaded on **every page** through `frontend/src/app/layout.tsx:19` → `frontend/src/app/api/compliance-progress-client/route.ts:5-21`, which proxies to the backend with `no-store`. This is not AI work, but it adds one backend round trip per page view (VERIFIED).

---

## 2. Upload validation (size/type)

| Check | Value | Where | Label |
|-------|-------|-------|-------|
| Spring multipart limits | `max-file-size=50MB`, `max-request-size=50MB` | `application.properties:75-77` | VERIFIED |
| Tomcat swallow size | `server.tomcat.max-swallow-size=50MB` | `application.properties:72` | VERIFIED |
| Multipart disk threshold | not set, so Spring default applies (believed 0 B: always spooled to temp disk) | — | INFERRED |
| Controller re-checks | `file.getSize() > 50 MB` → 400 (`TenderController.java:1853-1855`); `uploadedBytes.length > 50 MB` → 400 (`1881-1883`) | | VERIFIED |
| Extension whitelist | `.pdf .docx .doc .txt .xlsx .xls` | `TenderController.java:1864-1869` | VERIFIED |
| Magic-byte checks | xlsx = ZIP or OLE2; xls = OLE2; txt must not be ZIP/OLE2 (`1886-1919`). **PDF has no magic check.** | | VERIFIED |
| Whole file read into heap | `uploadedBytes = file.getBytes()` | `TenderController.java:1873` | VERIFIED |
| Already-approved spec | 409 if `specVerificationStatus == Approved` (`1842-1847`) | | VERIFIED |
| Unknown tender ID | A **new `Tender` row is created** (`1829-1839`). Load scripts can use synthetic IDs, but each one adds DB rows. | | VERIFIED |
| Next.js body limit | No middleware found; no route-level limit configured | `frontend/next.config.ts` | UNKNOWN (framework default; confirm by test) |

`.doc` is accepted but parsed with `XWPFDocument` (OOXML only). A real binary `.doc` throws, the exception is caught, and the text stays empty (`DocumentGeneratorService.java:1749-1767`). Extraction then runs on empty text and still calls the AI (§12). Path VERIFIED; outcome INFERRED.

---

## 3. Text extraction

| Input | Library / method | Where | Label |
|-------|------------------|-------|-------|
| PDF | Apache PDFBox `PDDocument.load(byte[])` + `PDFTextStripper` **per page** | `DocumentGeneratorService.java:2537, 2562-2567, 2751-2808` | VERIFIED |
| PDFBox version | Not declared in `backend/pom.xml`; comes transitively from `openhtmltopdf-pdfbox` 1.0.10 (`pom.xml:102-104`). `PDDocument.load` is a PDFBox 2.x API. | | INFERRED 2.0.x; exact version UNKNOWN (run `mvn dependency:tree`) |
| DOCX | Apache POI `XWPFDocument`: paragraphs then table cells | `DocumentGeneratorService.java:1749-1767`; POI `poi-ooxml` 5.3.0 (`pom.xml:95-97`) | VERIFIED |
| XLSX/XLS | POI `WorkbookFactory.create` (full in-memory workbook) | `DocumentGeneratorService.java:2169-2310` | VERIFIED |
| TXT | `new String(bytes, UTF_8)` | `DocumentGeneratorService.java:1768-1774` | VERIFIED |

PDF text is cleaned per page: page furniture is dropped (`cleanExtractedText`, `2822-2842`) and the text is wrapped in `[SOURCE_PAGE pdf="N" printed="M"] … [/SOURCE_PAGE]` markers (`2794-2798`). VERIFIED.

The PDF is parsed several times per upload, all in memory (VERIFIED):
1. `createPdfBatches` loads the whole PDF and runs `PDFTextStripper` on every page to classify it as scanned or not (`2537-2539`).
2. Each batch is copied into a new `PDDocument` and saved to `byte[]` (`2600-2607`).
3. `extractPdfText` re-loads every batch `byte[]` and strips text again (`2596-2597`, `2757`).
4. `containsScannedPage` re-loads a batch during recovery (`2554-2560`).

---

## 4. Scanned-PDF detection (including the latest "thin image strips" commit)

Constants (VERIFIED, `DocumentGeneratorService.java:1706-1710`):
```java
private static final int MIN_PAGE_TEXT_CHARS = 80;
private static final long MIN_SCANNED_IMAGE_PIXELS = 300L * 300;   // 90,000 px
private static final int MAX_OCR_PAGES = 60;
```

Heuristic `isScannedPage` (VERIFIED, `2562-2567`):
```java
return cleanExtractedText(stripper.getText(document)).length() < MIN_PAGE_TEXT_CHARS
        && imagePixelArea(document.getPage(page).getResources(), 0) >= MIN_SCANNED_IMAGE_PIXELS;
```

- A page counts as scanned when its cleaned text is **under 80 characters** **and** the **sum** of `width × height` over all image XObjects on the page is **at least 90,000 px**.
- `imagePixelArea` (`2571-2582`) recurses into Form XObjects up to depth 4 and adds up the area of every `PDImageXObject`. Commit `68eb28ae` changed this from "one image ≥ 300×300" to "total area". This catches "Microsoft: Print To PDF" scans stored as many full-width strips (the commit message example is 46 strips of 1655×52 px).
- Calling `image.getWidth()/getHeight()` reads only the image dictionary and does not decode the image. INFERRED from the PDFBox API.

There are two different "scanned" tests (VERIFIED):
- `isScannedPage` (text < 80 **and** images) controls batching and upright-image recovery (`2539-2546`, `2036`, `2077`).
- `hasUnreadablePage` (any page in the batch with text < 80, **images not required**) and `extractPdfText`'s `scannedPage` (text < 80) decide whether OCR runs (`2499-2510`, `2773`).

How detection drives batching (VERIFIED, `2535-2552`):
- `MAX_NATIVE_PDF_BATCH_PAGES = 4` (`1510`).
- A scanned page is always a **1-page batch**.
- A run of text pages becomes batches of up to 4 pages, and each batch stops before the next scanned page.
- A batch whose saved size is over `MAX_INLINE_PDF_BYTES = 12 MiB` (`1508`) is split in half recursively. A single page over 12 MiB throws `IOException` (`2593-2595`). `parsePdfSpecificationClauses` catches it and returns an empty list (`1840-1843`), so the upload fails with 400 "could not validate".

Load impact (INFERRED): a fully scanned 60-page tender produces **60 batches**, so ≥60 AI calls. A 60-page text tender produces 15 batches.

---

## 5. OCR

| Aspect | Value | Where | Label |
|--------|-------|-------|-------|
| Engine | Tesseract **CLI** via `ProcessBuilder` (not Tess4J) | `DocumentGeneratorService.java:2857-2887` | VERIFIED |
| Binary lookup | `TESSERACT_PATH` env, then `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, then `tesseract` on PATH | `2717-2728` | VERIFIED |
| Availability probe | `tesseract --version`, run once per `extractPdfText` call | `2775-2781, 2845-2855` | VERIFIED |
| Command | `tesseract <tmp.png> stdout` with **no `-l`** (Tesseract's default language, eng) and `OMP_THREAD_LIMIT=1` | `2864-2867` | VERIFIED (args) / INFERRED (default lang) |
| Docker (backend) | `apk add tesseract-ocr tesseract-ocr-data-eng` (English only) on `eclipse-temurin:21-jre-alpine` | `backend/Dockerfile:12,19` | VERIFIED |
| Render | `PDFRenderer.renderImageWithDPI(page, 200)` → PNG temp file (`File.createTempFile`, deleted in `finally`) | `2860-2862, 2883-2885` | VERIFIED |
| Memory per rendered page | A4 at 200 DPI ≈ 1654×2339 px; with the default RGB image type that is about 15 MB of raster per page, plus PNG encoding | — | INFERRED |
| Page cap | `MAX_OCR_PAGES = 60` **per `extractPdfText` call**. OCR is called per batch (≤4 pages), so the cap never binds and there is **no per-document OCR cap**. | `1710, 2754, 2774` | VERIFIED |
| Timeout | **None.** `process.waitFor()` has no timeout and stdout is read until EOF. | `2868-2877` | VERIFIED |
| Concurrency | Runs inside the per-upload batch workers, so up to 5 tesseract processes per upload with no global limit | `1931-1932, 2050` | VERIFIED |
| When it runs | Only during **recovery**: (native AI result empty, failed, "unclear", or item-table coverage check needed) **and** the batch has a page with < 80 chars **and** the batch retry budget allows (`canRetryBatch`) | `2031-2057` | VERIFIED |
| Use of the OCR text | Becomes the batch's text context; the PDF is still attached. If the batch is 1 scanned page, the page is rendered to a **200-DPI PNG** and sent as `input_image` instead of the PDF (`2074-2083, 2730-2743`). | | VERIFIED |

OCR **never replaces** AI: the OCR text is re-sent to the model. The OCR retry is counted against the same 2-call batch budget (§7).

---

## 6. Azure OpenAI call (primary)

| Aspect | Value | Where | Label |
|--------|-------|-------|-------|
| API | Azure OpenAI **Responses API**: POST `<endpoint>/responses` | `AISpecificationIntelligenceService.java:1685-1693` | VERIFIED |
| Endpoint resolution | `System.getenv("AZURE_OPENAI_ENDPOINT")` if non-blank, else property `azure.openai.endpoint` (`${AZURE_OPENAI_ENDPOINT:}`, `application.properties:62`), else hard-coded `https://tenderpocket.services.ai.azure.com/api/projects/proj-default/openai/v1`. Trailing `/` stripped; `/responses` appended unless already present. | `42-43, 1685-1693` | VERIFIED |
| API key | property `azure.openai.api-key` (`${AZURE_OPENAI_API_KEY:}`, `application.properties:61`), else env `AZURE_OPENAI_API_KEY`. Sent as header `api-key`. Missing or `${…}` placeholder → no call (returns null, which triggers the Gemini fallback). | `36-37, 976-977, 994, 1679-1683, 1699-1703` | VERIFIED |
| Model / deployment | **Hard-coded** `"gpt-5-nano"`. `getAzureOpenAiDeployment()` returns `SPECIFICATION_MODEL`. The `@Value("${azure.openai.deployment:gpt-5-nano}")` field (`39-40`) is **never used**. | `44, 827, 1695-1697` | VERIFIED |
| HTTP client | `java.net.HttpURLConnection`, new connection per request, `disconnect()` in `finally` | `988-1045` | VERIFIED |
| Timeouts | connect **30 000 ms**, read **180 000 ms** | `996-997` | VERIFIED |
| Retries (HTTP level) | At most 2 attempts. The 2nd runs only for **429/502/503/504** on attempt 0, when the batch budget allows, and when the wait ≤ `MAX_INLINE_WAIT_MS = 75 000`. Wait = `Retry-After` header (seconds), else `"retryDelay":"Ns"` in the body, else 1000 ms; sleeps wait+250 ms. No retry on other 4xx/5xx or on exceptions. | `746, 984-1030, 1113-1119` | VERIFIED |
| Request body | `model`; `reasoning.effort` = `low` (PDF/text) or `medium` (image recovery); `store:false`; `max_output_tokens` = **32 768** for COMPLIANCE_ROWS/MATCH_CLAUSES and **4 096** for PRODUCTS/DATASHEET_SPECS; one user message holding `input_text` plus either `input_file` (PDF as `data:application/pdf;base64,…`, filename `tender-batch.pdf`) or `input_image` (PNG, `detail: high`); `text.format` = strict `json_schema` | `824-967` | VERIFIED |
| Temperature | **Not set** for Azure | `824-967` | VERIFIED |
| Structured output | Strict schema. COMPLIANCE_ROWS: `readable`, `clauseDecisions` (one enum property per source clause key found in the prompt), and `rows[]` with 10 string fields. `rowType` enum; `sourceReference` enum of allowed page references; `productCategory` enum when known products are passed. | `862-965` | VERIFIED |

### Prompt construction (COMPLIANCE_ROWS) — `callGenerativeLlmAi`, `1244-1443`
- The fixed system/rules text is **≈9 000 characters** (string literals in `1246-1344`, about 9 020 chars; INFERRED ≈2.2–2.5k tokens). A shorter transcription prompt replaces it for PNG image recovery (`1346-1370`).
- Appended when the text is longer than 20 chars: a note on page markers, then `EXTRACTED DOCUMENT TEXT:` + the full batch/chunk text, then `NUMBERED SOURCE CLAUSES THAT MUST BE ACCOUNTED FOR` (`1372-1383`).
- Always appended: `SOURCE CLAUSE KEYS` and `ALLOWED SOURCE REFERENCES` (`1384-1385`). Allowed references are every non-empty subset of the ≤4 pages, so up to 15 strings (`1617-1637`).
- For PDF batches, `[PRODUCT_NAME_HINTS]` (found locally by heading regex, **no AI call**) are prepended (`DocumentGeneratorService.java:1851, 2479-2484`; `AISpecificationIntelligenceService.java:568-570`).
- **Truncation:** none. PDF batch text is bounded by 4 pages. Non-PDF text is chunked only above `techspec.chunk-chars` (default **40 000**, `@Value` at `163-164`, **not** in `application.properties`). See §9.
- Validation retry (attempt 2) appends `validationRetryInstructions` (`1514-1537`) to the same prompt and resends the same file.

### Token/cost settings
- Prices (only for the metrics estimate, not enforced): `techspec.pricing.input-usd-per-million` = 0.05, `cached-input` = 0.005, `output` = 0.40; INR conversion needs `TECHSPEC_USD_TO_INR_RATE` and `_DATE` (`application.properties:63-67`; `ComplianceProgressService.java:19-28`; `ComplianceConversionMetrics.java:58-71, 235-242`). VERIFIED.
- Usage is read from the response `usage.{input_tokens, input_tokens_details.cached_tokens, output_tokens, output_tokens_details.reasoning_tokens, total_tokens}` (`ComplianceConversionMetrics.java:132-150`). VERIFIED.
- Output cost ceiling per COMPLIANCE_ROWS call at default prices: 32 768 × $0.40/M ≈ **$0.0131** (INFERRED arithmetic). Input tokens for an attached PDF are **UNKNOWN**: they depend on how Azure tokenises `input_file` pages. The upload response `metrics.tokens` reports the real figures.

---

## 7. Retry budget and number of AI calls per extraction

Batch budget (VERIFIED, `AISpecificationIntelligenceService.java:48-58`):
```java
private final ThreadLocal<Integer> batchAttempts = new ThreadLocal<>();
void beginBatch() { batchAttempts.set(0); }
boolean canRetryBatch() { return batchAttempts.get() == null || batchAttempts.get() < 2; }
private boolean reserveBatchAttempt() { if (!canRetryBatch()) return false;
    if (batchAttempts.get() != null) batchAttempts.set(batchAttempts.get() + 1); return true; }
```
- PDF batch workers call `beginBatch()`/`endBatch()` (`DocumentGeneratorService.java:1953, 1963`). Each validation attempt, each Azure HTTP retry, the omission-recovery call and the OCR/upright-image retry take from the same budget of **2**.
- On non-PDF paths (DOCX/TXT/XLSX, datasheet, bid-pack) the ThreadLocal is **null**, so `canRetryBatch()` is always true and `reserveBatchAttempt()` never increments. Only the loop bounds limit calls there. `recoverIncludedRows` sets its own budget of 1 (`1467-1469`).

| Input | Best case (Azure HTTP calls) | Worst case Azure | Gemini on top (per failed Azure call) | Label |
|-------|------------------------------|------------------|----------------------------------------|-------|
| PDF, B batches | **B** (one combined product+requirement call per batch; product discovery is local) | **2B** | up to 4 models × K keys, +1 inline wait-retry per model on per-minute 429 | VERIFIED |
| DOCX/TXT/XLSX text ≤ 40 000 chars | 1 | 4 (2 validation attempts × 2 HTTP) or 2+1 recovery | as above, per `postAiResponse` | VERIFIED |
| Text > 40 000 chars, C products | 1 + C (DOCX/TXT need one PRODUCTS discovery call; Excel passes sheet names so no discovery) | (2 discovery) + C × 2 `callGenerativeLlmAi` (scoped section, then **whole document** re-read if empty) × ≤4 | as above | VERIFIED (`175-264, 644-696`) |
| Datasheet upload | 1 | 2 | as above | VERIFIED (`2288-2336`) |

Batch count B ≈ (number of scanned pages) + ⌈text pages / 4⌉ + any 12 MiB splits (INFERRED from `2535-2552`).

There is **no deduplication or caching** of AI results. Re-uploading the same file pays again (VERIFIED: no cache anywhere in the call path).

A batch that fails (null or non-empty-invalid after its budget) makes the **whole upload fail with HTTP 400**. All other batches have already been paid for (`DocumentGeneratorService.java:1978-1996`; `TenderController.java:2032-2040`). VERIFIED.

---

## 8. Gemini fallback — exact trigger conditions

Every AI request goes through `postAiResponse` (VERIFIED, `AISpecificationIntelligenceService.java:1050-1058`):
```java
String postAiResponse(String prompt, byte[] fileBytes, AzureOutput output, List<String> knownProducts) {
    String azureResponse = postAzureResponse(prompt, fileBytes, output, knownProducts);
    if (azureResponse != null && !azureResponse.isBlank()) {
        return azureResponse;
    }
    reportProgress("Azure OpenAI endpoint unavailable or returned empty; attempting Gemini AI fallback.");
    ...
    return postGeminiResponse(prompt, fileBytes, output, knownProducts);
}
```
`postAzureResponse` returns null (and so triggers Gemini) when (VERIFIED, `974-1048`):
1. the Azure key is missing, blank or a `${…}` placeholder (`976-977`);
2. the thread is interrupted (`985`);
3. a retry attempt cannot reserve budget (`986`);
4. the response is non-2xx after the optional single 429/502/503/504 retry (`1011-1030`);
5. any exception occurs: `UnknownHostException`, `ConnectException`, `SocketTimeoutException` (incl. 180 s read timeout), or anything else (`1031-1042`);
6. 2xx with a blank body (`1052`).

Gemini does **not** run when Azure returns 2xx with `status: incomplete`, malformed JSON, `readable:false` or rows that fail validation. Those go to the Azure validation retry, or fail.

Gemini details (VERIFIED, `1060-1203`):
- Keys from `getAllApiKeys()`: property `gemini.api.key` (`${GEMINI_API_KEY:}`, `application.properties:58`), env `GEMINI_API_KEY`, and the classpath `application.properties` read directly. All are comma-split, deduplicated, and placeholders dropped (`711-743`). No keys → null, so the batch fails.
- Models tried in order: `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`, `gemini-1.5-pro` (`1089`). This conflicts with the unused `MODEL_CHAIN` constant and its comment, which says the 1.5 family is retired and returns 404 (`447-455`).
- URL **hard-coded**: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}` (`1137`). It is **not configurable**.
- `generationConfig`: `temperature 0.1`, `maxOutputTokens 8192`, `responseMimeType application/json`. **No response schema** (`1082-1085`).
- The file is always sent as `mimeType: application/pdf`, even for PNG image recovery (`1076-1079`). INFERRED: Gemini would reject or misread those requests.
- Timeouts: connect 30 s, read 180 s (`1143-1144`).
- **Global pacing**: `pace()` is `synchronized` on a static lock and **sleeps while holding it** until `techspec.min-request-interval-ms` (default **4000**, `753-754`, not in properties) has passed since the last Gemini request JVM-wide (`756-768`). All concurrent uploads that fall back therefore queue behind one lock.
- 429 handling: a per-minute quota with `retryDelay ≤ 75 s` gets one inline wait per `postOnce` (`1163-1181`). A daily quota, or no delay, marks the key rate-limited for **12 h** in a static `RATE_LIMITED_KEYS` map (`709, 803-810, 1183-1185`).

**Other providers:** `extractModelText` also parses an Ollama-style `response` field (`2008-2011`), but no Ollama client exists. No other providers are present. VERIFIED.

---

## 9. Structured parsing and validation

| Step | Where | Label |
|------|-------|-------|
| Envelope → model text (Gemini `candidates[0].content.parts[0].text`; Azure `output[].content[]` with `type` `output_text`; `output_text`; Ollama `response`) | `AISpecificationIntelligenceService.java:1977-2020` | VERIFIED |
| `parseLlmJsonResponse` rejects `status != completed` and Gemini `MAX_TOKENS`; maps rows to a 12-column `String[]` | `1763-1825` | VERIFIED |
| `readable:false` → null, so that batch goes to OCR recovery | `1404-1410` | VERIFIED |
| Clause filtering (bid-validity, PPE, AMC lines, etc.) | `complianceRequirementsOnly` `1576-1615` | VERIFIED |
| Evidence validation: source page must canonicalise to a `[SOURCE_PAGE]`. For native PDF, wording mismatches only add a warning; for text-only input they drop the row. | `validateEvidenceRows` `1831-1874` | VERIFIED |
| Coverage: `clauseDecisions` must have **exactly** the anchor keys; any "included" key with no row → one recovery call | `1539-1574, 1452-1507` | VERIFIED |
| Post-processing (no AI): `SpecificationProductLabels.normalize`, `groupCompactItemSchedule`, `SpecificationSheetContent.fromSourceRequirements` | `DocumentGeneratorService.java:1859-1861, 1873-1905`; `TenderController.java:2050-2053` | VERIFIED |

Non-PDF chunking (text > `techspec.chunk-chars`), VERIFIED `175-393`:
- `splitIntoChunks` cuts only at clause or heading lines, with a hard limit of 1.5 × chunk size. The chunks are only used to decide that per-product mode is needed; extraction is per product.
- Per product: `sectionsFor` picks the sections whose headings match. If nothing matches, the **whole document** is sent (`306-349`). An empty result also triggers a whole-document re-read (`229-233`).
- INFERRED risk: a large TXT/XLSX (TXT up to 50 MB; XLSX up to 100 000 cells) can produce very large prompts per product. This may exceed the model context window (Azure returns 4xx → Gemini fallback → failure).

---

## 10. Excel specification extraction

VERIFIED, `DocumentGeneratorService.java:2163-2310`:
- Limits: `MAX_EXCEL_SHEETS = 50`, `MAX_EXCEL_ROWS_PER_SHEET = 10 000`, `MAX_EXCEL_TOTAL_CELLS = 100 000` (`2165-2167`). Exceeding any of them → `IllegalArgumentException` → HTTP 400.
- `ZipSecureFile.setMinInflateRatio(0.01)` is a **JVM-global static** zip-bomb setting, applied on every call (`2183`).
- The whole workbook is loaded into memory (XSSF/HSSF via `WorkbookFactory`); there is no streaming SAX reader (`2186-2187`).
- Each non-generic sheet name becomes a product (`[SOURCE_PRODUCT name="…"]` marker) and is passed as `knownProducts`, which becomes the `productCategory` enum. A single AI call is made if the text is ≤ 40 000 chars, otherwise one or two calls per sheet/product (§7).
- Password-protected or corrupt workbooks → 400 with a message (`2292-2309`).

---

## 11. Rendering, persistence and completion (upload flow)

| Step | Where | Label |
|------|-------|-------|
| Input file saved as `specification.<ext>` via `persistDocument` **before** extraction | `TenderController.java:1935-1938` | VERIFIED |
| `persistDocument`: S3 when `aws.s3.enabled=true` (`AWS_S3_ENABLED`, default `false`, `application.properties:32`), key `tenders/{id}/{file}`. Otherwise local `${FILE_UPLOAD_DIR:public/documents}/{id}/{file}`, **mirrored** into each existing directory among `public/documents`, `../backend/public/documents`, `../public/documents`, `../frontend/public/documents`. | `TenderController.java:138-180+` | VERIFIED |
| Combined PDF → DOCX → XLSX rendered **sequentially** in the request thread (progress 80/86/92%) | `TenderController.java:2064-2072` | VERIFIED |
| Outputs: `Combined_Technical_Data_Sheet.{pdf,docx,xlsx}`. Re-uploads to the same tender **overwrite** them. | `2059-2075` | VERIFIED |
| Optional extra copy to `${user.home}/Downloads` if that directory exists | `2076-2085` | VERIFIED |
| DB writes: `tenders.downloaded_docs` (TEXT JSON), `tenders.spec_verification_status = 'Generated'`, `offered_model`, `selected_model_id`, `schedule_product_models`; one `activity_log` row | `TenderController.java:1942-1951, 2099-2111`; `models/Tender.java:74-75, 224-225, 263-267`; `models/ActivityLog.java:6` | VERIFIED |
| **Extracted clauses are not stored in the DB.** They exist only inside the rendered files. | (no repository save in the flow) | VERIFIED |
| Completion: `complianceProgressService.completeProducts(...)`; the response includes the **full** `metrics` snapshot (tokens, durations, retries, estimated INR cost) | `2125-2126` | VERIFIED |
| Failure: `fail()` + 400 (validation or `IllegalArgumentException`) or 500 (other); the response still includes metrics | `2032-2040, 2130-2145` | VERIFIED |

Rendering libraries and costs are covered in doc 06.

---

## 12. Bid-pack paths that call the AI with empty text

VERIFIED call chain:
- `DocumentGeneratorService.generateDocx` → `writeDoc16(document, data)` (`145`)
- → `parseSpecificationClauses(null, null, data)` (`3005`)
- → non-PDF branch with `text = ""` → `runAiExtraction("", null, …)` (`1788`)
- → `processOcrAndSynthesizeClauses("")` → `extractAcrossChunks` (length 0 ≤ 40 000) → `callGenerativeLlmAi("", null, …)` (`182-183`)

`callGenerativeLlmAi` has no empty-text guard: it sends the ≈9k-char rules prompt with empty `SOURCE CLAUSE KEYS`. The same happens through `generateTechSpecPdf/Docx(body)` → `legacyReviewHtml` (`3266, 3309`) and `generateTechSpecDocx(data, null)` (`3117-3128`).

Reachable via backend `POST /api/tenders/{id}/generate-bid-docs` (`TenderController.java:1676`) and `POST /api/tenders/{id}/generate-tech-specs` (`2167, 2173`, i.e. 2 empty-text extractions per request). The **Next.js** `generate-bid-docs` route does **not** forward to these (doc 06), so browser traffic does not hit them. A load script aimed straight at the backend would.

INFERRED: each such request costs 1–4 Azure calls (budget is unbounded on this thread) whenever an Azure key is configured.

---

## 13. Progress polling

| Aspect | Value | Where | Label |
|--------|-------|-------|-------|
| Store | `ConcurrentHashMap<String tenderId, Progress>` inside a singleton `@Service` | `ComplianceProgressService.java:13-17` | VERIFIED |
| Survives restart | No (heap only) | — | VERIFIED |
| Multiple backend instances | Not shared. A poll that lands on another instance returns `NOT_STARTED` (`97-101`). | — | VERIFIED (code) / INFERRED (behaviour) |
| Eviction | **None**. One entry per tender ever uploaded, each holding up to 100 events (`MAX_EVENTS = 100`, `16, 150`) and a metrics object. | `16-17` | VERIFIED |
| Same-tender concurrency | `start()` replaces the entry (`30-34`). Two concurrent uploads to one tender share or overwrite progress and output files. Load scripts should use **distinct tender IDs**. | | VERIFIED |
| Snapshot | Synchronized per job; strips cost, tokens and model fields, and filters events containing "azure openai", "retrying", "rate limit", "deployment", etc. | `153-200` | VERIFIED |
| Updates from workers | Batch listener synchronizes on a per-upload lock (`DocumentGeneratorService.java:1937-1951`) | | VERIFIED |
| Poll rate | Client every 1 s per active upload, through Next.js (two hops), plus a Next console log per poll | see §1 | VERIFIED |

---

## 14. Threading, timeouts and memory per step

| Step | Thread / executor | Timeouts | Memory behaviour | Label |
|------|-------------------|----------|------------------|-------|
| Next proxy (upload) | Node event loop | **none set** → undici defaults (believed headers/body 300 s) | `request.formData()` buffers the whole ≤50 MB file, then re-encodes it | VERIFIED / INFERRED |
| Spring upload handler | Tomcat worker thread for the whole run. Pool size not configured → Spring Boot default (believed max 200) | `server.tomcat.connection-timeout=180000` (applies to request I/O, not handler duration); `spring.mvc.async.request-timeout=180000` (unused: handler is not async) | `file.getBytes()` (≤50 MB) in heap | VERIFIED / INFERRED |
| PDF batching | request thread | none | Whole `PDDocument` in heap + every batch `byte[]` + its text, all held until the end | VERIFIED |
| Batch extraction | `Executors.newFixedThreadPool(min(5, B))`; default **unbounded `LinkedBlockingQueue`**, default `AbortPolicy` (never hit with an unbounded queue); new pool per upload; `shutdown()` + `awaitTermination(60 s)` then `shutdownNow()` + 10 s | Azure 30 s / 180 s per HTTP; no total deadline | Per in-flight call: base64 string (1.33×) + data-URL concat (1.33×) + JSON `toString` (1.33×) + UTF-8 `getBytes` (1.33×) ≈ **5× batch bytes** (≤12 MiB batch → ~60–65 MB transient); response read fully into a `String` | VERIFIED (code) / INFERRED (multiplier, JDK pool defaults) |
| OCR | inside batch workers; external `tesseract` process | **none** | ~15 MB raster per page at 200 DPI + PNG temp file on disk | VERIFIED / INFERRED |
| Gemini | inside batch workers; **global static lock** while pacing | 30 s / 180 s; pace 4 s; 429 wait ≤75 s | Same base64 duplication as Azure | VERIFIED |
| Rendering (PDF/DOCX/XLSX) | request thread, sequential | none | All three outputs as `byte[]` in heap, plus the HTML string | VERIFIED |
| Datasheet upload | request thread; no pool | Azure 30/180 s | Whole PDF (≤50 MB) base64'd inline, so **~250 MB transient** for a 50 MB datasheet | VERIFIED / INFERRED |

Worst-case wall clock for one batch with Azure only (INFERRED from timeouts): 2 × (30 s connect + 180 s read) + 75.25 s wait ≈ 8.5 min. With Gemini fallback, add up to 4 models × K keys × (4 s pace + 210 s + 75 s). There is **no overall deadline** on the upload request.

JVM heap for the root compose: `JAVA_TOOL_OPTIONS: -Xmx3g -Xms512m`, `mem_limit: 5g` (`docker-compose.yml:25, 32`). The backend Dockerfile ENTRYPOINT sets no heap flags (`backend/Dockerfile:38`). The deployed heap is UNKNOWN.

---

## 15. Where timings are logged

- **No explicit per-call duration log line exists.** Durations are collected in `ComplianceConversionMetrics`:
  - per-HTTP latency: `recordApiAttempt`, `AISpecificationIntelligenceService.java:1106-1111` → `ComplianceConversionMetrics.java:124-130`
  - extraction phase: `beginExtraction`/`endExtraction`, `DocumentGeneratorService.java:1731, 1803`
  - rendering phase: `TenderController.java:2058, 2097`
  - These are returned as `metrics.durationsMs.{api, extraction, rendering, total}` in the **upload HTTP response** (`TenderController.java:2028, 2038, 2126, 2135, 2143`). VERIFIED.
- Progress events carry ISO timestamps (`ComplianceProgressService.java:143-149`) but are filtered in snapshots. VERIFIED.
- stdout/stderr markers usable for log-based timing (all `System.out/err`, no logger, no timestamps of their own; VERIFIED):
  - `TenderController.java:1928-1932`: upload received, size, "AI Model Targeted"
  - `AISpecificationIntelligenceService.java:982`: attempting Azure
  - `1027-1028`: Azure HTTP code
  - `1034, 1037`: Azure exception
  - `1056`: Gemini fallback
  - `1093`: Gemini model attempt
  - `1192`: Gemini HTTP code
  - `117-118`: success count
  - `1438-1439`: validation retry
  - `DocumentGeneratorService.java:1787`: AI start (non-PDF)
  - `1974-1981`: batch failure
  - `2103-2104`: batch failed
  - `2778`: tesseract missing
  - `2801-2802`: pages / OCR count
- Next.js: `tech-spec-progress/route.ts:17` logs each poll.

For load testing, **record the `metrics` object from each upload response**. It is the only place that contains tokens, API latency and phase timings.

---

## 16. AI cost and rate-limit risk with 17 concurrent users

- **Concurrency (VERIFIED):** each PDF upload runs up to 5 concurrent Azure requests, and nothing limits this globally. 17 simultaneous uploads → ≤85 concurrent requests, each carrying a PDF of up to 12 MiB inline plus ~2.5k+ prompt tokens and allowed up to 32 768 output tokens.
- **Rate limits (UNKNOWN):** the Azure deployment's TPM/RPM quota is not in the repo; check the Azure portal for the `gpt-5-nano` deployment behind `AZURE_OPENAI_ENDPOINT`. On a 429 the code retries once (≤75 s), then falls to Gemini or fails the batch. A failed batch fails the **whole** upload after the other batches have already been billed (VERIFIED §7). Expect rising failure rates and wasted spend once the quota is exceeded (INFERRED).
- **Gemini under load (VERIFIED):** the fallback is serialised JVM-wide at one request per 4 s, and the Tomcat/worker threads sleep while holding the lock. Fallback cannot absorb load and will cause long stalls.
- **Cost (INFERRED order of magnitude at configured default prices):** output ≤ $0.013 per call. Per upload ≤ 2B × ($0.013 + input). For B = 15 (60-page text PDF) the ceiling is ≈ $0.40 + input. Real token use is UNKNOWN; measure it with `metrics.tokens` from a few pilot uploads.
- **Hidden callers (VERIFIED):** backend-direct bid-pack and generate-tech-specs calls (§12) also spend tokens.
- **Abandoned requests (VERIFIED comment, `technicalSpecificationBackend.ts:58-60`):** a client disconnect or Next proxy timeout does not cancel the Java work; every started batch completes and is billed.

## 17. Can a mock/stub be substituted purely by config?

- **Azure: yes.** Set `AZURE_OPENAI_ENDPOINT=http://mock:port/v1` (`/responses` is appended) and `AZURE_OPENAI_API_KEY=<any non-blank>`. The env var wins over the property (`1686-1689`). VERIFIED.
- Minimal mock response shape the code accepts (VERIFIED, `1763-1825, 1977-2004`):
  ```json
  {"status":"completed",
   "output":[{"content":[{"type":"output_text","text":"{\"readable\":true,\"clauseDecisions\":{...},\"rows\":[...]}"}]}],
   "usage":{"input_tokens":N,"output_tokens":M,"total_tokens":N+M}}
  ```
  - `rows: []` with `clauseDecisions` containing **exactly** the keys in the prompt's `SOURCE CLAUSE KEYS` → "No products found" (no rendering).
  - To exercise rendering, each row needs a non-empty `requirement` and `productCategory`, and a `sourceReference` copied from `ALLOWED SOURCE REFERENCES`. All row fields must be strings, with `rowType` = `requirement`.
  - An "unclear" `reviewerRemarks`, or an empty or `readable:false` answer on a page with < 80 chars of text, exercises the OCR path.
- **Gemini: no.** The URL is hard-coded (`1137`). Leave `GEMINI_API_KEY` unset in env **and** in the `gemini.api.key` property so a mock failure does not leak to Google.
- The model name cannot be changed (hard-coded `gpt-5-nano`). The pricing used for the cost estimate is configurable (`TECHSPEC_GPT_*`).

---

## 18. Conflicts between docs and code

- `DEPLOYMENT.md:5, 611-637, 1235-1247` describe **Gemini V1** as the production AI and Azure as reference/fallback. **Code:** Azure `gpt-5-nano` is primary, and Gemini is reached only when Azure returns null (`AISpecificationIntelligenceService.java:112, 1050-1058`). Code wins.
- `frontend/.env.example` says `GEMINI_API_KEY` is used for "technical specification extraction" on the frontend. **Code:** the frontend proxies extraction to Java and has no Gemini call in the extraction path. `@google/generative-ai` 0.24.1 is in `package.json` but no import was found in the reviewed extraction or document routes.
- `frontend/docs/technical-specification-upload.md:45-48` (180 s per request, up to five parallel batches, no total deadline) matches the code.
- Comment at `AISpecificationIntelligenceService.java:447-455` (1.5 models retired) contradicts the actually used list at `1089`.
- Unused `azure.openai.deployment` property (`39-40`) suggests the model is configurable; it is not (`1695-1697`).

## Open questions / UNKNOWN

1. Deployed values of `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `GEMINI_API_KEY`, `techspec.chunk-chars`, `techspec.min-request-interval-ms`, `AWS_S3_ENABLED`, `JAVA_TOOL_OPTIONS`: need the production env / secret store.
2. Azure deployment TPM/RPM quota and actual pricing for `gpt-5-nano` on that resource: need the Azure portal.
3. Azure's input-token accounting for `input_file` PDFs and `input_image` (detail high), i.e. real tokens per batch: measure with a few uploads (`metrics.tokens`).
4. Exact PDFBox version (transitive): `mvn dependency:tree`.
5. Tomcat thread-pool and accept-count actually in effect (not set in properties): runtime `/actuator` or a thread dump. Spring Boot default believed to be 200.
6. Node/undici fetch timeouts in the deployed Node version (Dockerfile `node:24-slim`) and any reverse proxy or load-balancer idle timeout in front of Next.js or Java: infra config.
7. Whether more than one backend instance is deployed (progress map is per instance): infra config.
8. Typical page count, size and scanned ratio of real tender PDFs (drives B): sample production uploads.
9. Whether Gemini model names in `1089` still resolve (the code comment says 1.5 returns 404): only observable at runtime.
10. Behaviour of Azure when sent an empty-text prompt (§12), and whether any production traffic reaches backend `generate-bid-docs` or `generate-tech-specs` directly: access logs.
