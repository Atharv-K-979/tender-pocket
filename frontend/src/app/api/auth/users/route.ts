import { NextResponse } from 'next/server';
import db, { hashPassword, addActivityLog } from '@/lib/db';

// Helper to check authorization for user management
function canManageUsers(request: Request): boolean {
  const userRole = request.headers.get('x-user-role');
  return userRole === 'Admin' || userRole === 'MIS Team';
}

export async function GET(request: Request) {
  try {
    const userRole = request.headers.get('x-user-role');
    if (userRole !== 'Admin' && userRole !== 'MIS Team' && userRole !== 'MIS Executive' && userRole !== 'Specification Team') {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // Fetch all users sorted by role and username with email
    const rawUsers = db.prepare('SELECT username, role, email FROM users ORDER BY role DESC, username ASC').all() as { username: string; role: string; email?: string }[];

    // Get IST date variables for dynamic status resolution
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-IN', options as any);
    const parts = formatter.formatToParts(new Date());
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    const todayISTString = `${year}-${month}-${day}`;

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

    const users = rawUsers.map((user: any) => {
      if (user.role === 'MIS Executive') {
        // Query assigned tenders
        const tenders = db.prepare('SELECT status, publish_date, due_date FROM tenders WHERE mis_executive = ?').all(user.username) as any[];
        
        let liveCount = 0;
        let inProgressCount = 0;
        let missedCount = 0;
        let submittedCount = 0;
        let wonCount = 0;
        let lostCount = 0;

        tenders.forEach(t => {
          const resolved = resolveStatus(t, todayISTString);
          if (resolved === 'New') {
            liveCount++;
          } else if (resolved === 'Participating') {
            inProgressCount++;
          } else if (resolved === 'Submitted') {
            submittedCount++;
          } else if (resolved === 'Missed Deadline' || resolved === 'Missed Opportunity' || resolved === 'Lapsed') {
            missedCount++;
          } else if (resolved === 'Won') {
            wonCount++;
          } else if (resolved === 'Lost') {
            lostCount++;
          }
        });

        return {
          ...user,
          stats: {
            live: liveCount,
            inProgress: inProgressCount,
            missed: missedCount,
            submitted: submittedCount,
            won: wonCount,
            lost: lostCount
          }
        };
      }
      return {
        ...user,
        stats: null
      };
    });

    return NextResponse.json({ success: true, users });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!canManageUsers(request)) {
      return NextResponse.json({ success: false, error: 'Access denied: Admin or MIS Team only' }, { status: 403 });
    }

    const adminUsername = request.headers.get('x-user-username') || 'admin';
    const body = await request.json();
    const { username, password, role, email } = body;

    if (!username || !password || !role) {
      return NextResponse.json({ success: false, error: 'Username, password, and role are required' }, { status: 400 });
    }

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      return NextResponse.json({ success: false, error: 'Username must be between 3 and 20 characters long' }, { status: 400 });
    }

    const usernameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!usernameRegex.test(trimmedUsername)) {
      return NextResponse.json({ success: false, error: 'Username can only contain alphanumeric characters, hyphens, and underscores' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ success: false, error: 'Password must be at least 6 characters long' }, { status: 400 });
    }

    const validRoles = ['MIS Team', 'MIS Executive', 'Specification Team'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ success: false, error: 'Invalid role. Choose "MIS Team", "MIS Executive", or "Specification Team"' }, { status: 400 });
    }

    const checkUser = db.prepare('SELECT username FROM users WHERE LOWER(username) = LOWER(?)').get(trimmedUsername);
    if (checkUser) {
      return NextResponse.json({ success: false, error: 'Username already exists' }, { status: 400 });
    }

    const passwordHash = hashPassword(password);
    const userEmail = email ? email.trim() : `${trimmedUsername}@company.com`;
    const insertStmt = db.prepare('INSERT INTO users (username, password_hash, role, email) VALUES (?, ?, ?, ?)');
    insertStmt.run(trimmedUsername, passwordHash, role, userEmail);

    addActivityLog(adminUsername, 'Admin', 'Created User', null, `Created user account: ${trimmedUsername} (${userEmail}) with role: ${role}`);

    return NextResponse.json({ success: true, message: 'User created successfully' });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    if (!canManageUsers(request)) {
      return NextResponse.json({ success: false, error: 'Access denied: Admin or MIS Team only' }, { status: 403 });
    }

    const adminUsername = request.headers.get('x-user-username') || 'admin';
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
      return NextResponse.json({ success: false, error: 'Username is required' }, { status: 400 });
    }

    const targetUsername = username.trim().toLowerCase();
    if (targetUsername === 'admin') {
      return NextResponse.json({ success: false, error: 'Cannot delete the primary Admin account' }, { status: 400 });
    }

    const userStmt = db.prepare('SELECT username FROM users WHERE LOWER(username) = ?');
    const user = userStmt.get(targetUsername) as { username: string } | undefined;

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const deleteStmt = db.prepare('DELETE FROM users WHERE LOWER(username) = ?');
    deleteStmt.run(targetUsername);

    addActivityLog(adminUsername, 'Admin', 'Deleted User', null, `Deleted user account: ${user.username}`);

    return NextResponse.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
