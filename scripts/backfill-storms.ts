/**
 * Load NOAA severe-weather history into the storm_reports table.
 *
 * Run after applying migration 017, then periodically to top up recent days:
 *   npm run storms                 # last 2 years (the default window)
 *   npm run storms -- --years 1    # shorter window
 *   npm run storms -- --days 7     # just top up recent days (cheap, run often)
 *
 * Idempotent: every row carries a dedupe_key and is upserted, so re-running
 * costs nothing and re-fetching a day already covered by NOAA's quality-
 * controlled yearly archive will not downgrade it back to the preliminary value.
 */
import { createClient } from '@supabase/supabase-js';
import { dedupeKey, dedupeReports, type ParsedReport, type StormType } from '../src/lib/storm/parse';
import {
  planStormFetch,
  archiveYearExists,
  fetchArchiveYear,
  fetchDailyDate,
  mapLimit,
  FETCH_CONCURRENCY,
} from '../src/lib/storm/fetch';

const TYPES: StormType[] = ['hail', 'wind'];
const UPSERT_CHUNK = 1000;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const db = createClient(url, key);

  const days = arg('days');
  const years = arg('years');
  const windowDays = days ? Number(days) : Math.round((years ? Number(years) : 2) * 365.25);
  if (!Number.isFinite(windowDays) || windowDays < 1) {
    console.error('Invalid window');
    process.exit(1);
  }

  const end = isoDaysAgo(0);
  const start = isoDaysAgo(windowDays);
  console.log(`Loading storm reports ${start} .. ${end} (${windowDays} days)\n`);

  // Confirm the table is really there. A missing-table error reads as an empty
  // result on some queries, so ask for a row rather than a count.
  const probe = await db.from('storm_reports').select('id').limit(1);
  if (probe.error) {
    console.error(`storm_reports is not queryable — has migration 017 been applied?\n  ${probe.error.message}`);
    process.exit(1);
  }

  let grandTotal = 0;

  for (const type of TYPES) {
    // Which years NOAA has published an archive for. Probed rather than assumed:
    // the current year never has one, and last year's appears at some point
    // after it ends.
    const spanYears: number[] = [];
    for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) spanYears.push(y);
    const available: number[] = [];
    for (const y of spanYears) {
      if (await archiveYearExists(y, type)) available.push(y);
    }

    const plan = planStormFetch(start, end, available);
    console.log(
      `[${type}] archive years: ${plan.archiveYears.join(', ') || 'none'} · ` +
        `daily files: ${plan.dailyDates.length}`
    );

    const collected: ParsedReport[] = [];

    for (const year of plan.archiveYears) {
      const rows = await fetchArchiveYear(year, type);
      // The archive file spans the whole year; keep only the requested window.
      const kept = rows.filter((r) => r.occurred_on >= start && r.occurred_on <= end);
      console.log(`  ${year} archive: ${rows.length} rows, ${kept.length} in window`);
      collected.push(...kept);
    }

    if (plan.dailyDates.length) {
      let done = 0;
      const perDay = await mapLimit(plan.dailyDates, FETCH_CONCURRENCY, async (date) => {
        const rows = await fetchDailyDate(date, type);
        if (++done % 50 === 0) console.log(`  daily ${done}/${plan.dailyDates.length}…`);
        return rows;
      });
      const dailyRows = perDay.flat();
      console.log(`  daily: ${dailyRows.length} rows from ${plan.dailyDates.length} files`);
      collected.push(...dailyRows);
    }

    const unique = dedupeReports(collected);
    console.log(`  ${collected.length} fetched -> ${unique.length} unique`);

    for (let i = 0; i < unique.length; i += UPSERT_CHUNK) {
      const chunk = unique.slice(i, i + UPSERT_CHUNK).map((r) => ({
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
      const { error } = await db.from('storm_reports').upsert(chunk, { onConflict: 'dedupe_key' });
      if (error) {
        console.error(`  upsert failed at ${i}: ${error.message}`);
        process.exit(1);
      }
    }
    console.log(`  stored ${unique.length} ${type} reports\n`);
    grandTotal += unique.length;
  }

  const { count } = await db.from('storm_reports').select('id', { count: 'exact', head: true });
  console.log(`Done. ${grandTotal} reports processed this run; ${count ?? '?'} rows in storm_reports.`);
}

main();
