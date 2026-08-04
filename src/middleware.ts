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

/** Paths that need an authentication decision, as opposed to just a CSP. */
const GUARDED_PREFIXES = ['/admin', '/api/admin', '/api/webhooks'];

/**
 * A fresh nonce per request.
 *
 * Must be unguessable and must never repeat: a predictable or reused nonce
 * lets injected markup carry a valid one, which is the whole thing the nonce
 * prevents.
 */
function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Content Security Policy, rebuilt per request around that request's nonce.
 *
 * This replaced `script-src 'self' 'unsafe-inline'`, which permitted any inline
 * script on the page — meaning that if an XSS sink ever appeared, CSP would not
 * have slowed it down. 'unsafe-inline' was there because Next injects inline
 * hydration scripts; handing Next a nonce is what makes removing it possible.
 *
 * 'strict-dynamic' lets a script that already carries the nonce load further
 * scripts, which is how Next pulls in its chunks. It also makes 'self' and any
 * host allowlist ignored by browsers that understand it — which is the point:
 * trust flows from the nonce rather than from an origin, so injected markup
 * cannot run no matter where it claims to come from. 'self' stays as the
 * fallback for older browsers that ignore 'strict-dynamic'.
 *
 * Styles keep 'unsafe-inline' deliberately. React sets element styles directly
 * and Leaflet writes inline transforms on every pan, neither of which has a
 * nonce path, and injected CSS cannot execute — the exposure is not comparable
 * to script injection.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
    "font-src 'self'",
    // Geocoding runs server-side; the browser only talks to us and Supabase.
    "connect-src 'self' https://*.supabase.co",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export async function middleware(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp(nonce);

  /*
   * Next reads the nonce back out of this REQUEST header and stamps it onto the
   * inline hydration scripts it generates. Without this the page still loads,
   * but every one of those scripts is blocked and nothing hydrates — so the
   * request header is not optional bookkeeping, it is the mechanism.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = await route(request, requestHeaders);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

/**
 * The authentication decision.
 *
 * Split out because the matcher now covers every document so the CSP can reach
 * them all, which is wider than the set of paths that need an auth decision.
 * Anything outside GUARDED_PREFIXES passes straight through with only the
 * security headers applied.
 */
async function route(request: NextRequest, requestHeaders: Headers): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const guarded = GUARDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!guarded) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next({ request: { headers: requestHeaders } });
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

    return NextResponse.next({ request: { headers: requestHeaders } });
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
  /*
   * Every document, so the CSP reaches them all — the previous matcher covered
   * only guarded paths, and a policy that skips a page is not a policy.
   *
   * Next's own build output is excluded: those are static assets, CSP governs
   * documents, and running the edge function on every chunk would be pure cost.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
