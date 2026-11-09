package com.tenderpocket.config;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One-time cleanup of the two tender numbers, run at startup:
 * <ul>
 *   <li>ref_no    = Organization Tender ID (the department's number, e.g. GEM/2026/B/1234567)</li>
 *   <li>source_id = T247 ID (Tender247's numeric tender number, e.g. 48213377)</li>
 * </ul>
 * GeM sync used to write GeM bid / RA numbers into source_id. Those values are moved to ref_no when it is
 * empty, otherwise kept in the notes, and then source_id is cleared so it only holds T247 IDs. Tender247
 * tenders that are missing their T247 ID get it back from their tender ID, which email sync sets to the T247 ID.
 * Last, every tender's type is set from its Organization Tender ID: "GeM" when ref_no contains the word GEM,
 * otherwise "Non GeM" (same rule as TenderClassifier.classify).
 * <p>
 * Every statement only touches rows that still need fixing, so later startups change nothing.
 * All statements run in one transaction: if any fails, nothing is changed.
 */
@Component
public class TenderIdCleanupMigration implements CommandLineRunner {

    private static final String PLACEHOLDERS = "('N/A','NA','NULL','-','--','TBD','NONE')";
    private static final String NOT_T247 = "source_id IS NOT NULL AND TRIM(source_id) !~ '^[0-9]+$'";
    private static final String REAL_VALUE = "TRIM(source_id) <> '' AND UPPER(TRIM(source_id)) NOT IN " + PLACEHOLDERS;
    private static final String GEM_NUMBER = "TRIM(source_id) ~* '^GEM[/_][0-9]{4}[/_][A-Z][/_][0-9]+$'";
    /** Same rule as TenderClassifier.classify: ref_no contains the word GEM, in any letter case. */
    private static final String TENDER_TYPE_FROM_REF_NO =
            "CASE WHEN ref_no ~* '(^|[^a-z])gem([^a-z]|$)' THEN 'GeM' ELSE 'Non GeM' END";
    private static final String REF_BLANK = "(ref_no IS NULL OR TRIM(ref_no) = '' OR UPPER(TRIM(ref_no)) IN " + PLACEHOLDERS + ")";

    /** Statements in the order they must run, with a short description for the log. */
    static final Map<String, String> STATEMENTS = new LinkedHashMap<>();
    static {
        STATEMENTS.put("GeM numbers moved from T247 ID to empty Organization Tender ID",
                "UPDATE tenders SET ref_no = UPPER(REPLACE(TRIM(source_id), '_', '/')) WHERE "
                        + NOT_T247 + " AND " + GEM_NUMBER + " AND " + REF_BLANK);
        STATEMENTS.put("Other numbers moved from T247 ID to empty Organization Tender ID",
                "UPDATE tenders SET ref_no = TRIM(source_id) WHERE "
                        + NOT_T247 + " AND " + REAL_VALUE + " AND " + REF_BLANK);
        STATEMENTS.put("Remaining numbers kept in notes",
                "UPDATE tenders SET notes = "
                        + "CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE notes || chr(10) END"
                        + " || CASE WHEN " + GEM_NUMBER + " THEN 'GeM RA number: ' ELSE 'Earlier Source ID: ' END"
                        + " || TRIM(source_id)"
                        + " WHERE " + NOT_T247 + " AND " + REAL_VALUE
                        + " AND UPPER(REPLACE(TRIM(source_id), '_', '/')) <> UPPER(REPLACE(TRIM(COALESCE(ref_no, '')), '_', '/'))"
                        + " AND POSITION(UPPER(TRIM(source_id)) IN UPPER(COALESCE(notes, ''))) = 0");
        STATEMENTS.put("Non-T247 values cleared from T247 ID",
                "UPDATE tenders SET source_id = NULL WHERE " + NOT_T247);
        STATEMENTS.put("Spaces trimmed from T247 IDs",
                "UPDATE tenders SET source_id = TRIM(source_id) WHERE source_id <> TRIM(source_id)");
        STATEMENTS.put("T247 ID filled from tender ID for Tender247 tenders",
                "UPDATE tenders SET source_id = id WHERE source_id IS NULL"
                        + " AND REPLACE(LOWER(COALESCE(source, '')), ' ', '') = 'tender247' AND id ~ '^[0-9]+$'");
        STATEMENTS.put("T247 ID filled from t247-<number> tender IDs",
                "UPDATE tenders SET source_id = SUBSTRING(id FROM 6) WHERE source_id IS NULL AND id ~ '^t247-[0-9]+$'");
        STATEMENTS.put("Tender type set from Organization Tender ID",
                "UPDATE tenders SET tender_type = " + TENDER_TYPE_FROM_REF_NO
                        + " WHERE tender_type IS DISTINCT FROM " + TENDER_TYPE_FROM_REF_NO);
    }

    private final DataSource dataSource;

    public TenderIdCleanupMigration(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public void run(String... args) {
        try (Connection conn = dataSource.getConnection()) {
            String db = conn.getMetaData().getDatabaseProductName();
            if (db == null || !db.toLowerCase().contains("postgresql")) {
                return; // the statements use PostgreSQL regex operators
            }
            boolean autoCommit = conn.getAutoCommit();
            conn.setAutoCommit(false);
            try (Statement stmt = conn.createStatement()) {
                StringBuilder summary = new StringBuilder();
                for (Map.Entry<String, String> e : STATEMENTS.entrySet()) {
                    int rows = stmt.executeUpdate(e.getValue());
                    if (rows > 0) summary.append("\n  - ").append(e.getKey()).append(": ").append(rows);
                }
                conn.commit();
                System.out.println("[Tender ID Cleanup] " + (summary.length() == 0 ? "Nothing to fix." : "Done:" + summary));
            } catch (Exception e) {
                conn.rollback();
                System.out.println("[Tender ID Cleanup] Skipped, no changes made: " + e.getMessage());
            } finally {
                conn.setAutoCommit(autoCommit);
            }
        } catch (Exception e) {
            System.out.println("[Tender ID Cleanup] Could not run: " + e.getMessage());
        }
    }
}
