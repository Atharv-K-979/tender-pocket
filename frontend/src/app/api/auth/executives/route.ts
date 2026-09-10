import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const stmt = db.prepare("SELECT username FROM users WHERE role = 'MIS Executive' ORDER BY username ASC");
    const executives = (stmt.all() as { username: string }[]).map(r => r.username);

    return NextResponse.json({
      success: true,
      executives
    });
  } catch (error) {
    console.error('Error fetching executives:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
