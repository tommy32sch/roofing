import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { db } from '@/lib/supabase/server';
import { dedupeKey, type StormType } from '@/lib/storm/parse';
import { eachDate, fetchDailyDate, mapLimit, FETCH_CONCURRENCY } from '@/lib/storm/fetch';

export const maxDuration = 60;

/** Two years. The window the stored history is loaded for. */
const MAX_DAYS = 730;
/** Cap on returned markers. A metro view holds a couple of hundred; this guards a zoomed-out one. */
const MAX_POINTS = 3000;
const TYPES = new Set<StormType>(['hail', 'wind']);

/**
 * How many recent days may be filled in live, per request.
 *
 * History comes from storm_reports (see migration 017 and `npm run storms`), but
 * a storm-restoration company needs TODAY's reports the day they happen, and the
 * backfill only runs when someone runs it. So a request tops up the tail of the
 * window from NOAA's daily feed. Bounded hard: this is a cache fill, not a
 * backfill, and it must never turn one map pan into hundreds of NOAA requests.
 */
const TOPUP_MAX_DAYS = 10;

/** Don't re-check for a top-up on every pan of the map. */
const TOPUP_COOLDOWN_MS = 10 * 60 * 1000;
const lastTopup = new Map<string, number>();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pull any of the last few days that the stored history doesn't have yet.
 *
 * Best-effort throughout: a NOAA hiccup must degrade to "slightly stale map",
 * never to a failed request.
 */
async function topUpRecent(type: StormType): Promise<void> {
  const last = lastTopup.get(type) ?? 0;
  if (Date.now() - last < TOPUP_COOLDOWN_MS) return;
  lastTopup.set(type, Date.now());

  try {
    const supabase = db();
    const { data, error } = await supabase
      .from('storm_reports')
      .select('occurred_on')
      .eq('type', type)
      .order('occurred_on', { ascending: false })
      .limit(1);
    if (error) return;

    const newest = (data?.[0] as { occurred_on?: string } | undefined)?.occurred_on;
    const today = todayIso();
    // Start the day AFTER the newest stored date, but never reach further back
    // than the top-up cap — an empty table is the backfill's job, not this.
    const from = newest && newest > isoDaysAgo(TOPUP_MAX_DAYS)
      ? eachDate(newest, today).slice(1) // exclude the day we already have
      : eachDate(isoDaysAgo(TOPUP_MAX_DAYS), today);
    const dates = from.slice(-TOPUP_MAX_DAYS);
    if (dates.length === 0) return;

    const perDay = await mapLimit(dates, FETCH_CONCURRENCY, (d) => fetchDailyDate(d, type));
    const rows = perDay.flat().map((r) => ({
      type: r.type,
      occurred_on: r.occurred_on,
      occurred_at: r.occurred_at,
      lat: r.lat,
      lon: r.lon,
      value: r.value,
      location: r.location,
      state: r.state,
      source: r.source,
      dedupe_key: dedupeKey(r),
    }));
    if (rows.length === 0) return;

    // ignoreDuplicates so a preliminary row can never overwrite the archive's
    // quality-controlled value for a date the backfill already settled.
    await supabase.from('storm_reports').upsert(rows, {
      onConflict: 'dedupe_key',
      ignoreDuplicates: true,
    });
  } catch {
    // Stale is fine; broken is not.
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { type } = await params;
    if (!TYPES.has(type as StormType)) {
      return NextResponse.json({ success: false, error: 'Invalid storm type' }, { status: 400 });
    }
    const stormType = type as StormType;

    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), MAX_DAYS);
    const minValue = parseFloat(searchParams.get('min') || '0') || 0;

    const [n, s, e, w] = ['n', 's', 'e', 'w'].map((k) => {
      const v = searchParams.get(k);
      return v === null ? null : parseFloat(v);
    });
    const hasBbox = [n, s, e, w].every((v) => v !== null && !Number.isNaN(v));

    await topUpRecent(stormType);

    let query = db()
      .from('storm_reports')
      .select('occurred_on, lat, lon, value, location, state', { count: 'exact' })
      .eq('type', stormType)
      .gte('occurred_on', isoDaysAgo(days))
      // Worst first, so a view that has to be capped keeps the reports that
      // actually qualify a roof rather than an arbitrary slice.
      .order('value', { ascending: false, nullsFirst: false })
      .limit(MAX_POINTS);

    if (minValue > 0) query = query.gte('value', minValue);
    if (hasBbox) {
      query = query.lte('lat', n!).gte('lat', s!).lte('lon', e!).gte('lon', w!);
    }

    const { data, error, count } = await query;
    if (error) {
      // Before migration 017 the table doesn't exist. Report it plainly rather
      // than a bare 500, so the cause is obvious.
      const missing = /storm_reports/.test(error.message);
      return NextResponse.json(
        {
          success: false,
          error: missing
            ? 'Storm history table is missing — apply migration 017, then run: npm run storms'
            : error.message,
        },
        { status: missing ? 503 : 500 }
      );
    }

    const reports = (data ?? []).map((r) => ({
      lat: r.lat,
      lon: r.lon,
      value: r.value,
      date: r.occurred_on,
      location: r.location ?? '',
      state: r.state ?? '',
    }));

    return NextResponse.json({
      success: true,
      type: stormType,
      reports,
      days,
      count: reports.length,
      total: count ?? reports.length,
      truncated: (count ?? 0) > reports.length,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
