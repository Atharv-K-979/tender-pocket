package com.tenderpocket.controllers;

import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;

@RestController
@RequestMapping("/api/analytics")
public class AnalyticsController {

    @Autowired
    private TenderRepository tenderRepository;

    @PersistenceContext
    private EntityManager entityManager;

    @GetMapping
    public ResponseEntity<?> getAnalytics(
            @RequestHeader("x-user-role") String userRole,
            @RequestHeader("x-user-username") String username) {

        String todayIST = java.time.ZonedDateTime.now(java.time.ZoneId.of("Asia/Kolkata")).toLocalDate().toString();

        List<Tender> tenders = ("MIS Executive".equalsIgnoreCase(userRole) || "Tender Executive".equalsIgnoreCase(userRole))
                ? tenderRepository.findByMisExecutive(username)
                : "Specification Team".equalsIgnoreCase(userRole)
                ? tenderRepository.findByAssignedMisMemberSpec(username)
                : tenderRepository.findAll();

        int issuedCount = 0;
        int participatingCount = 0;
        int notParticipatingCount = 0;
        int lapsedCount = 0;
        int filedCount = 0;
        int awardedCount = 0;
        int notAwardedCount = 0;
        int nonSubmissionLossCount = 0;
        int nonParticipationLossCount = 0;
        int t2TodayCount = 0;
        int t2_3DaysCount = 0;

        int specPendingCount = 0;
        int specApprovedCount = 0;
        int specRejectedCount = 0;
        int specTotalCount = tenders.size();

        LocalDate today = LocalDate.now();
        LocalDate threeDaysLater = today.plusDays(3);

        double valNew = 0, valPart = 0, valNotPart = 0, valLapsed = 0, valFiled = 0, valWon = 0, valLost = 0, valMissedDead = 0, valMissedOpp = 0;

        for (Tender t : tenders) {
            String status = resolveStatus(t, todayIST);
            double val = t.getEstimatedCost() != null ? t.getEstimatedCost() : 0.0;

            if ("Pending".equalsIgnoreCase(t.getSpecVerificationStatus())) specPendingCount++;
            else if ("Approved".equalsIgnoreCase(t.getSpecVerificationStatus())) specApprovedCount++;
            else if ("Rejected".equalsIgnoreCase(t.getSpecVerificationStatus())) specRejectedCount++;

            if ("New".equals(status)) { issuedCount++; valNew += val; }
            else if ("Participating".equals(status)) { participatingCount++; valPart += val; }
            else if ("Not Participating".equals(status)) { notParticipatingCount++; valNotPart += val; }
            else if ("Lapsed".equals(status)) { lapsedCount++; valLapsed += val; }
            else if ("Submitted".equals(status)) { filedCount++; valFiled += val; }
            else if ("Won".equals(status)) { awardedCount++; valWon += val; }
            else if ("Lost".equals(status)) { notAwardedCount++; valLost += val; }
            else if ("Missed Deadline".equals(status)) { nonSubmissionLossCount++; valMissedDead += val; }
            else if ("Missed Opportunity".equals(status)) { nonParticipationLossCount++; valMissedOpp += val; }

            // Deadline warning calculations
            if (t.getDueDate() != null) {
                try {
                    String cleanDue = t.getDueDate().split(" ")[0];
                    LocalDate due = LocalDate.parse(cleanDue);
                    if (cleanDue.equals(todayIST)) {
                        if ("New".equals(status) || "Lapsed".equals(status) || "Participating".equals(status) || "Submitted".equals(status)) {
                            t2TodayCount++;
                        }
                    }
                    if (due.isAfter(today) && !due.isAfter(threeDaysLater)) {
                        if ("New".equals(status) || "Lapsed".equals(status) || "Participating".equals(status) || "Submitted".equals(status)) {
                            t2_3DaysCount++;
                        }
                    }
                } catch (Exception e) {}
            }
        }

        int totalTenders = tenders.size();

        // Query database value brackets, sectors, and authorities using native queries
        List<Map<String, Object>> sectorList = new ArrayList<>();
        List<Map<String, Object>> authorityList = new ArrayList<>();
        List<Map<String, Object>> bracketsList = new ArrayList<>();

        try {
            // Sectors Query
            String sectorSql = "SELECT COALESCE(sector, 'Unknown') as sector, COUNT(*) as count, SUM(COALESCE(estimated_cost, 0.0)) as total_val " +
                    "FROM tenders " +
                    ("MIS Executive".equalsIgnoreCase(userRole) ? "WHERE mis_executive = ? " : "") +
                    "GROUP BY sector ORDER BY count DESC LIMIT 10";
            Query q1 = entityManager.createNativeQuery(sectorSql);
            if ("MIS Executive".equalsIgnoreCase(userRole)) {
                q1.setParameter(1, username);
            }
            List<Object[]> r1 = q1.getResultList();
            for (Object[] row : r1) {
                sectorList.add(Map.of("sector", row[0], "count", row[1], "total_val", row[2]));
            }

            // Authorities Query
            String authSql = "SELECT COALESCE(authority, 'Unknown') as authority, COUNT(*) as count, SUM(COALESCE(estimated_cost, 0.0)) as total_val " +
                    "FROM tenders " +
                    ("MIS Executive".equalsIgnoreCase(userRole) ? "WHERE mis_executive = ? " : "") +
                    "GROUP BY authority ORDER BY total_val DESC LIMIT 10";
            Query q2 = entityManager.createNativeQuery(authSql);
            if ("MIS Executive".equalsIgnoreCase(userRole)) {
                q2.setParameter(1, username);
            }
            List<Object[]> r2 = q2.getResultList();
            for (Object[] row : r2) {
                authorityList.add(Map.of("authority", row[0], "count", row[1], "total_val", row[2]));
            }

            // Value Brackets Query
            String bracketSql = "SELECT " +
                    "CASE " +
                    "  WHEN estimated_cost IS NULL THEN 'Unspecified' " +
                    "  WHEN estimated_cost < 500000 THEN 'Under 5L' " +
                    "  WHEN estimated_cost >= 500000 AND estimated_cost < 2000000 THEN '5L - 20L' " +
                    "  WHEN estimated_cost >= 2000000 AND estimated_cost < 10000000 THEN '20L - 1Cr' " +
                    "  WHEN estimated_cost >= 10000000 AND estimated_cost < 50000000 THEN '1Cr - 5Cr' " +
                    "  ELSE 'Over 5Cr' " +
                    "END as bracket, COUNT(*) as count " +
                    "FROM tenders " +
                    ("MIS Executive".equalsIgnoreCase(userRole) ? "WHERE mis_executive = ? " : "") +
                    "GROUP BY bracket";
            Query q3 = entityManager.createNativeQuery(bracketSql);
            if ("MIS Executive".equalsIgnoreCase(userRole)) {
                q3.setParameter(1, username);
            }
            List<Object[]> r3 = q3.getResultList();
            
            List<String> bracketOrder = Arrays.asList("Under 5L", "5L - 20L", "20L - 1Cr", "1Cr - 5Cr", "Over 5Cr", "Unspecified");
            for (String bracketName : bracketOrder) {
                long cnt = 0;
                for (Object[] row : r3) {
                    if (bracketName.equalsIgnoreCase((String) row[0])) {
                        cnt = ((Number) row[1]).longValue();
                        break;
                    }
                }
                bracketsList.add(Map.of("bracket", bracketName, "count", cnt));
            }

        } catch (Exception e) {
            e.printStackTrace();
        }

        List<Map<String, Object>> statusRows = new ArrayList<>();
        statusRows.add(Map.of("status", "New", "count", issuedCount, "total_val", valNew));
        statusRows.add(Map.of("status", "Participating", "count", participatingCount, "total_val", valPart));
        statusRows.add(Map.of("status", "Not Participating", "count", notParticipatingCount, "total_val", valNotPart));
        statusRows.add(Map.of("status", "Lapsed", "count", lapsedCount, "total_val", valLapsed));
        statusRows.add(Map.of("status", "Submitted", "count", filedCount, "total_val", valFiled));
        statusRows.add(Map.of("status", "Won", "count", awardedCount, "total_val", valWon));
        statusRows.add(Map.of("status", "Lost", "count", notAwardedCount, "total_val", valLost));
        statusRows.add(Map.of("status", "Missed Deadline", "count", nonSubmissionLossCount, "total_val", valMissedDead));
        Map<String, Object> metrics = new HashMap<>();
        metrics.put("totalEmails", 12);
        metrics.put("totalTenders", totalTenders);
        metrics.put("issuedCount", issuedCount);
        metrics.put("participatingCount", participatingCount);
        metrics.put("notParticipatingCount", notParticipatingCount);
        metrics.put("lapsedCount", lapsedCount);
        metrics.put("t2_3DaysCount", t2_3DaysCount);
        metrics.put("t2TodayCount", t2TodayCount);
        metrics.put("filedCount", filedCount);
        metrics.put("awardedCount", awardedCount);
        metrics.put("notAwardedCount", notAwardedCount);
        metrics.put("nonSubmissionLossCount", nonSubmissionLossCount);
        metrics.put("nonParticipationLossCount", nonParticipationLossCount);
        metrics.put("specTotalCount", specTotalCount);
        metrics.put("specPendingCount", specPendingCount);
        metrics.put("specApprovedCount", specApprovedCount);
        metrics.put("specRejectedCount", specRejectedCount);
        metrics.put("status", statusRows);

        return ResponseEntity.ok(Map.of(
                "success", true,
                "metrics", metrics,
                "deadlines", Collections.emptyList(), // Standard chart placeholder
                "sectors", sectorList,
                "authorities", authorityList,
                "valueBrackets", bracketsList
        ));
    }

