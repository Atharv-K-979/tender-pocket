# 06 — Document generation

Scope: every generator of DOCX, XLSX, PDF, bid packs, compliance/technical sheets, templates, letterheads, signatures/stamps, previews and ZIPs, on both the Spring Boot backend and the Next.js server.

Source state: branch `load-testing`, commit `68eb28ae`. Read-only review.

Labels: **VERIFIED** = read in code. **INFERRED** = reasoned from code or from documented library defaults. **UNKNOWN** = not determinable from the repo. Deployed env values are UNKNOWN.

---

## 0. Summary for load-test planning

| # | Finding | Label | Where |
|---|---------|-------|-------|
| 1 | The browser's **bid package** (`POST /api/tenders/{id}/generate-bid-docs`) is generated **on the Next.js server**, not in Java. It launches a **new headless Chromium per request** (Puppeteer), then runs **`execSync`** for Python (`generate_bid_docx.py`, no timeout) and for `extract_tender_specs.py` (20 s timeout) / `pdftotext`. `execSync` blocks the Node event loop, so **every other Next.js request stalls** while these run. | VERIFIED (code) / INFERRED (event-loop effect) | `frontend/src/app/api/tenders/[id]/generate-bid-docs/route.ts:46-55, 116-155, 210-234, 237-283, 476-484` |
| 2 | The compliance sheets (PDF via openhtmltopdf, DOCX/XLSX via Apache POI) are rendered **synchronously in the upload request thread** after AI extraction. Every output is a `byte[]` in heap, and nothing is streamed. | VERIFIED | `backend/.../controllers/TenderController.java:2064-2075`; `services/DocumentGeneratorService.java:2914-2962` |
| 3 | The backend `generateDocx` bid pack calls `writeDoc16` → `parseSpecificationClauses(null, null, data)`, which issues an **AI request with empty text**. This hits only backend-direct `POST /api/tenders/{id}/generate-bid-docs` and `/generate-tech-specs`; the UI goes through Next.js instead. | VERIFIED | `DocumentGeneratorService.java:145, 3005, 3309`; `TenderController.java:1676, 2167, 2173` |
| 4 | There is **no caching** of generated documents or of template images. Logos, partner, stamp and signature PNGs are read from disk and base64-embedded on **every** render (backend) and for every renderer instance (frontend). | VERIFIED | `DocumentGeneratorService.java:1486-1501, 773-792`; `frontend/src/lib/documentLayout.ts:21-31, 100-141` |
| 5 | Backend `generatePdf` writes `public/debug_generated.html` on **every** call. All concurrent bid-PDF requests write the same shared path. | VERIFIED | `DocumentGeneratorService.java:31` |
| 6 | Downloads: backend `/documents/{id}/{file}` streams from disk or 302s to S3. The Next `tech-spec-download` proxy uses `redirect: 'error'`, so INFERRED it **breaks when S3 is enabled**. The Next `documents/[...filename]` route reads whole files into memory, and for a missing `.pdf` it makes **outbound calls to bidplus.gem.gov.in and the Tender247 scraper**. | VERIFIED / INFERRED | `TenderController.java:2336-2420`; `frontend/src/lib/technicalSpecificationBackend.ts:63-65`; `frontend/src/app/api/tenders/[id]/documents/[...filename]/route.ts:111-196` |
| 7 | There is **no ZIP** bid-pack output anywhere. JSZip is used only to re-pack a DOCX in the html-to-docx fallback. | VERIFIED | `frontend/src/lib/documentTemplates.ts:1186-1363` |

---

## 1. Library inventory and versions

