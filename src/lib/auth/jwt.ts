import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const COOKIE_NAME = 'admin_token';
const TOKEN_EXPIRY = '24h';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours
const REFRESH_THRESHOLD_MS = 12 * 60 * 60 * 1000; // Refresh after 12 hours

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

export async function createToken(user: {
  id: string;
  email: string;
  name: string;
}): Promise<string> {
  const token = await new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
  })
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
}

export async function refreshTokenIfNeeded(payload: JWTPayload): Promise<string | null> {
  if (!payload.iat) return null;
  const age = Date.now() - payload.iat * 1000;
  if (age > REFRESH_THRESHOLD_MS) {
    return createToken({ id: payload.sub, email: payload.email, name: payload.name });
  }
  return null;
}

export async function getAuthenticatedAdmin(): Promise<JWTPayload | null> {
  const token = await getAuthCookie();
  if (!token) return null;
  return verifyToken(token);
}
