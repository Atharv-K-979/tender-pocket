import db from '@/lib/db';

/**
 * Reconciles the tender_approval_requests table with current tender workflow states.
 * Ensures that any tender requiring approval across any stage (Spec Clearance,
 * TPC Pricing, MIS Pricing, EMD Payment, Document Verification, Submission Audit, Win/Loss Outcome)
 * is immediately visible in the Approvals Center.
 */
export function reconcileApprovalRequests(): void {
  try {
    const now = new Date().toISOString();

    // 0. Deduplicate: if multiple PENDING rows exist for the same (tender_id, stage), keep only the newest one (highest id)
    db.prepare(`
      DELETE FROM tender_approval_requests
      WHERE status = 'PENDING'
        AND id NOT IN (
          SELECT MAX(id)
          FROM tender_approval_requests
          WHERE status = 'PENDING'
          GROUP BY tender_id, stage
        )
    `).run();

    // 0.1 Heal downstream statuses and delete premature approval requests if prerequisite stages are incomplete
    db.prepare(`
      UPDATE tenders
      SET payment_status = 'None',
          submission_status = 'None'
      WHERE verification_status != 'Approved'
        AND (status IS NULL OR status NOT IN ('Won', 'Lost', 'Awarded', 'Not Awarded', 'Submitted', 'Filed'))
        AND (payment_status IN ('Approved', 'Pending') OR submission_status IN ('Approved', 'Pending'))
    `).run();

    db.prepare(`
      UPDATE tenders
      SET submission_status = 'None'
      WHERE payment_status != 'Approved'
        AND (status IS NULL OR status NOT IN ('Won', 'Lost', 'Awarded', 'Not Awarded', 'Submitted', 'Filed'))
        AND submission_status IN ('Approved', 'Pending')
    `).run();

    // Clean up orphaned / premature approval requests
    db.prepare(`
      DELETE FROM tender_approval_requests
      WHERE status = 'PENDING'
        AND stage IN ('PAYMENT_APPROVAL', 'SUBMISSION_PENDING', 'WIN_LOSS_PENDING')
        AND tender_id IN (
          SELECT id FROM tenders
          WHERE verification_status != 'Approved'
            AND (status IS NULL OR status NOT IN ('Won', 'Lost', 'Awarded', 'Not Awarded', 'Submitted', 'Filed'))
        )
    `).run();

    db.prepare(`
      DELETE FROM tender_approval_requests
      WHERE status = 'PENDING'
        AND stage IN ('SUBMISSION_PENDING', 'WIN_LOSS_PENDING')
        AND tender_id IN (
          SELECT id FROM tenders
          WHERE payment_status != 'Approved'
            AND (status IS NULL OR status NOT IN ('Won', 'Lost', 'Awarded', 'Not Awarded', 'Submitted', 'Filed'))
        )
    `).run();

    // 1. Spec Clearance (Executive submitted for clearance)
    const pendingSpecs = db.prepare(`
      SELECT id, mis_executive, assigned_mis_member_spec 
      FROM tenders 
      WHERE spec_verification_status = 'Pending' OR current_stage = 'SPEC_CLEARANCE'
    `).all() as any[];

    for (const t of pendingSpecs) {
      const exists = db.prepare("SELECT id FROM tender_approval_requests WHERE tender_id = ? AND stage = 'SPEC_CLEARANCE' AND status = 'PENDING'").get(t.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, status, created_at, updated_at)
          VALUES (?, 'SPEC_CLEARANCE', ?, ?, 'PENDING', ?, ?)
        `).run(t.id, t.mis_executive || 'executive', t.assigned_mis_member_spec || 'clearance', now, now);
      }
    }

    // 2. TPC Pricing (Clearance approved -> Awaiting manufacturer price)
    const pendingTpc = db.prepare(`
      SELECT id, mis_executive 
      FROM tenders 
      WHERE current_stage = 'TPC_PRICING'
        AND (tpc_purchase_price IS NULL OR tpc_purchase_price = 0)
        AND (status IS NULL OR status NOT IN ('Won', 'Lost', 'Awarded', 'Not Awarded', 'Not Participating', 'Submitted', 'Filed'))
    `).all() as any[];

    for (const t of pendingTpc) {
      const exists = db.prepare("SELECT id FROM tender_approval_requests WHERE tender_id = ? AND stage = 'TPC_PRICING' AND status = 'PENDING'").get(t.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, status, created_at, updated_at)
          VALUES (?, 'TPC_PRICING', 'clearance', 'tpc', 'PENDING', ?, ?)
        `).run(t.id, now, now);
      }
    }

    // 3. MIS Pricing (TPC price submitted -> Awaiting MIS final price)
    const pendingMis = db.prepare(`
      SELECT id, tpc_purchase_price, assigned_mis_member 
      FROM tenders 
      WHERE current_stage = 'MIS_PRICING'
        AND (mis_final_price IS NULL OR mis_final_price = 0)
        AND (status IS NULL OR status NOT IN ('Won', 'Lost', 'Awarded', 'Not Awarded', 'Not Participating', 'Submitted', 'Filed'))
    `).all() as any[];

    for (const t of pendingMis) {
      const exists = db.prepare("SELECT id FROM tender_approval_requests WHERE tender_id = ? AND stage = 'MIS_PRICING' AND status = 'PENDING'").get(t.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, tpc_purchase_price, status, created_at, updated_at)
          VALUES (?, 'MIS_PRICING', 'tpc', ?, ?, 'PENDING', ?, ?)
        `).run(t.id, t.assigned_mis_member || 'misteam', t.tpc_purchase_price || null, now, now);
      }
    }

    // 4. Document Verification (Review requested)
    const pendingDoc = db.prepare(`
      SELECT id, mis_executive, assigned_mis_member, working_path 
      FROM tenders 
      WHERE verification_status = 'Pending'
    `).all() as any[];

    for (const t of pendingDoc) {
      const exists = db.prepare("SELECT id FROM tender_approval_requests WHERE tender_id = ? AND stage = 'DOC_VERIFICATION' AND status = 'PENDING'").get(t.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, working_path, status, created_at, updated_at)
          VALUES (?, 'DOC_VERIFICATION', ?, ?, ?, 'PENDING', ?, ?)
        `).run(t.id, t.mis_executive || 'executive', t.assigned_mis_member || 'misteam', t.working_path || null, now, now);
      }
    }

    // 5. Payment Approval (EMD payment request submitted, docs approved)
    const pendingPayment = db.prepare(`
      SELECT id, mis_executive, assigned_mis_member, emd_amount_actual, emd_payment_mode, emd_payment_ref 
      FROM tenders 
      WHERE payment_status = 'Pending' AND verification_status = 'Approved'
    `).all() as any[];

    for (const t of pendingPayment) {
      const exists = db.prepare("SELECT id FROM tender_approval_requests WHERE tender_id = ? AND stage = 'PAYMENT_APPROVAL' AND status = 'PENDING'").get(t.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, emd_amount, transfer_mode, transfer_ref_no, status, created_at, updated_at)
          VALUES (?, 'PAYMENT_APPROVAL', ?, ?, ?, ?, ?, 'PENDING', ?, ?)
        `).run(t.id, t.mis_executive || 'executive', t.assigned_mis_member || 'misteam', t.emd_amount_actual || null, t.emd_payment_mode || null, t.emd_payment_ref || null, now, now);
      }
    }

    // 6. Submission Audit (Bid filing audit requested, payment approved)
    const pendingSub = db.prepare(`
      SELECT id, mis_executive, assigned_mis_member, assigned_mis_member_submission 
      FROM tenders 
      WHERE submission_status = 'Pending' AND payment_status = 'Approved'
    `).all() as any[];

    for (const t of pendingSub) {
      const exists = db.prepare("SELECT id FROM tender_approval_requests WHERE tender_id = ? AND stage = 'SUBMISSION_PENDING' AND status = 'PENDING'").get(t.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, status, created_at, updated_at)
          VALUES (?, 'SUBMISSION_PENDING', ?, ?, 'PENDING', ?, ?)
        `).run(t.id, t.mis_executive || 'executive', t.assigned_mis_member_submission || t.assigned_mis_member || 'misteam', now, now);
      }
    }

    // Auto-advance tenders whose submission is approved to outcome verification pending
    db.prepare(`
      UPDATE tenders 
      SET outcome_status = 'Pending', current_stage = 'WIN_LOSS_PENDING'
      WHERE submission_status = 'Approved' 
        AND (outcome_status IS NULL OR outcome_status = 'None')
        AND (status IS NULL OR status NOT IN ('Won', 'Lost', 'Awarded', 'Not Awarded'))
    `).run();

    // Auto-resolve current_stage and outcome_status for finalized tenders
    db.prepare(`
      UPDATE tenders 
      SET current_stage = 'WON', outcome_status = 'Won' 
      WHERE (status = 'Awarded' OR status = 'Won') AND (current_stage != 'WON' OR outcome_status != 'Won')
    `).run();

    db.prepare(`
      UPDATE tenders 
      SET current_stage = 'LOST', outcome_status = 'Lost' 
      WHERE (status = 'Not Awarded' OR status = 'Lost') AND (current_stage != 'LOST' OR outcome_status != 'Lost')
    `).run();

    // 7. Outcome Pending (Win/Loss outcome audit requested)
    const pendingOutcome = db.prepare(`
      SELECT id, mis_executive, assigned_mis_member, assigned_mis_member_submission, loss_reason 
      FROM tenders 
      WHERE (outcome_status = 'Pending' OR current_stage = 'WIN_LOSS_PENDING')
        AND (status IS NULL OR status NOT IN ('Won', 'Lost', 'Awarded', 'Not Awarded'))
        AND (outcome_status IS NULL OR outcome_status NOT IN ('Won', 'Lost', 'Approved', 'Rejected'))
        AND (current_stage IS NULL OR current_stage NOT IN ('WON', 'LOST'))
    `).all() as any[];

    for (const t of pendingOutcome) {
      const exists = db.prepare("SELECT id FROM tender_approval_requests WHERE tender_id = ? AND stage = 'WIN_LOSS_PENDING' AND status = 'PENDING'").get(t.id);
      if (!exists) {
        db.prepare(`
          INSERT INTO tender_approval_requests (tender_id, stage, requested_by, assigned_to, loss_reason_executive, status, created_at, updated_at)
          VALUES (?, 'WIN_LOSS_PENDING', ?, ?, ?, 'PENDING', ?, ?)
        `).run(t.id, t.mis_executive || 'executive', t.assigned_mis_member || t.assigned_mis_member_submission || 'misteam', t.loss_reason || null, now, now);
      }
    }

    // Automatically resolve stale approval requests if tender has transitioned beyond that stage
    db.prepare(`
      UPDATE tender_approval_requests 
      SET status = 'APPROVED', updated_at = ? 
      WHERE status = 'PENDING' AND stage = 'SPEC_CLEARANCE' 
        AND tender_id IN (
          SELECT id FROM tenders 
          WHERE spec_verification_status = 'Approved'
        )
    `).run(now);

    db.prepare(`
      UPDATE tender_approval_requests 
      SET status = 'APPROVED', updated_at = ? 
      WHERE status = 'PENDING' AND stage = 'TPC_PRICING' 
        AND tender_id IN (
          SELECT id FROM tenders 
          WHERE (tpc_purchase_price IS NOT NULL AND tpc_purchase_price > 0)
             OR (mis_final_price IS NOT NULL AND mis_final_price > 0)
        )
    `).run(now);

    db.prepare(`
      UPDATE tender_approval_requests 
      SET status = 'APPROVED', updated_at = ? 
      WHERE status = 'PENDING' AND stage = 'MIS_PRICING' 
        AND tender_id IN (
          SELECT id FROM tenders 
          WHERE mis_final_price IS NOT NULL AND mis_final_price > 0
        )
    `).run(now);

    db.prepare(`
      UPDATE tender_approval_requests 
      SET status = 'APPROVED', updated_at = ? 
      WHERE status = 'PENDING' AND stage = 'DOC_VERIFICATION' 
        AND tender_id IN (
          SELECT id FROM tenders 
          WHERE verification_status = 'Approved'
        )
    `).run(now);

    db.prepare(`
      UPDATE tender_approval_requests 
      SET status = 'APPROVED', updated_at = ? 
      WHERE status = 'PENDING' AND stage = 'PAYMENT_APPROVAL' 
        AND tender_id IN (
          SELECT id FROM tenders 
          WHERE payment_status = 'Approved'
        )
    `).run(now);

    db.prepare(`
      UPDATE tender_approval_requests 
      SET status = 'APPROVED', updated_at = ? 
      WHERE status = 'PENDING' AND stage = 'SUBMISSION_PENDING' 
        AND tender_id IN (
          SELECT id FROM tenders 
          WHERE submission_status = 'Approved'
             OR status IN ('Submitted', 'Filed', 'Won', 'Lost', 'Awarded', 'Not Awarded')
        )
    `).run(now);

    db.prepare(`
      UPDATE tender_approval_requests 
      SET status = 'APPROVED', updated_at = ? 
      WHERE status = 'PENDING' AND stage = 'WIN_LOSS_PENDING' 
        AND tender_id IN (
          SELECT id FROM tenders 
          WHERE outcome_status IN ('Won', 'Lost', 'Approved', 'Rejected')
             OR current_stage IN ('WON', 'LOST')
             OR status IN ('Won', 'Lost', 'Awarded', 'Not Awarded')
        )
    `).run(now);

  } catch (err) {
    console.error('[approvalsSync] Error during reconciliation:', err);
  }
}