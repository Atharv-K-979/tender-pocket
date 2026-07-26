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

    // Run synchronization tasks on startup (15s after boot) and every 6 hours
    @Scheduled(initialDelay = 15000, fixedDelay = 21600000)
    public void runStartupSync() {
        System.out.println("[Scheduler] Running automated startup/periodic Tender sync...");
        performSync();
    }

    // Run synchronization tasks daily at 8:00 AM IST
    @Scheduled(cron = "0 0 8 * * *", zone = "Asia/Kolkata")
    public void runDailySync() {
        System.out.println("[Scheduler] Starting daily automated Tender synchronizations at 8:00 AM IST...");
        performSync();
    }

    private void performSync() {
        try {
            // 1. Sync emails from Tender247 (if credentials provided)
            try {
                int emailCount = emailSyncService.syncEmails();
                System.out.println("[Scheduler] Email Sync completed. Imported: " + emailCount);
            } catch (Exception e) {
                System.out.println("[Scheduler] Email sync skipped or failed (check IMAP credentials): " + e.getMessage());
            }

            // 2. Sync GeM portal bids (all active ongoing bids)
            try {
                int gemCount = geMScraperService.syncTenders(true, Collections.emptyList());
                System.out.println("[Scheduler] GeM Sync completed. Imported: " + gemCount);
            } catch (Exception e) {
                String errorMsg = e.getMessage() != null ? e.getMessage() : e.toString();
                System.err.println("[Scheduler] GeM Sync failed: " + errorMsg);
            }

            // 3. Process SLA and deadline warnings and dispatch alerts
            try {
                alertEngineService.checkAndSendAlerts();
                System.out.println("[Scheduler] Alert engine runs completed successfully.");
            } catch (Exception e) {
                System.out.println("[Scheduler] Alert engine skipped or failed: " + e.getMessage());
            }

        } catch (Exception e) {
            System.err.println("[Scheduler] Automated execution encountered an error: " + e.getMessage());
        }
    }
}