| Library | Version | Side | Where declared | Label |
|---------|---------|------|----------------|-------|
| Apache POI `poi-ooxml` (XWPF, XSSF, WorkbookFactory) | 5.3.0 | Java | `backend/pom.xml:95-97` | VERIFIED |
| openhtmltopdf `openhtmltopdf-pdfbox` | 1.0.10 | Java | `backend/pom.xml:102-104` | VERIFIED |
| Apache PDFBox | transitive via openhtmltopdf. `PDDocument.load` is a 2.x API | Java | — | INFERRED 2.0.x; exact UNKNOWN (`mvn dependency:tree`) |
| AWS SDK v2 `s3` (+ presigner) | 2.25.15 | Java | `backend/pom.xml:45-47` | VERIFIED |
| Spring Boot | 3.4.1, Java 21 | Java | `backend/pom.xml:7-10, 21` | VERIFIED |
| Puppeteer | 25.2.1 (lockfile). Docker uses system `chromium` (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, `PUPPETEER_SKIP_DOWNLOAD=true`) | Next | `frontend/package.json`; `frontend/package-lock.json`; `frontend/Dockerfile` | VERIFIED |
| html-to-docx | 1.8.0 | Next | `package.json`/lockfile | VERIFIED |
| jszip | 3.10.1 | Next | `package.json`/lockfile | VERIFIED |
| docx (npm) 9.7.1, pdfkit 0.19.0, pdfkit-table 0.2.11 | declared | Next | `package.json`; `next.config.ts` lists pdfkit as server external | VERIFIED declared; **no import found** in `frontend/src` (grep) |
| python-docx, pypdf (pip, unpinned); PyMuPDF **not installed** in Docker | — | Next container | `frontend/Dockerfile` (pip line) | VERIFIED |
| poppler-utils (`pdftotext`, `pdftoppm`), tesseract-ocr, chromium, fonts-liberation (apt) | distro | Next container | `frontend/Dockerfile` (runner stage) | VERIFIED |
| LibreOffice / soffice | **not used** anywhere | — | grep | VERIFIED |
| Next.js | 16.2.6 on `node:24-slim` | Next | `package.json`; `frontend/Dockerfile` | VERIFIED |

---

## 2. Generators (backend, Java)

All Java generators are synchronous, run on the Tomcat request thread, build output in a `ByteArrayOutputStream` → `byte[]`, and have no cache. Storage always goes through `TenderController.persistDocument` (`TenderController.java:138-180+`):
- S3 key `tenders/{id}/{fileName}` when `aws.s3.enabled=true` (`AWS_S3_ENABLED`, default `false`). Upload uses `RequestBody.fromInputStream` (`S3ObjectStorageService.java:42-92`).
- Otherwise `${FILE_UPLOAD_DIR:public/documents}/{id}/{fileName}`, **plus mirror copies** into each existing directory among `public/documents`, `../backend/public/documents`, `../public/documents`, `../frontend/public/documents`.

### 2.1 Combined Technical Data Sheet (compliance sheet) — main load path
| Item | Value | Label |
|------|-------|-------|
| Trigger | `POST /api/tenders/{id}/upload-tech-spec` (after AI extraction; see doc 05) | VERIFIED `TenderController.java:1800, 2064-2075` |
| PDF | `generateCombinedSheetPdf` `DocumentGeneratorService.java:2914-2919` → `SpecificationSheetRenderer.html(...)` `SpecificationSheetRenderer.java:43-262` → `renderSpecificationPdf` `2933-2962` (openhtmltopdf `PdfRendererBuilder.useFastMode()`) | VERIFIED |
| DOCX | `generateCombinedSheetDocx` `2921-2926` → `SpecificationSheetRenderer.docx` `263-478` (POI `XWPFDocument`; header letterhead table with logo and partner PNGs via `addPicture`, `281-308, 649-652`) | VERIFIED |
| XLSX | `generateCombinedSheetXlsx` `2928-2931` → `SpecificationSheetRenderer.xlsx` `479-577`. Uses **`XSSFWorkbook`** (full DOM, not streaming `SXSSF`), one sheet per product, freeze panes, repeating header rows, A4 landscape fit-to-width. | VERIFIED |
| Order | PDF → DOCX → XLSX, sequential, then three `persistDocument` calls (`2066-2075`) | VERIFIED |
| Output names | `Combined_Technical_Data_Sheet.{pdf,docx,xlsx}`. Overwritten on re-upload. Also copied to `~/Downloads` if that directory exists (`2076-2085`). | VERIFIED |
| Letterhead | CSS running element `position:running(letterhead)` in `@page @top-center` (`SpecificationSheetRenderer.java:54-61, 96`); logo and partner embedded as base64 `<img>` (`image()` `653-656`) | VERIFIED |
| Size drivers | Number of products (sheets / schedules) × number of clause rows. Each row is one table row in PDF/DOCX and one row in XLSX. Images are fixed (logo 263 KB, partner 145 KB, `backend/src/main/resources/static/images/`). | VERIFIED (code) / INFERRED (scaling) |