    @GetMapping("/executive-performance")
    public ResponseEntity<?> getExecutivePerformance(
            @RequestHeader(value = "x-user-username", required = false, defaultValue = "executive") String username,
            @RequestHeader(value = "x-user-role", required = false, defaultValue = "Tender Executive") String userRole) {

        List<Tender> tenders = ("Admin".equalsIgnoreCase(userRole) || "MIS Team".equalsIgnoreCase(userRole))
                ? tenderRepository.findAll()
                : tenderRepository.findByMisExecutive(username);

        LocalDate today = LocalDate.now();
        LocalDate sevenDaysAgo = today.minusDays(7);
        LocalDate thirtyDaysAgo = today.minusDays(30);
        LocalDate oneYearAgo = today.minusDays(365);

        int filled7Days = 0, filled30Days = 0, filled1Year = 0;
        int won7Days = 0, won30Days = 0, won1Year = 0;
        int lost7Days = 0, lost30Days = 0, lost1Year = 0;

        Map<String, Integer> statusDistribution = new HashMap<>();
        statusDistribution.put("Live", 0);
        statusDistribution.put("Participating", 0);
        statusDistribution.put("Submitted", 0);
        statusDistribution.put("Won", 0);
        statusDistribution.put("Lost", 0);
        statusDistribution.put("Missed", 0);

        for (Tender t : tenders) {
            String status = t.getStatus() != null ? t.getStatus() : "Live";
            statusDistribution.put(status, statusDistribution.getOrDefault(status, 0) + 1);

            LocalDate date = null;
            if (t.getEntryDate() != null && !t.getEntryDate().isEmpty()) {
                try {
                    date = LocalDate.parse(t.getEntryDate().substring(0, 10));
                } catch (Exception ignored) {}
            }
            if (date == null) date = today;

            boolean isSubmitted = "Submitted".equalsIgnoreCase(status) || "Won".equalsIgnoreCase(status) || "Lost".equalsIgnoreCase(status);
            boolean isWon = "Won".equalsIgnoreCase(status);
            boolean isLost = "Lost".equalsIgnoreCase(status);

            if (!date.isBefore(sevenDaysAgo)) {
                if (isSubmitted) filled7Days++;
                if (isWon) won7Days++;
                if (isLost) lost7Days++;
            }
            if (!date.isBefore(thirtyDaysAgo)) {
                if (isSubmitted) filled30Days++;
                if (isWon) won30Days++;
                if (isLost) lost30Days++;
            }
            if (!date.isBefore(oneYearAgo)) {
                if (isSubmitted) filled1Year++;
                if (isWon) won1Year++;
                if (isLost) lost1Year++;
            }
        }

        Map<String, Object> resp = new HashMap<>();
        resp.put("success", true);
        resp.put("username", username);
        resp.put("role", userRole);
        resp.put("timeWindows", Map.of(
            "last7Days", Map.of("filled", filled7Days, "won", won7Days, "lost", lost7Days),
            "last30Days", Map.of("filled", filled30Days, "won", won30Days, "lost", lost30Days),
            "last1Year", Map.of("filled", filled1Year, "won", won1Year, "lost", lost1Year)
        ));
        resp.put("statusDistribution", statusDistribution);

        return ResponseEntity.ok(resp);
    }

