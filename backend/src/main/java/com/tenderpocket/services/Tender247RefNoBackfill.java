package com.tenderpocket.services;

import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.utils.TenderClassifier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Fills the Organization Tender ID (ref_no) of Tender247 tenders saved without one. Tender247 calls used to
 * fail on every request (Java rejected the "_" in t247_api.tender247.com), so those tenders kept an empty
 * ref_no and were all classified Non GeM. Runs in the background after startup, one Tender247 call at a
 * time; tenders that already have a ref_no are skipped, so later startups only retry what is still missing.
 */
@Component
public class Tender247RefNoBackfill {

    private static final int MAX_CONSECUTIVE_FAILURES = 10;

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private EmailSyncService emailSyncService;

    long pauseMs = 500;

    @EventListener(ApplicationReadyEvent.class)
    public void startInBackground() {
        Thread worker = new Thread(this::run, "tender247-refno-backfill");
        worker.setDaemon(true);
        worker.start();
    }

    void run() {
        List<Tender> missing = tenderRepository.findTender247WithT247Id().stream()
                .filter(t -> TenderClassifier.isPlaceholderRefNo(t.getRefNo()) && EmailSyncService.isT247Id(t.getSourceId()))
                .toList();
        if (missing.isEmpty()) return;
        System.out.println("[T247 Backfill] Looking up the Organization Tender ID of " + missing.size() + " Tender247 tender(s)...");

        int filled = 0, notOnTender247 = 0, failed = 0, consecutiveFailures = 0;
        for (Tender tender : missing) {
            String t247Id = tender.getSourceId().trim();
            try {
                String refNo = emailSyncService.fetchOrganizationTenderId(t247Id);
                consecutiveFailures = 0;
                if (refNo == null) {
                    notOnTender247++;
                } else if (tenderRepository.fillMissingRefNo(tender.getId(), refNo, TenderClassifier.classify(refNo)) > 0) {
                    filled++;
                }
            } catch (Exception e) {
                failed++;
                if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    System.out.println("[T247 Backfill] Stopping after " + consecutiveFailures
                            + " failed Tender247 requests in a row; will retry on next startup. Last error: " + e.getMessage());
                    break;
                }
            }
            if (pauseMs > 0) {
                try {
                    Thread.sleep(pauseMs);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        System.out.println(String.format("[T247 Backfill] Done: %d filled, %d without a number on Tender247, %d failed.",
                filled, notOnTender247, failed));
    }
}
