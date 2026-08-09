import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression guard: authenticated API responses must never be cacheable.
 *
 * None of the /api/admin routes set cache directives of their own, which makes
 * a plain 200 heuristically cacheable — and without Vary: Cookie the browser
 * will happily reuse one session's response for the next. The sharp edge is
 * /api/admin/auth/me remains an explicit session endpoint even though the
 * protected layout now loads its trusted shell directly on the server. It must
 * never become a reusable cross-session response.
 *
 * This is a static check because the failure is invisible in development until
 * two different users share a browser.
 */
const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');

describe('authenticated API cache headers', () => {
  it('declares a header block for the admin API', () => {
    expect(config).toMatch(/source:\s*'\/api\/admin\/:path\*'/);
  });

  it('sends no-store so a session-scoped response is never reused', () => {
    const block = config.slice(config.indexOf("'/api/admin/:path*'"));
    expect(block).toMatch(/'Cache-Control'/);
    expect(block).toMatch(/no-store/);
  });

  it('varies on Cookie, so any cache that does exist is keyed per session', () => {
    const block = config.slice(config.indexOf("'/api/admin/:path*'"));
    expect(block).toMatch(/'Vary'/);
    expect(block).toMatch(/Cookie/);
  });

  it('loads the protected shell directly on the server without a client identity request', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/admin/(app)/layout.tsx'), 'utf8');
    const loader = readFileSync(join(process.cwd(), 'src/lib/app-shell/server.ts'), 'utf8');
    expect(layout).toContain('await loadAppShell()');
    expect(layout).toContain("export const dynamic = 'force-dynamic'");
    expect(loader).not.toContain("fetch('/api/admin/auth/me");
  });
});