    private String resolveTenderStatus(Tender t, String todayIST) {
        boolean hasPassedDueDate = t.getDueDate() != null && t.getDueDate().split(" ")[0].compareTo(todayIST) < 0;

        if ("Awarded".equalsIgnoreCase(t.getStatus())) return "Won";
        if ("Not Awarded".equalsIgnoreCase(t.getStatus())) return "Lost";
        if ("Filed".equalsIgnoreCase(t.getStatus())) return "Submitted";

        if (hasPassedDueDate) {
            if ("Not Participating".equalsIgnoreCase(t.getStatus())) return "Missed Opportunity";
            if ("Issued".equalsIgnoreCase(t.getStatus()) || "Participating".equalsIgnoreCase(t.getStatus()) || t.getStatus() == null) {
                return "Missed Deadline";
            }
        }

        if ("Not Participating".equalsIgnoreCase(t.getStatus())) return "Not Participating";
        if ("Participating".equalsIgnoreCase(t.getStatus())) return "Participating";

        if (t.getPublishDate() != null && !"N/A".equals(t.getPublishDate())) {
            try {
                LocalDate pub = LocalDate.parse(t.getPublishDate());
                long diff = ChronoUnit.DAYS.between(pub, LocalDate.now());
                if (diff > 3) return "Lapsed";
            } catch (Exception e) {}
        }

        return "New";
    }

