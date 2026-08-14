import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('operations overview integration contracts', () => {
  const route = read('src/app/api/admin/operations-overview/route.ts');
  const loader = read('src/lib/reporting/operations.server.ts');
  const requestScope = read('src/lib/reporting/request-scope.server.ts');
  const page = read('src/app/admin/(app)/page.tsx');
  const client = read('src/components/reporting/operations-overview.tsx');

  it('authenticates and resolves report scope before loading service-role data', () => {
    expect(route).toContain('getAuthenticatedAdmin()');
    expect(route.indexOf('loadReportRequestScope(')).toBeLessThan(route.indexOf('loadOperationsOverview({'));
    expect(requestScope).toContain('resolveReportScope(');
    expect(loader).toContain('applyLeadAccessFilter');
    expect(loader).toContain('foreignTable,');
  });

  it('uses a dedicated response boundary with independently recoverable sections', () => {
    expect(route).toContain('OperationsOverviewResponse');
    expect(loader).toContain("section(\n      'exceptions'");
    expect(loader).toContain("section(\n      'metrics'");
    expect(loader).toContain("section(\n      'teamPulse'");
    expect(loader).toContain('partialErrors');
  });

  it('keeps scope in navigation state and leaves legacy stats routes alone', () => {
    expect(page).toContain('OperationsOverview');
    expect(client).toContain('useSearchParams()');
    expect(client).toContain('serializeReportScope(next)');
    expect(client).toContain('router.push');
    expect(route).not.toContain("/api/admin/stats");
    expect(route).not.toContain("/api/admin/contact-activity");
  });
});
