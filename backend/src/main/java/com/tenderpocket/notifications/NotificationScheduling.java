package com.tenderpocket.notifications;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.scheduling.support.CronTrigger;
import org.springframework.stereotype.Component;

/**
 * Runs the 9 AM send and the hourly pending-clock refresh on their own thread.
 *
 * The app's other scheduled jobs (the GeM / Tender247 sync, the update check) share Spring's
 * single scheduler thread, and the sync can run for a long time. On that shared thread the
 * mails would wait until the sync finished. A dedicated thread keeps them on time.
 *
 * The schedules are set in code rather than with {@code @Scheduled(cron = ...)} so that a
 * blank or mistyped NOTIFY_CRON falls back to the default instead of stopping the backend.
 */
@Component
public class NotificationScheduling implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(NotificationScheduling.class);

    private final NotificationSettings settings;
    private final DailyDigestService digestService;
    private final PendingClockService clockService;
    private ThreadPoolTaskScheduler scheduler;

    public NotificationScheduling(NotificationSettings settings, DailyDigestService digestService, PendingClockService clockService) {
        this.settings = settings;
        this.digestService = digestService;
        this.clockService = clockService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public synchronized void start() {
        if (scheduler != null) return;
        scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("notify-");
        scheduler.setErrorHandler(t -> log.error("[Notifications] Scheduled task failed: {}", t.getMessage(), t));
        scheduler.setWaitForTasksToCompleteOnShutdown(true);
        scheduler.setAwaitTerminationSeconds(60);
        scheduler.initialize();

        String send = settings.getCron();
        if (send != null) scheduler.schedule(digestService::scheduledRun, new CronTrigger(send, NotificationSettings.IST));
        String clock = settings.getClockCron();
        if (clock != null) scheduler.schedule(clockService::scheduledRefresh, new CronTrigger(clock, NotificationSettings.IST));

        log.info("[Notifications] Daily mails {} at '{}' IST; pending clock refresh at '{}' IST; via {}; own scheduler thread",
                settings.isEnabled() ? "ON" : "OFF (NOTIFY_ENABLED=false)",
                send == null ? "never" : send, clock == null ? "never" : clock,
                settings.getSmtpHost() + ":" + settings.getSmtpPort());
    }

    @Override
    public synchronized void destroy() {
        if (scheduler != null) {
            scheduler.shutdown();
            scheduler = null;
        }
    }
}
