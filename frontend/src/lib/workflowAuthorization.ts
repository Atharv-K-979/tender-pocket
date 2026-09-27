import { getAuthFromRequest, type AuthInfo } from '@/lib/auth';

export type WorkflowAction = 'viewTenders' | 'uploadSpecs' | 'approveSpecs' | 'setTpcPrice'
  | 'viewTpcPrice' | 'setMisPrice' | 'generateBids' | 'reviewBids' | 'recordPayment'
  | 'recordSubmission' | 'recordOutcome' | 'manageUsers' | 'viewAudit';

export function canonicalRole(role: string | null | undefined): string {
  switch ((role || '').replace(/^ROLE_/i, '').replace(/_/g, ' ').trim().toLowerCase()) {
    case 'admin': return 'Admin';
    case 'executive':
    case 'mis executive':
    case 'tender executive': return 'Tender Executive';
    case 'specification team':
    case 'clearance team': return 'Clearance Team';
    case 'tpc team':
    case 'tpc pricing team': return 'TPC Pricing Team';
    case 'mis team': return 'MIS Team';
    default: return '';
  }
}

export function canPerform(role: string | null | undefined, action: WorkflowAction): boolean {
  const canonical = canonicalRole(role);
  if (!canonical) return false;
  if (action === 'viewTenders' || action === 'viewAudit') return true;
  if (canonical === 'Admin') {
    // Admin has view rights across tenders/history/approvals, with the sole edit right for TPC pricing
    return action === 'setTpcPrice' || action === 'viewTpcPrice' || action === 'manageUsers';
  }
  if (canonical === 'MIS Team') {
    // MIS Team has full operational and edit rights across all stages (including all executive tasks)
    return true;
  }
  switch (action) {
    case 'uploadSpecs':
    case 'generateBids': return canonical === 'Tender Executive';
    case 'approveSpecs': return canonical === 'Clearance Team';
    case 'setTpcPrice':
    case 'viewTpcPrice': return canonical === 'TPC Pricing Team';
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
    'MIS Team': ['misteam', 'mis team'],
    'Clearance Team': ['clearance', 'clearance team', 'specification team'],
    'TPC Pricing Team': ['tpc', 'tpc team', 'tpc pricing team'],
  };
  return (queues[canonical] || []).includes(value);
}

export function forbiddenPatchFields(role: string, body: Record<string, unknown>, old: Record<string, unknown>): string[] {
  const denied: string[] = [];
  const canonical = canonicalRole(role);
  const fields: Record<string, WorkflowAction> = {
    tpc_purchase_price: 'setTpcPrice', mis_final_price: 'setMisPrice',
    verification_status: 'reviewBids', payment_status: 'recordPayment',
    emd_amount_actual: 'recordPayment', emd_payment_mode: 'recordPayment',
    emd_payment_ref: 'recordPayment', emd_payment_date: 'recordPayment',
    assigned_mis_member_emd: 'recordPayment', submission_status: 'recordSubmission',
    assigned_mis_member_submission: 'recordSubmission', outcome_status: 'recordOutcome', loss_reason: 'recordOutcome',
  };
  for (const [field, action] of Object.entries(fields)) {
    if (field in body && !canPerform(role, action)) denied.push(field);
  }
  if ('spec_verification_status' in body) {
    const action = ['Approved', 'Rejected'].includes(String(body.spec_verification_status))
      ? 'approveSpecs' : 'uploadSpecs';
    if (!canPerform(role, action)) denied.push('spec_verification_status');
  }
  if ('current_stage' in body && body.current_stage !== old.current_stage) {
    denied.push('current_stage');
  }
  if (canonical === 'Admin') {
    const adminRestrictedFields = ['notes', 'mis_executive', 'bid_qty', 'quoted_qty', 'working_path', 'assigned_mis_member', 'assigned_mis_member_spec', 'assigned_mis_member_docs', 'assigned_mis_member_emd', 'assigned_mis_member_submission', 'mis_final_price'];
    for (const f of adminRestrictedFields) {
      if (f in body && body[f] !== old[f]) denied.push(f);
    }
  }
  if (['Won', 'Lost', 'Awarded', 'Not Awarded', 'Disqualified', 'Missed Opportunity'].includes(String(body.status))
      && !canPerform(role, 'recordOutcome')) denied.push('status');
  if (['Submitted', 'Filed'].includes(String(body.status))
      && !canPerform(role, 'recordSubmission')) denied.push('status');
  if (['Participating', 'Not Participating', 'New', 'Issued', 'Lapsed'].includes(String(body.status))
      && canonical === 'Admin') denied.push('status');
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
