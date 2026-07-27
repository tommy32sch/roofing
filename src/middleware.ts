import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = new Set([
  '/api/admin/auth/login',
  '/admin/login',
]);

const PUBLIC_PREFIXES = ['/api/webhooks/'];

// Routes restricted to admin only. Integrations manage webhook API keys (a
// lead-injection credential) and settings hold global config + the Regrid API
// key, so neither should be reachable by setters/closers. The handlers also
// enforce this themselves — this list is the outer layer of defense.
const ADMIN_ONLY_PAGE_PREFIXES = ['/admin/users', '/admin/analytics', '/admin/settings', '/admin/integrations'];
const ADMIN_ONLY_API_PREFIXES = ['/api/admin/users', '/api/admin/analytics', '/api/admin/settings', '/api/admin/integrations'];

// Routes blocked for closers.
//
// Importing and adding leads are deliberately NOT here: every role can bring in
// leads now, and each one is stamped with the account that added it, so the
// question "who uploaded this list" has an answer without needing a gate.
const CLOSER_BLOCKED_PAGE_PREFIXES: string[] = [];
const CLOSER_BLOCKED_API_PREFIXES: string[] = [];

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
