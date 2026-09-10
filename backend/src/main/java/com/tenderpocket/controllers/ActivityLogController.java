package com.tenderpocket.controllers;

import com.tenderpocket.models.ActivityLog;
import com.tenderpocket.repositories.ActivityLogRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/activity-logs")
public class ActivityLogController {

    @Autowired
    private ActivityLogRepository activityLogRepository;

    @GetMapping
    public ResponseEntity<?> getActivityLogs(
            @RequestParam(value = "action", required = false) String action) {
        
        List<ActivityLog> logs;
        if (action != null && !action.isEmpty()) {
            logs = activityLogRepository.findByActionOrderByTimestampDesc(action);
        } else {
            logs = activityLogRepository.findAllByOrderByTimestampDesc();
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "logs", logs
        ));
    }
}
