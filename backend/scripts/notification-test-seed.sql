-- =============================================================================
-- TenderPocket daily mails: test tenders for the local database
--
-- Adds 22 tenders whose IDs start with NTEST- and whose titles start with [TEST],
-- spread over every workflow step, so every section of the Due and Pending mails
-- has something in it. All dates are relative to today (IST), so the file can be
-- re-run on any day. Running it again replaces the previous NTEST- rows.
--
--   Load:    docker exec -i tender-pocket-postgres psql -U postgres -d tender_pocket < backend/scripts/notification-test-seed.sql
--   Remove:  docker exec -i tender-pocket-postgres psql -U postgres -d tender_pocket < backend/scripts/notification-test-cleanup.sql
--   (or use backend/scripts/notification-test.sh seed / cleanup)
--
-- Expected result with the default rules (Due window 3 days, Pending after 3 days):
--
--   Login      Due mail (due today .. +3 days)   Pending mail (waiting > 3 days, due later)
--   misteam    01 02 03 04 05                    06 07 11 13(docs) 15(price) 17 22
--   executive  03 04 05                          08 10 12 13(route) 15(fix docs) 16
--   clearance  04                                09
--   tpc        05                                14
--   admin      01 02 03 04 05 + Missed: 21       everything above + routing note for 22
--   nobody     18 (fresh), 19 (not participating), 20 (submitted)
--
-- Real tenders already in the database appear in these mails as well.
-- =============================================================================

BEGIN;

DELETE FROM tender_approval_requests WHERE tender_id LIKE 'NTEST-%';
DELETE FROM tender_workflow_states   WHERE tender_id LIKE 'NTEST-%';
DELETE FROM tenders                  WHERE id        LIKE 'NTEST-%';
DO $$
BEGIN
    IF to_regclass('public.tender_pending_actions') IS NOT NULL THEN
        DELETE FROM tender_pending_actions WHERE tender_id LIKE 'NTEST-%';
    END IF;
END $$;

-- Today in IST, and helpers that turn "n days from today" into the formats the app stores.
CREATE TEMP TABLE ntest_today ON COMMIT DROP AS SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d;
-- due_date: "2026-11-15 15:00:00"
CREATE FUNCTION pg_temp.due(n int) RETURNS varchar LANGUAGE sql AS
    $$ SELECT to_char((SELECT d FROM ntest_today) + n, 'YYYY-MM-DD') || ' 15:00:00' $$;
-- entry_date as the GeM import writes it: "7 Nov 2026"
CREATE FUNCTION pg_temp.entry(n int) RETURNS varchar LANGUAGE sql AS
    $$ SELECT to_char((SELECT d FROM ntest_today) - n, 'FMDD Mon YYYY') $$;
-- server timestamps (assigned_at, workflow times): "2026-11-07 06:00:00". 06:00 falls on the
-- same IST day whether the backend reads it as UTC (Docker) or as IST (local run).
CREATE FUNCTION pg_temp.ts(n int) RETURNS varchar LANGUAGE sql AS
    $$ SELECT to_char((SELECT d FROM ntest_today) - n, 'YYYY-MM-DD') || ' 06:00:00' $$;
CREATE FUNCTION pg_temp.tsx(n int) RETURNS timestamp LANGUAGE sql AS
    $$ SELECT ((SELECT d FROM ntest_today) - n)::timestamp + interval '6 hours' $$;

-- ---------------------------------------------------------------------------
-- Base rows. Everything starts as an undecided GeM import; the UPDATEs below
-- move each tender to its step.
-- ---------------------------------------------------------------------------
INSERT INTO tenders (id, title, ref_no, authority, original_url, scraped_at, entry_date, publish_date,
                     due_date, time, status, current_stage, source, tender_type, location, sector, notes,
                     payment_status, verification_status, submission_status, outcome_status,
                     spec_verification_status, pricing_status, emd_applicable, emd_receipt_confidential,
                     can_final_submit, is_corrigendum)
SELECT v.id, '[TEST] ' || v.title, v.ref, 'Notification Test Hospital, Test District', 'https://example.invalid/' || v.id,
       pg_temp.ts(v.entry_ago), pg_temp.entry(v.entry_ago), pg_temp.ts(v.entry_ago),
       CASE WHEN v.due_in IS NULL THEN NULL ELSE pg_temp.due(v.due_in) END, 'N/A',
       'Issued', 'NEW', 'GeM', 'GeM', 'Test District', 'Medical Equipment', '',
       'None', 'None', 'None', 'None', 'None', 'None', true, true, false, false