### 2.2 Bid package (backend version)
| Item | Value | Label |
|------|-------|-------|
| Trigger | `POST /api/tenders/{id}/generate-bid-docs` on **Spring** (`TenderController.java:1632-1718`). The UI calls the **Next.js** route of the same path, which handles it itself (§3.1). The Spring endpoint is reached only by direct backend calls. | VERIFIED (both routes exist; Next has its own handler) |
| PDF | `generatePdf` `DocumentGeneratorService.java:28-58`: `generateHtmlTemplates` (`768-1387`, ~16 bid-form pages built with `wrapPage` `1388+`) → openhtmltopdf. **Writes `public/debug_generated.html` every call** (`31`). | VERIFIED |
| HTML size | logo, partner, stamp and signature are base64-encoded once (`773-792`), but the logo/partner strings are **inlined into every page** via `wrapPage` (`861-1106`, ~17 calls). That repeats ~400 KB of base64 per page, ≈6–7 MB of HTML before rendering. | VERIFIED (repetition) / INFERRED (size) |
| DOCX | `generateDocx` `60-150`: POI XWPF, `writeDoc1..15` (`417-766`) + `writeDoc16` (`2996-3071`). Pictures (logo, partner, stamp, signature) are added per header/signatory block (`158-296, 354-404`). | VERIFIED |
| AI side effect | `writeDoc16(document, data)` → `parseSpecificationClauses(null, null, data)` (`3005`) → AI request with empty text when an Azure key is configured (doc 05 §12) | VERIFIED path / INFERRED cost |
| Output | `Bid_Documents_{id}.pdf` / `.docx` via `persistDocument`; `tenders.downloaded_docs` updated; `activity_log` row | VERIFIED `1670-1704` |

### 2.3 Legacy Technical Specification Sheet
| Item | Value | Label |
|------|-------|-------|
| Trigger | Spring `POST /api/tenders/{id}/generate-tech-specs` (`TenderController.java:2148-2207`). **No Next.js route** proxies it, so it is reachable only by calling the backend directly. | VERIFIED |
| PDF | `generateTechSpecPdf(body)` `2889-2900` → `generateTechSpecHtml(data, null)` → `legacyReviewHtml` `3277-3371` → `parseSpecificationClauses(null, null, data)` (`3309`, **AI call**) → openhtmltopdf | VERIFIED |
| DOCX | `generateTechSpecDocx(body)` `3073-3132` → `writeDoc16` (**second AI call**) | VERIFIED |
| Output | `Technical_Specification_Sheet_{id}.{pdf,docx}` | VERIFIED |

### 2.4 Unused generators (no callers found)
`generateProductSheetPdf/Docx/Xlsx` (`DocumentGeneratorService.java:2902-2912`), `generateIndividualProductPdf` (`2987-2994`) and `writeTenderReviewComplianceSheet` (`3077-3115`): grep finds no call sites. VERIFIED.

### 2.5 Images rendered for AI (not output documents)
`renderFirstPageToPng` (200 DPI PNG, `2730-2743`) and the OCR raster (`2857-2887`) are covered in doc 05.

---

## 3. Generators (Next.js server)

