import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: Request) {
  try {
    // 1. Get IST date variables
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-IN', options as any);
    const parts = formatter.formatToParts(new Date());
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    const todayISTString = `${year}-${month}-${day}`;

    // Helper functions for dynamic resolution
    const isLapsed = (publishDateStr: string | null | undefined, todayISTStr: string): boolean => {
      if (!publishDateStr || publishDateStr === 'N/A') return false;
      const date = new Date(publishDateStr);
      if (isNaN(date.getTime())) return false;
      
      const today = new Date(todayISTStr + 'T00:00:00+05:30');
      const publishDate = new Date(date);
      publishDate.setHours(0,0,0,0);
      
      const diffTime = today.getTime() - publishDate.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      return diffDays > 3;
    };

    const resolveStatus = (t: any, todayIST: string): string => {
      const hasPassedDueDate = t.due_date && t.due_date < todayIST;

      if (t.status === 'Awarded') return 'Won';
      if (t.status === 'Not Awarded') return 'Lost';
      if (t.status === 'Filed') return 'Submitted';

      if (hasPassedDueDate) {
        if (t.status === 'Not Participating') {
          return 'Missed Opportunity';
        }
        if (t.status === 'Issued' || t.status === 'Participating' || !t.status) {
          return 'Missed Deadline';
        }
      }

      if (t.status === 'Not Participating') return 'Not Participating';
      if (t.status === 'Participating') return 'Participating';

      if (isLapsed(t.publish_date, todayIST)) {
        return 'Lapsed';
      }
      return 'New';
    };

    // Load all tenders
    const rawTenders = db.prepare('SELECT mis_executive, status, estimated_cost, publish_date, due_date FROM tenders WHERE mis_executive IS NOT NULL').all() as any[];

    // Fetch historical status changes
    const historyRows = db.prepare(`
      SELECT t.mis_executive, sh.to_status, sh.changed_at 
      FROM status_history sh 
      JOIN tenders t ON sh.tender_id = t.id
    `).all() as any[];

    const statsMap: Record<string, {
      executive: string;
      last7Days: number;
      last30Days: number;
      last365Days: number;
      totalWon: number;
      totalLost: number;
      submittedCount: number;
      submittedValue: number;
    }> = {};

    const today = new Date();

    // Seed default map with all executives
    const users = db.prepare("SELECT username FROM users WHERE role = 'MIS Executive' OR role = 'Tender Executive'").all() as { username: string }[];
    for (const u of users) {
      statsMap[u.username] = {
        executive: u.username,
        last7Days: 0,
        last30Days: 0,
        last365Days: 0,
        totalWon: 0,
        totalLost: 0,
        submittedCount: 0,
        submittedValue: 0
      };
    }

    // 1. Calculate historical transition stats
    for (const row of historyRows) {
      const exec = row.mis_executive;
      const status = row.to_status;
      const changedAtStr = row.changed_at;

      if (!exec || !changedAtStr) continue;
      if (!statsMap[exec]) {
        statsMap[exec] = {
          executive: exec,
          last7Days: 0,
          last30Days: 0,
          last365Days: 0,
          totalWon: 0,
          totalLost: 0,
          submittedCount: 0,
          submittedValue: 0
        };
      }

      const isSubmission = status === 'Filed' || status === 'Submitted';
      const isWon = status === 'Awarded' || status === 'Won';
      const isLost = status === 'Not Awarded' || status === 'Lost';

      if (!isSubmission && !isWon && !isLost) continue;

      const execStats = statsMap[exec];

      try {
        const cleanDateStr = changedAtStr.split(' ')[0].split('T')[0];
        const changedDate = new Date(cleanDateStr);
        if (isNaN(changedDate.getTime())) continue;

        const diffTime = Math.abs(today.getTime() - changedDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (isSubmission) {
          if (diffDays <= 7) execStats.last7Days += 1;
          if (diffDays <= 30) execStats.last30Days += 1;
          if (diffDays <= 365) execStats.last365Days += 1;
        }

        if (isWon) execStats.totalWon += 1;
        if (isLost) execStats.totalLost += 1;

      } catch (err) {
        // Ignore date parse errors
      }
    }

    // 2. Calculate current active submissions & values
    for (const t of rawTenders) {
      const exec = t.mis_executive;
      if (!exec) continue;

      if (!statsMap[exec]) {
        statsMap[exec] = {
          executive: exec,
          last7Days: 0,
          last30Days: 0,
          last365Days: 0,
          totalWon: 0,
          totalLost: 0,
          submittedCount: 0,
          submittedValue: 0
        };
      }

      const resolvedStatus = resolveStatus(t, todayISTString);
      const isSubmitted = resolvedStatus === 'Submitted' || resolvedStatus === 'Won' || resolvedStatus === 'Lost';

      if (isSubmitted) {
        statsMap[exec].submittedCount += 1;
        statsMap[exec].submittedValue += (t.estimated_cost || 0);
      }
    }

    return NextResponse.json({ success: true, stats: Object.values(statsMap) });
  } catch (error: any) {
    console.error('Error compiling stats:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to compile stats' },
      { status: 500 }
    );
  }
}
