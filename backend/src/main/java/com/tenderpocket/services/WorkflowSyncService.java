package com.tenderpocket.services;

import com.tenderpocket.models.*;
import com.tenderpocket.repositories.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * WorkflowSyncService
 * The central orchestration engine for the 7-step tender lifecycle.
 * Manages atomic state transitions across Tender, TenderWorkflowState,
 * TenderApprovalRequest, and TenderDocumentManifest.
 */
@Service
public class WorkflowSyncService {

    /** Tender.brochureStatus values. null means no brochure was requested (cleared before the Brochure Team existed). */
    public static final String BROCHURE_PENDING = "Pending";
    public static final String BROCHURE_UPLOADED = "Uploaded";

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private TenderWorkflowStateRepository workflowStateRepository;

    @Autowired
    private TenderApprovalRepository approvalRepository;

    @Autowired
    private TenderFolderScannerService folderScannerService;

    @Autowired
    private TenderCommentRepository commentRepository;

    private String nowIso() {
        return LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
    }

    /**
     * Resolves or synthesizes a TenderWorkflowState for the tender.
     * Backwards-compatible with existing tenders.
     */
    @Transactional
    public TenderWorkflowState getOrCreateState(String tenderId) {
        Optional<TenderWorkflowState> opt = workflowStateRepository.findByTenderId(tenderId);
        if (opt.isPresent()) {
            return opt.get();
        }

        Optional<Tender> tenderOpt = tenderRepository.findById(tenderId);
        if (tenderOpt.isEmpty()) {
            return null;
        }
        Tender t = tenderOpt.get();

        TenderWorkflowState state = new TenderWorkflowState(tenderId);
        state.setAssignedExecutive(t.getMisExecutive());
        state.setAssignedAt(t.getAssignedAt());

        // Derive initial step from legacy fields
        String stage = t.getCurrentStage() != null ? t.getCurrentStage().toUpperCase() : "NEW";
        String status = t.getStatus() != null ? t.getStatus() : "Issued";

        if ("WON".equals(stage) || "Awarded".equalsIgnoreCase(status) || "Won".equalsIgnoreCase(status)) {
            state.setCurrentStep(7);
            state.setStepName("OUTCOME_WON");
            state.setOutcomeStatus("Won");
        } else if ("LOST".equals(stage) || "Not Awarded".equalsIgnoreCase(status) || "Lost".equalsIgnoreCase(status)) {
            state.setCurrentStep(7);
            state.setStepName("OUTCOME_LOST");
            state.setOutcomeStatus("Lost");
            state.setLossReason(t.getLossReason());
        } else if ("SUBMITTED".equals(stage) || "Submitted".equalsIgnoreCase(status) || "Filed".equalsIgnoreCase(status)) {
            state.setCurrentStep(7);
            state.setStepName("SUBMITTED");
        } else if ("SUBMISSION_READY".equals(stage)) {
            state.setCurrentStep(6);
            state.setStepName("SUBMISSION_READY");
            state.setCanFinalSubmit(true);
        } else if ("DOC_VERIFICATION".equals(stage) || "MIS_PRICING".equals(stage) || "TPC_PRICING".equals(stage) || "DUAL_TRACK".equals(stage)) {
            state.setCurrentStep(5);
            state.setStepName("DUAL_TRACK");
            if (t.getPricingRoute() != null) {
                state.setPricingRoute(t.getPricingRoute());
            }
            if (t.getTpcPurchasePrice() != null && t.getTpcPurchasePrice() > 0) {
                state.setTpcPurchasePrice(t.getTpcPurchasePrice());
            }
            if (t.getMisFinalPrice() != null && t.getMisFinalPrice() > 0) {
                state.setTrackAPricingStatus("APPROVED");
                state.setMisFinalPrice(t.getMisFinalPrice());
            } else if ("TPC_PRICING".equalsIgnoreCase(stage) || "TPC".equalsIgnoreCase(t.getPricingRoute())) {
                state.setTrackAPricingStatus("TPC_PENDING");
            } else if ("MIS_PRICING".equalsIgnoreCase(stage) || "MIS".equalsIgnoreCase(t.getPricingRoute())) {
                state.setTrackAPricingStatus("MIS_PENDING");
            } else if (state.getTrackAPricingStatus() == null || "NOT_STARTED".equals(state.getTrackAPricingStatus())) {
                state.setTrackAPricingStatus("ROUTING_PENDING");
            }
            if ("Approved".equalsIgnoreCase(t.getVerificationStatus())) {
                state.setTrackBDocStatus("APPROVED");
            }
        } else if ("PAYMENT_APPROVAL".equals(stage) || "EMD_PENDING".equals(stage) || "EMD_PAYMENT".equals(stage)) {
            state.setCurrentStep(4);
            state.setStepName("EMD_PAYMENT");
        } else if ("BID_DOC_PENDING".equals(stage) || "BID_DOC_GENERATED".equals(stage) || "BID_DOCS_PREPARATION".equals(stage)) {
            state.setCurrentStep(3);
            state.setStepName("BID_DOCS_PREPARATION");
        } else if ("SPEC_CLEARANCE".equals(stage)) {
            state.setCurrentStep(2);
            state.setStepName("SPEC_CLEARANCE");
            state.setSpecStatus("Pending".equalsIgnoreCase(t.getSpecVerificationStatus()) ? "PENDING" : "DRAFT");
        } else {
            state.setCurrentStep(1);
            state.setStepName("EXECUTIVE_ASSIGNMENT");
        }

        // Sync EMD applicability
        boolean isExplicitlyApplicable = Boolean.TRUE.equals(t.getEmdApplicable())
                || "PAYMENT_APPROVAL".equalsIgnoreCase(stage)
                || "EMD_PENDING".equalsIgnoreCase(stage)
                || "Pending".equalsIgnoreCase(t.getPaymentStatus())
                || (t.getEmdBeneficiaryName() != null && !t.getEmdBeneficiaryName().isBlank());

        boolean isExempt = !isExplicitlyApplicable && (
                Boolean.FALSE.equals(t.getEmdApplicable())
                || "Exempt".equalsIgnoreCase(t.getPaymentStatus())
                || (t.getEmdRaw() != null && t.getEmdRaw().toLowerCase().matches(".*(exempt|nil|not applicable).*"))
        );
        if (isExempt) {
            state.setEmdApplicable(false);
            state.setEmdStatus("EXEMPT_SKIPPED");
        }

        return workflowStateRepository.save(state);
    }

