import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyMarketFilter } from '@/lib/leads/markets';
import {
  computeRepMetrics,
  repTrend,
  weekStart,
  type MetricsLead,
  type MetricsEvent,
  type MetricsAppointment,
  type RepMetrics,
} from '@/lib/leads/rep-metrics';

export type { RepMetrics };

/**
 * Per-rep performance.
 *
 * The reporting window arrives from the CLIENT as explicit instants rather than
 * being derived here, because a Phoenix rep's "this week" is not the same pair
 * of instants as a Minnesota rep's and this server runs in UTC. Same reasoning
 * as the dashboard contact-activity route.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = db();
    const params = new URL(request.url).searchParams;
    const trendFor = params.get('trend_user_id');

    const isoOrNull = (value: string | null) =>
      value && !Number.isNaN(Date.parse(value)) ? value : null;
    const windowFrom = isoOrNull(params.get('from'));
    const windowTo = isoOrNull(params.get('to'));

    // Role scoping is server-side, never a UI filter: a rep may only ever see
    // their own numbers.
    let users: { id: string; name: string; role: string }[] = [];
    if (admin.role === 'admin') {
      const { data } = await supabase.from('admin_users').select('id, name, role').order('name');
      users = data ?? [];
    } else {
      const { data } = await supabase
        .from('admin_users')
        .select('id, name, role')
        .eq('id', admin.sub)
        .single();
      if (data) users = [data];
    }

    if (users.length === 0) {
      return NextResponse.json({ success: true, reps: [], trend: null });
    }
    const userIds = users.map((u) => u.id);

    // Office scoping: a blended close rate across two offices describes neither.
    const marketId = await marketFilterFor(admin.sub, params.get('market_id'));

    const { data: leadRows } = await applyMarketFilter(
      supabase
        .from('leads')
        .select('id, status, deal_value, assigned_setter_id, assigned_closer_id, created_at')
        .or(
          `assigned_setter_id.in.(${userIds.join(',')}),assigned_closer_id.in.(${userIds.join(',')})`
        )
        .eq('is_flagged_duplicate', false),
      marketId
    );
    const leads = (leadRows ?? []) as MetricsLead[];

    // Activity is fetched by ACTOR, not by lead assignment — a rep covering
    // someone else's territory still did that work, and it would disappear if it
    // were only counted against leads assigned to them.
    const [{ data: knockRows }, { data: callRows }, { data: apptRows }] = await Promise.all([
      supabase.from('lead_knocks').select('lead_id, created_by, knocked_at').in('created_by', userIds),
      supabase.from('lead_calls').select('lead_id, created_by, called_at').in('created_by', userIds),
      supabase.from('lead_appointments').select('lead_id, created_by, scheduled_at, outcome'),
    ]);

    const knocks: MetricsEvent[] = (knockRows ?? []).map(
      (k: { lead_id: string; created_by: string | null; knocked_at: string }) => ({
        lead_id: k.lead_id,
        created_by: k.created_by,
        occurred_at: k.knocked_at,
      })
    );
    const calls: MetricsEvent[] = (callRows ?? []).map(
      (c: { lead_id: string; created_by: string | null; called_at: string }) => ({
        lead_id: c.lead_id,
        created_by: c.created_by,
        occurred_at: c.called_at,
      })
    );
    const appointments = (apptRows ?? []) as MetricsAppointment[];

    const reps = computeRepMetrics({
      users,
      leads,
      knocks,
      calls,
      appointments,
      from: windowFrom,
      to: windowTo,
    });

    // Trend is computed only when a rep is opened, so the leaderboard itself
    // stays a single cheap pass.
    let trend: { userId: string; points: ReturnType<typeof repTrend> } | null = null;
    if (trendFor && userIds.includes(trendFor)) {
      trend = {
        userId: trendFor,
        points: repTrend({
          userId: trendFor,
          leads,
          knocks,
          calls,
          appointments,
          weeks: recentWeeks(12, windowTo),
        }),
      };
    }

    return NextResponse.json({ success: true, reps, trend });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** The last `count` Monday-anchored weeks, oldest first. */
function recentWeeks(count: number, endIso?: string | null): string[] {
  const anchor = endIso && !Number.isNaN(Date.parse(endIso)) ? Date.parse(endIso) : Date.now();
  const thisWeek = weekStart(new Date(anchor).toISOString());
  if (!thisWeek) return [];
  const weeks: string[] = [];
  const start = Date.parse(`${thisWeek}T00:00:00Z`);
  for (let i = count - 1; i >= 0; i--) {
    weeks.push(new Date(start - i * 7 * 86_400_000).toISOString().slice(0, 10));
  }
  return weeks;
}
