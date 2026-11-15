package com.tenderpocket.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;
import java.util.Locale;
import java.util.Set;

@Configuration
public class DatabaseConfig {

    /** How long the backend waits for PostgreSQL at startup before it stops with an error. */
    private static final long POSTGRES_WAIT_MILLIS = 120_000;

    /** Pause between two connection attempts while waiting for PostgreSQL. */
    private static final long POSTGRES_RETRY_MILLIS = 3_000;

    /** Hibernate ddl-auto values that delete tables when the backend starts. */
    private static final Set<String> TABLE_DROPPING_DDL_AUTO = Set.of("create", "create-drop", "drop");

    @Value("${spring.datasource.url}")
    private String dbUrl;

    @Value("${SPRING_DATASOURCE_USERNAME:${spring.datasource.username:}}")
    private String username;

    @Value("${SPRING_DATASOURCE_PASSWORD:${spring.datasource.password:}}")
    private String password;

    @Value("${spring.jpa.hibernate.ddl-auto:update}")
    private String ddlAuto;

    @Bean
    @Primary
    public DataSource dataSource() {
        String envUrl = System.getenv("SPRING_DATASOURCE_URL");
        if (envUrl == null || envUrl.isEmpty()) {
            envUrl = System.getenv("DATABASE_URL");
        }

        String finalUrl = (envUrl != null && !envUrl.isEmpty()) ? envUrl : dbUrl;

        // Convert postgres:// or postgresql:// URI format to jdbc:postgresql://
        if (finalUrl.startsWith("postgres://")) {
            finalUrl = finalUrl.replace("postgres://", "jdbc:postgresql://");
        } else if (finalUrl.startsWith("postgresql://")) {
            finalUrl = finalUrl.replace("postgresql://", "jdbc:postgresql://");
        }

        // Auto-convert internal Render hostname to external hostname if running locally outside Render cloud
        if (System.getenv("RENDER") == null && finalUrl.contains("dpg-") && !finalUrl.contains(".render.com")) {
            finalUrl = finalUrl.replace("dpg-d9iounv41pts73bisb50-a", "dpg-d9iounv41pts73bisb50-a.singapore-postgres.render.com");
            if (!finalUrl.contains("sslmode=")) {
                finalUrl += (finalUrl.contains("?") ? "&" : "?") + "sslmode=require";
            }
        }

        // SQLite is used only when it is asked for explicitly with a jdbc:sqlite: URL.
        if (finalUrl.startsWith("jdbc:sqlite:")) {
            HikariConfig config = new HikariConfig();
            config.setDriverClassName("org.sqlite.JDBC");
            config.setJdbcUrl(finalUrl);
            System.out.println("[DatabaseConfig] Configured SQLite DataSource: " + finalUrl);
            return new HikariDataSource(config);
        }

        refuseTableDroppingDdlAuto();
        return connectToPostgres(finalUrl);
    }

    /**
     * Connects to PostgreSQL, waiting for it when it is not ready yet.
     * <p>
     * When the server boots, Docker starts every container at the same time and ignores
     * depends_on, so the backend can be ready before PostgreSQL accepts connections. With the
     * server stopped every night and started every morning, this happens every day. The backend
     * therefore retries for up to {@link #POSTGRES_WAIT_MILLIS}.
     * <p>
     * It never falls back to a local SQLite file: the app would show no tenders, and new tenders
     * and edits would be written to a throw-away file inside the container. If PostgreSQL is still
     * not reachable after the wait, startup fails and Docker (restart: always) starts the backend
     * again, which waits again.
     */
    private DataSource connectToPostgres(String jdbcUrl) {
        long start = System.currentTimeMillis();
        for (int attempt = 1; ; attempt++) {
            try {
                // Auto-create database if it doesn't exist on local PostgreSQL server
                createDatabaseIfNotExist(jdbcUrl, username, password);
                HikariDataSource ds = new HikariDataSource(postgresConfig(jdbcUrl));
                System.out.println("[DatabaseConfig] Configured PostgreSQL DataSource successfully"
                        + (attempt == 1 ? "." : " after waiting " + secondsSince(start) + " s (attempt " + attempt + ")."));
                return ds;
            } catch (Exception e) {
                String reason = rootCauseMessage(e);
                if (System.currentTimeMillis() - start + POSTGRES_RETRY_MILLIS > POSTGRES_WAIT_MILLIS) {
                    System.err.println("[DatabaseConfig] PostgreSQL is still not reachable after " + secondsSince(start)
                            + " s (" + attempt + " attempts): " + reason
                            + ". Stopping the backend so Docker restarts it. SQLite is not used.");
                    throw new IllegalStateException("PostgreSQL is not reachable: " + reason, e);
                }
                System.out.println("[DatabaseConfig] PostgreSQL is not ready yet (attempt " + attempt + ", "
                        + secondsSince(start) + " s): " + reason + ". Retrying in "
                        + (POSTGRES_RETRY_MILLIS / 1000) + " s...");
                sleep(POSTGRES_RETRY_MILLIS);
            }
        }
    }

