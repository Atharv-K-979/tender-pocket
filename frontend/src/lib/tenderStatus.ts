/**
 * Centralized Tender Status and Pipeline Stage Resolution Engine (Restructured 7-Step Workflow)
 *
 * Step 1: Executive Assignment (Tender assigned to Tender Executive)
 * Step 2: Technical Specification (Executive generates -> Clearance reviews, edits locally, uploads final spec with All Comply / Deviations)
 * Step 3: Executive Handover & Document Preparation (Tender returns to Executive -> full template bid package generated)
 * Step 4: EMD Payment Gateway (Applicability check -> auto-skips if exempt; otherwise Beneficiary Name & confidential receipt submitted)
 * Step 5: Dual Track (Simultaneous parallel execution: Track A Commercial Pricing + Track B Full Path Document Verification)
 * Step 6: Final Submission (Submit Tender button unlocks ONLY when BOTH Track A & Track B pass)
 * Step 7: Outcome (Won / Lost / Commercial Evaluation)
 *
 * Brochure: after clearance the Brochure Team uploads brochure documents (PDF, Word, Excel or ZIP).
 * It runs alongside Steps 3-7 and never blocks a step. Tenders cleared before the Brochure Team
 * existed have no brochure_status.
 */

export * from './tenderClassification';

export function getTodayISTString(): string {
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-IN', options as any);
  const parts = formatter.formatToParts(new Date());
  const day = parts.find(p => p.type === 'day')?.value || '01';
  const month = parts.find(p => p.type === 'month')?.value || '01';
  const year = parts.find(p => p.type === 'year')?.value || '2026';
  return `${year}-${month}-${day}`;
}

export function isLapsed(publishDateStr: string | null | undefined, todayISTStr: string): boolean {
  if (!publishDateStr || publishDateStr === 'N/A') return false;
  const date = new Date(publishDateStr);
  if (isNaN(date.getTime())) return false;
  
  const today = new Date(todayISTStr + 'T00:00:00+05:30');
  const publishDate = new Date(date);
  publishDate.setHours(0, 0, 0, 0);
  
  const diffTime = today.getTime() - publishDate.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays > 3;
}

export function resolveStatus(t: any, todayIST: string): string {
  if (!t) return 'New';
  const hasPassedDueDate = Boolean(t.due_date && typeof t.due_date === 'string' && t.due_date.trim() !== '' && t.due_date !== 'N/A' && t.due_date < todayIST);

  if (t.status === 'Awarded' || t.status === 'Won') return 'Won';
  if (t.status === 'Not Awarded' || t.status === 'Lost') return 'Lost';
  if (t.status === 'Filed' || t.status === 'Submitted') return 'Submitted';

  if (hasPassedDueDate) {
    if (t.status === 'Not Participating') {
      return 'Missed Opportunity';
    }
    if (t.status === 'Issued' || t.status === 'New' || !t.status) {
      return 'Missed Deadline';
    }
  }

  if (t.status === 'Not Participating') return 'Not Participating';
  if (t.status === 'Participating') return 'Participating';

  if (isLapsed(t.publish_date, todayIST)) {
    return 'Lapsed';
  }
  return 'New';
}

export interface PipelineStep {
  num: number;
  name: string;
  short: string;
}

export const PIPELINE_STEPS: PipelineStep[] = [
  { num: 1, name: 'Executive Assignment', short: 'Assignment' },
  { num: 2, name: 'Technical Specification', short: 'Tech Spec' },
  { num: 3, name: 'Bid Document Prep', short: 'Bid Prep' },
  { num: 4, name: 'EMD Payment Step', short: 'EMD Payment' },
  { num: 5, name: 'Pricing & Verification', short: 'Dual Track' },
  { num: 6, name: 'Final Submission', short: 'Submit Tender' },
  { num: 7, name: 'Outcome', short: 'Outcome' }
];

type BrochureFields = { brochure_status?: string | null; brochureStatus?: string | null } | null | undefined;

