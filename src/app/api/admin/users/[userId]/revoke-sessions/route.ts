import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { revokeUserSessions } from '@/lib/auth/revoke';
import { isValidUUID } from '@/lib/utils/validation';

/**
 * Force-logout a user everywhere ("log out everywhere" / kill sessions).
 *
 * Admin only. Bumps the user's token_version so every outstanding JWT is
 * rejected on its next request — used when a device is lost or someone leaves.
 */
export async function POST(
  _request: NextRequest,
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

    const result = await revokeUserSessions(db(), userId);
    if (!result.ok) {
      const status = result.error === 'User not found' ? 404 : 500;
      return NextResponse.json({ success: false, error: result.error }, { status });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
