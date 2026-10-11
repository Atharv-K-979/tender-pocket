-- PostgreSQL Database Backup & Change Tracking Trigger Schema
-- Creates db_change_log, backup_runs, and triggers for all 9 business tables.

CREATE TABLE IF NOT EXISTS db_change_log (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(64) NOT NULL,
    operation VARCHAR(10) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
    record_pk TEXT NOT NULL,
    row_data JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_db_change_log_id ON db_change_log(id);
CREATE INDEX IF NOT EXISTS idx_db_change_log_table ON db_change_log(table_name);

CREATE TABLE IF NOT EXISTS backup_runs (
    id BIGSERIAL PRIMARY KEY,
    backup_type VARCHAR(20) NOT NULL, -- 'DAILY', 'MONTHLY'
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    checkpoint_from_id BIGINT NOT NULL,
    checkpoint_to_id BIGINT NOT NULL,
    s3_bucket VARCHAR(255),
    s3_key VARCHAR(512),
    status VARCHAR(20) NOT NULL, -- 'IN_PROGRESS', 'SUCCESS', 'FAILED'
    error_message TEXT,
    size_bytes BIGINT,
    record_count BIGINT
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_status ON backup_runs(status);

CREATE OR REPLACE FUNCTION fn_track_db_changes()
RETURNS TRIGGER AS $$
DECLARE
    rec_pk TEXT;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        IF (TG_TABLE_NAME = 'users' OR TG_TABLE_NAME = 'user_signatures') THEN
            rec_pk := OLD.username::TEXT;
        ELSE
            rec_pk := OLD.id::TEXT;
        END IF;

        INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
        VALUES (TG_TABLE_NAME, 'DELETE', rec_pk, to_jsonb(OLD), CURRENT_TIMESTAMP);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (TG_TABLE_NAME = 'users' OR TG_TABLE_NAME = 'user_signatures') THEN
            rec_pk := NEW.username::TEXT;
        ELSE
            rec_pk := NEW.id::TEXT;
        END IF;

        INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
        VALUES (TG_TABLE_NAME, 'UPDATE', rec_pk, to_jsonb(NEW), CURRENT_TIMESTAMP);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        IF (TG_TABLE_NAME = 'users' OR TG_TABLE_NAME = 'user_signatures') THEN
            rec_pk := NEW.username::TEXT;
        ELSE
            rec_pk := NEW.id::TEXT;
        END IF;

        INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
        VALUES (TG_TABLE_NAME, 'INSERT', rec_pk, to_jsonb(NEW), CURRENT_TIMESTAMP);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Triggers for all 9 business tables
DROP TRIGGER IF EXISTS trg_track_tenders ON tenders;
CREATE TRIGGER trg_track_tenders
AFTER INSERT OR UPDATE OR DELETE ON tenders
FOR EACH ROW EXECUTE FUNCTION fn_track_db_changes();

DROP TRIGGER IF EXISTS trg_track_users ON users;
CREATE TRIGGER trg_track_users
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION fn_track_db_changes();

DROP TRIGGER IF EXISTS trg_track_activity_log ON activity_log;
CREATE TRIGGER trg_track_activity_log
AFTER INSERT OR UPDATE OR DELETE ON activity_log
FOR EACH ROW EXECUTE FUNCTION fn_track_db_changes();

DROP TRIGGER IF EXISTS trg_track_status_history ON status_history;
CREATE TRIGGER trg_track_status_history
AFTER INSERT OR UPDATE OR DELETE ON status_history
FOR EACH ROW EXECUTE FUNCTION fn_track_db_changes();

DROP TRIGGER IF EXISTS trg_track_tender_approval_requests ON tender_approval_requests;
CREATE TRIGGER trg_track_tender_approval_requests
AFTER INSERT OR UPDATE OR DELETE ON tender_approval_requests
FOR EACH ROW EXECUTE FUNCTION fn_track_db_changes();

DROP TRIGGER IF EXISTS trg_track_tender_comments ON tender_comments;
CREATE TRIGGER trg_track_tender_comments
AFTER INSERT OR UPDATE OR DELETE ON tender_comments
FOR EACH ROW EXECUTE FUNCTION fn_track_db_changes();

DROP TRIGGER IF EXISTS trg_track_tender_workflow_comments ON tender_workflow_comments;
CREATE TRIGGER trg_track_tender_workflow_comments
AFTER INSERT OR UPDATE OR DELETE ON tender_workflow_comments
FOR EACH ROW EXECUTE FUNCTION fn_track_db_changes();

DROP TRIGGER IF EXISTS trg_track_user_signatures ON user_signatures;
CREATE TRIGGER trg_track_user_signatures
AFTER INSERT OR UPDATE OR DELETE ON user_signatures
FOR EACH ROW EXECUTE FUNCTION fn_track_db_changes();

DROP TRIGGER IF EXISTS trg_track_email_notification_logs ON email_notification_logs;
CREATE TRIGGER trg_track_email_notification_logs
AFTER INSERT OR UPDATE OR DELETE ON email_notification_logs
FOR EACH ROW EXECUTE FUNCTION fn_track_db_changes();

-- Initial Backfill logic: populate db_change_log for existing rows if table is empty
INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
SELECT 'users', 'INSERT', username::TEXT, to_jsonb(u), CURRENT_TIMESTAMP FROM users u
WHERE NOT EXISTS (SELECT 1 FROM db_change_log WHERE table_name = 'users');

INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
SELECT 'user_signatures', 'INSERT', username::TEXT, to_jsonb(s), CURRENT_TIMESTAMP FROM user_signatures s
WHERE NOT EXISTS (SELECT 1 FROM db_change_log WHERE table_name = 'user_signatures');

INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
SELECT 'tenders', 'INSERT', id::TEXT, to_jsonb(t), CURRENT_TIMESTAMP FROM tenders t
WHERE NOT EXISTS (SELECT 1 FROM db_change_log WHERE table_name = 'tenders');

INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
SELECT 'activity_log', 'INSERT', id::TEXT, to_jsonb(a), CURRENT_TIMESTAMP FROM activity_log a
WHERE NOT EXISTS (SELECT 1 FROM db_change_log WHERE table_name = 'activity_log');

INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
SELECT 'status_history', 'INSERT', id::TEXT, to_jsonb(h), CURRENT_TIMESTAMP FROM status_history h
WHERE NOT EXISTS (SELECT 1 FROM db_change_log WHERE table_name = 'status_history');

INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
SELECT 'tender_approval_requests', 'INSERT', id::TEXT, to_jsonb(r), CURRENT_TIMESTAMP FROM tender_approval_requests r
WHERE NOT EXISTS (SELECT 1 FROM db_change_log WHERE table_name = 'tender_approval_requests');

INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
SELECT 'tender_comments', 'INSERT', id::TEXT, to_jsonb(c), CURRENT_TIMESTAMP FROM tender_comments c
WHERE NOT EXISTS (SELECT 1 FROM db_change_log WHERE table_name = 'tender_comments');

INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
SELECT 'tender_workflow_comments', 'INSERT', id::TEXT, to_jsonb(wc), CURRENT_TIMESTAMP FROM tender_workflow_comments wc
WHERE NOT EXISTS (SELECT 1 FROM db_change_log WHERE table_name = 'tender_workflow_comments');

INSERT INTO db_change_log (table_name, operation, record_pk, row_data, created_at)
SELECT 'email_notification_logs', 'INSERT', id::TEXT, to_jsonb(e), CURRENT_TIMESTAMP FROM email_notification_logs e
WHERE NOT EXISTS (SELECT 1 FROM db_change_log WHERE table_name = 'email_notification_logs');
