import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin, createToken, setAuthCookie } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { cookies } from 'next/headers';

const IMPERSONATE_COOKIE = 'admin_original_token';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { userId } = await params;
    if (!isValidUUID(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid user ID' }, { status: 400 });
    }

    if (userId === admin.sub) {
      return NextResponse.json({ success: false, error: 'Already viewing as this user' }, { status: 400 });
    }

    const supabase = db();
    const { data: targetUser, error } = await supabase
      .from('admin_users')
      .select('id, email, name, role, token_version')
      .eq('id', userId)
      .single();

    if (error || !targetUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const cookieStore = await cookies();
    const currentToken = cookieStore.get('admin_token')?.value;

    // Save current admin token so we can restore it later
    if (currentToken) {
      cookieStore.set(IMPERSONATE_COOKIE, currentToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 8, // 8 hours
        path: '/',
      });
    }

    const newToken = await createToken({
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: targetUser.role as 'admin' | 'setter' | 'closer',
      impersonatedBy: admin.sub,
      tokenVersion: targetUser.token_version,
    });

    await setAuthCookie(newToken);

    return NextResponse.json({ success: true, user: { name: targetUser.name, role: targetUser.role } });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