FROM (VALUES
    ('NTEST-01', 'ICU ventilators: undecided, due today',                  'GEM/2026/B/9900001',  0, 6),
    ('NTEST-02', 'Office chairs: undecided, due in 2 days',                'GEM/2026/B/9900002',  2, 1),
    ('NTEST-03', 'Hospital beds: spec not sent, due tomorrow',             'GEM/2026/B/9900003',  1, 6),
    ('NTEST-04', 'Patient monitors: spec with Clearance, due in 3 days',   'GEM/2026/B/9900004',  3, 9),
    ('NTEST-05', 'Blood bank fridges: TPC price and docs open, due today', 'GEM/2026/B/9900005',  0, 12),
    ('NTEST-06', 'Lab furniture: undecided for 5 days',                    'GEM/2026/B/9900006', 10, 5),
    ('NTEST-07', 'Water coolers: undecided, no due date',                  'GEM/2026/B/9900007', NULL, 8),
    ('NTEST-08', 'X-ray processor: spec not sent for 7 days',              'GEM/2026/B/9900008',  6, 9),
    ('NTEST-09', 'ECG machines: spec with Clearance for 4 days',           'GEM/2026/B/9900009', 12, 8),
    ('NTEST-10', 'Dialysis machines: bid package not generated',           'GEM/2026/B/9900010', 20, 12),
    ('NTEST-11', 'Autoclaves: EMD awaiting MIS approval',                  'GEM/2026/B/9900011',  9, 14),
    ('NTEST-12', 'Suction pumps: EMD details not entered',                 'GEM/2026/B/9900012',  8, 14),
    ('NTEST-13', 'Ultrasound: pricing route not chosen, docs with MIS',    'GEM/2026/B/9900013', 14, 15),
    ('NTEST-14', 'Defibrillators: TPC price pending for 6 days',           'GEM/2026/B/9900014',  7, 16),
    ('NTEST-15', 'Infusion pumps: MIS price pending, docs rejected',       'GEM/2026/B/9900015', 11, 16),
    ('NTEST-16', 'OT lights: ready to submit for 4 days',                  'GEM/2026/B/9900016',  5, 18),
    ('NTEST-17', 'Wheelchairs: filed, awaiting MIS confirmation',          'GEM/2026/B/9900017', -2, 20),
    ('NTEST-18', 'Stretchers: spec with Clearance 1 day (not mailed)',     'GEM/2026/B/9900018', 15, 4),
    ('NTEST-19', 'Glucometers: not participating (not mailed)',            'GEM/2026/B/9900019',  1, 3),
    ('NTEST-20', 'Thermometers: submitted and confirmed (not mailed)',     'GEM/2026/B/9900020',  1, 20),
    ('NTEST-21', 'Nebulisers: due yesterday, never submitted',             'GEM/2026/B/9900021', -1, 8),
    ('NTEST-22', 'Oxygen concentrators: executive has no login',           'GEM/2026/B/9900022',  9, 10)
) AS v(id, title, ref, due_in, entry_ago);

-- Every tender except the undecided ones is assigned to the "executive" login.
UPDATE tenders SET status = 'Participating', mis_executive = 'executive', assigned_by = 'misteam',
                   current_stage = 'SPEC_CLEARANCE', bid_qty = 10, quoted_qty = 10
WHERE id LIKE 'NTEST-%' AND id NOT IN ('NTEST-01', 'NTEST-02', 'NTEST-06', 'NTEST-07', 'NTEST-19');

UPDATE tenders SET assigned_at = pg_temp.ts(4) WHERE id = 'NTEST-03';
UPDATE tenders SET assigned_at = pg_temp.ts(7) WHERE id = 'NTEST-08';
UPDATE tenders SET assigned_at = pg_temp.ts(6) WHERE id = 'NTEST-21';
UPDATE tenders SET assigned_at = pg_temp.ts(8) WHERE id IN ('NTEST-04', 'NTEST-09', 'NTEST-18');
UPDATE tenders SET assigned_at = pg_temp.ts(10) WHERE assigned_at IS NULL AND mis_executive = 'executive' AND id LIKE 'NTEST-%';

-- Step 2: spec sent to Clearance (04, 09, 18)
UPDATE tenders SET spec_verification_status = 'Pending' WHERE id IN ('NTEST-04', 'NTEST-09', 'NTEST-18');

-- From step 3 on the spec is approved.
UPDATE tenders SET spec_verification_status = 'Approved', final_tech_spec_filename = 'tech_spec_' || id || '.docx',
                   final_tech_spec_uploaded_at = pg_temp.ts(5), final_tech_spec_uploaded_by = 'clearance'
