import { NextResponse } from 'next/server';
import db, { hashPassword } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password are required' },
        { status: 400 }
      );
    }

    const trimmedUsername = username.trim().toLowerCase();
    
    // Find user in db
    const userStmt = db.prepare('SELECT username, password_hash, role FROM users WHERE LOWER(username) = ?');
    const user = userStmt.get(trimmedUsername) as { username: string; password_hash: string; role: string } | undefined;

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    const inputHash = hashPassword(password);
    if (user.password_hash !== inputHash) {
      return NextResponse.json(
        { success: false, error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    // Success! Return user profile details
    return NextResponse.json({
      success: true,
      user: {
        username: user.username,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Error authenticating user:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
