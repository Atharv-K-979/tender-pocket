package com.tenderpocket.controllers;

import com.tenderpocket.config.WorkflowPermissions;
import com.tenderpocket.notifications.DailyDigestService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Admin tools for the daily mails (Admin login only).
 *
 *  GET  /api/notifications/summary   what every login would get now, and the settings in use; sends nothing
 *  POST /api/notifications/run       sends today's mails that have not been sent yet (the 9 AM job does this itself)
 */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final DailyDigestService digestService;

    public NotificationController(DailyDigestService digestService) {
        this.digestService = digestService;
    }

    @GetMapping("/summary")
    public ResponseEntity<?> summary() {
        if (!isAdmin()) return WorkflowPermissions.denied();
        return ResponseEntity.ok(digestService.summary());
    }

    @PostMapping("/run")
    public ResponseEntity<?> run() {
        if (!isAdmin()) return WorkflowPermissions.denied();
        // Always 200: "success" and "status" (DONE, DISABLED, BUSY) in the body say what happened.
        return ResponseEntity.ok(digestService.run("manual").toMap());
    }

    private static boolean isAdmin() {
        return "Admin".equals(WorkflowPermissions.role());
    }
}
