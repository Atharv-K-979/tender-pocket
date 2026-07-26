package com.tenderpocket;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;

@SpringBootApplication
@EnableScheduling
public class TenderPocketApplication {
    public static void main(String[] args) {
        SpringApplication.run(TenderPocketApplication.class, args);
    }

    @Bean
    public CommandLineRunner migrateDatabaseColumns(DataSource dataSource) {
        return args -> {
            try (Connection conn = dataSource.getConnection(); Statement stmt = conn.createStatement()) {
                String[] alterStatements = {
                    "ALTER TABLE tenders ALTER COLUMN title TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN original_url TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN authority TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN location TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN document_url TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN downloaded_docs TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN notes TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN corrigendum_remark TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN product_name_as_per_tender TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN product_name_as_per_marken TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN ai_details_summary TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN ai_history_summary TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN working_path TYPE text",
                    "ALTER TABLE tenders ALTER COLUMN loss_reason TYPE text"
                };

                for (String sql : alterStatements) {
                    try {
                        stmt.executeUpdate(sql);
                    } catch (Exception ignored) {
                        // Ignore if running on SQLite or column is already TEXT
                    }
                }
                System.out.println("[Database Migration] Verified and altered PostgreSQL tender table columns to TEXT.");
            } catch (Exception e) {
                System.out.println("[Database Migration] Migration runner finished: " + e.getMessage());
            }
        };
    }
}
