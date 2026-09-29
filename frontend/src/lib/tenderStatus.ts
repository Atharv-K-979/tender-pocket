/**
 * Centralized Tender Status Resolution Helper
 * Ensures 100% status calculation consistency across all API routes:
 * - /api/tenders
 * - /api/tenders/[id]
 * - /api/tenders/stats
 * - /api/analytics
 * - /api/auth/users
 */

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
  const hasPassedDueDate = Boolean(t.due_date && t.due_date < todayIST);

  if (t.status === 'Awarded' || t.status === 'Won') return 'Won';
  if (t.status === 'Not Awarded' || t.status === 'Lost') return 'Lost';
  if (t.status === 'Filed' || t.status === 'Submitted') return 'Submitted';

  if (hasPassedDueDate) {
    if (t.status === 'Not Participating') {
      return 'Missed Opportunity';
    }
    if (t.status === 'Issued' || t.status === 'New' || t.status === 'Participating' || !t.status) {
      return 'Missed Deadline';
    }
  }

  if (t.status === 'Not Participating') return 'Not Participating';
  if (t.status === 'Participating') return 'Participating';

  // Default or 'Issued' / 'New' status
  if (isLapsed(t.publish_date, todayIST)) {
    return 'Lapsed';
  }
  return 'New';
}
