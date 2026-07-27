import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // Next/React production bundles don't use eval; keep 'unsafe-eval' only in
    // dev (React Refresh / source maps need it). 'unsafe-inline' stays because
    // Next injects inline hydration scripts without a nonce.
    const isDev = process.env.NODE_ENV !== 'production';
    const scriptSrc = `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`;
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
      {
        // Every authenticated API response is scoped to one user, and none of
        // them carry cache directives of their own — which makes a plain 200
        // heuristically cacheable and, without Vary: Cookie, reusable across
        // sessions. /api/admin/auth/me is the sharp edge: the layout reads it
        // on every page load to decide whose name and navigation to render, so
        // a cached copy shows the PREVIOUS user's identity to the person who
        // just signed in.
        source: '/api/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'Vary', value: 'Cookie' },
        ],
      },
    ];
  },
};

export default nextConfig;
