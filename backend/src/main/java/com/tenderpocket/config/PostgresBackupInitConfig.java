package com.tenderpocket.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import javax.sql.DataSource;

@Configuration
public class PostgresBackupInitConfig implements CommandLineRunner {

    @Autowired
    private DataSource dataSource;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Override
    public void run(String... args) throws Exception {
        try {
            // Check if PostgreSQL database is active
            String driverName = jdbcTemplate.getDataSource().getConnection().getMetaData().getDriverName();
            if (driverName != null && driverName.toLowerCase().contains("postgresql")) {
                System.out.println("[PostgresBackupInitConfig] PostgreSQL detected. Initializing change tracking triggers and backup schema...");
                ResourceDatabasePopulator populator = new ResourceDatabasePopulator();
                populator.addScript(new ClassPathResource("schema-backup-triggers.sql"));
                populator.setContinueOnError(true);
                populator.execute(dataSource);
                System.out.println("[PostgresBackupInitConfig] Change tracking schema and triggers initialized successfully.");
            } else {
                System.out.println("[PostgresBackupInitConfig] Non-PostgreSQL datasource (" + driverName + "). Skipping PostgreSQL backup triggers.");
            }
        } catch (Exception e) {
            System.err.println("[PostgresBackupInitConfig] Warning initializing PostgreSQL backup triggers: " + e.getMessage());
        }
    }
}
