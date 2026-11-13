package com.tenderpocket.repositories;

import com.tenderpocket.models.Tender;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

@Repository
public interface TenderRepository extends JpaRepository<Tender, String> {

    public interface TenderAnalyticsProjection {
        String getId();
        String getStatus();
        Double getEstimatedCost();
        String getDueDate();
        String getScrapedAt();
        String getPublishDate();
        String getAssignedAt();
        String getEntryDate();
        String getMisExecutive();
        String getCurrentStage();
        Double getTpcPurchasePrice();
        Double getMisFinalPrice();
        String getSpecVerificationStatus();
        String getAssignedMisMemberSpec();
        String getPricingRoute();
    }

    @Query("SELECT t.id AS id, t.status AS status, t.estimatedCost AS estimatedCost, " +
           "t.dueDate AS dueDate, t.scrapedAt AS scrapedAt, t.publishDate AS publishDate, " +
           "t.assignedAt AS assignedAt, t.entryDate AS entryDate, t.misExecutive AS misExecutive, t.currentStage AS currentStage, " +
           "t.tpcPurchasePrice AS tpcPurchasePrice, t.misFinalPrice AS misFinalPrice, t.specVerificationStatus AS specVerificationStatus, " +
           "t.assignedMisMemberSpec AS assignedMisMemberSpec, t.pricingRoute AS pricingRoute FROM Tender t")
    List<TenderAnalyticsProjection> findAllForAnalytics();

    @Query("SELECT t.id AS id, t.status AS status, t.estimatedCost AS estimatedCost, " +
           "t.dueDate AS dueDate, t.scrapedAt AS scrapedAt, t.publishDate AS publishDate, " +
           "t.assignedAt AS assignedAt, t.entryDate AS entryDate, t.misExecutive AS misExecutive, t.currentStage AS currentStage, " +
           "t.tpcPurchasePrice AS tpcPurchasePrice, t.misFinalPrice AS misFinalPrice, t.specVerificationStatus AS specVerificationStatus, " +
           "t.assignedMisMemberSpec AS assignedMisMemberSpec, t.pricingRoute AS pricingRoute FROM Tender t WHERE t.misExecutive = :executive")
    List<TenderAnalyticsProjection> findForAnalyticsByExecutive(@Param("executive") String executive);

    @Query("SELECT t.id AS id, t.status AS status, t.estimatedCost AS estimatedCost, " +
           "t.dueDate AS dueDate, t.scrapedAt AS scrapedAt, t.publishDate AS publishDate, " +
           "t.assignedAt AS assignedAt, t.entryDate AS entryDate, t.misExecutive AS misExecutive, t.currentStage AS currentStage, " +
           "t.tpcPurchasePrice AS tpcPurchasePrice, t.misFinalPrice AS misFinalPrice, t.specVerificationStatus AS specVerificationStatus, " +
           "t.assignedMisMemberSpec AS assignedMisMemberSpec, t.pricingRoute AS pricingRoute FROM Tender t " +
           "WHERE LOWER(t.assignedMisMemberSpec) = LOWER(:actor) OR LOWER(t.assignedMisMemberSpec) = 'clearance' " +
           "OR LOWER(t.assignedMisMemberSpec) = 'clearance team' OR UPPER(t.currentStage) = 'SPEC_CLEARANCE'")
    List<TenderAnalyticsProjection> findForAnalyticsBySpecMember(@Param("actor") String actor);
    
    List<Tender> findByMisExecutive(String misExecutive);
    Page<Tender> findByMisExecutive(String misExecutive, Pageable pageable);
    Page<Tender> findByStatus(String status, Pageable pageable);
    Page<Tender> findBySector(String sector, Pageable pageable);
    Page<Tender> findByLocation(String location, Pageable pageable);
    Page<Tender> findBySource(String source, Pageable pageable);

    boolean existsByRefNo(String refNo);
    boolean existsBySourceId(String sourceId);
    Optional<Tender> findFirstByRefNo(String refNo);
    Optional<Tender> findFirstBySourceId(String sourceId);

    List<Tender> findByAssignedMisMemberSpec(String assignedMisMemberSpec);

    @Query("SELECT DISTINCT t.location FROM Tender t WHERE t.location IS NOT NULL AND t.location != '' ORDER BY t.location")
    List<String> findUniqueLocations();

    @Query("SELECT DISTINCT t.location FROM Tender t WHERE t.location IS NOT NULL AND t.location != '' AND t.misExecutive = :executive ORDER BY t.location")
    List<String> findUniqueLocationsByExecutive(String executive);

    @Query("SELECT DISTINCT t.sector FROM Tender t WHERE t.sector IS NOT NULL AND t.sector != '' ORDER BY t.sector")
    List<String> findUniqueSectors();

    @Query("SELECT DISTINCT t.sector FROM Tender t WHERE t.sector IS NOT NULL AND t.sector != '' AND t.misExecutive = :executive ORDER BY t.sector")
    List<String> findUniqueSectorsByExecutive(String executive);

    @Query("SELECT DISTINCT t.location FROM Tender t WHERE t.location IS NOT NULL AND t.location != '' AND t.assignedMisMemberSpec = :specMember ORDER BY t.location")
    List<String> findUniqueLocationsBySpecMember(String specMember);

    @Query("SELECT DISTINCT t.sector FROM Tender t WHERE t.sector IS NOT NULL AND t.sector != '' AND t.assignedMisMemberSpec = :specMember ORDER BY t.sector")
    List<String> findUniqueSectorsBySpecMember(String specMember);

    @Query(value = "SELECT t.mis_executive, sh.to_status, sh.changed_at FROM status_history sh JOIN tenders t ON sh.tender_id = t.id", nativeQuery = true)
    List<Object[]> findStatusHistoryStats();

    /**
     * Tenders the daily mails may need to mention: not closed, not filed, and not past due
     * before {@code fromDate} (an ISO date). Due dates in any other format are kept so the
     * Java side can parse them. Filed tenders whose submission still awaits MIS confirmation
     * are included too. The final decision is made by PendingWorkResolver.
     */
    @Query("SELECT t FROM Tender t WHERE t.submissionStatus = 'Pending' OR ("
            + " (t.status IS NULL OR LOWER(t.status) NOT IN :closedStatuses)"
            + " AND (t.currentStage IS NULL OR UPPER(t.currentStage) NOT IN :closedStages)"
            + " AND (t.dueDate IS NULL OR TRIM(t.dueDate) = '' OR t.dueDate >= :fromDate OR t.dueDate NOT LIKE '2___-__-__%'))")
    List<Tender> findNotificationCandidates(@Param("closedStatuses") List<String> closedStatuses,
                                            @Param("closedStages") List<String> closedStages,
                                            @Param("fromDate") String fromDate);
}