### 3.1 Bid package (the one the UI uses)
Trigger: `POST /api/tenders/{id}/generate-bid-docs`, called from `frontend/src/app/tenders/[id]/page.tsx:1405` and `frontend/src/app/page.tsx:452`. Handler: `frontend/src/app/api/tenders/[id]/generate-bid-docs/route.ts:285-650`. The whole handler is awaited in the request (synchronous from the client's view). VERIFIED.

Steps (all VERIFIED unless marked):
1. `GET ${BACKEND_URL}/api/tenders/{id}` with **no timeout** (`318-331`), falling back to SQLite `better-sqlite3` (`333-338`). Then a SQLite `UPDATE` (`348-361`).
2. Spec gate: `spec_verification_status` must be `Approved`, else 409 (`364-370`).
3. **Spec extraction for the DOCX** `extractTenderInfoAndSpecs` (`116-207`):
   - `execSync python3 scripts/extract_tender_specs.py --tender-id {id}` with **20 000 ms timeout** (`118-152`). The script needs PyMuPDF, which `frontend/Dockerfile` does **not** install (only pypdf, python-docx). In Docker it falls back to `pymupdf = None` (`scripts/extract_tender_specs.py:18-26`), so INFERRED the script returns no specs.
   - Fallback: for each PDF in `{cwd}/../backend/public/documents/{id}` (and other candidates), `execSync('pdftotext -layout …')` (`57-63`), or a raw zlib scan of the whole file read with `fs.readFileSync` (`64-100`). `pdftotext -v` is probed once per process (`46-55`).
4. HTML: `generateHtmlTemplates(enrichedTemplateData)` from `frontend/src/lib/documentTemplates.ts:11-863`. `DocumentLayoutRenderer` reads logo, watermark, stamp and signature images with `fs.readFileSync` and base64-encodes them **per renderer instance** (`documentLayout.ts:21-31, 91-141`). No caching.
5. **PDF via Puppeteer** `generatePdfFile` (`210-234`): **`puppeteer.launch()` per request** with `--no-sandbox`; `page.setContent(html, {waitUntil: 'domcontentloaded'})`; `page.pdf({path, format: 'A4', landscape, printBackground: true})` written **straight to disk**; `browser.close()` in `finally`. No explicit timeouts, so Puppeteer defaults apply (INFERRED: 30 s launch/navigation). No browser pool or reuse.
6. **DOCX via Python** `generateDocxWithPython` (`237-283`): writes a temp JSON to `os.tmpdir()`, then `execSync python3 scripts/generate_bid_docx.py --input … --output-bid …` with **no timeout**. The script uses python-docx with letterhead templates `frontend/public/letterheads/{ME,Healthtech}_{Portrait,Landscape}.docx` (`scripts/generate_bid_docx.py:14-20, 37-39, 1667-1680`).
7. **Fallback DOCX** if Python fails: `HTMLtoDOCX(cleanHtmlForDocx(html), headerHtml, options, footerHtml)` → `sanitizeDocxBuffer` (JSZip load, regex XML rewrites, `generateAsync` DEFLATE level 6, `documentTemplates.ts:1186-1363`) → `fs.writeFileSync` (`486-519`). This path is fully in memory.
8. Storage: `path.join(process.cwd(), 'public', 'documents', id)`, files `Bid_Documents_{id}.pdf/.docx` (`450-453, 473-482`). **Local disk only, never S3.** In the root `docker-compose.yml` both containers mount the same named volume `backend_documents` at `/app/public/documents` (`docker-compose.yml` backend and frontend `volumes:`), so the backend can see these files. VERIFIED (compose) / deployed topology UNKNOWN.
9. SQLite `UPDATE tenders SET downloaded_docs…` (`565-575`). Then `PATCH ${BACKEND_URL}/api/tenders/{id}` with a **10 s abort** (`577-622`) and `addActivityLog` (`629`).

Load characteristics:
- **Process spawns per request:** Chromium (multi-process), python3 (×1–2), possibly pdftotext ×N PDFs. VERIFIED.
- **Event-loop blocking:** `execSync` is synchronous. While Python and pdftotext run, Next.js cannot serve **any** other request, including progress polls, page loads and downloads. With 17 users generating bid packs the stalls stack up behind each other. INFERRED from Node semantics; this is high priority to measure.
- **Memory:** one Chromium instance per concurrent request (typically 100–300 MB RSS each; INFERRED). The frontend service in root compose has **no `mem_limit`** (VERIFIED, compare backend `mem_limit: 5g`).
- **Size drivers:** fixed ~16 bid-form pages plus embedded images. Spec rows go only to the Python DOCX (`generate_bid_docx.py:1355, 1476-1482`); the HTML/PDF bid pack does not reference `specs`. VERIFIED.
- **Fonts:** templates ask for Cambria/Calibri (`documentTemplates.ts`, `documentLayout.ts` `font-family` rules) with **no `@font-face`**. The Docker image installs only `fonts-liberation`, so Chromium substitutes fonts. VERIFIED (no font files) / INFERRED (substitution). This is a fidelity issue, not a load issue.

### 3.2 Preview
`POST /api/preview-doc` (`frontend/src/app/api/preview-doc/route.ts:4-34`) returns JSON `{html}` from `generateHtmlTemplates` or `generateTechnicalSpecificationHtml(data, [])`. No PDF, no process spawn, no storage. **No auth check** in the handler. CPU and sync file reads only (image base64). Called from `frontend/src/app/preview-docs/page.tsx:42, 134`. VERIFIED.

### 3.3 `generate-templates`
`POST /api/tenders/{id}/generate-templates` (Next) → `proxyToBackend(... '/api/tenders/{id}/generate-templates')` (`frontend/src/app/api/tenders/[id]/generate-templates/route.ts:3-9`). The backend has **no such mapping** (grep for `generate-templates` and `templates` in `backend/src/main/java` finds none), so INFERRED 404. No UI caller found (only `frontend/scripts/test-generate-templates.js`). Not a load target. VERIFIED / INFERRED.

### 3.4 Combined-sheet download proxy
`GET /api/tenders/{id}/tech-spec-download/{filename}` (`frontend/src/app/api/tenders/[id]/tech-spec-download/[filename]/route.ts:9-30`) → `fetchSpecificationBackend` → backend `/documents/{id}/{filename}`, streaming `response.body` back (no buffering). Uses `redirect: 'error'` (`technicalSpecificationBackend.ts:63-65`). When S3 is enabled the backend returns **302** to a presigned URL, so INFERRED this route fails with S3 on. VERIFIED (code) / INFERRED (failure).

---

## 4. Downloads and file serving

| Path | Behaviour | Memory | Label |
|------|-----------|--------|-------|
| Spring `GET /documents/{id}/{file}` (`DocumentDownloadController.java:15-20` → `TenderController.downloadDocumentFile` `2336-2420`) | If S3 is on and the object exists → **302** to a presigned URL valid **15 min** (`S3ObjectStorageService.java:130-145`), with one `headObject` per request (`exists`). Otherwise local `UrlResource` with `Content-Disposition: attachment`. `resolveSafeLocalPath` probes up to 7 candidate directories with `Files.exists` (`TenderController.java:99-136`). | Streamed (Spring `Resource`) | VERIFIED |
| Next `GET /api/tenders/{id}/documents/[...filename]` (also reached via the rewrite `/documents/:id/:filename*`, `next.config.ts`) | Probes 5 local directories (`existsSync`, `statSync`, `readdirSync`), else fetches the backend (`redirect: 'manual'`, **`arrayBuffer()` buffers the whole file**), else for `.pdf` makes **outbound `axios.get` to 3 bidplus.gem.gov.in URLs** (15 s timeout each) and calls `downloadAndSaveTenderDocuments` (scraper) | Local hit: `fs.readFileSync` of the whole file | VERIFIED (`route.ts:75-196, 220-250`) |

Load-test implication (INFERRED): requesting non-existent PDFs through the Next route causes external traffic to GeM and Tender247 and long latencies. Load scripts should request only files known to exist.

---

## 5. Letterheads, signatures, stamps, fonts and file-system dependencies

| Asset | Used by | Location | Label |
|-------|---------|----------|-------|
| Calibri / Cambria TTF (4 weights each, ~0.3–0.9 MB) | openhtmltopdf (`useFont` per render, subset=true, loaded through a classpath supplier on each `run()`) | `backend/src/main/resources/fonts/*.ttf`; `DocumentGeneratorService.java:39-51, 2940-2950` | VERIFIED (files present) |
| logo.png, partner.png, stamp.png, signature.png | Backend `loadImageBytes`: first `public/images/<name>` relative to the **working directory**, then classpath `/static/images/<name>` | `DocumentGeneratorService.java:1486-1501`; `backend/src/main/resources/static/images/` | VERIFIED |
| Per-user signature upload | `POST /api/signatures/upload` writes `public/images/signatures/{username}_signature.png` **and overwrites `public/images/signature.png`**, which every backend generator then uses as the default signature | `SignatureController.java:25-58` | VERIFIED |
| Frontend brand assets | `frontend/src/lib/companyProfiles.ts:95-147` (`assets/brand/...`); `documentLayout.ts:6-31, 100-141` resolves and base64-encodes them | | VERIFIED |
| Word letterhead templates | `frontend/public/letterheads/{ME,Healthtech}_{Portrait,Landscape}.docx` (Python generator) | | VERIFIED |
| Debug HTML | `public/debug_generated.html` written on every backend bid PDF | `DocumentGeneratorService.java:31` | VERIFIED |
| Temp files | Java OCR PNGs (`java.io.tmpdir`); S3 upload temp file when length is unknown (`S3ObjectStorageService.java` ~line 64-75); Next temp JSON (`os.tmpdir()`) | | VERIFIED |
| Working-directory sensitivity | Many paths are relative (`public/...`, `../backend/public/documents`, `scripts/...`), so behaviour depends on the process CWD (`/app` in both Dockerfiles) | | VERIFIED / INFERRED |

---

## 6. Per-generator quick reference

| Generator | Library | Trigger | Sync | In-memory vs streamed | Storage | External process | Cache |
|-----------|---------|---------|------|-----------------------|---------|------------------|-------|
| Combined sheet PDF | openhtmltopdf 1.0.10 / PDFBox 2.x | POST upload-tech-spec (Spring) | sync, request thread | `byte[]` | S3 `tenders/{id}/Combined_Technical_Data_Sheet.pdf` or local + mirrors | none | none |
| Combined sheet DOCX | POI 5.3.0 XWPF | same | sync | `byte[]` | same pattern `.docx` | none | none |
| Combined sheet XLSX | POI 5.3.0 XSSF | same | sync | `byte[]` | same pattern `.xlsx` | none | none |
| Bid pack PDF (Spring) | openhtmltopdf | POST generate-bid-docs (Spring, backend-direct only) | sync | `byte[]` + 6–7 MB HTML string (INFERRED) | `Bid_Documents_{id}.pdf` | none | none |
| Bid pack DOCX (Spring) | POI XWPF | same | sync | `byte[]` | `Bid_Documents_{id}.docx` | **AI HTTP call** (empty text) | none |
| Legacy tech-spec PDF/DOCX | openhtmltopdf / POI | POST generate-tech-specs (Spring only) | sync | `byte[]` | `Technical_Specification_Sheet_{id}.*` | **2 AI calls** | none |
| Bid pack PDF (Next, UI path) | Puppeteer 25.2.1 + Chromium | POST generate-bid-docs (Next) | awaited | written by Chromium to disk | `{cwd}/public/documents/{id}/Bid_Documents_{id}.pdf` (local only) | **Chromium per request** | none |
| Bid pack DOCX (Next) | python-docx via `generate_bid_docx.py`; fallback html-to-docx 1.8.0 + JSZip 3.10.1 | same | **execSync (blocks event loop)** | Python writes to disk; fallback in memory | `…/Bid_Documents_{id}.docx` | **python3** (no timeout); spec extraction python3 (20 s), pdftotext | none |
| Preview HTML | template strings | POST /api/preview-doc | sync | string | none | none | none |
| Datasheet storage | n/a (stores the upload) | POST /api/products/models/upload | sync | `byte[]` | local `public/documents/datasheets/{model}/datasheet.pdf` (**always local, ignores S3**) | AI call (doc 05) | none |

The datasheet row is VERIFIED at `ProductCatalogueService.java:87-95`.

---

## 7. Docs-vs-code conflicts

- Commit `6222ab47` says the legacy Technical Specification Sheet was removed from bid-docs generation. That holds for the **Next.js** route, which filters legacy entries (`generate-bid-docs/route.ts:545-552`). The **Spring** `generateDocx` still appends `writeDoc16` (the technical compliance page) and the Spring `generate-tech-specs` endpoint still exists (`DocumentGeneratorService.java:143-145`; `TenderController.java:2148`). Code wins: both legacy paths are reachable on the backend.
- `DEPLOYMENT.md` describes a Docker/S3 deployment. The Next bid pack writes only to local disk (`route.ts:450`), so S3-only deployments rely on the shared volume shown in `docker-compose.yml`. Whether production shares that volume is UNKNOWN.

## Open questions / UNKNOWN

1. Exact PDFBox version (transitive): `mvn dependency:tree`.
2. Real Chromium RSS and launch time per bid pack in the deployed image, and whether production sets a Puppeteer or Chromium pool elsewhere (none in repo): measure.
3. Runtime of `generate_bid_docx.py` per request (the event-loop block duration): measure; it is not determinable from code.
4. Whether production Next.js and Spring share `/app/public/documents` (root compose does, `frontend/docker-compose.yml` is standalone): deployment config.
5. Whether `AWS_S3_ENABLED=true` in production (affects the `tech-spec-download` 302 issue and storage latency): env.
6. Typical clause/row counts and product counts per tender (drives combined-sheet render time and size): sample data.
7. openhtmltopdf behaviour with the same base64 image repeated ~17× in one HTML (whether it decodes once or per occurrence): measure heap during a backend bid PDF.
8. Frontend container memory limit in production (none in root compose): infra config.
9. Whether `public/debug_generated.html` writes matter on the deployed filesystem (read-only or ephemeral?): infra.
