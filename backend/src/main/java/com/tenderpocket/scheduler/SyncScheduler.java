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

    // Run once, 15s after the backend starts. The server is stopped every night (22:00-07:00 IST),
    // so this morning run imports the GeM bids and Tender247 mails that arrived overnight.
    @Scheduled(initialDelay = 15000)
    public void runStartupSync() {
        System.out.println("[Scheduler] Running startup catch-up Tender sync...");
        performSync();
    }

    // Run at fixed times: 8:00 AM, 1:00 PM and 7:00 PM IST. Fixed times replace the old "6 hours after
    // the previous run" chain, whose start time drifted and could fall just before the 22:00 stop.
    // The 7:00 PM run has three hours to finish before the server stops.
    @Scheduled(cron = "0 0 8,13,19 * * *", zone = "Asia/Kolkata")
    public void runDailySync() {
        System.out.println("[Scheduler] Starting scheduled Tender sync (8:00 AM, 1:00 PM, 7:00 PM IST)...");
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

            // 2. Sync GeM portal bids (published in the last 2 days)
            try {
                int gemCount = geMScraperService.syncTenders(false, Collections.emptyList());
                System.out.println("[Scheduler] GeM Sync completed. Imported: " + gemCount);
            } catch (Exception e) {
                String errorMsg = e.getMessage() != null ? e.getMessage() : e.toString();
                System.err.println("[Scheduler] GeM Sync failed: " + errorMsg);
            }

        } catch (Exception e) {
            System.err.println("[Scheduler] Automated execution encountered an error: " + e.getMessage());
        }
    }
}
