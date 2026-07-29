import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Static guard for the performance route.
 *
 * This route hands one rep's numbers to whoever asks, so the scoping rules are
 * the security boundary: a setter must never be able to read the team's figures
 * by editing a query string, and a blended cross-office rate describes neither
 * office. Both are easy to drop in a refactor and neither fails loudly.
 */
const route = readFileSync(
  join(process.cwd(), 'src/app/api/admin/performance/route.ts'),
  'utf8'
);

describe('performance route contract', () => {
  it('authenticates before reading anything', () => {
    expect(route).toMatch(/getAuthenticatedAdmin\(\)/);
    const authAt = route.indexOf('getAuthenticatedAdmin()');
    const queryAt = route.indexOf(".from('leads')");
    expect(authAt).toBeGreaterThan(-1);
    expect(queryAt).toBeGreaterThan(authAt);
  });

  // The scoping decision must come from the token's role, never from a param.
  it('restricts non-admins to their own row server-side', () => {
    expect(route).toMatch(/admin\.role === 'admin'/);
    expect(route).toMatch(/\.eq\('id',\s*admin\.sub\)/);
  });

  it('never takes the reported user set from the query string', () => {
    expect(route).not.toMatch(/params\.get\(['"]user_ids?['"]\)/);
  });

  // A trend request names a user; it must be checked against the scoped set
  // rather than trusted, or a setter could read a colleague's history.
  it('validates the trend user against the permitted set', () => {
    expect(route).toMatch(/userIds\.includes\(trendFor\)/);
  });

  it('keeps office scoping on the lead query', () => {
    expect(route).toMatch(/marketFilterFor\(/);
    expect(route).toMatch(/applyMarketFilter\(/);
  });

  // A server-derived window would put a Phoenix rep in tomorrow during their
  // afternoon, because this runs in UTC.
  it('takes the reporting window from the client rather than deriving it', () => {
    expect(route).toMatch(/params\.get\('from'\)/);
    expect(route).toMatch(/params\.get\('to'\)/);
  });
});
