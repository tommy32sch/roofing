import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const protectedLayout = read('src/app/admin/(app)/layout.tsx');
const login = read('src/app/admin/login/page.tsx');
const provider = read('src/components/providers/app-shell-provider.tsx');
const marketHook = read('src/components/markets/use-markets.ts');
const adminShell = read('src/components/layout/admin-shell.tsx');
const sidebar = read('src/components/layout/app-sidebar.tsx');
const globalStyles = read('src/app/globals.css');
const serviceWorker = read('src/components/providers/service-worker.tsx');
const clientSources = [
  adminShell,
  marketHook,
  read('src/app/admin/(app)/page.tsx'),
  read('src/app/admin/(app)/leads/page.tsx'),
  read('src/app/admin/(app)/map/page.tsx'),
  read('src/app/admin/(app)/today/page.tsx'),
  read('src/app/admin/(app)/performance/page.tsx'),
  read('src/app/admin/(app)/users/page.tsx'),
  read('src/app/admin/(app)/leads/[leadId]/page.tsx'),
].join('\n');

describe('trusted application shell contracts', () => {
  it('keeps login outside the protected shell and gates protected children on server data', () => {
    expect(protectedLayout).toContain('await loadAppShell()');
    expect(protectedLayout).toContain("result.status === 'unauthenticated'");
    expect(protectedLayout).toContain('<AppShellProvider data={result.data}>');
    expect(protectedLayout).toContain('<AdminShell>{children}</AdminShell>');
    expect(login).not.toContain('AppShellProvider');
  });

  it('does not fetch identity or market lists from protected client pages', () => {
    expect(clientSources).not.toContain('/api/admin/auth/me');
    expect(marketHook).not.toContain("fetch('/api/admin/markets");
  });

  it('reuses the authenticated home market instead of reading the user twice', () => {
    const marketContext = read('src/lib/leads/market-context.ts');
    const statsRoute = read('src/app/api/admin/stats/route.ts');
    expect(marketContext).not.toContain("from('admin_users')");
    expect(statsRoute).toContain('marketFilterFor(admin.marketId');
  });

  it('has no privileged fallback while trusted identity is unknown', () => {
    expect(clientSources).not.toMatch(/useState<UserRole>\(['"]admin['"]\)/);
    expect(clientSources).not.toContain("setUserRole(d.admin.role)");
  });

  it('keeps theme-toggle markup stable while CSS selects the active icon', () => {
    expect(adminShell).not.toContain("theme === 'dark'");
    expect(adminShell).toContain('className="h-4 w-4 dark:hidden"');
    expect(adminShell).toContain('className="hidden h-4 w-4 dark:block"');
  });

  it('uses a product-specific work rail without decorative global elevation', () => {
    expect(adminShell).toContain('getNavLocation(pathname, user.role)');
    expect(sidebar).toContain('<RoofMark');
    expect(sidebar).toContain('border-l-2');
    expect(globalStyles).not.toContain('--ambient');
    expect(globalStyles).not.toContain('[data-slot="card"]:hover');
  });

  it('does not let the production service worker cache stable development asset URLs', () => {
    expect(serviceWorker).toContain("process.env.NODE_ENV !== 'production'");
    expect(serviceWorker).toContain("navigator.serviceWorker.register('/sw.js'");
  });

  it('owns the browser connection subscription once in the provider', () => {
    expect(provider).toContain('useSyncExternalStore');
    expect(provider.match(/addEventListener\('online'/g)).toHaveLength(1);
    expect(read('src/lib/offline/useOfflineTerritories.ts')).not.toContain(
      "addEventListener('online'"
    );
    expect(read('src/lib/offline/useLeadResultOutbox.ts')).not.toContain(
      "addEventListener('online'"
    );
  });

  it('gives primary data screens an error state before their empty state', () => {
    for (const page of [
      read('src/app/admin/(app)/leads/page.tsx'),
      read('src/app/admin/(app)/today/page.tsx'),
      read('src/app/admin/(app)/performance/page.tsx'),
      read('src/app/admin/(app)/analytics/page.tsx'),
      read('src/app/admin/(app)/calendar/page.tsx'),
      read('src/app/admin/(app)/activity/page.tsx'),
    ]) {
      expect(page).toContain('DataErrorState');
    }

    const operationsOverview = read('src/components/reporting/operations-overview.tsx');
    expect(operationsOverview).toContain('<ReportState');
    expect(operationsOverview).toContain('variant="error"');

    const map = read('src/app/admin/(app)/map/page.tsx');
    expect(map).toContain('leadError &&');
    expect(map).toContain('Map leads did not refresh.');
    expect(map).toContain('onClick={() => void fetchLeads()}');
  });
});
