package com.tenderpocket.scheduler;

import com.tenderpocket.services.AlertEngineService;
import com.tenderpocket.services.EmailSyncService;
import com.tenderpocket.services.GeMScraperService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Collections;

@Component
public class SyncScheduler {

    @Autowired
    private EmailSyncService emailSyncService;

    @Autowired
    private GeMScraperService geMScraperService;

    @Autowired
    private AlertEngineService alertEngineService;

    // Run synchronization tasks daily at 8:00 AM IST
    @Scheduled(cron = "0 0 8 * * *", zone = "Asia/Kolkata")
    public void runDailySync() {
        System.out.println("[Scheduler] Starting daily automated Tender synchronizations at 8:00 AM IST...");
        try {
            // 1. Sync emails from Tender247
            int emailCount = emailSyncService.syncEmails();
            System.out.println("[Scheduler] Email Sync completed. Imported: " + emailCount);

            // 2. Sync GeM portal bids (for today only, hence allDates = false)
            int gemCount = geMScraperService.syncTenders(false, Collections.emptyList());
            System.out.println("[Scheduler] GeM Sync completed. Imported: " + gemCount);

            // 3. Process SLA and deadline warnings and dispatch alerts
            alertEngineService.checkAndSendAlerts();
            System.out.println("[Scheduler] Alert engine runs completed successfully.");

        } catch (Exception e) {
            System.err.println("[Scheduler] Automated execution encountered an error: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