/** True while the Brochure Team has been asked for the brochure and has not uploaded it yet. */
export function isBrochurePending(tender: BrochureFields): boolean {
  if (!tender) return false;
  return String(tender.brochure_status || tender.brochureStatus || '').toLowerCase() === 'pending';
}

/** True once the Brochure Team has uploaded the brochure. */
export function isBrochureUploaded(tender: BrochureFields): boolean {
  if (!tender) return false;
  return String(tender.brochure_status || tender.brochureStatus || '').toLowerCase() === 'uploaded';
}

export interface TenderStageDetails {
  stageNumber: number; // 0 to 7
  stageKey: string;
  stageName: string;
  shortStage: string;
  actionTitle: string;
  actionDesc: string;
  statusColor: string;
  badgeBg: string;
  badgeBorder: string;
  needsAction: boolean;
  actionButtonText: string;
  stepCompleted: boolean[]; // Array of 7 booleans for steps 1..7
  currentStepIndex: number; // 0..6
  progressPercent: number; // 0..100
  isWon: boolean;
  isLost: boolean;
  isSubmitted: boolean;
  isDeclined: boolean;
  // Dual-Track metadata
  isDualTrackActive?: boolean;
  isPricingApproved?: boolean;
  isDocsVerified?: boolean;
  canFinalSubmit?: boolean;
  isEmdSkipped?: boolean;
  pricingRoute?: string;
  isRoutingPending?: boolean;
}

export function hasWorkingPathSaved(tender: any): boolean {
  if (!tender) return false;
  const path = tender.working_path || tender.workingPath;
  return Boolean(path && typeof path === 'string' && path.trim() !== '');
}

export function areBidDocsGenerated(tender: any): boolean {
  if (!tender) return false;
  if (hasWorkingPathSaved(tender)) return true;
  const docs = `${tender.downloaded_docs || ''} ${tender.downloadedDocs || ''}`;
  return /bid_documents_/i.test(docs) || /generated bid documents/i.test(docs);
}

/**
 * Robust Canonical Stage Resolver for the Restructured 7-Step Workflow
 */
