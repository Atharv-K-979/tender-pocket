package com.tenderpocket.services;

import com.tenderpocket.models.Tender;
import com.tenderpocket.models.TenderApprovalRequest;
import com.tenderpocket.models.TenderWorkflowStage;
import com.tenderpocket.repositories.TenderApprovalRepository;
import com.tenderpocket.repositories.TenderRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

/**
 * The approval clean-up must settle: once it has run, running it again must change nothing. When its
 * "close finished requests" rules and its "open missing requests" rules disagree about a tender, it
 * would otherwise close and re-open that tender's request on every run, adding a row each time.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ApprovalReconcileServiceTest {

    @Mock
    private TenderApprovalRepository approvalRepository;

    @Mock
    private TenderRepository tenderRepository;

    @InjectMocks
    private ApprovalReconcileService service;

    /** The approval table, kept in memory. */
    private final List<TenderApprovalRequest> rows = new ArrayList<>();
    private final AtomicLong nextId = new AtomicLong(1);
    /** Every save or delete the clean-up makes. */
    private final AtomicInteger writes = new AtomicInteger();
    private Tender tender;

    @BeforeEach
    void fakeRepositories() {
        when(approvalRepository.findByStatusOrderByCreatedAtDesc(anyString())).thenAnswer(inv ->
                newestFirst(rows.stream().filter(r -> inv.getArgument(0, String.class).equalsIgnoreCase(r.getStatus()))));
        when(approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(anyString(), any())).thenAnswer(inv ->
                newestFirst(rows.stream().filter(r -> r.getTenderId().equals(inv.getArgument(0)) && r.getStage() == inv.getArgument(1))));
        when(approvalRepository.save(any(TenderApprovalRequest.class))).thenAnswer(inv -> {
            TenderApprovalRequest r = inv.getArgument(0);
            if (r.getId() == null) {
                r.setId(nextId.getAndIncrement());
                rows.add(r);
            }
            writes.incrementAndGet();
            return r;
        });
        doAnswer(inv -> {
            rows.remove(inv.<TenderApprovalRequest>getArgument(0));
            writes.incrementAndGet();
            return null;
        }).when(approvalRepository).delete(any(TenderApprovalRequest.class));
        when(tenderRepository.findAllById(any())).thenAnswer(inv -> List.of(tender));
        when(tenderRepository.findAll()).thenAnswer(inv -> List.of(tender));
        when(tenderRepository.save(any(Tender.class))).thenAnswer(inv -> {
            writes.incrementAndGet();
            return inv.getArgument(0);
        });
    }

    @Test
    void winLossTenderWhoseOutcomeWasNeverSetKeepsOnePendingRequestAndAddsNoRows() {
        // The production case: stage WIN_LOSS_PENDING while the outcome still has its starting value "None".
        tender = tender("10004708", "Submitted", "WIN_LOSS_PENDING");
        tender.setOutcomeStatus("None");
        tender.setSubmissionStatus("Approved");
        TenderApprovalRequest pending = request(TenderWorkflowStage.WIN_LOSS_PENDING, "PENDING", "MIS1");

        for (int run = 0; run < 5; run++) {
            service.reconcileStaleAndDuplicateApprovals();
        }

        assertEquals(1, rows.size(), "no new approval rows");
        assertEquals("PENDING", pending.getStatus(), "MIS keeps the one pending win/loss request");
        assertEquals(0, writes.get(), "nothing was written");
    }

    @Test
    void normalWinLossRequestIsOpenedOnceAndClosedWhenTheOutcomeIsRecorded() {
        tender = tender("T-1", "Submitted", "WIN_LOSS_PENDING");
        tender.setOutcomeStatus("Pending");

        service.reconcileStaleAndDuplicateApprovals();
        assertEquals(1, rows.size());
        TenderApprovalRequest pending = rows.get(0);
        assertEquals(TenderWorkflowStage.WIN_LOSS_PENDING, pending.getStage());
        assertEquals("PENDING", pending.getStatus());

        writes.set(0);
        service.reconcileStaleAndDuplicateApprovals();
        assertEquals(0, writes.get(), "a second run changes nothing");

        tender.setOutcomeStatus("Won");
        service.reconcileStaleAndDuplicateApprovals();
        assertEquals("APPROVED", pending.getStatus(), "closed once the outcome is recorded");
        assertEquals(1, rows.size(), "and no new request is opened");
    }

    @Test
    void finishedStepRequestIsStillClosed() {
        // The tender has moved past document verification and nothing asks for it any more: closed as before.
        tender = tender("T-2", "Participating", "SUBMISSION_PENDING");
        tender.setVerificationStatus("Approved");
        tender.setSubmissionStatus("Pending");
        TenderApprovalRequest docs = request(TenderWorkflowStage.DOC_VERIFICATION, "PENDING", "misteam");

        service.reconcileStaleAndDuplicateApprovals();

        assertEquals("APPROVED", docs.getStatus());
    }

    private static final String[] STAGES = {null, "NEW", "EXECUTIVE_ASSIGNMENT", "SPEC_CLEARANCE", "BID_DOCS_PREPARATION",
            "PAYMENT_APPROVAL", "EMD_PENDING", "DUAL_TRACK", "TPC_PRICING", "MIS_PRICING", "DOC_VERIFICATION",
            "SUBMISSION_READY", "SUBMISSION_PENDING", "SUBMITTED", "WIN_LOSS_PENDING", "WON", "LOST"};
    private static final String[] STEP_STATUSES = {null, "None", "Pending", "Approved"};
    private static final String[] PAYMENT_STATUSES = {null, "None", "Pending", "Approved", "Exempt"};
    private static final String[] OUTCOMES = {null, "None", "Pending", "Won", "Lost", "Approved"};
    private static final String[] TENDER_STATUSES = {"Participating", "Submitted", "Won", "Not Participating"};
    private static final String[] ASSIGNEES = {"misteam", "MIS1", "tpc", "executive"};
    private static final TenderWorkflowStage[] REQUEST_STAGES = {TenderWorkflowStage.SPEC_CLEARANCE,
            TenderWorkflowStage.PAYMENT_APPROVAL, TenderWorkflowStage.TPC_PRICING, TenderWorkflowStage.MIS_PRICING,
            TenderWorkflowStage.DOC_VERIFICATION, TenderWorkflowStage.SUBMISSION_PENDING, TenderWorkflowStage.WIN_LOSS_PENDING};

    @Test
    void aSecondRunNeverChangesAnythingWhateverTheTenderState() {
        Random random = new Random(46);
        for (int i = 0; i < 4_000; i++) {
            tender = tender("T-" + i, pick(random, TENDER_STATUSES), pick(random, STAGES));
            tender.setSpecVerificationStatus(pick(random, STEP_STATUSES));
            tender.setPaymentStatus(pick(random, PAYMENT_STATUSES));
            tender.setVerificationStatus(pick(random, STEP_STATUSES));
            tender.setSubmissionStatus(pick(random, STEP_STATUSES));
            tender.setPricingStatus(pick(random, STEP_STATUSES));
            tender.setOutcomeStatus(pick(random, OUTCOMES));
            tender.setTpcPurchasePrice(random.nextBoolean() ? null : 1000.0);
            tender.setMisFinalPrice(random.nextBoolean() ? null : 1200.0);
            tender.setPricingRoute(random.nextInt(4) == 0 ? "MIS" : null);
            rows.clear();
            if (random.nextBoolean()) {
                // Start with a pending request for every step, as an approval queue may hold them.
                for (TenderWorkflowStage stage : REQUEST_STAGES) {
                    request(stage, "PENDING", pick(random, ASSIGNEES));
                }
            }
            String state = describe(tender);

            service.reconcileStaleAndDuplicateApprovals(); // may legitimately open, close or tidy requests
            writes.set(0);
            int rowsAfterFirstRun = rows.size();
            service.reconcileStaleAndDuplicateApprovals();

            assertEquals(0, writes.get(), "the second run changed something for " + state);
            assertEquals(rowsAfterFirstRun, rows.size(), "the second run added rows for " + state);
        }
    }

    private Tender tender(String id, String status, String stage) {
        Tender t = new Tender();
        t.setId(id);
        t.setStatus(status);
        t.setCurrentStage(stage);
        t.setMisExecutive("EXECUTIVE_7");
        t.setAssignedMisMember("MIS1");
        return t;
    }

    private TenderApprovalRequest request(TenderWorkflowStage stage, String status, String assignedTo) {
        TenderApprovalRequest r = new TenderApprovalRequest(tender.getId(), stage, "EXECUTIVE_7", assignedTo, status);
        r.setId(nextId.getAndIncrement());
        r.setCreatedAt(LocalDateTime.now().minusDays(1));
        rows.add(r);
        return r;
    }

    private static List<TenderApprovalRequest> newestFirst(Stream<TenderApprovalRequest> requests) {
        return requests.sorted(Comparator.comparing(TenderApprovalRequest::getCreatedAt, Comparator.nullsFirst(Comparator.<LocalDateTime>naturalOrder()))
                        .thenComparing(r -> r.getId() == null ? 0L : r.getId())
                        .reversed())
                .collect(Collectors.toList());
    }

    private static String pick(Random random, String[] values) {
        return values[random.nextInt(values.length)];
    }

    private static String describe(Tender t) {
        return "status=" + t.getStatus() + ", stage=" + t.getCurrentStage() + ", spec=" + t.getSpecVerificationStatus()
                + ", payment=" + t.getPaymentStatus() + ", verification=" + t.getVerificationStatus()
                + ", submission=" + t.getSubmissionStatus() + ", pricing=" + t.getPricingStatus()
                + ", outcome=" + t.getOutcomeStatus() + ", tpcPrice=" + t.getTpcPurchasePrice()
                + ", misPrice=" + t.getMisFinalPrice() + ", route=" + t.getPricingRoute();
    }
}
