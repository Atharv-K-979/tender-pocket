import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { workflowActor, workflowForbidden } from '@/lib/workflowAuthorization';
import { getTodayISTString, isLapsed, resolveStatus } from '@/lib/tenderStatus';

export async function GET(request: Request) {
  try {
    const auth = workflowActor(request, 'viewTenders');
    if (!auth) return workflowForbidden();
    const userRole = auth.role;
    const username = auth.username;

    // 1. Get IST date variables
    const todayISTString = getTodayISTString();

    // Load all tenders to classify in JS (filtered by executive if applicable)
    let rawTenders: any[];
    if (userRole === 'MIS Executive' || userRole === 'Tender Executive') {
      rawTenders = db.prepare('SELECT status, estimated_cost, publish_date, due_date, authority, sector, spec_verification_status, current_stage, tpc_purchase_price, mis_final_price FROM tenders WHERE mis_executive = ?').all(username) as any[];
    } else if (userRole === 'Clearance Team' || userRole === 'Specification Team') {
      rawTenders = db.prepare("SELECT status, estimated_cost, publish_date, due_date, authority, sector, spec_verification_status, current_stage, tpc_purchase_price, mis_final_price FROM tenders WHERE assigned_mis_member_spec = ? OR assigned_mis_member_spec = 'clearance' OR assigned_mis_member_spec = 'Clearance Team' OR current_stage = 'SPEC_CLEARANCE'").all(username) as any[];
    } else if (userRole === 'TPC Team' || userRole === 'TPC Pricing Team') {
      rawTenders = db.prepare("SELECT status, estimated_cost, publish_date, due_date, authority, sector, spec_verification_status, current_stage, tpc_purchase_price, mis_final_price FROM tenders WHERE current_stage = 'TPC_PRICING' OR tpc_purchase_price IS NOT NULL").all() as any[];
    } else {
      rawTenders = db.prepare('SELECT status, estimated_cost, publish_date, due_date, authority, sector, spec_verification_status, current_stage, tpc_purchase_price, mis_final_price FROM tenders').all() as any[];
    }

    // Calculate metrics
    let issuedCount = 0;
    let participatingCount = 0;
    let notParticipatingCount = 0;
    let lapsedCount = 0;
    let filedCount = 0;
    let awardedCount = 0;
    let notAwardedCount = 0;
    let nonSubmissionLossCount = 0;
    let nonParticipationLossCount = 0;

    let specPendingCount = 0;
    let specApprovedCount = 0;
    let specRejectedCount = 0;
    let specTotalCount = rawTenders.length;

    let tpcTotalCount = rawTenders.length;
    let tpcPendingCount = 0;
    let tpcApprovedCount = 0;
    let tpcRejectedCount = 0;

    let t2TodayCount = 0;
    let t2_3DaysCount = 0;

    const statusCounts: Record<string, { count: number; total_val: number }> = {};
    const validStatuses = [
      'New', 'Participating', 'Not Participating', 'Lapsed',
      'Submitted', 'Won', 'Lost', 
      'Missed Deadline', 'Missed Opportunity'
    ];
    validStatuses.forEach(s => {
      statusCounts[s] = { count: 0, total_val: 0 };
    });

    const parsedToday = new Date(todayISTString + 'T00:00:00+05:30');
    const threeDaysLater = new Date(parsedToday);
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);

    rawTenders.forEach(t => {
      const status = resolveStatus(t, todayISTString);
      const cost = t.estimated_cost || 0;

      if (t.spec_verification_status === 'Pending') specPendingCount++;
      else if (t.spec_verification_status === 'Approved') specApprovedCount++;
      else if (t.spec_verification_status === 'Rejected') specRejectedCount++;

      // TPC counters
      if (t.status === 'Rejected' || t.current_stage === 'REJECTED_TPC') {
        tpcRejectedCount++;
      } else if (t.current_stage === 'TPC_PRICING' && (!t.tpc_purchase_price || t.tpc_purchase_price === 0)) {
        tpcPendingCount++;
      } else if (t.tpc_purchase_price && t.tpc_purchase_price > 0) {
        tpcApprovedCount++;
      }

      // Status aggregation
      if (statusCounts[status]) {
        statusCounts[status].count++;
        statusCounts[status].total_val += cost;
      }

      // Specific counts
      if (status === 'New') issuedCount++;
      else if (status === 'Participating') participatingCount++;
      else if (status === 'Not Participating') notParticipatingCount++;
      else if (status === 'Lapsed') lapsedCount++;
      else if (status === 'Submitted') filedCount++;
      else if (status === 'Won') awardedCount++;
      else if (status === 'Lost') notAwardedCount++;
      else if (status === 'Missed Deadline') nonSubmissionLossCount++;
      else if (status === 'Missed Opportunity') nonParticipationLossCount++;

      // Deadline calculations
      if (t.due_date) {
        const dueDate = new Date(t.due_date + 'T00:00:00+05:30');
        if (!isNaN(dueDate.getTime())) {
          // T2 today: status must be active/unreviewed (Issued, Lapsed, Participating)
          if (t.due_date === todayISTString) {
            if (status === 'New' || status === 'Lapsed' || status === 'Participating') {
              t2TodayCount++;
            }
          }
          // T2-3 days: status must be active/unreviewed (Issued, Lapsed, Participating)
          if (dueDate > parsedToday && dueDate <= threeDaysLater) {
            if (status === 'New' || status === 'Lapsed' || status === 'Participating') {
              t2_3DaysCount++;
            }
          }
        }
      }
    });

    const totalTenders = issuedCount + participatingCount + notParticipatingCount + lapsedCount + filedCount + awardedCount + notAwardedCount + nonSubmissionLossCount + nonParticipationLossCount;

    const statusRows = Object.keys(statusCounts).map(status => ({
      status,
      count: statusCounts[status].count,
      total_val: statusCounts[status].total_val
    }));

    // 2. Upcoming deadlines (next 30 days) for charts
    let deadlineRows: { due_date: string; count: number }[] = [];
    let sectorRows: { sector: string; count: number; total_val: number }[] = [];
    let authorityRows: { authority: string; count: number; total_val: number }[] = [];
    let valueBrackets: { bracket: string; count: number }[] = [];

    if (userRole === 'MIS Executive') {
      deadlineRows = db.prepare(`
        SELECT due_date, COUNT(*) as count 
        FROM tenders 
        WHERE due_date >= ? AND due_date <= date(?, '+30 days') AND mis_executive = ?
        GROUP BY due_date
        ORDER BY due_date ASC
      `).all(todayISTString, todayISTString, username) as { due_date: string; count: number }[];

      sectorRows = db.prepare(`
        SELECT COALESCE(sector, 'Unknown') as sector, COUNT(*) as count, SUM(CASE WHEN estimated_cost IS NOT NULL THEN estimated_cost ELSE 0 END) as total_val
        FROM tenders
        WHERE mis_executive = ?
        GROUP BY sector
        ORDER BY count DESC
        LIMIT 10
      `).all(username) as { sector: string; count: number; total_val: number }[];

      authorityRows = db.prepare(`
        SELECT COALESCE(authority, 'Unknown') as authority, COUNT(*) as count, SUM(CASE WHEN estimated_cost IS NOT NULL THEN estimated_cost ELSE 0 END) as total_val
        FROM tenders
        WHERE mis_executive = ?
        GROUP BY authority
        ORDER BY total_val DESC
        LIMIT 10
      `).all(username) as { authority: string; count: number; total_val: number }[];

      valueBrackets = db.prepare(`
        SELECT 
          CASE 
            WHEN estimated_cost IS NULL THEN 'Unspecified'
            WHEN estimated_cost < 500000 THEN 'Under 5L'
            WHEN estimated_cost >= 500000 AND estimated_cost < 2000000 THEN '5L - 20L'
            WHEN estimated_cost >= 2000000 AND estimated_cost < 10000000 THEN '20L - 1Cr'
            WHEN estimated_cost >= 10000000 AND estimated_cost < 50000000 THEN '1Cr - 5Cr'
            ELSE 'Over 5Cr'
          END as bracket,
          COUNT(*) as count
        FROM tenders
        WHERE mis_executive = ?
        GROUP BY bracket
      `).all(username) as { bracket: string; count: number }[];
    } else {
      deadlineRows = db.prepare(`
        SELECT due_date, COUNT(*) as count 
        FROM tenders 
        WHERE due_date >= ? AND due_date <= date(?, '+30 days')
        GROUP BY due_date
        ORDER BY due_date ASC
      `).all(todayISTString, todayISTString) as { due_date: string; count: number }[];

      sectorRows = db.prepare(`
        SELECT COALESCE(sector, 'Unknown') as sector, COUNT(*) as count, SUM(CASE WHEN estimated_cost IS NOT NULL THEN estimated_cost ELSE 0 END) as total_val
        FROM tenders
        GROUP BY sector
        ORDER BY count DESC
        LIMIT 10
      `).all() as { sector: string; count: number; total_val: number }[];

      authorityRows = db.prepare(`
        SELECT COALESCE(authority, 'Unknown') as authority, COUNT(*) as count, SUM(CASE WHEN estimated_cost IS NOT NULL THEN estimated_cost ELSE 0 END) as total_val
        FROM tenders
        GROUP BY authority
        ORDER BY total_val DESC
        LIMIT 10
      `).all() as { authority: string; count: number; total_val: number }[];

      valueBrackets = db.prepare(`
        SELECT 
          CASE 
            WHEN estimated_cost IS NULL THEN 'Unspecified'
            WHEN estimated_cost < 500000 THEN 'Under 5L'
            WHEN estimated_cost >= 500000 AND estimated_cost < 2000000 THEN '5L - 20L'
            WHEN estimated_cost >= 2000000 AND estimated_cost < 10000000 THEN '20L - 1Cr'
            WHEN estimated_cost >= 10000000 AND estimated_cost < 50000000 THEN '1Cr - 5Cr'
            ELSE 'Over 5Cr'
          END as bracket,
          COUNT(*) as count
        FROM tenders
        GROUP BY bracket
      `).all() as { bracket: string; count: number }[];
    }

    const bracketOrder = ['Under 5L', '5L - 20L', '20L - 1Cr', '1Cr - 5Cr', 'Over 5Cr', 'Unspecified'];
    const sortedValueBrackets = bracketOrder.map(name => {
      const match = valueBrackets.find(b => b.bracket === name);
      return {
        bracket: name,
        count: match ? match.count : 0
      };
    });

    const emailCount = db.prepare('SELECT COUNT(*) as count FROM processed_emails').get() as { count: number };

    return NextResponse.json({
      success: true,
      metrics: {
        totalEmails: emailCount.count,
        totalTenders,
        status: statusRows,
        issuedCount,
        participatingCount,
        notParticipatingCount,
        lapsedCount,
        t2_3DaysCount,
        t2TodayCount,
        filedCount,
        awardedCount,
        notAwardedCount,
        nonSubmissionLossCount,
        nonParticipationLossCount,
        specTotalCount,
        specPendingCount,
        specApprovedCount,
        specRejectedCount,
        tpcTotalCount,
        tpcPendingCount,
        tpcApprovedCount,
        tpcRejectedCount
      },
      deadlines: deadlineRows,
      sectors: sectorRows,
      authorities: authorityRows,
      valueBrackets: sortedValueBrackets
    });
  } catch (error) {
    console.error('Error generating analytics:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
