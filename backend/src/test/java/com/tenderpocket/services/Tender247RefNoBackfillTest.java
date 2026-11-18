package com.tenderpocket.services;

import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class Tender247RefNoBackfillTest {

    private TenderRepository repository;
    private EmailSyncService emailSync;
    private Tender247RefNoBackfill backfill;

    @BeforeEach
    void setUp() {
        repository = mock(TenderRepository.class);
        emailSync = mock(EmailSyncService.class);
        backfill = new Tender247RefNoBackfill();
        ReflectionTestUtils.setField(backfill, "tenderRepository", repository);
        ReflectionTestUtils.setField(backfill, "emailSyncService", emailSync);
        backfill.pauseMs = 0;
    }

    private static Tender tender(String id, String t247Id, String refNo) {
        Tender t = new Tender();
        t.setId(id);
        t.setSourceId(t247Id);
        t.setRefNo(refNo);
        return t;
    }

    @Test
    void fillsMissingIdsAndClassifiesFromThem() {
        when(repository.findTender247WithT247Id()).thenReturn(List.of(
                tender("106080200", "106080200", null),
                tender("106088775", "106088775", "N/A"),
                tender("106000001", "106000001", "2026_MES_1_1")));   // already has one: skipped
        when(emailSync.fetchOrganizationTenderId("106080200")).thenReturn("2026_MES_798138_1");
        when(emailSync.fetchOrganizationTenderId("106088775")).thenReturn("GEM/2026/B/7570015");
        when(repository.fillMissingRefNo(anyString(), anyString(), anyString())).thenReturn(1);

        backfill.run();

        verify(repository).fillMissingRefNo("106080200", "2026_MES_798138_1", "Non GeM");
        verify(repository).fillMissingRefNo("106088775", "GEM/2026/B/7570015", "GeM");
        verify(emailSync, never()).fetchOrganizationTenderId("106000001");
    }

    @Test
    void tendersWithoutANumberOnTender247AreLeftEmpty() {
        when(repository.findTender247WithT247Id()).thenReturn(List.of(tender("1", "48213377", "")));
        when(emailSync.fetchOrganizationTenderId("48213377")).thenReturn(null);

        backfill.run();

        verify(repository, never()).fillMissingRefNo(anyString(), anyString(), anyString());
    }

    @Test
    void stopsAfterRepeatedRequestFailures() {
        List<Tender> many = new ArrayList<>();
        for (int i = 0; i < 25; i++) many.add(tender("t" + i, String.valueOf(1000 + i), null));
        when(repository.findTender247WithT247Id()).thenReturn(many);
        when(emailSync.fetchOrganizationTenderId(anyString())).thenThrow(new RuntimeException("I/O error"));

        backfill.run();

        verify(emailSync, times(10)).fetchOrganizationTenderId(anyString());
        verify(repository, never()).fillMissingRefNo(anyString(), anyString(), anyString());
    }
}
