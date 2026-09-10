import { NextResponse } from 'next/server';
import db, { addActivityLog } from '@/lib/db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const stmt = db.prepare('SELECT * FROM tender_workflow_comments WHERE tender_id = ? ORDER BY created_at ASC');
    const comments = stmt.all(id);

    return NextResponse.json({ success: true, comments });
  } catch (error: any) {
    console.error('Error fetching comments:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userRole = request.headers.get('x-user-role') || 'Unknown';
    const username = request.headers.get('x-user-username') || 'system';

    const body = await request.json();
    const { comment, phase } = body;

    if (!comment || !phase) {
      return NextResponse.json(
        { success: false, error: 'Comment and phase are required' },
        { status: 400 }
      );
    }

    const stmt = db.prepare(`
      INSERT INTO tender_workflow_comments (tender_id, phase, author, author_role, comment, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `);
    const result = stmt.run(id, phase, username, userRole, comment);

    // Retrieve inserted comment
    const insertedComment = db.prepare('SELECT * FROM tender_workflow_comments WHERE id = ?').get(result.lastInsertRowid);

    // Log to activity log
    addActivityLog(username, userRole, 'Added Workflow Comment', id, `Added comment on phase: ${phase}`);

    return NextResponse.json({ success: true, comment: insertedComment });
  } catch (error: any) {
    console.error('Error posting comment:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to post comment' },
      { status: 500 }
    );
  }
}
