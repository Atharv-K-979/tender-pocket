package com.tenderpocket.repositories;

import com.tenderpocket.models.EmailNotificationLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface EmailNotificationLogRepository extends JpaRepository<EmailNotificationLog, Long> {

    boolean existsByRecipientUsernameAndTenderIdAndNotificationTypeAndSentDateAndStatus(
            String recipientUsername, String tenderId, String notificationType, LocalDate sentDate, String status);

    List<EmailNotificationLog> findBySentDate(LocalDate sentDate);

    List<EmailNotificationLog> findByRecipientUsernameAndSentDate(String recipientUsername, LocalDate sentDate);

    List<EmailNotificationLog> findByTenderId(String tenderId);
}
