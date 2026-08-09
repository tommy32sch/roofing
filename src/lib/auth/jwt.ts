import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { db } from '@/lib/supabase/server';
import type { UserRole } from '@/types';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const COOKIE_NAME = 'admin_token';
/**
 * Where an admin's own token is parked while they impersonate someone.
 *
 * It holds a live, fully privileged credential, so its lifetime must be tied to
 * the impersonation and nothing else — see clearAuthCookie and the login route,
 * which both drop it.
 */
export const IMPERSONATION_COOKIE_NAME = 'admin_original_token';
const TOKEN_EXPIRY = '24h';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours
const REFRESH_THRESHOLD_MS = 12 * 60 * 60 * 1000; // Refresh after 12 hours

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  role: 'admin' | 'setter' | 'closer';
  impersonatedBy?: string;
  /** Session-revocation counter; must match admin_users.token_version. */
  tv?: number;
  iat: number;
  exp: number;
}

export interface AuthenticatedAdmin extends JWTPayload {
  /** The current database value, not the value captured when the JWT was issued. */
  email: string;
  name: string;
  role: UserRole;
  marketId: number | null;
}

export type AdminSessionResult =
  | { status: 'authenticated'; admin: AuthenticatedAdmin }
  | {
      status: 'unauthenticated';
      reason: 'missing' | 'invalid' | 'deleted' | 'revoked';
    }
  | { status: 'unavailable' };

export async function createToken(user: {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'setter' | 'closer';
  impersonatedBy?: string;
  tokenVersion?: number;
}): Promise<string> {
  const payload: Record<string, unknown> = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tv: user.tokenVersion ?? 0,
  };
  if (user.impersonatedBy) payload.impersonatedBy = user.impersonatedBy;

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);

  return token;
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

export async function getAuthCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  return cookie?.value || null;
}

export async function clearAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  // The parked admin token must not outlive the session that parked it. Left
  // behind, it sits in the browser as a live admin credential for whoever signs
  // in next — which is precisely how a legitimate employee ended up holding one.
  cookieStore.delete(IMPERSONATION_COOKIE_NAME);
}

/**
 * Drop any parked admin token without touching the current session.
 *
 * Used on a fresh login: authenticating as someone starts a new session, and a
 * new session must not inherit an escape hatch left by a previous one.
 */
export async function clearImpersonationCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE_NAME);
}

export async function refreshTokenIfNeeded(payload: JWTPayload): Promise<string | null> {
  if (!payload.iat) return null;
  const age = Date.now() - payload.iat * 1000;
  if (age > REFRESH_THRESHOLD_MS) {
    // Carry the version forward: refresh only runs on a token already confirmed
    // current, so its tv is the live one.
    return createToken({
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      tokenVersion: payload.tv ?? 0,
    });
  }
  return null;
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'setter' || value === 'closer';
}

interface SessionUserRecord {
  email?: string | null;
  name?: string | null;
  role?: unknown;
  market_id?: number | null;
  token_version?: number | null;
}

/** Pure session classification after signature verification and the user read. */
export function sessionFromUserRecord(
  payload: JWTPayload,
  user: SessionUserRecord | null
): AdminSessionResult {
  if (!user) return { status: 'unauthenticated', reason: 'deleted' };
  if ((user.token_version ?? 0) !== (payload.tv ?? 0)) {
    return { status: 'unauthenticated', reason: 'revoked' };
  }
  if (!isUserRole(user.role)) return { status: 'unavailable' };

  return {
    status: 'authenticated',
    admin: {
      ...payload,
      email: user.email || payload.email,
      name: user.name || payload.name,
      role: user.role,
      marketId: typeof user.market_id === 'number' ? user.market_id : null,
    },
  };
}

/**
 * Resolve the current session without confusing an invalid credential with a
 * database outage. Protected pages use the distinction to show a retry state
 * for service failures instead of sending a valid user back to sign-in.
 */
export async function resolveAdminSession(): Promise<AdminSessionResult> {
  const token = await getAuthCookie();
  if (!token) return { status: 'unauthenticated', reason: 'missing' };

  const payload = await verifyToken(token); // signature + expiry
  if (!payload) return { status: 'unauthenticated', reason: 'invalid' };

  // Session revocation: the token's version must still match the user's current
  // token_version. Bumping it (role/password change, "log out everywhere") or
  // deleting the user invalidates every outstanding token immediately. Fail
  // closed — a lookup error rejects rather than trusting a stale token.
  try {
    const { data: user, error } = await db()
      .from('admin_users')
      .select('email, name, role, market_id, token_version')
      .eq('id', payload.sub)
      .maybeSingle();

    if (error) return { status: 'unavailable' };
    return sessionFromUserRecord(payload, user);
  } catch {
    return { status: 'unavailable' };
  }
}

/** Compatibility boundary for API handlers that only need allow or deny. */
export async function getAuthenticatedAdmin(): Promise<AuthenticatedAdmin | null> {
  const session = await resolveAdminSession();
  return session.status === 'authenticated' ? session.admin : null;
}
