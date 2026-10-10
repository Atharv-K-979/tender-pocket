import { getAuthFromRequest, type AuthInfo } from '@/lib/auth';

export type WorkflowAction = 'viewTenders' | 'uploadSpecs' | 'approveSpecs' | 'setTpcPrice'
  | 'viewTpcPrice' | 'setMisPrice' | 'generateBids' | 'reviewBids' | 'recordPayment'
  | 'recordSubmission' | 'recordOutcome' | 'manageUsers' | 'viewAudit';

export function canonicalRole(role: string | null | undefined): string {
  switch ((role || '').replace(/^ROLE_/i, '').replace(/_/g, ' ').trim().toLowerCase()) {
    case 'admin': return 'Admin';
    case 'executive':
    case 'tender executive': return 'Tender Executive';
    case 'mis':
    case 'misteam':
    case 'mis executive':
    case 'mis team': return 'MIS Team';
    case 'clearance':
    case 'specification':
    case 'specification team':
    case 'clearance team': return 'Clearance Team';
    case 'tpc':
    case 'tpc pricing':
    case 'tpc team':
    case 'tpc pricing team': return 'TPC Pricing Team';
    default: return '';
  }
}

export function canPerform(role: string | null | undefined, action: WorkflowAction): boolean {
  const canonical = canonicalRole(role);
  if (!canonical) return false;
  if (action === 'viewTenders' || action === 'viewAudit' || canonical === 'Admin') return true;
  switch (action) {
    case 'uploadSpecs':
    case 'generateBids': return canonical === 'Tender Executive';
    case 'approveSpecs': return canonical === 'Clearance Team';
    case 'setTpcPrice': return canonical === 'TPC Pricing Team';
    case 'viewTpcPrice': return canonical === 'TPC Pricing Team' || canonical === 'MIS Team';
    case 'setMisPrice': return canonical === 'MIS Team';
    case 'manageUsers': return true;
    case 'reviewBids':
    case 'recordPayment':
    case 'recordSubmission':
    case 'recordOutcome': return canonical === 'MIS Team';
    default: return false;
  }
}

export function workflowActor(request: Request, action: WorkflowAction): AuthInfo | null {
  const auth = getAuthFromRequest(request);
  return auth && canPerform(auth.role, action)
    ? { username: auth.username, role: canonicalRole(auth.role) } : null;
}

export function workflowForbidden(): Response {
  return Response.json({ success: false, error: 'Access denied for this workflow action.' }, { status: 403 });
}

export function reviewAction(stage: string): WorkflowAction | null {
  switch (stage) {
    case 'SPEC_CLEARANCE': return 'approveSpecs';
    case 'TPC_PRICING': return 'setTpcPrice';
    case 'MIS_PRICING': return 'setMisPrice';
    case 'DOC_VERIFICATION': return 'reviewBids';
    case 'PAYMENT_APPROVAL':
    case 'PAYMENT_PENDING': return 'recordPayment';
    case 'SUBMISSION_PENDING': return 'recordSubmission';
    case 'WIN_LOSS_PENDING': return 'recordOutcome';
    default: return null;
  }
}

