import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET(request: Request) {
  try {
    const role = request.headers.get('x-user-role');
    if (role !== 'Admin') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }

    const stmt = db.prepare(`
      SELECT a.*, t.title as tender_title
      FROM activity_log a
      LEFT JOIN tenders t ON a.tender_id = t.id
      WHERE a.role IN ('MIS Team', 'MIS Executive')
      ORDER BY a.timestamp DESC
      LIMIT 100
    `);
    const logs = stmt.all();

    return NextResponse.json({
      success: true,
      logs
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
