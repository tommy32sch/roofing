import { NextRequest, NextResponse } from 'next/server';
import { compare } from 'bcryptjs';
import { db } from '@/lib/supabase/server';
import { createToken, setAuthCookie, clearAuthCookie, clearImpersonationCookie } from '@/lib/auth/jwt';
import { checkConfiguredRateLimit, resetRateLimit, getClientIP } from '@/lib/utils/rate-limit';

/**
 * Two budgets, because they answer different questions.
 *
 * The per-ACCOUNT budget is the real brute-force defence: guesses against one
 * email accumulate no matter where they come from, so spreading an attack over
 * many IPs buys nothing.
 *
 * The per-IP budget is a broad backstop against one source sweeping many
 * accounts. It is deliberately loose, because the account budget does the
 * precise work and a tight shared bucket is what locks a whole office out of
 * their own app.
 *
 * A single per-IP budget used to do both jobs and was reset on any successful
 * login. That combination meant proving you knew ONE password cleared the
 * budget for guessing every OTHER account: burn four guesses at the admin
 * address, sign into your own account to wipe the counter, repeat forever.
 */
const IP_LIMIT = { prefix: 'login-ip', max: 50, window: '15 m' } as const;
const ACCOUNT_LIMIT = { prefix: 'login-account', max: 10, window: '15 m' } as const;

/*
 * Why 50 and not something tight: the IP budget is the one that can lock a
 * whole office out at once, since a crew shares one NAT address, and unlike the
 * account budget it is never cleared by signing in successfully. Capping
 * guesses per ACCOUNT at 10 already makes brute force hopeless regardless of
 * how many addresses an attacker comes from, so squeezing the shared bucket
 * buys almost nothing and risks repeating a real lockout.
 */

/**
 * Burned when the email is unknown.
 *
 * Without it the unknown-email branch returns in about a millisecond while a
 * real account spends ~100ms in bcrypt, and that gap tells an attacker which
 * addresses exist. A cost-12 hash matching the one used for real passwords
 * makes both paths cost the same.
 */
const TIMING_EQUALISER_HASH = '$2b$12$zXeU1orv5Q1sH.Vtr06fxOb8VKx6.ouMFcL5lGHcn0kgvyPfvi9hm';

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
  const ipLimit = await checkConfiguredRateLimit(
    clientIP,
    IP_LIMIT.prefix,
    IP_LIMIT.max,
    IP_LIMIT.window
  );
  if (!ipLimit.success) {
    return await failedAttempt(retryHint(ipLimit.reset), 429);
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

    const normalisedEmail = String(email).toLowerCase().trim();

    // Charged before the lookup so guesses count whether or not the account
    // exists — otherwise the budget itself would reveal which emails are real.
    const accountLimit = await checkConfiguredRateLimit(
      normalisedEmail,
      ACCOUNT_LIMIT.prefix,
      ACCOUNT_LIMIT.max,
      ACCOUNT_LIMIT.window
    );
    if (!accountLimit.success) {
      return await failedAttempt(retryHint(accountLimit.reset), 429);
    }

    const supabase = db();
    const { data: admin, error } = await supabase
      .from('admin_users')
      .select('id, email, name, password_hash, role, token_version')
      .eq('email', normalisedEmail)
      .single();

    if (error || !admin) {
      // Spend the same CPU a real account would, so response time does not
      // separate "no such user" from "wrong password".
      await compare(password, TIMING_EQUALISER_HASH);
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

    /**
     * Clear the budget for THIS ACCOUNT only.
     *
     * Safe, because clearing it required the account's own password — an
     * attacker who could do this has already won for that account and gains
     * nothing. It also keeps the original fix intact: mistyping your password a
     * few times then getting it right does not leave you locked out.
     *
     * The per-IP budget is deliberately NOT cleared. Clearing it is what let one
     * successful login reopen guessing against every other account.
     */
    await resetRateLimit(
      normalisedEmail,
      ACCOUNT_LIMIT.prefix,
      ACCOUNT_LIMIT.max,
      ACCOUNT_LIMIT.window
    );

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
