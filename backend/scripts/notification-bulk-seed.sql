-- =============================================================================
-- TenderPocket daily mails: bulk test data (940 tenders, IDs start with NBULK-)
--
-- Used by "backend/scripts/notification-test.sh mailtest", which sends test mails built
-- only from these tenders (idPrefix=NBULK-), so the numbers below are exact whatever else
-- is in the database. All dates are relative to today (IST); safe to re-run.
--
--   Set   Count  What                                              Mail it lands in
--   P      480   undecided, waiting 4-30 days, due in 4-60 days    MIS Pending (12 have no due date)
--   D      250   due today .. in 3 days; 40 with the executive      MIS Due, Admin Due (40 also Executive Due)
--   E       60   with the executive, spec not sent for 4-13 days   Executive Pending
--   L      150   with the executive, due in 0-3 days, very long    MIS Due, Executive Due, Admin Due
--                titles and authorities (tests the size guard)
--
-- Expected mails (body limit 200 rows):
--   1. misteam   Pending  480 rows -> 200 in the mail + Excel with all 480
--   2. executive Due      190 rows -> under 200, but too long for Gmail -> Excel with all 190
--   3. executive Pending   60 rows -> all in the mail, no Excel
--   4. admin     Pending  540 rows -> 200 in the mail + Excel with all 540
--   5. misteam   Due      400 rows -> up to 200 in the mail + Excel with all 400
--
--   Load:    backend/scripts/notification-test.sh seed-bulk
--   Remove:  backend/scripts/notification-test.sh cleanup
-- =============================================================================

BEGIN;

DELETE FROM tender_approval_requests WHERE tender_id LIKE 'NBULK-%';
DELETE FROM tender_workflow_states   WHERE tender_id LIKE 'NBULK-%';
DELETE FROM tenders                  WHERE id        LIKE 'NBULK-%';
DO $$
BEGIN
    IF to_regclass('public.tender_pending_actions') IS NOT NULL THEN
        DELETE FROM tender_pending_actions WHERE tender_id LIKE 'NBULK-%';
    END IF;
END $$;

CREATE TEMP TABLE nbulk_today ON COMMIT DROP AS SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d;
CREATE TEMP TABLE nbulk_words ON COMMIT DROP AS SELECT
    ARRAY['ICU Ventilator', 'Patient Monitor 5 Para', 'Hospital Bed Fowler', 'Autoclave 230 L', 'Blood Bank Refrigerator',
          'Infusion Pump', 'Syringe Pump', 'Defibrillator Biphasic', 'ECG Machine 12 Channel', 'Ultrasound Colour Doppler',
          'X-Ray 500 mA', 'Dialysis Machine', 'Oxygen Concentrator 10 LPM', 'Suction Machine', 'OT Light LED',
          'Anaesthesia Workstation', 'Pulse Oximeter', 'Wheelchair Foldable', 'Stretcher Trolley', 'Laboratory Centrifuge'] AS items,
    ARRAY['AIIMS Raipur', 'Department of Health and Family Welfare, Gujarat', 'Indian Railways, Central Hospital',
          'Directorate of Health Services, Maharashtra', 'Employees State Insurance Corporation',
          'Department of Defence, Military Hospital', 'State Health Society, Bihar', 'Government Medical College, Nagpur'] AS authorities;

-- One row per test tender. Columns not listed here keep the values the app itself uses.
CREATE TEMP TABLE nbulk ON COMMIT DROP AS
SELECT 'NBULK-P-' || lpad(i::text, 3, '0') AS id,
       '[TEST] ' || w.items[1 + i % 20] || ', quantity ' || (1 + i % 12) || ' (bulk test P' || i || ')' AS title,
       'GEM/2026/B/71' || lpad(i::text, 5, '0') AS ref,
       w.authorities[1 + i % 8] AS authority,
       CASE WHEN i % 40 = 0 THEN NULL ELSE t.d + (4 + i % 57) END AS due_day,
       (10 + i % 8) AS due_hour,
       t.d - (4 + i % 27) AS entry_day,
       NULL::date AS assigned_day