    private HikariConfig postgresConfig(String jdbcUrl) {
        HikariConfig config = new HikariConfig();
        config.setDriverClassName("org.postgresql.Driver");
        config.setJdbcUrl(jdbcUrl);

        if (username != null && !username.isEmpty()) {
            config.setUsername(username);
        }
        if (password != null && !password.isEmpty()) {
            config.setPassword(password);
        }

        // Parse inline credentials if present (postgres://user:pass@host/db)
        if (jdbcUrl.contains("@")) {
            try {
                String clean = jdbcUrl.replace("jdbc:postgresql://", "");
                String userInfo = clean.split("@")[0];
                String[] userPass = userInfo.split(":");
                if (userPass.length >= 1) config.setUsername(userPass[0]);
                if (userPass.length >= 2) config.setPassword(userPass[1]);

                String hostAndDb = clean.split("@")[1];
                config.setJdbcUrl("jdbc:postgresql://" + hostAndDb);
            } catch (Exception e) {
                System.err.println("[DatabaseConfig] Error parsing PostgreSQL URL credentials: " + e.getMessage());
            }
        }

        config.setMaximumPoolSize(25);
        config.setMinimumIdle(5);
        config.setConnectionTimeout(15000);
        config.setIdleTimeout(30000);
        config.setMaxLifetime(60000);
        config.setKeepaliveTime(30000);
        config.setLeakDetectionThreshold(60000);
        return config;
    }

    /**
     * The backend now starts every morning. With ddl-auto create, create-drop or drop, Hibernate
     * would delete every table at each start, so the backend refuses to start instead.
     */
    private void refuseTableDroppingDdlAuto() {
        String mode = ddlAuto == null ? "" : ddlAuto.trim().toLowerCase(Locale.ROOT);
        if (TABLE_DROPPING_DDL_AUTO.contains(mode)) {
            throw new IllegalStateException("SPRING_JPA_HIBERNATE_DDL_AUTO=" + ddlAuto
                    + " deletes all tables every time the backend starts. Set it to update in .env.");
        }
    }

    private static String rootCauseMessage(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        return root.getMessage() != null ? root.getMessage() : root.toString();
    }

    private static long secondsSince(long startMillis) {
        return (System.currentTimeMillis() - startMillis) / 1000;
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting for PostgreSQL", e);
        }
    }

    private void createDatabaseIfNotExist(String jdbcUrl, String user, String pass) {
        if (jdbcUrl == null || !jdbcUrl.startsWith("jdbc:postgresql:")) return;
        try {
            String clean = jdbcUrl.replace("jdbc:postgresql://", "");
            if (clean.contains("@")) clean = clean.split("@")[1];
            String hostPortAndDb = clean.split("\\?")[0];
            String[] parts = hostPortAndDb.split("/");
            if (parts.length < 2) return;
            
            String hostPort = parts[0];
            String dbName = parts[1];

            String baseUrl = "jdbc:postgresql://" + hostPort + "/postgres";
            try (java.sql.Connection conn = java.sql.DriverManager.getConnection(baseUrl, user, pass);
                 java.sql.Statement stmt = conn.createStatement()) {
                stmt.executeUpdate("CREATE DATABASE \"" + dbName + "\"");
                System.out.println("[DatabaseConfig] Auto-created PostgreSQL database: " + dbName);
            } catch (Exception ignored) {
                // Database already exists
            }
        } catch (Exception ignored) {}
    }
}
