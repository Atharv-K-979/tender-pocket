package com.tenderpocket.repositories;

import com.tenderpocket.models.EmailDigestLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public interface EmailDigestLogRepository extends JpaRepository<EmailDigestLog, Long> {

    Optional<EmailDigestLog> findByRecipientUsernameAndDigestTypeAndSentDate(String recipientUsername, String digestType, LocalDate sentDate);

    List<EmailDigestLog> findBySentDateOrderByIdAsc(LocalDate sentDate);
}
