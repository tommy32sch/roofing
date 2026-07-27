import { NextRequest, NextResponse } from 'next/server';
import { compare } from 'bcryptjs';
import { db } from '@/lib/supabase/server';
import { createToken, setAuthCookie, clearAuthCookie, clearImpersonationCookie } from '@/lib/auth/jwt';
import { checkConfiguredRateLimit, resetRateLimit, getClientIP } from '@/lib/utils/rate-limit';

const LOGIN_LIMIT = { prefix: 'login', max: 5, window: '15 m' } as const;

/** "Try again in 4 minutes" beats "try again later" when you're locked out. */
function retryHint(resetAt: number): string {
  const minutes = Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000));
  return `Too many login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * A rejected sign-in must not leave the previous session running.
 *
 * Someone typing credentials on the login screen is asserting an identity. If
 * that fails and the browser still holds an earlier session, the next click
 * silently drops them back into the previous person's account — which reads as
 * "it logged me in as the wrong user" rather than "your attempt was rejected".
 */
async function failedAttempt(error: string, status: number) {
  await clearAuthCookie();
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request.headers);
  const rateLimit = await checkConfiguredRateLimit(
    clientIP,
    LOGIN_LIMIT.prefix,
    LOGIN_LIMIT.max,
    LOGIN_LIMIT.window
  );
  if (!rateLimit.success) {
    return await failedAttempt(retryHint(rateLimit.reset), 429);
  }

  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const supabase = db();
    const { data: admin, error } = await supabase
      .from('admin_users')
      .select('id, email, name, password_hash, role, token_version')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !admin) {
      return await failedAttempt('Invalid email or password', 401);
    }

    const passwordValid = await compare(password, admin.password_hash);
    if (!passwordValid) {
      return await failedAttempt('Invalid email or password', 401);
    }

    const token = await createToken({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      tokenVersion: admin.token_version,
    });

    await setAuthCookie(token);
    // Signing in starts a new session, which must not inherit a parked admin
    // token from whoever used this browser before.
    await clearImpersonationCookie();

    // Proving you know the password clears the brute-force budget. Counting
    // successes against it locks people out of their own app for switching
    // accounts, and the rejection lands before the password is checked, so it
    // looks like the right credentials stopped working.
    await resetRateLimit(clientIP, LOGIN_LIMIT.prefix, LOGIN_LIMIT.max, LOGIN_LIMIT.window);

    return NextResponse.json({
      success: true,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
