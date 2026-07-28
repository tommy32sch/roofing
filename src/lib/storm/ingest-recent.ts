import type { SupabaseClient } from '@supabase/supabase-js';
import { dedupeKey, type ParsedReport, type StormType } from './parse';
import { FETCH_CONCURRENCY, fetchDailyDateResult, mapLimit } from './fetch';
import { recentStormDates, shouldUpdateStoredReport } from './alerts';

const TYPES: StormType[] = ['hail', 'wind'];
const DB_CHUNK_SIZE = 200;

interface ExistingReport {
  dedupe_key: string;
  source: 'daily' | 'archive';
  occurred_at: string | null;
  lat: number;
  lon: number;
  value: number | null;
  location: string | null;
  state: string | null;
}

export interface RefreshTypeResult {
  type: StormType;
  dates: string[];
  fetched: number;
  inserted: number;
  updated: number;
  failed_dates: string[];
}

export interface RecentRefreshResult {
  started_at: string;
  finished_at: string;
  types: RefreshTypeResult[];
}

function chunks<T>(values: T[], size = DB_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function reportRow(report: ParsedReport) {
  return {
    type: report.type,
    occurred_on: report.occurred_on,
    occurred_at: report.occurred_at,
    lat: report.lat,
    lon: report.lon,
    value: report.value,
    location: report.location,
    state: report.state,
    source: report.source,
    dedupe_key: dedupeKey(report),
  };
}

function reportChanged(existing: ExistingReport, incoming: ReturnType<typeof reportRow>): boolean {
  return existing.source !== incoming.source ||
    existing.occurred_at !== incoming.occurred_at ||
    Number(existing.lat) !== incoming.lat ||
    Number(existing.lon) !== incoming.lon ||
    (existing.value == null ? null : Number(existing.value)) !== incoming.value ||
    (existing.location ?? '') !== incoming.location ||
    (existing.state ?? '') !== incoming.state;
}

/**
 * Refresh NOAA's still-changing recent daily files.
 *
 * The same three dates are intentionally fetched on every run. A newest-date
 * cursor is wrong for a feed that grows throughout the day and accepts delayed
 * reports. Existing QC archive rows are never overwritten by preliminary data.
 */
export async function refreshRecentStormReports(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<RecentRefreshResult> {
  const startedAt = now.toISOString();
  const dates = recentStormDates(now);
  const results: RefreshTypeResult[] = [];

  for (const type of TYPES) {
    const { error: attemptError } = await supabase
      .from('storm_ingestion_state')
      .upsert({ type, last_attempt_at: startedAt }, { onConflict: 'type' });
    if (attemptError) throw new Error(attemptError.message);

    try {
      const fetchedByDate = await mapLimit(dates, FETCH_CONCURRENCY, async (date) => ({
        date,
        ...(await fetchDailyDateResult(date, type)),
      }));
      const failedDates = fetchedByDate.filter((result) => !result.ok).map((result) => result.date);
      const reports = fetchedByDate.flatMap((result) => result.reports);
      const rows = reports.map(reportRow);
      const existing = new Map<string, ExistingReport>();

      for (const keyChunk of chunks(rows.map((row) => row.dedupe_key))) {
        if (keyChunk.length === 0) continue;
        const { data, error } = await supabase
          .from('storm_reports')
          .select('dedupe_key, source, occurred_at, lat, lon, value, location, state')
          .in('dedupe_key', keyChunk);
        if (error) throw new Error(error.message);
        for (const row of (data ?? []) as ExistingReport[]) existing.set(row.dedupe_key, row);
      }

      const newRows = rows.filter((row) => !existing.has(row.dedupe_key));
      const updateRows = rows.filter((row) => {
        const stored = existing.get(row.dedupe_key);
        return stored
          ? shouldUpdateStoredReport(stored.source, row.source) && reportChanged(stored, row)
          : false;
      });

      let inserted = 0;
      for (const rowChunk of chunks(newRows)) {
        if (rowChunk.length === 0) continue;
        const { data, error } = await supabase
          .from('storm_reports')
          .upsert(rowChunk, { onConflict: 'dedupe_key', ignoreDuplicates: true })
          .select('id');
        if (error) throw new Error(error.message);
        inserted += data?.length ?? 0;
      }

      let updated = 0;
      for (const row of updateRows) {
        // The source predicate is the final precedence guard. If a yearly
        // archive replaced this row after the read above, this write affects 0.
        let query = supabase.from('storm_reports').update(row).eq('dedupe_key', row.dedupe_key);
        if (row.source === 'daily') query = query.eq('source', 'daily');
        const { data, error } = await query.select('id');
        if (error) throw new Error(error.message);
        updated += data?.length ?? 0;
      }

      const finished = new Date().toISOString();
      if (failedDates.length === 0) {
        const { error: healthError } = await supabase
          .from('storm_ingestion_state')
          .upsert({
            type,
            last_success_at: finished,
            last_new_report_at: inserted > 0 ? finished : undefined,
            consecutive_failures: 0,
            last_error: null,
          }, { onConflict: 'type' });
        if (healthError) throw new Error(healthError.message);
      } else {
        await recordIngestionFailure(
          supabase,
          type,
          `NOAA fetch failed for ${failedDates.join(', ')}`
        );
      }

      results.push({
        type,
        dates,
        fetched: reports.length,
        inserted,
        updated,
        failed_dates: failedDates,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ingestion error';
      await recordIngestionFailure(supabase, type, message);
      results.push({
        type,
        dates,
        fetched: 0,
        inserted: 0,
        updated: 0,
        failed_dates: [...dates],
      });
    }
  }

  return {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    types: results,
  };
}

async function recordIngestionFailure(
  supabase: SupabaseClient,
  type: StormType,
  message: string
) {
  const { data, error: readError } = await supabase
    .from('storm_ingestion_state')
    .select('consecutive_failures')
    .eq('type', type)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const previous = Number((data as { consecutive_failures?: number } | null)?.consecutive_failures) || 0;
  const { error: writeError } = await supabase
    .from('storm_ingestion_state')
    .upsert({
      type,
      consecutive_failures: previous + 1,
      last_error: message.slice(0, 1000),
    }, { onConflict: 'type' });
  if (writeError) throw new Error(writeError.message);
}
