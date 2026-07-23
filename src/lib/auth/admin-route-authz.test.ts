import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression guard for the admin-only access-control fix.
 *
 * Integration API keys are lead-injection credentials and settings hold the
 * Regrid API key, so both families must be admin-only. A security review found
 * they were reachable by any authenticated setter/closer. This test encodes the
 * invariant statically so an accidental edit can't silently reopen the hole —
 * it fails if either defense layer is removed:
 *   1. the middleware admin-only prefix list, and
 *   2. an in-handler `role !== 'admin'` check in every exported handler.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const ADMIN_ONLY_PREFIXES = [
  '/api/admin/users',
  '/api/admin/analytics',
  '/api/admin/settings',
  '/api/admin/integrations',
];

// Route files whose every exported handler must self-check admin role.
const ADMIN_ONLY_ROUTES = [
  'src/app/api/admin/settings/route.ts',
  'src/app/api/admin/integrations/route.ts',
  'src/app/api/admin/integrations/[keyId]/route.ts',
  'src/app/api/admin/integrations/logs/route.ts',
  'src/app/api/admin/integrations/email-logs/route.ts',
  'src/app/api/admin/integrations/regrid/route.ts',
];

describe('admin-only route access control', () => {
  it('middleware lists every sensitive API prefix as admin-only', () => {
    const mw = read('src/middleware.ts');
    const listMatch = mw.match(/ADMIN_ONLY_API_PREFIXES\s*=\s*\[([^\]]*)\]/);
    expect(listMatch, 'ADMIN_ONLY_API_PREFIXES not found in middleware').toBeTruthy();
    const list = listMatch![1];
    for (const prefix of ADMIN_ONLY_PREFIXES) {
      expect(list, `middleware admin-only list is missing ${prefix}`).toContain(prefix);
    }
  });

  it.each(ADMIN_ONLY_ROUTES)('%s gates every handler on admin role', (path) => {
    const src = read(path);
    const handlerCount = (src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) || []).length;
    const gateCount = (src.match(/role !== 'admin'/g) || []).length;
    expect(handlerCount, `${path} has no exported handlers`).toBeGreaterThan(0);
    // Each handler needs its own admin gate.
    expect(gateCount, `${path}: ${gateCount} admin gates for ${handlerCount} handlers`).toBe(handlerCount);
  });
});
