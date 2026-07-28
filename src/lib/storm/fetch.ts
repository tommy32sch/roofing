import { parseDailyCsv, parseArchiveCsv, type ParsedReport, type StormType } from './parse';

/**
 * Fetching NOAA SPC reports for a date range.
 *
 * Two feeds, chosen per year: NOAA publishes a quality-controlled file per
 * COMPLETED year, and one file per day for recent dates. Pulling a whole year in
 * a single request instead of 365 is the difference between a backfill that
 * takes seconds and one that hammers a public service with hundreds of requests.
 */

const DAILY_BASE = 'https://www.spc.noaa.gov/climo/reports';
const ARCHIVE_BASE = 'https://www.spc.noaa.gov/wcm/data';
const UA = 'RoofLeadsCRM/1.0 (storm history backfill; +https://roofing-ebon.vercel.app)';

/** Politeness cap on simultaneous requests to NOAA. */
export const FETCH_CONCURRENCY = 8;

export interface FetchPlan {
  /** Years to pull as a single archive file. */
  archiveYears: number[];
  /** Individual dates ("YYYY-MM-DD") with no archive coverage. */
  dailyDates: string[];
}

/** Iterate "YYYY-MM-DD" from start to end inclusive, in UTC to avoid DST drift. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(last.getTime())) return out;
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Decide how to cover [start, end]: one request per archive-covered year, plus a
 * daily request for every date the archive can't supply.
 *
 * A year is only taken from the archive when it is FULLY inside the requested
 * range. A partial year still comes from the archive file — it holds the whole
 * year and the caller filters — so `archiveYears` includes any year present in
 * `available` that the range touches, and those dates are excluded from
 * `dailyDates`.
 *
 * @param available years NOAA has published an archive for; the current year
 *   never appears, which is exactly why the daily feed is still needed.
 */
export function planStormFetch(start: string, end: string, available: number[]): FetchPlan {
  const archive = new Set(available);
  const archiveYears = new Set<number>();
  const dailyDates: string[] = [];

  for (const date of eachDate(start, end)) {
    const year = Number(date.slice(0, 4));
    if (archive.has(year)) archiveYears.add(year);
    else dailyDates.push(date);
  }

  return { archiveYears: [...archiveYears].sort((a, b) => a - b), dailyDates };
}

async function get(url: string, timeoutMs = 30000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** True when NOAA has published an archive file for this year and type. */
export async function archiveYearExists(year: number, type: StormType): Promise<boolean> {
  try {
    const res = await fetch(`${ARCHIVE_BASE}/${year}_${type}.csv`, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Every report in a published year. ~1–3 MB per file. */
export async function fetchArchiveYear(year: number, type: StormType): Promise<ParsedReport[]> {
  const text = await get(`${ARCHIVE_BASE}/${year}_${type}.csv`, 60000);
  return text ? parseArchiveCsv(text, type) : [];
}

/** Reports for a single date from the daily preliminary feed. */
export async function fetchDailyDate(date: string, type: StormType): Promise<ParsedReport[]> {
  return (await fetchDailyDateResult(date, type)).reports;
}

/**
 * Reports plus transport health for one preliminary daily file.
 *
 * The map only needs a list and deliberately treats a NOAA outage like an empty
 * day. Scheduled ingestion cannot: an empty file is a valid success, while a
 * timeout/404 must make the stored freshness health go stale. Keep the richer
 * result here so both callers share the exact same URL, parser, and timeout.
 */
export async function fetchDailyDateResult(
  date: string,
  type: StormType
): Promise<{ ok: boolean; reports: ParsedReport[] }> {
  const [y, m, d] = date.split('-');
  const text = await get(`${DAILY_BASE}/${y.slice(2)}${m}${d}_rpts_${type}.csv`, 15000);
  return text === null
    ? { ok: false, reports: [] }
    : { ok: true, reports: parseDailyCsv(text, date, type) };
}

/** Run `worker` over `items` with a bounded number in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}
