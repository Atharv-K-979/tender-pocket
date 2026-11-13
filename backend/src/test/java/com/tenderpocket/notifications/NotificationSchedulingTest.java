package com.tenderpocket.notifications;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class NotificationSchedulingTest {

    @Test
    void scheduledMailWorkRunsOnItsOwnThreadNotTheSharedOne() throws Exception {
        NotificationSettings settings = new NotificationSettings();
        ReflectionTestUtils.setField(settings, "cron", "-");
        ReflectionTestUtils.setField(settings, "clockCron", "* * * * * *");
        PendingClockService clock = mock(PendingClockService.class);
        CountDownLatch ran = new CountDownLatch(1);
        AtomicReference<String> thread = new AtomicReference<>();
        doAnswer(inv -> { thread.set(Thread.currentThread().getName()); ran.countDown(); return null; })
                .when(clock).scheduledRefresh();

        NotificationScheduling scheduling = new NotificationScheduling(settings, mock(DailyDigestService.class), clock);
        try {
            scheduling.start();
            assertTrue(ran.await(5, TimeUnit.SECONDS), "the refresh ran");
            assertTrue(thread.get().startsWith("notify-"), "ran on " + thread.get());
        } finally {
            scheduling.destroy();
        }
    }
}
