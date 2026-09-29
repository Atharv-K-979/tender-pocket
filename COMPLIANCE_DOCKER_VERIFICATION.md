# Docker Compliance Verification

## Scope and Outcome

The frontend, Spring backend and existing PostgreSQL container were started locally.
The real browser upload, Azure inference, progress polling, generated-document
registration and authenticated PDF/DOCX/XLSX downloads were exercised.

**Functional workflow: passed. Full source-content fidelity: not yet passed.**
The generated sample must be reviewed before bid use.

## Fixes

- Normalize the frontend entrypoint's CRLF line endings during Docker build and
  pin its Git line endings to LF.
- Restore the Admin upload control under both "Review" and "Clearance" headings.
- Keep native PDF pages attached to OCR-assisted extraction.
- Check scanned empty responses with OCR when the existing attempt budget permits.
- Check source-labelled item-table fields against same-page extracted rows and
  request bounded recovery; expose unresolved gaps as review warnings.
- Normalize section labels incorrectly appended to product names. Resolve generic
  labels only when their cited pages identify one specific model, not multiple variants.
- Keep delivery/inspection obligations with their item; exclude offer validity.
- Omit repeated standalone "ITEM SPECIFICATION" table titles without dropping wording.

## Verification

- Complete Java suite: 158 tests; 153 passed, 5 opt-in tests skipped, no failures.
- Frontend upload/proxy suite: 64 passed.
- Admin upload browser regression: both supported headings passed.
- Frontend and backend Docker builds passed.
- Real browser upload and three authenticated downloads passed.
- One DOCX table and one Excel worksheet; matching row content.
- Sequential numbering restarts per product; bidder columns remain blank.
- PDF pages and desktop/mobile progress screenshots were inspected.

Latest live run, starting at `2026-09-28T20:18:14Z`:

| Metric | Result |
| --- | --- |
| Input | 5-page rotated scanned PDF |
| Output | 4 model groups, 17 requirement rows, 2 PDF pages |
| API attempts | 3 successful responses |
| Tokens | 13,429 input (2,560 cached), 6,440 output, 19,869 total |
| Reasoning tokens | 3,584, already included in output tokens |
| Duration | 40.315 seconds end to end |
| Estimated cost | INR 0.2993 using existing configured prices/rate |

The estimate uses the existing USD/INR rate of 95.56 dated 2026-09-11.
It is not a current FX quote or an Azure invoice.

## Remaining Source-Review Findings

- One model description omits refrigerant, wattage and make information present
  in the input. Successful HTTP responses do not prove complete extraction.
- The final model's delivery, inspection and destination fields are still omitted.
  Coverage warnings expose those gaps. A compliance remark is present despite a
  label-based warning not recognizing it.
- One destination contains an OCR character substitution.
- Repeated "ITEM DESCRIPTION" headings and a pre-existing letterhead glyph issue remain.
- Source-label checks are deliberately conservative and are not a semantic guarantee.
  No missing values were manually fabricated or substituted.

## Runtime and Preservation

- Frontend: `http://localhost:8085`; backend: `http://localhost:8080`.
- The backend uses the PostgreSQL dialect via an environment override.
- Existing database volumes and documents were preserved. Testing used a separate
  tender record; it did not overwrite another tender's source document.
- Obsolete TenderPocket build-cache entries and two unused frontend images were
  removed. They can be rebuilt; no global Docker/volume pruning was performed.
- The old backend rollback container is stopped with automatic restart disabled.
- These changes build on PR #12; merge that prerequisite first.
- Unrelated bid-pack generation, external email delivery and GeM scraping were not
  end-to-end validated. Existing background jobs and security defaults were not changed.
