import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthenticatedAdmin } from '@/lib/auth/jwt';
import type { ReportMemberOption } from './contracts';
import { parseReportScopeUrl } from './scope';
import {
  resolveReportScope,
  type ResolvedReportScope,
} from './scope.server';
import type { UserRole } from '@/types';

const USER_ROLES = new Set<UserRole>(['admin', 'setter', 'closer']);

export type ReportRequestScopeResult =
  | {
      ok: true;
      resolved: ResolvedReportScope;
      members: ReportMemberOption[];
    }
  | { ok: false; status: 400 | 403 | 500; error: string };

/**
 * Load and validate the shared report scope before a service-role data query.
 *
 * Dashboard, Performance, Activity, and Analytics must use this boundary so a
 * future scope change cannot leave one reporting route with a wider policy.
 */
export async function loadReportRequestScope(
  client: SupabaseClient,
  admin: AuthenticatedAdmin,
  searchParams: URLSearchParams
): Promise<ReportRequestScopeResult> {
  const marketRequest = client
    .from('markets')
    .select('id')
    .eq('is_active', true);
  const memberRequest = admin.role === 'admin'
    ? client.from('admin_users').select('id, name, role').order('name')
    : Promise.resolve({
        data: [{ id: admin.sub, name: admin.name || admin.email, role: admin.role }],
        error: null,
      });
  const [markets, memberRows] = await Promise.all([marketRequest, memberRequest]);
  if (markets.error || memberRows.error) {
    return { ok: false, status: 500, error: 'Report scope options did not load' };
  }

  const members: ReportMemberOption[] = (memberRows.data ?? []).flatMap((member) =>
    USER_ROLES.has(member.role as UserRole)
      ? [{ id: member.id, name: member.name, role: member.role as UserRole }]
      : []
  );
  const resolution = resolveReportScope(parseReportScopeUrl(searchParams), {
    actor: {
      id: admin.sub,
      name: admin.name || admin.email,
      role: admin.role,
      homeMarketId: admin.marketId,
    },
    members,
    accessibleMarketIds: (markets.data ?? []).map((market) => market.id),
  });
  if (!resolution.ok) return resolution;
  return { ok: true, resolved: resolution.value, members };
}
