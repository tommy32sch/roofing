import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { db } from '@/lib/supabase/server';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

  try {
    const supabase = db();
    const requested = Number(new URL(request.url).searchParams.get('limit') || DEFAULT_LIMIT);
    const limit = Number.isInteger(requested)
      ? Math.min(Math.max(requested, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const { data: subscriptions, error: subscriptionError } = await supabase
      .from('storm_alert_subscriptions')
      .select('market_id')
      .eq('user_id', admin.sub);
    if (subscriptionError) throw new Error(subscriptionError.message);
    const marketIds = [...new Set((subscriptions ?? []).map((row) => row.market_id))];
    if (marketIds.length === 0) {
      return NextResponse.json({ success: true, alerts: [], unread_count: 0 });
    }

    const [{ data: events, error: eventError }, { count: eventCount, error: countError },
      { data: reads, error: readError }, { count: readCount, error: readCountError }] = await Promise.all([
      supabase
        .from('storm_alert_events')
        .select('id, market_id, type, occurred_on, peak_value, report_count, closest_distance_miles, centroid_lat, centroid_lon, severity_band, updated_at, markets!inner(name)')
        .in('market_id', marketIds)
        .order('updated_at', { ascending: false })
        .limit(limit),
      supabase
        .from('storm_alert_events')
        .select('id', { count: 'exact', head: true })
        .in('market_id', marketIds),
      supabase
        .from('storm_alert_reads')
        .select('event_id, read_at')
        .eq('user_id', admin.sub)
        .in('market_id', marketIds),
      supabase
        .from('storm_alert_reads')
        .select('event_id', { count: 'exact', head: true })
        .eq('user_id', admin.sub)
        .in('market_id', marketIds),
    ]);
    const error = eventError || countError || readError || readCountError;
    if (error) throw new Error(error.message);
    const readMap = new Map((reads ?? []).map((read) => [read.event_id, read.read_at]));

    const alerts = (events ?? []).map((event) => {
      const marketJoin = event.markets as unknown as { name?: string } | { name?: string }[] | null;
      const marketName = Array.isArray(marketJoin) ? marketJoin[0]?.name : marketJoin?.name;
      return {
        id: event.id,
        market_id: event.market_id,
        market_name: marketName ?? 'Unknown market',
        type: event.type,
        occurred_on: event.occurred_on,
        peak_value: event.peak_value == null ? null : Number(event.peak_value),
        report_count: Number(event.report_count),
        closest_distance_miles: Number(event.closest_distance_miles),
        centroid_lat: Number(event.centroid_lat),
        centroid_lon: Number(event.centroid_lon),
        severity_band: Number(event.severity_band),
        updated_at: event.updated_at,
        read_at: readMap.get(event.id) ?? null,
      };
    });
    return NextResponse.json({
      success: true,
      alerts,
      unread_count: Math.max(0, (eventCount ?? 0) - (readCount ?? 0)),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
