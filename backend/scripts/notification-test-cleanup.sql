-- Removes the test tenders (NTEST- from notification-test-seed.sql and NBULK- from
-- notification-bulk-seed.sql), and today's mail send log so the daily mails can be sent
-- again today.
--   docker exec -i tender-pocket-postgres psql -U postgres -d tender_pocket < backend/scripts/notification-test-cleanup.sql
BEGIN;
DELETE FROM tender_approval_requests WHERE tender_id LIKE 'NTEST-%' OR tender_id LIKE 'NBULK-%';
DELETE FROM tender_workflow_states   WHERE tender_id LIKE 'NTEST-%' OR tender_id LIKE 'NBULK-%';
DELETE FROM tenders                  WHERE id        LIKE 'NTEST-%' OR id        LIKE 'NBULK-%';
DO $$
BEGIN
    IF to_regclass('public.tender_pending_actions') IS NOT NULL THEN
        DELETE FROM tender_pending_actions WHERE tender_id LIKE 'NTEST-%' OR tender_id LIKE 'NBULK-%';
    END IF;
    IF to_regclass('public.email_digest_log') IS NOT NULL THEN
        DELETE FROM email_digest_log WHERE sent_date = (now() AT TIME ZONE 'Asia/Kolkata')::date;
    END IF;
END $$;
COMMIT;
