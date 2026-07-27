package com.tenderpocket.repositories;

import com.tenderpocket.models.Tender;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;

@Repository
public interface TenderRepository extends JpaRepository<Tender, String> {
    
    List<Tender> findByMisExecutive(String misExecutive);
    Page<Tender> findByMisExecutive(String misExecutive, Pageable pageable);
    Page<Tender> findByStatus(String status, Pageable pageable);
    Page<Tender> findBySector(String sector, Pageable pageable);
    Page<Tender> findByLocation(String location, Pageable pageable);
    Page<Tender> findBySource(String source, Pageable pageable);

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
}