FROM generate_series(1, 480) AS i, nbulk_today t, nbulk_words w
UNION ALL
SELECT 'NBULK-D-' || lpad(i::text, 3, '0'),
       '[TEST] ' || w.items[1 + i % 20] || ', quantity ' || (1 + i % 12) || ' (bulk test D' || i || ')',
       'GEM/2026/B/72' || lpad(i::text, 5, '0'),
       w.authorities[1 + i % 8],
       t.d + (i % 4), (10 + i % 8), t.d - (1 + i % 9),
       CASE WHEN i <= 40 THEN t.d - (2 + i % 6) ELSE NULL END
FROM generate_series(1, 250) AS i, nbulk_today t, nbulk_words w
UNION ALL
SELECT 'NBULK-E-' || lpad(i::text, 3, '0'),
       '[TEST] ' || w.items[1 + i % 20] || ', quantity ' || (1 + i % 12) || ' (bulk test E' || i || ')',
       'GEM/2026/B/73' || lpad(i::text, 5, '0'),
       w.authorities[1 + i % 8],
       t.d + (6 + i % 25), (10 + i % 8), t.d - (12 + i % 5), t.d - (4 + i % 10)
FROM generate_series(1, 60) AS i, nbulk_today t, nbulk_words w
UNION ALL
SELECT 'NBULK-L-' || lpad(i::text, 3, '0'),
       '[TEST] Rate contract for supply of ' || repeat('consumables, reagents, spares and accessories for ', 6)
           || w.items[1 + i % 20] || ' with installation, training and five years comprehensive maintenance (long title test L' || i || ')',
       'GEM/2026/B/74' || lpad(i::text, 5, '0'),
       'Directorate of Medical Education and Research, ' || repeat('Government Medical College and Hospital, ', 2) || w.authorities[1 + i % 8],
       t.d + (i % 4), (10 + i % 8), t.d - (5 + i % 4), t.d - (1 + i % 3)
FROM generate_series(1, 150) AS i, nbulk_today t, nbulk_words w;

INSERT INTO tenders (id, title, ref_no, authority, original_url, scraped_at, entry_date, publish_date, due_date, time,
                     status, current_stage, mis_executive, assigned_at, assigned_by, source, tender_type, location, sector, notes,
                     payment_status, verification_status, submission_status, outcome_status, spec_verification_status,
                     pricing_status, emd_applicable, emd_receipt_confidential, can_final_submit, is_corrigendum, bid_qty, quoted_qty)
SELECT b.id, b.title, b.ref, b.authority, 'https://example.invalid/' || b.id,
       to_char(b.entry_day, 'YYYY-MM-DD') || ' 06:00:00', to_char(b.entry_day, 'FMDD Mon YYYY'), to_char(b.entry_day, 'YYYY-MM-DD'),
       CASE WHEN b.due_day IS NULL THEN NULL ELSE to_char(b.due_day, 'YYYY-MM-DD') || ' ' || lpad(b.due_hour::text, 2, '0') || ':00:00' END,
       'N/A',
       CASE WHEN b.assigned_day IS NULL THEN 'Issued' ELSE 'Participating' END,
       CASE WHEN b.assigned_day IS NULL THEN 'NEW' ELSE 'SPEC_CLEARANCE' END,
       CASE WHEN b.assigned_day IS NULL THEN NULL ELSE 'executive' END,
       CASE WHEN b.assigned_day IS NULL THEN NULL ELSE to_char(b.assigned_day, 'YYYY-MM-DD') || ' 06:00:00' END,
       CASE WHEN b.assigned_day IS NULL THEN NULL ELSE 'misteam' END,
       'GeM', 'GeM', 'Test District', 'Medical Equipment', '',
       'None', 'None', 'None', 'None', 'None', 'None', true, true, false, false,
       CASE WHEN b.assigned_day IS NULL THEN NULL ELSE 10 END,
       CASE WHEN b.assigned_day IS NULL THEN NULL ELSE 10 END
FROM nbulk b;

COMMIT;

SELECT left(id, 8) AS test_set, count(*) AS tenders,
       count(*) FILTER (WHERE mis_executive IS NOT NULL) AS with_executive,
       count(*) FILTER (WHERE due_date IS NULL) AS no_due_date,
       min(left(due_date, 10)) AS first_due, max(left(due_date, 10)) AS last_due
FROM tenders WHERE id LIKE 'NBULK-%' GROUP BY 1 ORDER BY 1;
