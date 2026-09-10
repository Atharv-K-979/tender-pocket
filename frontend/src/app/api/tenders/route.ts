import { NextResponse } from 'next/server';
import db, { Tender } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const location = searchParams.get('location') || '';
    const sector = searchParams.get('sector') || '';
    const minCost = searchParams.get('minCost') ? parseFloat(searchParams.get('minCost')!) : null;
    const maxCost = searchParams.get('maxCost') ? parseFloat(searchParams.get('maxCost')!) : null;
    const sortBy = searchParams.get('sortBy') || 'scraped_at'; // scraped_at, due_date, estimated_cost
    const order = searchParams.get('order') || 'desc'; // desc, asc
    const misExecutive = searchParams.get('mis_executive') || '';
    
    // Get IST date variables
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-IN', options as any);
    const parts = formatter.formatToParts(new Date());
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    const todayISTString = `${year}-${month}-${day}`;

    // Get user role from headers
    const userRole = request.headers.get('x-user-role');
    const username = request.headers.get('x-user-username');

    // Build SQL query
    let query = 'SELECT * FROM tenders WHERE 1=1';
    const params: any[] = [];

    if (userRole === 'MIS Executive') {
      query += ' AND mis_executive = ?';
      params.push(username);
    } else if (userRole === 'Specification Team') {
      query += ' AND assigned_mis_member_spec = ?';
      params.push(username);
    } else if (misExecutive) {
      query += ' AND mis_executive = ?';
      params.push(misExecutive);
    }

    if (search) {
      query += ' AND (title LIKE ? OR id LIKE ? OR ref_no LIKE ? OR authority LIKE ? OR source_id LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      if (status === 'Pending' || status === 'Approved' || status === 'Rejected') {
        query += " AND spec_verification_status = ?";
        params.push(status);
      } else if (status === 'New') {
        query += " AND (status = 'Issued' OR status IS NULL)";
      } else if (status === 'Lapsed') {
        query += " AND (status = 'Issued' OR status IS NULL)";
      } else if (status === 'Participating') {
        query += " AND status = 'Participating'";
      } else if (status === 'Not Participating') {
        query += " AND status = 'Not Participating'";
      } else if (status === 'Submitted') {
        query += " AND status = 'Filed'";
      } else if (status === 'Won') {
        query += " AND status = 'Awarded'";
      } else if (status === 'Lost') {
        query += " AND status = 'Not Awarded'";
      } else if (status === 'Missed Deadline') {
        query += " AND (status = 'Issued' OR status IS NULL OR status = 'Participating') AND due_date IS NOT NULL AND due_date != '' AND due_date < ?";
        params.push(todayISTString);
      } else if (status === 'Missed Opportunity') {
        query += " AND status = 'Not Participating' AND due_date IS NOT NULL AND due_date != '' AND due_date < ?";
        params.push(todayISTString);
      } else if (status === 'T2') {
        query += " AND (status = 'Issued' OR status IS NULL OR status = 'Participating') AND due_date = ?";
        params.push(todayISTString);
      } else if (status === 'T2-3 days') {
        query += " AND (status = 'Issued' OR status IS NULL OR status = 'Participating') AND due_date > ? AND due_date <= date(?, '+3 days')";
        params.push(todayISTString, todayISTString);
      }
    }

    if (location) {
      query += ' AND location = ?';
      params.push(location);
    }

    if (sector) {
      query += ' AND sector = ?';
      params.push(sector);
    }

    if (minCost !== null) {
      query += ' AND estimated_cost >= ?';
      params.push(minCost);
    }

    if (maxCost !== null) {
      query += ' AND estimated_cost <= ?';
      params.push(maxCost);
    }

    // Validate sort fields to prevent SQL injection
    const allowedSortFields = ['scraped_at', 'due_date', 'estimated_cost'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'scraped_at';
    const safeOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    
    query += ` ORDER BY ${safeSortBy} ${safeOrder}`;

    const statement = db.prepare(query);
    const rawTenders = statement.all(...params) as Tender[];

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

      // Default or 'Issued' status
      if (isLapsed(t.publish_date, todayIST)) {
        return 'Lapsed';
      }
      return 'New';
    };

    // Dynamic resolution in JS
    let tenders = rawTenders.map(t => ({
      ...t,
      status: resolveStatus(t, todayISTString) as any
    }));

    // strict JS filter
    if (status) {
      tenders = tenders.filter(t => {
        if (status === 'New') return t.status === 'New';
        if (status === 'Lapsed') return t.status === 'Lapsed';
        if (status === 'Participating') return t.status === 'Participating';
        if (status === 'Not Participating') return t.status === 'Not Participating';
        if (status === 'Submitted') return t.status === 'Submitted';
        if (status === 'Won') return t.status === 'Won';
        if (status === 'Lost') return t.status === 'Lost';
        if (status === 'Missed Deadline') return t.status === 'Missed Deadline';
        if (status === 'Missed Opportunity') return t.status === 'Missed Opportunity';
        
        if (status === 'T2') {
          return t.due_date === todayISTString && (t.status === 'New' || t.status === 'Lapsed' || t.status === 'Participating');
        }
        if (status === 'T2-3 days') {
          if (!t.due_date) return false;
          const dueDate = new Date(t.due_date + 'T00:00:00+05:30');
          const parsedToday = new Date(todayISTString + 'T00:00:00+05:30');
          const threeDaysLater = new Date(parsedToday);
          threeDaysLater.setDate(threeDaysLater.getDate() + 3);
          return dueDate > parsedToday && dueDate <= threeDaysLater && (t.status === 'New' || t.status === 'Lapsed' || t.status === 'Participating');
        }
        return true;
      });
    }

    // Fetch unique locations and sectors for filter dropdowns
    let locations: string[] = [];
    let sectors: string[] = [];

    if (userRole === 'MIS Executive') {
      const locStmt = db.prepare("SELECT DISTINCT location FROM tenders WHERE location IS NOT NULL AND location != '' AND mis_executive = ? ORDER BY location");
      const secStmt = db.prepare("SELECT DISTINCT sector FROM tenders WHERE sector IS NOT NULL AND sector != '' AND mis_executive = ? ORDER BY sector");
      locations = (locStmt.all(username) as { location: string }[]).map(r => r.location);
      sectors = (secStmt.all(username) as { sector: string }[]).map(r => r.sector);
    } else {
      const locStmt = db.prepare("SELECT DISTINCT location FROM tenders WHERE location IS NOT NULL AND location != '' ORDER BY location");
      const secStmt = db.prepare("SELECT DISTINCT sector FROM tenders WHERE sector IS NOT NULL AND sector != '' ORDER BY sector");
      locations = (locStmt.all() as { location: string }[]).map(r => r.location);
      sectors = (secStmt.all() as { sector: string }[]).map(r => r.sector);
    }

    return NextResponse.json({
      success: true,
      tenders,
      filters: {
        locations,
        sectors
      }
    });
  } catch (error) {
    console.error('Error fetching tenders:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      id, ref_no, title, authority, estimated_cost, estimated_cost_raw,
      emd, emd_raw, document_fee, document_fee_raw, location, sector,
      due_date, opening_date, document_url, original_url, status
    } = body;

    if (!id || !title || !original_url) {
      return NextResponse.json(
        { success: false, error: 'id, title, and original_url are required' },
        { status: 400 }
      );
    }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO tenders (
        id, ref_no, title, authority, estimated_cost, estimated_cost_raw,
        emd, emd_raw, document_fee, document_fee_raw, location, sector,
        due_date, opening_date, document_url, original_url, status, scraped_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      ref_no || null,
      title,
      authority || null,
      estimated_cost || null,
      estimated_cost_raw || null,
      emd || null,
      emd_raw || null,
      document_fee || null,
      document_fee_raw || null,
      location || null,
      sector || null,
      due_date || null,
      opening_date || null,
      document_url || null,
      original_url,
      status || 'new',
      new Date().toISOString()
    );

    return NextResponse.json({ success: true, message: 'Tender added successfully' });
  } catch (error) {
    console.error('Error creating tender:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
