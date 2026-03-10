import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = new Set([
  '/api/admin/auth/login',
  '/admin/login',
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
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

    await jwtVerify(token, new TextEncoder().encode(secret));
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

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