export function resolveTenderStageDetails(tender: any, userRole?: string | null): TenderStageDetails {
  if (!tender) {
    return {
      stageNumber: 0,
      stageKey: 'NEW_UNREVIEWED',
      stageName: 'Intake: New Assignment',
      shortStage: 'Decision Needed',
      actionTitle: 'Action: Assign Tender Executive',
      actionDesc: 'New tender intake. Assign to a Tender Executive.',
      statusColor: '#f59e0b',
      badgeBg: 'rgba(245, 158, 11, 0.12)',
      badgeBorder: 'rgba(245, 158, 11, 0.3)',
      needsAction: true,
      actionButtonText: 'Assign Executive',
      stepCompleted: [false, false, false, false, false, false, false],
      currentStepIndex: 0,
      progressPercent: 0,
      isWon: false,
      isLost: false,
      isSubmitted: false,
      isDeclined: false
    };
  }

  const role = (userRole || '').trim();
  const isClearanceRole = role === 'Clearance Team' || role === 'Specification Team';
  const isTpcRole = role === 'TPC Team' || role === 'TPC Pricing Team' || role === 'Admin';
  const isMisRole = role === 'MIS Team';
  const isExecutiveRole = role === 'Tender Executive' || role === 'Executive';

  // Terminal State: Won
  const isWon = tender.status === 'Won' || 
    tender.status === 'Awarded' || 
    tender.outcome_status === 'Won' || 
    (tender.current_stage === 'WON' && tender.status !== 'Not Awarded' && tender.status !== 'Lost');

  if (isWon) {
    return {
      stageNumber: 7,
      stageKey: 'WON',
      stageName: 'Won & Awarded',
      shortStage: 'Won / Awarded',
      actionTitle: 'Tender Won & Awarded',
      actionDesc: 'Bid awarded successfully. Contract processing active.',
      statusColor: '#10b981',
      badgeBg: 'rgba(16, 185, 129, 0.12)',
      badgeBorder: 'rgba(16, 185, 129, 0.3)',
      needsAction: false,
      actionButtonText: 'View Award',
      stepCompleted: [true, true, true, true, true, true, true],
      currentStepIndex: 6,
      progressPercent: 100,
      isWon: true,
      isLost: false,
      isSubmitted: true,
      isDeclined: false
    };
  }

  // Terminal State: Lost
  const isLost = tender.status === 'Lost' || 
    tender.status === 'Not Awarded' || 
    tender.outcome_status === 'Lost' || 
    (tender.current_stage === 'LOST' && tender.status !== 'Awarded' && tender.status !== 'Won');

  if (isLost) {
    return {
      stageNumber: 7,
      stageKey: 'LOST',
      stageName: 'Lost / Closed',
      shortStage: 'Lost / Closed',
      actionTitle: 'Tender Lost',
      actionDesc: tender.loss_reason ? `Loss reason: ${tender.loss_reason}` : 'Bid concluded without contract award.',
      statusColor: '#ef4444',
      badgeBg: 'rgba(239, 68, 68, 0.12)',
      badgeBorder: 'rgba(239, 68, 68, 0.3)',
      needsAction: false,
      actionButtonText: 'View Details',
      stepCompleted: [true, true, true, true, true, true, true],
      currentStepIndex: 6,
      progressPercent: 100,
      isWon: false,
      isLost: true,
      isSubmitted: true,
      isDeclined: false
    };
  }

  // Declined (Not Participating)
  if (tender.status === 'Not Participating') {
    return {
      stageNumber: 0,
      stageKey: 'NOT_PARTICIPATING',
      stageName: 'Participation Declined',
      shortStage: 'Not Participating',
      actionTitle: 'Participation Declined',
      actionDesc: 'Tender marked as not participating. You can re-activate anytime.',
      statusColor: '#64748b',
      badgeBg: 'rgba(100, 116, 139, 0.12)',
      badgeBorder: 'rgba(100, 116, 139, 0.3)',
      needsAction: false,
      actionButtonText: 'Re-activate',
      stepCompleted: [false, false, false, false, false, false, false],
      currentStepIndex: 0,
      progressPercent: 0,
      isWon: false,
      isLost: false,
      isSubmitted: false,
      isDeclined: true
    };
  }

  // Portal Submitted State
  const isSubmittedToPortal = tender.status === 'Submitted' || 
    tender.status === 'Filed' || 
    (tender.submission_status === 'Approved' && (!tender.outcome_status || tender.outcome_status === 'Pending')) ||
    (tender.current_stage === 'WIN_LOSS_PENDING' && tender.submission_status === 'Approved');

  // Milestone Progression:
  // Step 1: Executive Assignment
  const hasExecutive = Boolean(tender.mis_executive && tender.mis_executive.trim() !== '');
  const isStep1Done = isSubmittedToPortal || hasExecutive;

  // Step 2: Technical Specification (Generated & Approved by Clearance Team)
  const isSpecApproved = tender.spec_verification_status === 'Approved' || Boolean(tender.final_tech_spec_filename);
  const isStep2Done = isSubmittedToPortal || (isStep1Done && isSpecApproved);

  // Step 3: Bid package. Comes after clearance and before EMD.
  const docsGenerated = areBidDocsGenerated(tender);
  const isPastStep3 = [
    'PAYMENT_APPROVAL', 'EMD_PENDING', 'EMD_PAYMENT', 'EMD_PAYMENT_READY',
    'DUAL_TRACK', 'DUAL_TRACK_ACTIVE', 'TPC_PRICING', 'MIS_PRICING',
    'DOC_VERIFICATION', 'SUBMISSION_READY', 'SUBMISSION_PENDING',
    'SUBMITTED', 'WIN_LOSS_PENDING', 'WON', 'LOST'
  ].includes((tender.current_stage || '').toUpperCase())
    || ['Pending', 'Approved', 'Exempt'].includes(tender.payment_status)
    || ['PENDING', 'APPROVED', 'EXEMPT_SKIPPED'].includes(tender.emd_status)
    || Boolean(tender.emd_beneficiary_name && tender.emd_beneficiary_name.trim() !== '')
    || Boolean(tender.pricing_status === 'Approved')
    || Boolean(tender.verification_status === 'Approved');

  const isStep3Done = isSubmittedToPortal || isPastStep3 || (isStep2Done && docsGenerated && tender.verification_status !== 'Rejected');

  // Step 4: EMD Payment Gateway (Check if exempt -> auto-skip; else check approved)
  const isExplicitlyApplicable = Boolean(
    tender.emd_applicable === true ||
    tender.emd_applicable === 1 ||
    tender.emd_applicable === 'true' ||
    tender.current_stage === 'PAYMENT_APPROVAL' ||
    tender.payment_status === 'Pending' ||
    (tender.emd_beneficiary_name && tender.emd_beneficiary_name.trim() !== '')
  );

  const isEmdExempt = !isExplicitlyApplicable && Boolean(
    tender.emd_applicable === false ||
    tender.emd_applicable === 0 ||
    tender.emd_applicable === 'false' ||
    tender.payment_status === 'Exempt' ||
    tender.emd_status === 'EXEMPT_SKIPPED' ||
    (tender.emd_raw && /exempt|nil|not applicable/i.test(String(tender.emd_raw)))
  );

  const isPastStep4 = [
    'DUAL_TRACK', 'DUAL_TRACK_ACTIVE', 'TPC_PRICING', 'MIS_PRICING',
    'DOC_VERIFICATION', 'SUBMISSION_READY', 'SUBMISSION_PENDING',
    'SUBMITTED', 'WIN_LOSS_PENDING', 'WON', 'LOST'
  ].includes((tender.current_stage || '').toUpperCase())
    || tender.pricing_status === 'Approved'
    || tender.verification_status === 'Approved';

  const isEmdApproved = isEmdExempt || tender.payment_status === 'Approved' || tender.emd_status === 'APPROVED' || isPastStep4;
  const isStep4Done = isSubmittedToPortal || (isStep3Done && isEmdApproved);

  // Step 5: Dual Track (Track A Pricing + Track B Document Verification)
  const isPricingApproved = Boolean(
    tender.pricing_status === 'Approved' ||
    (tender.mis_final_price && Number(tender.mis_final_price) > 0)
  );
  const isDocsVerified = Boolean(tender.verification_status === 'Approved');
  const isDualTrackComplete = isPricingApproved && isDocsVerified;
  const isStep5Done = isSubmittedToPortal || (isStep4Done && isDualTrackComplete);

  // Step 6: Final Submission
  const isStep6Done = isSubmittedToPortal || (isStep5Done && (tender.submission_status === 'Approved' || tender.status === 'Submitted' || tender.status === 'Filed'));

  const stepCompleted = [
    isStep1Done,
    isStep2Done,
    isStep3Done,
    isStep4Done,
    isStep5Done,
    isStep6Done,
    false
  ];

  // Resolve Active Stage in Sequence:

  // If Step 1 is NOT complete (Needs Executive Assignment):
  if (!isStep1Done) {
    return {
      stageNumber: 1,
      stageKey: 'ASSIGNMENT_PENDING',
      stageName: 'Executive Assignment Needed',
      shortStage: 'Assign Exec',
      actionTitle: 'Action: Assign Tender Executive',
      actionDesc: 'New tender intake. Please assign to an Executive to start specification.',
      statusColor: '#f59e0b',
      badgeBg: 'rgba(245, 158, 11, 0.15)',
      badgeBorder: 'rgba(245, 158, 11, 0.35)',
      needsAction: isMisRole,
      actionButtonText: isMisRole ? 'Assign Executive' : 'View Tender',
      stepCompleted,
      currentStepIndex: 0,
      progressPercent: 7,
      isWon: false,
      isLost: false,
      isSubmitted: false,
      isDeclined: false
    };
  }

  // If Step 2 is NOT complete (Tech Specification in Progress):
  if (!isStep2Done) {
    if (tender.spec_verification_status === 'Pending') {
      return {
        stageNumber: 2,
        stageKey: 'SPEC_CLEARANCE_PENDING',
        stageName: 'Spec Clearance Pending',
        shortStage: 'Clearance Pending',
        actionTitle: 'Awaiting Clearance Team Review',
        actionDesc: 'Clearance Team: review, edit locally, upload updated spec & mark All Comply / Deviations.',
        statusColor: '#8b5cf6',
        badgeBg: 'rgba(139, 92, 246, 0.12)',
        badgeBorder: 'rgba(139, 92, 246, 0.3)',
        needsAction: isClearanceRole,
        actionButtonText: isClearanceRole ? 'Review & Comply' : 'View Status',
        stepCompleted,
        currentStepIndex: 1,
        progressPercent: 22,
        isWon: false,
        isLost: false,
        isSubmitted: false,
        isDeclined: false
      };
    }
    return {
      stageNumber: 2,
      stageKey: 'SPEC_GENERATION_PENDING',
      stageName: 'Technical Specs Needed',
      shortStage: 'Generate Specs',
      actionTitle: 'Action: Generate Technical Specification',
      actionDesc: 'Tender assigned. Generate specification sheet and forward to Clearance Team.',
      statusColor: '#3b82f6',
      badgeBg: 'rgba(59, 130, 246, 0.15)',
      badgeBorder: 'rgba(59, 130, 246, 0.35)',
      needsAction: isExecutiveRole,
      actionButtonText: 'Generate Specs',
      stepCompleted,
      currentStepIndex: 1,
      progressPercent: 15,
      isWon: false,
      isLost: false,
      isSubmitted: false,
      isDeclined: false
    };
  }

  // If Step 3 is NOT complete (Executive Bid Preparation):
  if (!isStep3Done) {
    return {
      stageNumber: 3,
      stageKey: 'BID_DOCS_PREP',
      stageName: 'Bid Document Preparation',
      shortStage: 'Prepare Package',
      actionTitle: 'Action: Compile Standard Bid Package',
      actionDesc: 'Technical spec cleared. Executive must prepare standard Annexures & tender forms.',
      statusColor: '#10b981',
      badgeBg: 'rgba(16, 185, 129, 0.15)',
      badgeBorder: 'rgba(16, 185, 129, 0.35)',
      needsAction: isExecutiveRole,
      actionButtonText: 'Compile Bid Package',
      stepCompleted,
      currentStepIndex: 2,
      progressPercent: 35,
      isWon: false,
      isLost: false,
      isSubmitted: false,
      isDeclined: false
    };
  }

  // If Step 4 is NOT complete (EMD Payment Step - Applicable Tenders):
  if (!isStep4Done) {
    if (tender.payment_status === 'Pending' || tender.current_stage === 'PAYMENT_APPROVAL' || tender.current_stage === 'EMD_PENDING') {
      return {
        stageNumber: 4,
        stageKey: 'EMD_APPROVAL_PENDING',
        stageName: 'EMD Approval Pending',
        shortStage: 'EMD Approval',
        actionTitle: 'Awaiting EMD Payment Sign-Off',
        actionDesc: 'EMD details submitted with Beneficiary Name. Awaiting MIS/Finance verification.',
        statusColor: '#f59e0b',
        badgeBg: 'rgba(245, 158, 11, 0.12)',
        badgeBorder: 'rgba(245, 158, 11, 0.3)',
        needsAction: isMisRole,
        actionButtonText: isMisRole ? 'Approve EMD' : 'View EMD',
        stepCompleted,
        currentStepIndex: 3,
        progressPercent: 50,
        isWon: false,
        isLost: false,
        isSubmitted: false,
        isDeclined: false
      };
    }
    return {
      stageNumber: 4,
      stageKey: 'EMD_PAYMENT_READY',
      stageName: 'EMD Payment Needed',
      shortStage: 'Enter EMD',
      actionTitle: 'Action: Enter Beneficiary Name & Payment Proof',
      actionDesc: 'Please submit EMD payment details or attach confidential payment receipt.',
      statusColor: '#ec4899',
      badgeBg: 'rgba(236, 72, 153, 0.15)',
      badgeBorder: 'rgba(236, 72, 153, 0.35)',
      needsAction: isExecutiveRole,
      actionButtonText: 'Submit EMD',
      stepCompleted,
      currentStepIndex: 3,
      progressPercent: 45,
      isWon: false,
      isLost: false,
      isSubmitted: false,
      isDeclined: false
    };
  }

  // If Step 5 is NOT complete (Dual Track: Parallel Pricing & Document Verification):
  if (!isStep5Done) {
    const pricingPending = !isPricingApproved;
    const docsPending = !isDocsVerified;

    const pricingRoute = tender.pricing_route || tender.pricingRoute;
    const isTpcRoute = pricingRoute === 'TPC' || tender.current_stage === 'TPC_PRICING' || tender.track_a_pricing_status === 'TPC_PENDING';
    const isMisRoute = pricingRoute === 'MIS' || tender.current_stage === 'MIS_PRICING' || tender.track_a_pricing_status === 'MIS_PENDING' || Boolean(tender.tpc_purchase_price && Number(tender.tpc_purchase_price) > 0);
    const isRoutingPending = pricingPending && !isTpcRoute && !isMisRoute && (tender.track_a_pricing_status === 'ROUTING_PENDING' || (!pricingRoute && !tender.tpc_purchase_price));

    let stageKey = 'DUAL_TRACK_ACTIVE';
    let stageName = 'Dual Track: Pricing & Verification';
    let shortStage = 'Dual Track';
    let actionTitle = 'Pricing & Verification in Progress';
    let actionDesc = 'Track A (Commercial Quote) & Track B (Folder Audit) are running simultaneously.';
    let needsActionNow = (pricingPending && (isMisRole || isTpcRole)) || (docsPending && isMisRole);
    let actionButtonText = isMisRole ? 'Review Dual Track' : (isTpcRole ? 'Provide TPC Price' : 'View Clearance');

    if (isRoutingPending) {
      stageKey = 'PRICING_ROUTING_PENDING';
      stageName = 'Commercial Pricing Decision';
      shortStage = 'Route Pricing';
      actionTitle = 'Action Required: Select Commercial Pricing Route';
      actionDesc = 'Executive must choose Option 1 (Send tender to TPC Team) or Option 2 (Send tender to MIS Team for pricing).';
      needsActionNow = isExecutiveRole;
      actionButtonText = isExecutiveRole ? 'Select Pricing Route' : 'View Tender';
    } else if (pricingPending && isTpcRoute) {
      stageKey = 'TPC_PRICING';
      stageName = 'TPC Commercial Pricing';
      shortStage = 'TPC Quote';
      actionTitle = 'Awaiting TPC Commercial Quote';
      actionDesc = 'Tender is with TPC Team. TPC will add manufacturer purchase price and forward to MIS member of choice.';
      needsActionNow = isTpcRole || (docsPending && isMisRole);
      actionButtonText = isTpcRole ? 'Provide TPC Price' : 'View Tender';
    } else if (pricingPending && isMisRoute) {
      stageKey = 'MIS_PRICING';
      stageName = 'MIS Commercial Pricing';
      shortStage = 'MIS Quote';
      actionTitle = 'Awaiting MIS Commercial Go-Ahead';
      actionDesc = tender.tpc_purchase_price
        ? `TPC transfer price recorded (₹${Number(tender.tpc_purchase_price).toLocaleString('en-IN')}). Awaiting MIS final price or direct forward to Executive.`
        : 'Tender routed directly to MIS Team for pricing (TPC bypassed). Awaiting MIS quote.';
      needsActionNow = isMisRole;
      actionButtonText = isMisRole ? 'Provide Quote Price' : 'View Tender';
    } else if (!pricingPending && docsPending) {
      stageKey = 'DOC_VERIFICATION';
      stageName = 'Folder Document Audit';
      shortStage = 'Audit Docs';
      actionTitle = 'Awaiting Document Audit';
      actionDesc = 'Track A (Commercial Pricing) Approved ✓. Waiting on Track B (Full Folder Audit).';
      needsActionNow = isMisRole;
      actionButtonText = isMisRole ? 'Audit Documents' : 'View Clearance';
    }

    return {
      stageNumber: 5,
      stageKey,
      stageName,
      shortStage,
      actionTitle,
      actionDesc,
      statusColor: isRoutingPending ? '#a855f7' : '#8b5cf6',
      badgeBg: 'rgba(139, 92, 246, 0.15)',
      badgeBorder: 'rgba(139, 92, 246, 0.35)',
      needsAction: needsActionNow,
      actionButtonText,
      stepCompleted,
      currentStepIndex: 4,
      progressPercent: 68,
      isWon: false,
      isLost: false,
      isSubmitted: false,
      isDeclined: false,
      isDualTrackActive: true,
      isPricingApproved,
      isDocsVerified,
      canFinalSubmit: false,
      isEmdSkipped: isEmdExempt,
      pricingRoute: isTpcRoute ? 'TPC' : (isMisRoute ? 'MIS' : undefined),
      isRoutingPending
    };
  }

  // If Step 6 is NOT complete (Ready for Final Submission):
  if (!isStep6Done) {
    if (tender.submission_status === 'Pending' || tender.current_stage === 'SUBMISSION_PENDING') {
      return {
        stageNumber: 6,
        stageKey: 'SUBMISSION_PENDING',
        stageName: 'Submission Audit',
        shortStage: 'Audit Filing',
        actionTitle: 'Awaiting Filing Verification',
        actionDesc: 'Tender filed on portal. Awaiting MIS Team audit & filing confirmation.',
        statusColor: '#f59e0b',
        badgeBg: 'rgba(245, 158, 11, 0.12)',
        badgeBorder: 'rgba(245, 158, 11, 0.3)',
        needsAction: isMisRole,
        actionButtonText: isMisRole ? 'Audit Filing' : 'View Filing',
        stepCompleted,
        currentStepIndex: 5,
        progressPercent: 88,
        isWon: false,
        isLost: false,
        isSubmitted: false,
        isDeclined: false
      };
    }
    return {
      stageNumber: 6,
      stageKey: 'READY_TO_SUBMIT',
      stageName: 'Ready for Portal Submission',
      shortStage: 'Submit Tender',
      actionTitle: 'Action Required: Submit Tender on Portal',
      actionDesc: 'Dual track passed! Commercial go-ahead and full folder verification are complete.',
      statusColor: '#10b981',
      badgeBg: 'rgba(16, 185, 129, 0.18)',
      badgeBorder: 'rgba(16, 185, 129, 0.4)',
      needsAction: isExecutiveRole,
      actionButtonText: 'Submit on Portal',
      stepCompleted,
      currentStepIndex: 5,
      progressPercent: 85,
      isWon: false,
      isLost: false,
      isSubmitted: false,
      isDeclined: false,
      canFinalSubmit: true,
      isDualTrackActive: false,
      isPricingApproved: true,
      isDocsVerified: true
    };
  }

  // Step 7: Submitted / Under Commercial Evaluation
  return {
    stageNumber: 7,
    stageKey: 'SUBMITTED',
    stageName: 'Bid Submitted',
    shortStage: 'Under Evaluation',
    actionTitle: 'Submitted on Portal',
    actionDesc: 'Bid filed on portal and verified by MIS Team. Awaiting tender outcome.',
    statusColor: '#3b82f6',
    badgeBg: 'rgba(59, 130, 246, 0.12)',
    badgeBorder: 'rgba(59, 130, 246, 0.3)',
    needsAction: false,
    actionButtonText: 'View Submission',
    stepCompleted: [true, true, true, true, true, true, false],
    currentStepIndex: 6,
    progressPercent: 90,
    isWon: false,
    isLost: false,
    isSubmitted: true,
    isDeclined: false
  };
}

export function resolveTenderStageKey(tender: any): string {
  return resolveTenderStageDetails(tender).stageKey;
}
