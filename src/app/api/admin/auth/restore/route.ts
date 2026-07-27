import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/supabase/server';
import {
  getAuthenticatedAdmin,
  verifyToken,
  createToken,
  setAuthCookie,
  clearImpersonationCookie,
  IMPERSONATION_COOKIE_NAME,
} from '@/lib/auth/jwt';
import {
  canRestoreImpersonation,
  restoreRefusalStatus,
  type RestoreTargetUser,
} from '@/lib/auth/impersonation';

/**
 * End an impersonation and hand the admin their own session back.
 *
 * This used to install whatever sat in the saved-token cookie, with no check on
 * who was asking. Cookies outlive the session that set them, so a legitimate
 * employee signing in on a browser where an admin had once impersonated
 * inherited a live admin credential and a request that would spend it. The
 * decision now comes from the live session — see canRestoreImpersonation.
 */
export async function POST() {
  try {
    const cookieStore = await cookies();
    const savedToken = cookieStore.get(IMPERSONATION_COOKIE_NAME)?.value ?? null;

    const current = await getAuthenticatedAdmin();
    const original = savedToken ? await verifyToken(savedToken) : null;

    // Only look the account up once there is a plausible claim to check it
    // against, so an unauthenticated probe can't drive database reads.
    let originalUser: RestoreTargetUser | null = null;
    if (current?.impersonatedBy && original) {
      const { data } = await db()
        .from('admin_users')
        .select('role, token_version')
        .eq('id', original.sub)
        .single();
      originalUser = (data as RestoreTargetUser | null) ?? null;
    }

    const decision = canRestoreImpersonation({
      current,
      original,
      hasSavedToken: !!savedToken,
      originalUser,
    });

    if (!decision.allowed) {
      // A token that can never be redeemed is only a liability — drop it rather
      // than leave it in the browser for the next person.
      await clearImpersonationCookie();
      return NextResponse.json(
        { success: false, error: 'Not impersonating' },
        { status: restoreRefusalStatus(decision.reason) }
      );
    }

    // Mint a fresh token from what the database says right now rather than
    // replaying the saved one, so no stale claim rides along.
    const { data: admin } = await db()
      .from('admin_users')
      .select('id, email, name, role, token_version')
      .eq('id', decision.adminId)
      .single();

    if (!admin) {
      await clearImpersonationCookie();
      return NextResponse.json({ success: false, error: 'Not impersonating' }, { status: 403 });
    }

    await setAuthCookie(
      await createToken({
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role as 'admin' | 'setter' | 'closer',
        tokenVersion: admin.token_version,
      })
    );
    await clearImpersonationCookie();

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
