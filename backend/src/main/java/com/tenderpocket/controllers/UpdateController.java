package com.tenderpocket.controllers;

import com.tenderpocket.services.AutoUpdateService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/update")
public class UpdateController {

    @Autowired
    private AutoUpdateService autoUpdateService;

    @GetMapping("/status")
    public ResponseEntity<?> getUpdateStatus() {
        return ResponseEntity.ok(autoUpdateService.getUpdateStatus());
    }

    @PostMapping("/check")
    public ResponseEntity<?> checkUpdate() {
        Map<String, Object> result = autoUpdateService.checkAndDownloadUpdates();
        return ResponseEntity.ok(result);
    }

    @PostMapping("/apply")
    public ResponseEntity<?> applyUpdate() {
        boolean triggered = autoUpdateService.triggerRestartAndApply();
        if (triggered) {
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "message", "Update application triggered. Application is restarting..."
            ));
        } else {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "error", "No downloaded update file (TenderPocket-update.jar) found to apply."
            ));
        }
    }
}