export function canReviewAssignment(role: string, username: string, assigned: unknown): boolean {
  const canonical = canonicalRole(role);
  if (canonical === 'Admin') return false; // Admin has view-only access in approvals reviews
  if (assigned == null) return true;
  if (typeof assigned !== 'string') return false;
  const value = assigned.toLowerCase();
  if (value === username.toLowerCase()) return true;
  const queues: Record<string, string[]> = {
    'MIS Team': ['misteam', 'mis team', 'mis executive', 'mis'],
    'Clearance Team': ['clearance', 'clearance team', 'specification team', 'specification'],
    'TPC Pricing Team': ['tpc', 'tpc team', 'tpc pricing team', 'tpc pricing'],
  };
  return (queues[canonical] || []).includes(value);
}
export function forbiddenPatchFields(role: string, body: Record<string, unknown>, old: Record<string, unknown>): string[] {
  const denied: string[] = [];
  const canonical = canonicalRole(role);
  if (!canonical) return Object.keys(body);
  if (canonical === 'Admin') {
    const adminRestrictedFields = ['notes', 'mis_executive', 'bid_qty', 'quoted_qty', 'working_path', 'assigned_mis_member', 'assigned_mis_member_spec', 'assigned_mis_member_docs', 'assigned_mis_member_emd', 'assigned_mis_member_submission'];
    for (const f of adminRestrictedFields) {
      if (f in body && body[f] !== old[f]) denied.push(f);
    }
    return denied;
  }

  const isExec = canonical === 'Tender Executive';
  const isMis = canonical === 'MIS Team';

  // EMD details entry fields & submission assignments (editable ONLY by Tender Executive)
  const emdFields = ['emd_amount_actual', 'emd_payment_mode', 'emd_payment_ref', 'emd_payment_date', 'assigned_mis_member_emd', 'assigned_mis_member_submission', 'assigned_mis_member_docs', 'assigned_mis_member', 'working_path'];
  for (const f of emdFields) {
    if (f in body && !isExec) denied.push(f);
  }

  // Pricing fields
  if ('tpc_purchase_price' in body && canonical !== 'TPC Pricing Team') denied.push('tpc_purchase_price');
  if ('mis_final_price' in body && !isMis) denied.push('mis_final_price');

  // Stage status reviews vs submissions
  if ('verification_status' in body) {
    const val = String(body.verification_status);
    if (['Approved', 'Rejected'].includes(val) && !isMis) denied.push('verification_status');
    if (val === 'Pending' && !isExec) denied.push('verification_status');
  }

  if ('payment_status' in body) {
    const val = String(body.payment_status);
    if (['Approved', 'Rejected'].includes(val) && !isMis) denied.push('payment_status');
    if (val === 'Pending' && !isExec) denied.push('payment_status');
  }

  if ('submission_status' in body) {
    const val = String(body.submission_status);
    if (['Approved', 'Rejected'].includes(val) && !isMis) denied.push('submission_status');
    if (val === 'Pending' && !isExec) denied.push('submission_status');
  }

  if (('outcome_status' in body || 'loss_reason' in body) && !isMis) {
    if ('outcome_status' in body) denied.push('outcome_status');
    if ('loss_reason' in body) denied.push('loss_reason');
  }

  if ('spec_verification_status' in body) {
    const action = ['Approved', 'Rejected'].includes(String(body.spec_verification_status))
      ? 'approveSpecs' : 'uploadSpecs';
    if (!canPerform(role, action)) denied.push('spec_verification_status');
  }

  if ('current_stage' in body && body.current_stage !== old.current_stage) {
    const isAllowedStageChange = isExec
      || (canPerform(role, 'approveSpecs') && (old.current_stage === 'SPEC_CLEARANCE' || body.current_stage === 'TPC_PRICING' || body.current_stage === 'SPEC_CLEARANCE'))
      || (canPerform(role, 'setTpcPrice') && (old.current_stage === 'TPC_PRICING' || body.current_stage === 'MIS_PRICING'))
      || (isMis && (old.current_stage === 'MIS_PRICING' || body.current_stage === 'PAYMENT_APPROVAL' || body.current_stage === 'SUBMISSION_PENDING' || body.current_stage === 'WIN_LOSS_PENDING' || body.current_stage === 'WON' || body.current_stage === 'LOST'));
    if (!isAllowedStageChange) {
      denied.push('current_stage');
    }
  }

  if (['Won', 'Lost', 'Awarded', 'Not Awarded', 'Disqualified', 'Missed Opportunity'].includes(String(body.status))
      && !isMis) denied.push('status');
  if (['Submitted', 'Filed'].includes(String(body.status))
      && !isMis && !isExec) denied.push('status');

  return denied;
}

export function redactManufacturerPricing(value: unknown, role: string): unknown {
  if (canPerform(role, 'viewTpcPrice')) return value;
  function redact(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(redact);
    if (!item || typeof item !== 'object') return item;
    const source = item as Record<string, unknown>;
    const tpcNote = source.stage === 'TPC_PRICING' || source.phase === 'TPC_PRICING';
    return Object.fromEntries(Object.entries(source).map(([key, data]) => [
      key, ['tpc_purchase_price', 'tpcPurchasePrice', 'ai_details_summary', 'ai_history_summary',
        'aiDetailsSummary', 'aiHistorySummary'].includes(key) ? null
        : tpcNote && ['comment', 'commentText', 'comment_text'].includes(key)
          ? '[Manufacturer pricing note restricted]' : redact(data),
    ]));
  }
  return redact(value);
}
