import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const IMPERSONATE_COOKIE = 'admin_original_token';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const originalToken = cookieStore.get(IMPERSONATE_COOKIE)?.value;

    if (!originalToken) {
      return NextResponse.json({ success: false, error: 'Not impersonating' }, { status: 400 });
    }

    cookieStore.set('admin_token', originalToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    cookieStore.delete(IMPERSONATE_COOKIE);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
