import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = new Set([
  '/api/admin/auth/login',
  '/admin/login',
]);

const PUBLIC_PREFIXES = ['/api/webhooks/'];

// Routes restricted to admin only
const ADMIN_ONLY_PAGE_PREFIXES = ['/admin/users', '/admin/analytics'];
const ADMIN_ONLY_API_PREFIXES = ['/api/admin/users', '/api/admin/analytics'];

// Routes blocked for closers
const CLOSER_BLOCKED_PAGE_PREFIXES = ['/admin/leads/import', '/admin/leads/new'];
const CLOSER_BLOCKED_API_PREFIXES = ['/api/admin/import'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('admin_token')?.value;

  if (!token) {
    return handleUnauthenticated(request, pathname.startsWith('/api/'));
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return handleUnauthenticated(request, pathname.startsWith('/api/'));
    }

    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const role = payload.role as string | undefined;

    const isAPI = pathname.startsWith('/api/');

    if (ADMIN_ONLY_PAGE_PREFIXES.some(p => pathname.startsWith(p)) ||
        ADMIN_ONLY_API_PREFIXES.some(p => pathname.startsWith(p))) {
      if (role !== 'admin') {
        return handleForbidden(request, isAPI);
      }
    }

    if (CLOSER_BLOCKED_PAGE_PREFIXES.some(p => pathname.startsWith(p)) ||
        CLOSER_BLOCKED_API_PREFIXES.some(p => pathname.startsWith(p))) {
      if (role === 'closer') {
        return handleForbidden(request, isAPI);
      }
    }

    return NextResponse.next();
  } catch {
    return handleUnauthenticated(request, pathname.startsWith('/api/'));
  }
}

function handleUnauthenticated(request: NextRequest, isAPI: boolean): NextResponse {
  if (isAPI) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }

  const loginUrl = new URL('/admin/login', request.url);
  loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

function handleForbidden(request: NextRequest, isAPI: boolean): NextResponse {
  if (isAPI) {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 }
    );
  }

  return NextResponse.redirect(new URL('/admin?error=unauthorized', request.url));
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*', '/api/webhooks/:path*'],
};