WHERE id IN ('NTEST-05', 'NTEST-10', 'NTEST-11', 'NTEST-12', 'NTEST-13', 'NTEST-14', 'NTEST-15',
             'NTEST-16', 'NTEST-17', 'NTEST-20', 'NTEST-22');

-- Step 3: bid package not generated yet (10, and 22 whose executive has no login)
UPDATE tenders SET current_stage = 'BID_DOCS_PREPARATION' WHERE id IN ('NTEST-10', 'NTEST-22');
UPDATE tenders SET mis_executive = 'ghost.exec' WHERE id = 'NTEST-22';

-- From step 4 on the bid package exists.
UPDATE tenders SET working_path = '/documents/' || id
WHERE id IN ('NTEST-05', 'NTEST-11', 'NTEST-12', 'NTEST-13', 'NTEST-14', 'NTEST-15', 'NTEST-16', 'NTEST-17', 'NTEST-20');

-- Step 4: EMD. 11 entered and waiting on MIS; 12 not entered yet.
UPDATE tenders SET current_stage = 'PAYMENT_APPROVAL', payment_status = 'Pending', emd_beneficiary_name = 'Test Hospital',
                   emd_amount_actual = 25000, emd_payment_mode = 'NEFT'
WHERE id = 'NTEST-11';
UPDATE tenders SET current_stage = 'PAYMENT_APPROVAL' WHERE id = 'NTEST-12';

-- Step 5 and later: EMD done.
UPDATE tenders SET payment_status = 'Approved', current_stage = 'DUAL_TRACK'
WHERE id IN ('NTEST-05', 'NTEST-13', 'NTEST-14', 'NTEST-15', 'NTEST-16', 'NTEST-17', 'NTEST-20');

-- 05: routed to TPC, docs waiting on MIS
UPDATE tenders SET current_stage = 'TPC_PRICING', pricing_route = 'TPC', verification_status = 'Pending',
                   due_date = to_char((SELECT d FROM ntest_today), 'YYYY-MM-DD') || ' 17:00:00'
WHERE id = 'NTEST-05';
-- 13: no pricing route chosen, docs waiting on MIS
UPDATE tenders SET verification_status = 'Pending' WHERE id = 'NTEST-13';
-- 14: routed to TPC, docs already verified
UPDATE tenders SET current_stage = 'TPC_PRICING', pricing_route = 'TPC', verification_status = 'Approved' WHERE id = 'NTEST-14';
-- 15: TPC price in, MIS price pending; docs rejected back to the executive
UPDATE tenders SET current_stage = 'MIS_PRICING', pricing_route = 'TPC', tpc_purchase_price = 85000,
                   verification_status = 'Rejected'
WHERE id = 'NTEST-15';
-- 16, 17, 20: both tracks done
UPDATE tenders SET current_stage = 'SUBMISSION_READY', pricing_route = 'MIS', mis_final_price = 120000, pricing_status = 'Approved',
                   verification_status = 'Approved', can_final_submit = true, pricing_go_ahead_at = pg_temp.ts(5), pricing_go_ahead_by = 'misteam'
WHERE id IN ('NTEST-16', 'NTEST-17', 'NTEST-20');
-- 17: executive filed it on the portal, MIS has not confirmed
UPDATE tenders SET status = 'Submitted', submission_status = 'Pending' WHERE id = 'NTEST-17';
-- 20: filed and confirmed
UPDATE tenders SET status = 'Submitted', submission_status = 'Approved', current_stage = 'WIN_LOSS_PENDING', outcome_status = 'Pending'
WHERE id = 'NTEST-20';
-- 19: MIS declined it
UPDATE tenders SET status = 'Not Participating' WHERE id = 'NTEST-19';

-- ---------------------------------------------------------------------------
-- Workflow state rows for tenders past step 3 (the tender workspace reads these).
-- ---------------------------------------------------------------------------
INSERT INTO tender_workflow_states (tender_id, current_step, step_name, assigned_executive, assigned_at,
        spec_status, final_tech_spec_filename, final_tech_spec_uploaded_at, final_tech_spec_uploaded_by,
        bid_package_status, bid_package_generated_at, emd_applicable, emd_status, emd_approved_at, emd_approved_by,
        emd_receipt_confidential, pricing_route, track_a_pricing_status, track_b_doc_status, docs_verified_at,
        docs_verified_by, pricing_go_ahead_at, can_final_submit, outcome_status, total_path_docs, verified_path_docs,
        created_at, updated_at)
