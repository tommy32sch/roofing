import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Territory execution requests location only after a rep taps the
          // nearest-door control. Keep every other origin blocked.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          /*
           * Content-Security-Policy is NOT here — it moved to src/middleware.ts.
           *
           * The policy is now nonce-based, and a nonce has to be generated per
           * request, which a static header table cannot do. Setting one here as
           * well would not merely duplicate it: browsers enforce EVERY CSP
           * header they receive, so a second static policy would be intersected
           * with the nonce one and block Next's own scripts.
           */
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