    private String resolveStatus(Tender t, String todayIST) {
        boolean hasPassedDueDate = t.getDueDate() != null && t.getDueDate().split(" ")[0].compareTo(todayIST) < 0;

        if ("Awarded".equalsIgnoreCase(t.getStatus())) return "Won";
        if ("Not Awarded".equalsIgnoreCase(t.getStatus())) return "Lost";
        if ("Filed".equalsIgnoreCase(t.getStatus())) return "Submitted";

        if (hasPassedDueDate) {
            if ("Not Participating".equalsIgnoreCase(t.getStatus())) return "Missed Opportunity";
            if ("Issued".equalsIgnoreCase(t.getStatus()) || "Participating".equalsIgnoreCase(t.getStatus()) || t.getStatus() == null) {
                return "Missed Deadline";
            }
        }

        if ("Not Participating".equalsIgnoreCase(t.getStatus())) return "Not Participating";
        if ("Participating".equalsIgnoreCase(t.getStatus())) return "Participating";

        if (t.getPublishDate() != null && !"N/A".equals(t.getPublishDate())) {
            try {
                LocalDate pub = LocalDate.parse(t.getPublishDate());
                long diff = ChronoUnit.DAYS.between(pub, LocalDate.now());
                if (diff > 3) return "Lapsed";
            } catch (Exception e) {}
        }

        return "New";
    }
}