    /**
     * Step 1: Assign to Executive -> moves to Step 2 (Tech Spec)
     */
    @Transactional
    public TenderWorkflowState assignExecutive(String tenderId, String executive, String assignedBy) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        String now = nowIso();
        tender.setMisExecutive(executive);
        tender.setAssignedBy(assignedBy);
        tender.setAssignedAt(now);
        if ("Issued".equalsIgnoreCase(tender.getStatus()) || "New".equalsIgnoreCase(tender.getStatus()) || "Lapsed".equalsIgnoreCase(tender.getStatus())) {
            tender.setStatus("Participating");
        }
        tenderRepository.save(tender);

        state.setAssignedExecutive(executive);
        state.setAssignedAt(now);
        if (state.getCurrentStep() <= 1) {
            state.setCurrentStep(2);
            state.setStepName("SPEC_CLEARANCE");
        }
        return workflowStateRepository.save(state);
    }

    /**
     * Step 2: Clearance Upload & Comply / Deviations
     */
    @Transactional
    public TenderWorkflowState recordFinalTechSpec(String tenderId, String filename, String complianceType, String remarks, String clearanceUser) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        String now = nowIso();

        // 1. Update Tender
        tender.setFinalTechSpecFilename(filename);
        tender.setFinalTechSpecUploadedBy(clearanceUser);
        tender.setFinalTechSpecUploadedAt(now);
        tender.setSpecComplianceType(complianceType);
        tender.setSpecVerificationStatus("Approved");

        // 2. Hand the tender back to the executive for EMD (skip EMD when it does not apply)
        state.setFinalTechSpecFilename(filename);
        state.setFinalTechSpecUploadedBy(clearanceUser);
        state.setFinalTechSpecUploadedAt(now);
        state.setSpecComplianceType(complianceType);
        state.setSpecStatus("APPROVED");
        state.setSpecClearanceRemarks(remarks);
        boolean emdExempt = handOffClearedSpecToExecutive(tender, state);
        tenderRepository.save(tender);
        workflowStateRepository.save(state);

        // 3. Mark any pending SPEC_CLEARANCE approvals as approved
        List<TenderApprovalRequest> requests = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.SPEC_CLEARANCE);
        for (TenderApprovalRequest r : requests) {
            if ("PENDING".equalsIgnoreCase(r.getStatus())) {
                r.setStatus("APPROVED");
                r.setUpdatedAt(LocalDateTime.now());
                approvalRepository.save(r);
            }
        }

        // 4. Index final spec in folder scanner
        folderScannerService.scanAndSyncFolder(tenderId);

        if (emdExempt) {
            initiateDualTrack(tenderId, clearanceUser);
        }

        commentRepository.save(new TenderComment(tenderId, "SPEC_CLEARANCE", clearanceUser, "Clearance Team",
                "Final technical specification sealed with " + ("ALL_COMPLY".equalsIgnoreCase(complianceType) ? "All Comply" : "Deviations")
                + ". Tender returned to the Tender Executive to generate the bid package. EMD follows the package."
                + (BROCHURE_PENDING.equalsIgnoreCase(tender.getBrochureStatus())
                    ? " The Brochure Team was asked for the brochure."
                    : "")
                + ("DEVIATIONS".equalsIgnoreCase(complianceType)
                    ? " Replacement PDF, DOCX, and XLSX files are now the specification documents for the rest of this tender."
                    : "")));

        return state;
    }

    /**
     * After clearance the tender goes back to the executive for the bid package, and the Brochure
     * Team is asked for the brochure at the same time (see requestBrochure).
     * Returns true when EMD does not apply and the tender skips ahead.
     */
    public boolean handOffClearedSpecToExecutive(Tender tender, TenderWorkflowState state) {
        tender.setCurrentStage("BID_DOCS_PREPARATION");
        requestBrochure(tender);
        if (state != null) {
            state.setCurrentStep(3);
            state.setStepName("BID_DOCS_PREPARATION");
        }
        return false;
    }

    /**
     * Clearance approved: the Brochure Team is asked for the brochure (brochure_status Pending).
     * The Tender Executive does not wait for it; no step waits for the brochure.
     * A brochure that is already uploaded is kept.
     */
    public static void requestBrochure(Tender tender) {
        if (!BROCHURE_UPLOADED.equalsIgnoreCase(tender.getBrochureStatus())) {
            tender.setBrochureStatus(BROCHURE_PENDING);
        }
    }

    /**
     * Saves a brochure document change (upload, replace, rename, delete) in the tender's comment
     * history. Brochure changes never move the tender to another workflow step.
     */
    public void recordBrochureEvent(String tenderId, String username, String text) {
        commentRepository.save(new TenderComment(tenderId, "BROCHURE_UPLOAD", username, "Brochure Team", text));
    }

    /**
     * Step 3: Complete Bid Docs Prep -> checks EMD Applicability
     */
    @Transactional
    public TenderWorkflowState completeBidDocsPrep(String tenderId, String workingPath, String username) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        String now = nowIso();
        tender.setWorkingPath(workingPath);
        state.setBidPackageStatus("GENERATED");
        state.setBidPackageGeneratedAt(now);

        // Scan folder for generated docs
        folderScannerService.scanAndSyncFolder(tenderId);

        // Applicability check: if explicitly exempt -> auto-skip to Step 5!
        boolean isExplicitlyApplicable = Boolean.TRUE.equals(tender.getEmdApplicable())
                || "PAYMENT_APPROVAL".equalsIgnoreCase(tender.getCurrentStage())
                || "EMD_PENDING".equalsIgnoreCase(tender.getCurrentStage())
                || "Pending".equalsIgnoreCase(tender.getPaymentStatus())
                || (tender.getEmdBeneficiaryName() != null && !tender.getEmdBeneficiaryName().isBlank());

        boolean isExempt = !isExplicitlyApplicable && (
                Boolean.FALSE.equals(tender.getEmdApplicable())
                || "Exempt".equalsIgnoreCase(tender.getPaymentStatus())
                || (tender.getEmdRaw() != null && tender.getEmdRaw().toLowerCase().matches(".*(exempt|nil|not applicable).*"))
        );

        if (isExempt) {
            tender.setPaymentStatus("Approved");
            tender.setCurrentStage("DUAL_TRACK");
            tenderRepository.save(tender);

            state.setEmdApplicable(false);
            state.setEmdStatus("EXEMPT_SKIPPED");
            state.setCurrentStep(5);
            state.setStepName("DUAL_TRACK");
            workflowStateRepository.save(state);

            // Initiate Step 5 Dual-Track approval requests
            initiateDualTrack(tenderId, username);

            commentRepository.save(new TenderComment(tenderId, "BID_DOCS_PREPARATION", username, "Tender Executive",
                    "Bid package prepared. EMD is exempt/₹0 — automatically bypassed to Step 5 Dual Track (Pricing + Verification)."));
        } else {
            tender.setCurrentStage("PAYMENT_APPROVAL");
            tenderRepository.save(tender);

            state.setCurrentStep(4);
            state.setStepName("EMD_PAYMENT");
            state.setEmdStatus("PENDING_INPUT");
            workflowStateRepository.save(state);

            commentRepository.save(new TenderComment(tenderId, "BID_DOCS_PREPARATION", username, "Tender Executive",
                    "Bid package prepared. Submitted for EMD payment details."));
        }

        return state;
    }

    /**
     * Step 4: Toggle EMD Applicability (Executive option)
     */
    @Transactional
    public TenderWorkflowState setEmdApplicability(String tenderId, boolean applicable, String username) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        tender.setEmdApplicable(applicable);
        state.setEmdApplicable(applicable);

        if (!applicable) {
            tender.setPaymentStatus("Approved");
                        tender.setCurrentStage("DUAL_TRACK");
            tenderRepository.save(tender);

            state.setEmdStatus("EXEMPT_SKIPPED");
            state.setCurrentStep(5);
            state.setStepName("DUAL_TRACK");
            workflowStateRepository.save(state);

            initiateDualTrack(tenderId, username);

            commentRepository.save(new TenderComment(tenderId, "EMD_PAYMENT", username, "Tender Executive",
                    "EMD payment marked not required / exempt by Executive. Automatically advanced to Step 5 Dual Track (Pricing + Verification)."));
        } else {
            tender.setPaymentStatus("None");
            tender.setCurrentStage("PAYMENT_APPROVAL");
            tenderRepository.save(tender);

            state.setCurrentStep(4);
            state.setStepName("EMD_PAYMENT");
            state.setEmdStatus("PENDING_INPUT");
            workflowStateRepository.save(state);

            commentRepository.save(new TenderComment(tenderId, "EMD_PAYMENT", username, "Tender Executive",
                    "EMD payment enabled as required for tender by Executive. Awaiting payment details."));
        }
        return state;
    }

    /**
     * Step 4: Submit EMD Details
     */
    @Transactional
    public TenderWorkflowState submitEmdPayment(String tenderId, String beneficiaryName, Double amount, String mode, String receiptPath, boolean confidential, String username) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        String now = nowIso();
        tender.setEmdBeneficiaryName(beneficiaryName);
        tender.setEmdAmountActual(amount);
        tender.setEmdPaymentMode(mode);
        tender.setEmdPaymentRef(beneficiaryName);
        tender.setEmdPaymentDate(now.split("T")[0]);
        tender.setEmdReceiptDocPath(receiptPath);
        tender.setEmdReceiptConfidential(confidential);
        tender.setPaymentStatus("Pending");
        tender.setCurrentStage("PAYMENT_APPROVAL");
        tenderRepository.save(tender);

        state.setEmdBeneficiaryName(beneficiaryName);
        state.setEmdAmount(amount);
        state.setEmdPaymentMode(mode);
        state.setEmdReceiptDocPath(receiptPath);
        state.setEmdReceiptConfidential(confidential);
        state.setEmdStatus("PENDING");
        workflowStateRepository.save(state);

        // Create or patch EMD approval request
        List<TenderApprovalRequest> existing = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.PAYMENT_APPROVAL);
        TenderApprovalRequest req = existing.stream().filter(r -> "PENDING".equalsIgnoreCase(r.getStatus())).findFirst().orElse(null);
        if (req == null) {
            req = new TenderApprovalRequest(tenderId, TenderWorkflowStage.PAYMENT_APPROVAL, username, "misteam", "PENDING");
        }
        req.setEmdAmount(amount);
        req.setTransferMode(mode);
        req.setTransferRefNo(beneficiaryName);
        req.setReceiptFileUrl(receiptPath);
        req.setUpdatedAt(LocalDateTime.now());
        approvalRepository.save(req);

        // Index receipt in folder scanner
        folderScannerService.scanAndSyncFolder(tenderId);

        commentRepository.save(new TenderComment(tenderId, "PAYMENT_APPROVAL", username, "Tender Executive",
                "EMD payment details submitted [Beneficiary: " + beneficiaryName + ", Amount: ₹" + amount + ", Mode: " + mode + "]. Awaiting MIS/Finance approval."));

        return state;
    }

    /**
     * Step 4: Approve EMD -> initiates Step 5 Dual-Track
     */
    @Transactional
    public TenderWorkflowState approveEmdPayment(String tenderId, String reviewer) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        String now = nowIso();
        tender.setPaymentStatus("Approved");
        tender.setCurrentStage("DUAL_TRACK");
        tenderRepository.save(tender);

        state.setEmdStatus("APPROVED");
        state.setEmdApprovedBy(reviewer);
        state.setEmdApprovedAt(now);
        state.setCurrentStep(5);
        state.setStepName("DUAL_TRACK");
        workflowStateRepository.save(state);

        // Resolve pending EMD approval request
        List<TenderApprovalRequest> existing = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.PAYMENT_APPROVAL);
        for (TenderApprovalRequest r : existing) {
            if ("PENDING".equalsIgnoreCase(r.getStatus())) {
                r.setStatus("APPROVED");
                r.setUpdatedAt(LocalDateTime.now());
                approvalRepository.save(r);
            }
        }

        // Spawn Track A & Track B concurrent approval requests
        initiateDualTrack(tenderId, reviewer);

        commentRepository.save(new TenderComment(tenderId, "PAYMENT_APPROVAL", reviewer, "MIS Team",
                "EMD payment approved. Forwarded to Step 5 Dual Track (Commercial Pricing + Document Verification)."));

        return state;
    }

    /**
     * Spawns concurrent approval requests for Track A (Commercial Pricing) and Track B (Document Verification).
     */
    @Transactional
    public void initiateDualTrack(String tenderId, String requestedBy) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        if (state == null) return;
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);

        String currentRoute = state.getPricingRoute();
        if (currentRoute == null && tOpt.isPresent()) {
            currentRoute = tOpt.get().getPricingRoute();
        }

        // Track B: DOC_VERIFICATION
        state.setTrackBDocStatus("PENDING");
        List<TenderApprovalRequest> docReqs = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.DOC_VERIFICATION);
        boolean hasPendingDocs = docReqs.stream().anyMatch(r -> "PENDING".equalsIgnoreCase(r.getStatus()));
        if (!hasPendingDocs) {
            TenderApprovalRequest docReq = new TenderApprovalRequest(tenderId, TenderWorkflowStage.DOC_VERIFICATION, requestedBy, "MIS Team", "PENDING");
            approvalRepository.save(docReq);
        }

        // Track A: Check routing status
        if ("TPC".equalsIgnoreCase(currentRoute)) {
            routePricingToTpc(tenderId, requestedBy);
        } else if ("MIS".equalsIgnoreCase(currentRoute)) {
            routePricingToMis(tenderId, requestedBy, null);
        } else {
            if (state.getMisFinalPrice() != null && state.getMisFinalPrice() > 0) {
                state.setTrackAPricingStatus("APPROVED");
            } else if (state.getTpcPurchasePrice() != null && state.getTpcPurchasePrice() > 0) {
                state.setTrackAPricingStatus("MIS_PENDING");
                routePricingToMis(tenderId, requestedBy, null);
            } else {
                // Wait for Executive routing decision: Option 1 (TPC) vs Option 2 (MIS)
                state.setTrackAPricingStatus("ROUTING_PENDING");
            }
            workflowStateRepository.save(state);
        }
    }

    /**
     * Executive Option 1: Route tender to TPC Team for manufacturer pricing quote
     */
    @Transactional
    public TenderWorkflowState routePricingToTpc(String tenderId, String requestedBy) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        state.setPricingRoute("TPC");
        state.setTrackAPricingStatus("TPC_PENDING");
        tender.setPricingRoute("TPC");
        tender.setCurrentStage("TPC_PRICING");
        tenderRepository.save(tender);
        workflowStateRepository.save(state);

        // Delete any pending MIS_PRICING requests so TPC is first
        List<TenderApprovalRequest> existingMis = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.MIS_PRICING);
        for (TenderApprovalRequest m : existingMis) {
            if ("PENDING".equalsIgnoreCase(m.getStatus())) {
                approvalRepository.delete(m);
            }
        }

        // Create or reuse TPC_PRICING approval request
        List<TenderApprovalRequest> existingTpc = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.TPC_PRICING);
        boolean hasPendingTpc = existingTpc.stream().anyMatch(r -> "PENDING".equalsIgnoreCase(r.getStatus()));
        if (!hasPendingTpc) {
            TenderApprovalRequest tpcReq = new TenderApprovalRequest(tenderId, TenderWorkflowStage.TPC_PRICING, requestedBy, "TPC Team", "PENDING");
            approvalRepository.save(tpcReq);
        }

        commentRepository.save(new TenderComment(tenderId, "TPC_PRICING", requestedBy, "Tender Executive",
                "Executive selected Option 1: Sent tender to TPC Team for commercial pricing quote."));
        return state;
    }

    /**
     * Executive Option 2: Route tender directly to MIS Team for pricing (TPC bypassed)
     */
    @Transactional
    public TenderWorkflowState routePricingToMis(String tenderId, String requestedBy, String misMember) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        state.setPricingRoute("MIS");
        state.setTrackAPricingStatus("MIS_PENDING");
        tender.setPricingRoute("MIS");
        tender.setCurrentStage("MIS_PRICING");
        if (misMember != null && !misMember.isBlank()) {
            tender.setAssignedMisMember(misMember.trim());
        }
        tenderRepository.save(tender);
        workflowStateRepository.save(state);

        // CRITICAL: Delete any pending TPC_PRICING requests so TPC NEVER sees this tender in their queue or system!
        List<TenderApprovalRequest> existingTpc = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.TPC_PRICING);
        for (TenderApprovalRequest t : existingTpc) {
            approvalRepository.delete(t);
        }

        String targetAssignee = (misMember != null && !misMember.isBlank()) ? misMember.trim() :
                (tender.getAssignedMisMember() != null && !tender.getAssignedMisMember().isBlank() ? tender.getAssignedMisMember() : "MIS Team");

        List<TenderApprovalRequest> existingMis = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.MIS_PRICING);
        boolean hasPendingMis = existingMis.stream().anyMatch(r -> "PENDING".equalsIgnoreCase(r.getStatus()));
        if (!hasPendingMis) {
            TenderApprovalRequest misReq = new TenderApprovalRequest(tenderId, TenderWorkflowStage.MIS_PRICING, requestedBy, targetAssignee, "PENDING");
            approvalRepository.save(misReq);
        }

        commentRepository.save(new TenderComment(tenderId, "MIS_PRICING", requestedBy, "Tender Executive",
                "Executive selected Option 2: Sent tender directly to MIS Team for pricing (TPC bypassed)."));
        return state;
    }

    /**
     * TPC Team records manufacturer purchase price and forwards to chosen MIS member
     */
    @Transactional
    public TenderWorkflowState recordTpcPricing(String tenderId, Double tpcPrice, String chosenMisMember, String reviewer) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        tender.setTpcPurchasePrice(tpcPrice);
        if (chosenMisMember != null && !chosenMisMember.isBlank() && !List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(chosenMisMember.trim().toLowerCase())) {
            tender.setAssignedMisMember(chosenMisMember.trim());
        } else if (tender.getAssignedMisMember() != null && List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(tender.getAssignedMisMember().trim().toLowerCase())) {
            tender.setAssignedMisMember(null);
        }
        tender.setCurrentStage("MIS_PRICING");
        tenderRepository.save(tender);

        state.setTpcPurchasePrice(tpcPrice);
        state.setTrackAPricingStatus("MIS_PENDING");
        workflowStateRepository.save(state);

        // Mark TPC approval requests as APPROVED
        List<TenderApprovalRequest> tpcReqs = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.TPC_PRICING);
        for (TenderApprovalRequest req : tpcReqs) {
            if ("PENDING".equalsIgnoreCase(req.getStatus())) {
                req.setStatus("APPROVED");
                req.setTpcPurchasePrice(tpcPrice);
                req.setReviewedBy(reviewer);
                req.setUpdatedAt(LocalDateTime.now());
                approvalRepository.save(req);
            }
        }

        // Create or update MIS_PRICING request assigned to chosen MIS member
        String rawAssignee = (chosenMisMember != null && !chosenMisMember.isBlank() && !List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(chosenMisMember.trim().toLowerCase())) ? chosenMisMember.trim() : tender.getAssignedMisMember();
        String misAssignee = (rawAssignee != null && !rawAssignee.isBlank() && !List.of("tpc", "tpc team", "clearance", "clearance team", "executive").contains(rawAssignee.trim().toLowerCase()))
                ? rawAssignee.trim() : "misteam";

        List<TenderApprovalRequest> existingMis = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.MIS_PRICING);
        TenderApprovalRequest targetMis = null;
        for (TenderApprovalRequest m : existingMis) {
            if ("PENDING".equalsIgnoreCase(m.getStatus())) {
                if (targetMis == null) targetMis = m;
                else approvalRepository.delete(m);
            }
        }

        if (targetMis != null) {
            targetMis.setRequestedBy(reviewer);
            targetMis.setAssignedTo(misAssignee);
            targetMis.setTpcPurchasePrice(tpcPrice);
            targetMis.setStatus("PENDING");
            targetMis.setUpdatedAt(LocalDateTime.now());
            approvalRepository.save(targetMis);
        } else {
            TenderApprovalRequest misReq = new TenderApprovalRequest(tenderId, TenderWorkflowStage.MIS_PRICING, reviewer, misAssignee, "PENDING");
            misReq.setTpcPurchasePrice(tpcPrice);
            approvalRepository.save(misReq);
        }

        commentRepository.save(new TenderComment(tenderId, "TPC_PRICING", reviewer, "TPC Team",
                "TPC Team submitted transfer price (₹" + tpcPrice + ") and forwarded tender to MIS member: " + misAssignee + "."));
        return state;
    }

    /**
     * Step 5 Track A: Commercial Pricing Approved
     */
    @Transactional
    public TenderWorkflowState approveTrackAPricing(String tenderId, Double finalPrice, String reviewer) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        String now = nowIso();
        tender.setMisFinalPrice(finalPrice);
        tender.setPricingStatus("Approved");
        tender.setPricingGoAheadBy(reviewer);
        tender.setPricingGoAheadAt(now);
        tenderRepository.save(tender);

        state.setMisFinalPrice(finalPrice);
        state.setTrackAPricingStatus("APPROVED");
        state.setPricingGoAheadBy(reviewer);
        state.setPricingGoAheadAt(now);
        workflowStateRepository.save(state);

        // Resolve MIS_PRICING approval request
        List<TenderApprovalRequest> pricingReqs = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.MIS_PRICING);
        for (TenderApprovalRequest r : pricingReqs) {
            if ("PENDING".equalsIgnoreCase(r.getStatus())) {
                r.setStatus("APPROVED");
                r.setMisFinalPrice(finalPrice);
                r.setUpdatedAt(LocalDateTime.now());
                approvalRepository.save(r);
            }
        }

        commentRepository.save(new TenderComment(tenderId, "MIS_PRICING", reviewer, "MIS Team",
                "Commercial quote finalized at ₹" + finalPrice + ". Commercial go-ahead granted."));

        // Evaluate barrier
        checkAndUnlockSubmission(tenderId);
        return workflowStateRepository.findByTenderId(tenderId).orElse(state);
    }

    /**
     * Step 5 Track B: Document Verification Approved
     */
    @Transactional
    public TenderWorkflowState approveTrackBDocs(String tenderId, String reviewer, String remarks) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        String now = nowIso();
        tender.setVerificationStatus("Approved");
        tenderRepository.save(tender);

        // Mark all path documents in manifest as verified
        List<TenderDocumentManifest> docs = folderScannerService.verifyAllDocuments(tenderId, reviewer);

        state.setTrackBDocStatus("APPROVED");
        state.setDocsVerifiedBy(reviewer);
        state.setDocsVerifiedAt(now);
        state.setTotalPathDocs(docs.size());
        state.setVerifiedPathDocs(docs.size());
        state.setDocVerificationRemarks(remarks);
        workflowStateRepository.save(state);

        // Resolve DOC_VERIFICATION approval request
        List<TenderApprovalRequest> docReqs = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.DOC_VERIFICATION);
        for (TenderApprovalRequest r : docReqs) {
            if ("PENDING".equalsIgnoreCase(r.getStatus())) {
                r.setStatus("APPROVED");
                r.setUpdatedAt(LocalDateTime.now());
                approvalRepository.save(r);
            }
        }

        commentRepository.save(new TenderComment(tenderId, "DOC_VERIFICATION", reviewer, "MIS Team",
                "Full document verification completed for all " + docs.size() + " files in folder path. Compliance sign-off granted."));

        // Evaluate barrier
        checkAndUnlockSubmission(tenderId);
        return workflowStateRepository.findByTenderId(tenderId).orElse(state);
    }

    /**
     * Step 5 Track B: Document Verification rejected / changes requested.
     * Available as soon as dual track is open, without a separate executive submission.
     */
    @Transactional
    public TenderWorkflowState rejectTrackBDocs(String tenderId, String reviewer, String remarks) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        String note = (remarks == null || remarks.isBlank()) ? "Changes requested on folder documents." : remarks.trim();
        tender.setVerificationStatus("Rejected");
        tender.setCanFinalSubmit(false);
        tenderRepository.save(tender);

        state.setTrackBDocStatus("CHANGES_REQUESTED");
        state.setDocsVerifiedBy(reviewer);
        state.setDocsVerifiedAt(nowIso());
        state.setDocVerificationRemarks(note);
        state.setCanFinalSubmit(false);
        workflowStateRepository.save(state);

        List<TenderApprovalRequest> docReqs = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.DOC_VERIFICATION);
        boolean updatedPending = false;
        for (TenderApprovalRequest r : docReqs) {
            if ("PENDING".equalsIgnoreCase(r.getStatus())) {
                r.setStatus("CHANGES_REQUESTED");
                r.setReviewedBy(reviewer);
                r.setReviewerComment(note);
                r.setUpdatedAt(LocalDateTime.now());
                approvalRepository.save(r);
                updatedPending = true;
            }
        }
        if (!updatedPending) {
            TenderApprovalRequest created = new TenderApprovalRequest(tenderId, TenderWorkflowStage.DOC_VERIFICATION, reviewer, "MIS Team", "CHANGES_REQUESTED");
            created.setReviewedBy(reviewer);
            created.setReviewerComment(note);
            approvalRepository.save(created);
        }

        commentRepository.save(new TenderComment(tenderId, "DOC_VERIFICATION", reviewer, "MIS Team",
                "Document verification changes requested. " + note));
        return workflowStateRepository.findByTenderId(tenderId).orElse(state);
    }

    /**
     * Step 6 Barrier Check: Unlocks Submit Tender button ONLY when both Track A and Track B pass!
     */
    @Transactional
    public boolean checkAndUnlockSubmission(String tenderId) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (state == null || tOpt.isEmpty()) return false;
        Tender tender = tOpt.get();

        boolean trackADone = "APPROVED".equalsIgnoreCase(state.getTrackAPricingStatus());
        boolean trackBDone = "APPROVED".equalsIgnoreCase(state.getTrackBDocStatus());

        if (trackADone && trackBDone) {
            state.setCanFinalSubmit(true);
            state.setCurrentStep(6);
            state.setStepName("SUBMISSION_READY");
            workflowStateRepository.save(state);

            tender.setCanFinalSubmit(true);
            tender.setCurrentStage("SUBMISSION_READY");
            tenderRepository.save(tender);
            return true;
        } else {
            state.setCanFinalSubmit(false);
            workflowStateRepository.save(state);
            tender.setCanFinalSubmit(false);
            tenderRepository.save(tender);
            return false;
        }
    }

    /**
     * Step 6: Executive Submits Tender -> moves to Step 7 (Outcome)
     */
    @Transactional
    public TenderWorkflowState recordFinalSubmission(String tenderId, String username, String ackDocPath) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        String now = nowIso();
        tender.setStatus("Submitted");
        tender.setSubmissionStatus("Approved");
        tender.setCurrentStage("WIN_LOSS_PENDING");
        tenderRepository.save(tender);

        state.setSubmittedBy(username);
        state.setSubmittedAt(now);
        state.setSubmissionAckPath(ackDocPath);
        state.setCurrentStep(7);
        state.setStepName("SUBMITTED");
        state.setOutcomeStatus("PENDING");
        workflowStateRepository.save(state);

        // Spawn outcome approval request
        List<TenderApprovalRequest> existing = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.WIN_LOSS_PENDING);
        if (existing.stream().noneMatch(r -> "PENDING".equalsIgnoreCase(r.getStatus()))) {
            TenderApprovalRequest req = new TenderApprovalRequest(tenderId, TenderWorkflowStage.WIN_LOSS_PENDING, username, "misteam", "PENDING");
            approvalRepository.save(req);
        }

        commentRepository.save(new TenderComment(tenderId, "SUBMISSION_READY", username, "Tender Executive",
                "Tender officially submitted on portal by Executive. Awaiting final outcome evaluation."));

        return state;
    }

    /**
     * Step 7: Record Outcome (Won / Lost)
     */
    @Transactional
    public TenderWorkflowState recordOutcome(String tenderId, String outcome, String lossReason, String username) {
        TenderWorkflowState state = getOrCreateState(tenderId);
        Optional<Tender> tOpt = tenderRepository.findById(tenderId);
        if (tOpt.isEmpty() || state == null) return null;
        Tender tender = tOpt.get();

        boolean isWon = "Won".equalsIgnoreCase(outcome) || "Awarded".equalsIgnoreCase(outcome);
        tender.setStatus(isWon ? "Won" : "Lost");
        tender.setOutcomeStatus(isWon ? "Won" : "Lost");
        tender.setCurrentStage(isWon ? "WON" : "LOST");
        if (!isWon && lossReason != null) {
            tender.setLossReason(lossReason);
        }
        tenderRepository.save(tender);

        state.setOutcomeStatus(isWon ? "Won" : "Lost");
        state.setLossReason(lossReason);
        state.setStepName(isWon ? "OUTCOME_WON" : "OUTCOME_LOST");
        workflowStateRepository.save(state);

        // Resolve outcome approval request
        List<TenderApprovalRequest> existing = approvalRepository.findByTenderIdAndStageOrderByCreatedAtDesc(tenderId, TenderWorkflowStage.WIN_LOSS_PENDING);
        for (TenderApprovalRequest r : existing) {
            if ("PENDING".equalsIgnoreCase(r.getStatus())) {
                r.setStatus("APPROVED");
                r.setUpdatedAt(LocalDateTime.now());
                approvalRepository.save(r);
            }
        }

        commentRepository.save(new TenderComment(tenderId, "WIN_LOSS_PENDING", username, "MIS Team",
                "Tender outcome recorded as " + (isWon ? "Won / Awarded" : "Lost (" + lossReason + ")")));

        return state;
    }
}
