import { resolveAdminSession } from '@/lib/auth/jwt';
import { permissionsForRole } from '@/lib/auth/permissions';
import { db } from '@/lib/supabase/server';
import type { AppShellIssue, AppShellLoadResult } from './types';
import type { Market } from '@/types';

/**
 * Load the trusted, request-scoped data needed by every protected screen.
 *
 * This function is called directly by a Server Component. It is intentionally
 * not wrapped in a cross-request cache because every field is session-scoped.
 */
export async function loadAppShell(): Promise<AppShellLoadResult> {
  const session = await resolveAdminSession();
  if (session.status === 'unauthenticated') return { status: 'unauthenticated' };
  if (session.status === 'unavailable') return { status: 'unavailable' };

  try {
    const supabase = db();
    const [settingsResult, marketsResult] = await Promise.all([
      supabase
        .from('app_settings')
        .select('company_name')
        .eq('id', 'default')
        .maybeSingle(),
      supabase
        .from('markets')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
        .order('name'),
    ]);

    const issues: AppShellIssue[] = [];
    if (settingsResult.error) {
      issues.push({
        code: 'company_unavailable',
        message: 'Company settings are temporarily unavailable.',
      });
    }
    if (marketsResult.error) {
      issues.push({
        code: 'markets_unavailable',
        message: 'Office filters are temporarily unavailable.',
      });
    }

    const admin = session.admin;
    return {
      status: 'ready',
      data: {
        user: {
          id: admin.sub,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          homeMarketId: admin.marketId,
        },
        company: {
          name: settingsResult.data?.company_name || 'Roof Leads',
        },
        markets: (marketsResult.error ? [] : marketsResult.data ?? []) as Market[],
        permissions: permissionsForRole(admin.role),
        session: {
          isImpersonating: Boolean(admin.impersonatedBy),
          impersonatedById: admin.impersonatedBy ?? null,
        },
        issues,
        loadedAt: new Date().toISOString(),
      },
    };
  } catch {
    return { status: 'unavailable' };
  }
}
