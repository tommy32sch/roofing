import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { sanitizeSearch } from '@/lib/utils/lead-query';
import { LIMITS } from '@/lib/utils/validation';
import type { ReportMemberOption } from '@/lib/reporting/contracts';
import { parseReportScopeUrl } from '@/lib/reporting/scope';
import { resolveReportScope } from '@/lib/reporting/scope.server';
import type { UserRole } from '@/types';

const AUDIT_TYPES = new Set([
  'note',
  'call',
  'email',
  'visit',
  'status_change',
  'created',
  'updated',
  'bulk_assignment',
]);

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

interface AuditFeedRow {
  item_kind: 'activity' | 'operation';
  item_id: string;
  activity_type: string;
  content: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
  actor_name: string | null;
  lead: Record<string, unknown> | null;
  operation: Record<string, unknown> | null;
  total_count: number | string;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = positiveInteger(searchParams.get('page'), 1);
    const limit = Math.min(positiveInteger(searchParams.get('limit'), 50), 100);
    const offset = (page - 1) * limit;

    const type = searchParams.get('type') || null;
    if (type && !AUDIT_TYPES.has(type)) {
      return NextResponse.json({ success: false, error: 'Invalid activity type' }, { status: 400 });
    }
    if (type === 'bulk_assignment' && admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Invalid activity type' }, { status: 400 });
    }

    const rawQuery = searchParams.get('q') || '';
    if (rawQuery.length > LIMITS.SEARCH_QUERY) {
      return NextResponse.json({ success: false, error: 'Search is too long' }, { status: 400 });
    }
    const query = sanitizeSearch(rawQuery) || null;

    const supabase = db();
    const marketRequest = supabase
      .from('markets')
      .select('id')
      .eq('is_active', true);
    const memberRequest = admin.role === 'admin'
      ? supabase.from('admin_users').select('id, name, role').order('name')
      : Promise.resolve({
          data: [{ id: admin.sub, name: admin.name || admin.email, role: admin.role }],
          error: null,
        });
    const [marketRows, memberRows] = await Promise.all([marketRequest, memberRequest]);
    if (marketRows.error || memberRows.error) {
      return NextResponse.json(
        { success: false, error: 'Audit scope options did not load' },
        { status: 500 }
      );
    }

    const roles = new Set<UserRole>(['admin', 'setter', 'closer']);
    const members: ReportMemberOption[] = (memberRows.data ?? []).flatMap((member) =>
      roles.has(member.role as UserRole)
        ? [{ id: member.id, name: member.name, role: member.role as UserRole }]
        : []
    );
    const resolved = resolveReportScope(parseReportScopeUrl(searchParams), {
      actor: {
        id: admin.sub,
        name: admin.name || admin.email,
        role: admin.role,
        homeMarketId: admin.marketId,
      },
      members,
      accessibleMarketIds: (marketRows.data ?? []).map((market) => market.id),
    });
    if (!resolved.ok) {
      return NextResponse.json(
        { success: false, error: resolved.error },
        { status: resolved.status }
      );
    }

    const commonParams = {
      p_limit: limit,
      p_offset: offset,
      p_market_id: resolved.value.scope.marketId,
      p_type: type,
      p_from: resolved.value.scope.from,
      p_to: resolved.value.scope.to,
      p_query: query,
    };

    const result = admin.role === 'admin'
      ? await supabase.rpc('list_admin_audit_feed', {
          ...commonParams,
          p_user_id: resolved.value.activityUserId,
        })
      : await supabase.rpc('list_rep_audit_feed', {
          ...commonParams,
          p_actor_id: admin.sub,
          p_actor_role: admin.role,
        });

    if (result.error) {
      return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    }

    const items = (result.data ?? []) as AuditFeedRow[];
    const total = items.length > 0 ? Number(items[0].total_count) : 0;

    return NextResponse.json({
      success: true,
      items: items.map((item) => ({
        item_kind: item.item_kind,
        item_id: item.item_id,
        activity_type: item.activity_type,
        content: item.content,
        old_status: item.old_status,
        new_status: item.new_status,
        created_at: item.created_at,
        actor_name: item.actor_name,
        lead: item.lead,
        operation: item.operation,
      })),
      total,
      page,
      limit,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