SELECT t.id, s.step, s.step_name, t.mis_executive, t.assigned_at,
       'APPROVED', t.final_tech_spec_filename, t.final_tech_spec_uploaded_at, 'clearance',
       'GENERATED', pg_temp.ts(s.pkg_ago), true, s.emd_status,
       CASE WHEN s.emd_ago IS NULL THEN NULL ELSE pg_temp.ts(s.emd_ago) END,
       CASE WHEN s.emd_ago IS NULL THEN NULL ELSE 'misteam' END,
       true, t.pricing_route, s.track_a, s.track_b,
       CASE WHEN s.docs_ago IS NULL THEN NULL ELSE pg_temp.ts(s.docs_ago) END,
       CASE WHEN s.docs_ago IS NULL THEN NULL ELSE 'misteam' END,
       t.pricing_go_ahead_at, s.step >= 6, 'PENDING', 4, CASE WHEN s.track_b = 'APPROVED' THEN 4 ELSE 0 END,
       pg_temp.ts(s.pkg_ago), pg_temp.ts(1)
FROM tenders t
JOIN (VALUES
    ('NTEST-05', 5, 'DUAL_TRACK',       5, 'APPROVED',      5, 'TPC_PENDING', 'PENDING',            NULL),
    ('NTEST-11', 4, 'EMD_PAYMENT',      6, 'PENDING',    NULL, 'NOT_STARTED', 'NOT_STARTED',        NULL),
    ('NTEST-12', 4, 'EMD_PAYMENT',      6, 'PENDING_INPUT', NULL, 'NOT_STARTED', 'NOT_STARTED',     NULL),
    ('NTEST-13', 5, 'DUAL_TRACK',       6, 'APPROVED',      5, 'ROUTING_PENDING', 'PENDING',        NULL),
    ('NTEST-14', 5, 'DUAL_TRACK',       9, 'APPROVED',      8, 'TPC_PENDING', 'APPROVED',              7),
    ('NTEST-15', 5, 'DUAL_TRACK',       9, 'APPROVED',      8, 'MIS_PENDING', 'CHANGES_REQUESTED',     5),
    ('NTEST-16', 6, 'SUBMISSION_READY', 9, 'APPROVED',      8, 'APPROVED', 'APPROVED',                 4),
    ('NTEST-17', 7, 'SUBMITTED',        9, 'APPROVED',      8, 'APPROVED', 'APPROVED',                 6),
    ('NTEST-20', 7, 'SUBMITTED',        9, 'APPROVED',      8, 'APPROVED', 'APPROVED',                 6)
) AS s(id, step, step_name, pkg_ago, emd_status, emd_ago, track_a, track_b, docs_ago) ON s.id = t.id;

-- ---------------------------------------------------------------------------
-- Pending approval requests: these name the queue and say since when it waits.
-- ---------------------------------------------------------------------------
INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, status, created_at, updated_at)
SELECT v.id, v.stage, v.requested_by, v.assigned_to, v.status, pg_temp.tsx(v.ago), pg_temp.tsx(v.ago)
FROM (VALUES
    ('NTEST-04', 'SPEC_CLEARANCE',     'executive', 'Clearance Team', 'PENDING', 5),
    ('NTEST-09', 'SPEC_CLEARANCE',     'executive', 'Clearance Team', 'PENDING', 4),
    ('NTEST-18', 'SPEC_CLEARANCE',     'executive', 'Clearance Team', 'PENDING', 1),
    ('NTEST-05', 'TPC_PRICING',        'executive', 'TPC Team',       'PENDING', 4),
    ('NTEST-05', 'DOC_VERIFICATION',   'executive', 'MIS Team',       'PENDING', 4),
    ('NTEST-11', 'PAYMENT_APPROVAL',   'executive', 'MIS Team',       'PENDING', 4),
    ('NTEST-13', 'DOC_VERIFICATION',   'executive', 'MIS Team',       'PENDING', 5),
    ('NTEST-14', 'TPC_PRICING',        'executive', 'TPC Team',       'PENDING', 6),
    ('NTEST-15', 'MIS_PRICING',        'tpc',       'MIS Team',       'PENDING', 5),
    ('NTEST-15', 'DOC_VERIFICATION',   'executive', 'MIS Team',       'CHANGES_REQUESTED', 5),
    ('NTEST-17', 'SUBMISSION_PENDING', 'executive', 'MIS Team',       'PENDING', 4)
) AS v(id, stage, requested_by, assigned_to, status, ago);

COMMIT;

SELECT id, left(title, 62) AS title, status, current_stage, coalesce(mis_executive, '-') AS executive, coalesce(due_date, '(none)') AS due
FROM tenders WHERE id LIKE 'NTEST-%' ORDER BY id;
