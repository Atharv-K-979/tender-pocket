package com.tenderpocket.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;

@Configuration
public class DatabaseConfig {

    @Value("${spring.datasource.url}")
    private String dbUrl;

    @Value("${SPRING_DATASOURCE_USERNAME:${spring.datasource.username:}}")
    private String username;

    @Value("${SPRING_DATASOURCE_PASSWORD:${spring.datasource.password:}}")
    private String password;

    @Bean
    @Primary
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        
        String finalUrl = dbUrl;
        // Convert postgres:// or postgresql:// URI format to jdbc:postgresql://
        if (finalUrl.startsWith("postgres://")) {
            finalUrl = finalUrl.replace("postgres://", "jdbc:postgresql://");
        } else if (finalUrl.startsWith("postgresql://")) {
            finalUrl = finalUrl.replace("postgresql://", "jdbc:postgresql://");
        }

        config.setJdbcUrl(finalUrl);

        if (finalUrl.startsWith("jdbc:postgresql:")) {
            config.setDriverClassName("org.postgresql.Driver");
            if (username != null && !username.isEmpty()) {
                config.setUsername(username);
            }
            if (password != null && !password.isEmpty()) {
                config.setPassword(password);
            }
            // Parse inline credentials if present (postgres://user:pass@host/db)
            if (finalUrl.contains("@")) {
                try {
                    String clean = finalUrl.replace("jdbc:postgresql://", "");
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
            System.out.println("[DatabaseConfig] Auto-configured PostgreSQL DataSource successfully.");
        } else {
            config.setDriverClassName("org.sqlite.JDBC");
            System.out.println("[DatabaseConfig] Auto-configured SQLite DataSource successfully.");
        }

        return new HikariDataSource(config);
    }
}
