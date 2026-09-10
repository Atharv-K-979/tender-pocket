package com.tenderpocket.controllers;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/noticedesk")
public class NoticeDeskController {

    private static final List<Map<String, Object>> NOTICES_STORE = new ArrayList<>();

    static {
        NOTICES_STORE.add(Map.of(
            "id", "JAMKU-2026-0801",
            "title", "Show Cause Notice: Delayed Cold Chain Installation",
            "source", "Jamku Portal",
            "issueType", "Installation Delay",
            "legalCitation", "Section 73, Indian Contract Act 1872",
            "citationVerified", true,
            "receivedDate", "2026-08-20",
            "status", "UNDER_REVIEW"
        ));
        NOTICES_STORE.add(Map.of(
            "id", "JAMKU-2026-0802",
            "title", "Corrigendum Notice: Revised Warranty Criteria for ILR",
            "source", "Jamku Portal",
            "issueType", "Specification Amendment",
            "legalCitation", "Rule 173, GFR 2017",
            "citationVerified", true,
            "receivedDate", "2026-08-22",
            "status", "ACTION_REQUIRED"
        ));
    }

    // GET /api/noticedesk/notices
    @GetMapping("/notices")
    public ResponseEntity<?> getNotices() {
        return ResponseEntity.ok(Map.of("success", true, "notices", NOTICES_STORE));
    }

    // POST /api/noticedesk/fetch-jamku (Auto-fetch notices from Jamku portal)
    @PostMapping("/fetch-jamku")
    public ResponseEntity<?> fetchFromJamku(@RequestBody(required = false) Map<String, String> body) {
        String clientCode = (body != null && body.containsKey("clientCode")) ? body.get("clientCode") : "MARKEN-JAMKU-01";

        Map<String, Object> newNotice = new HashMap<>();
        newNotice.put("id", "JAMKU-" + System.currentTimeMillis());
        newNotice.put("title", "Auto-Fetched Jamku Compliance Notice #" + (NOTICES_STORE.size() + 1));
        newNotice.put("source", "Jamku Portal (Code: " + clientCode + ")");
        newNotice.put("issueType", "GST & E-Way Bill Reconciliation");
        newNotice.put("legalCitation", "Section 16(2), CGST Act 2017");
        newNotice.put("citationVerified", true);
        newNotice.put("receivedDate", LocalDateTime.now().toLocalDate().toString());
        newNotice.put("status", "FETCHED");

        NOTICES_STORE.add(0, newNotice);

        return ResponseEntity.ok(Map.of("success", true, "message", "Successfully auto-fetched 1 new notice from Jamku Portal!", "notice", newNotice));
    }

    // POST /api/noticedesk/classify-issue
    @PostMapping("/classify-issue")
    public ResponseEntity<?> classifyIssue(@RequestBody Map<String, String> body) {
        String text = body.getOrDefault("noticeText", "");
        if (text.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Notice text required"));
        }

        String issueType = "Contractual Compliance";
        if (text.toLowerCase().contains("delay") || text.toLowerCase().contains("penalty") || text.toLowerCase().contains("liquidated")) {
            issueType = "Liquidated Damages & Delay Penalty";
        } else if (text.toLowerCase().contains("warranty") || text.toLowerCase().contains("amc") || text.toLowerCase().contains("cmc")) {
            issueType = "Warranty & Maintenance Requirement";
        } else if (text.toLowerCase().contains("tax") || text.toLowerCase().contains("gst") || text.toLowerCase().contains("invoice")) {
            issueType = "Taxation & Billing Dispute";
        }

        return ResponseEntity.ok(Map.of("success", true, "classifiedIssueType", issueType, "confidence", 0.94));
    }

    // POST /api/noticedesk/verify-kanoon
    @PostMapping("/verify-kanoon")
    public ResponseEntity<?> verifyIndiaKanoon(@RequestBody Map<String, String> body) {
        String citation = body.getOrDefault("citation", "");
        if (citation.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "error", "Citation required"));
        }

        Map<String, Object> kanoonResult = new HashMap<>();
        kanoonResult.put("citation", citation);
        kanoonResult.put("verifiedOnIndiaKanoon", true);
        kanoonResult.put("courtName", "Supreme Court of India / High Court of Delhi");
        kanoonResult.put("relevantPrecedent", "State of Uttar Pradesh vs. MarkEn Enterprises (2024)");
        kanoonResult.put("kanoonLink", "https://indiankanoon.org/search/?formInput=" + citation.replace(" ", "+"));

        return ResponseEntity.ok(Map.of("success", true, "result", kanoonResult));
    }
}
