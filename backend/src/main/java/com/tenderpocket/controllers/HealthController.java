package com.tenderpocket.controllers;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class HealthController {

    @Autowired(required = false)
    private JdbcTemplate jdbcTemplate;

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> checkHealth() {
        boolean dbHealthy = false;
        if (jdbcTemplate != null) {
            try {
                jdbcTemplate.execute("SELECT 1");
                dbHealthy = true;
            } catch (Exception ignored) {
                dbHealthy = false;
            }
        } else {
            dbHealthy = true;
        }

        if (!dbHealthy) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("status", "DOWN", "database", "DOWN"));
        }

        return ResponseEntity.ok(Map.of("status", "UP", "database", "UP"));
    }
}
