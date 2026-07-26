/**
 * Parsers for NOAA SPC severe-weather reports.
 *
 * Two sources with DIFFERENT formats and — critically — different units:
 *
 *   1. Daily preliminary reports (spc.noaa.gov/climo/reports/YYMMDD_rpts_TYPE.csv)
 *      Columns: Time,Size|Speed,Location,County,State,Lat,Lon,Comments
 *      Hail size in HUNDREDTHS of an inch (100 = 1.00"). Wind speed in MPH.
 *      Covers roughly the last 3 years, one file per day. The only source for
 *      the current year.
 *
 *   2. Per-year QC'd archive (spc.noaa.gov/wcm/data/YYYY_TYPE.csv)
 *      Columns: om,yr,mo,dy,date,time,tz,st,...,mag,...,slat,slon,...
 *      Hail magnitude already in INCHES. **Wind magnitude in KNOTS.**
 *      Published for completed years only (2020–2025 at time of writing).
 *
 * The knots/mph difference is the trap here. Verified by cross-matching the same
 * reports in both sources on 2025-07-24: archive 52 -> daily 60 mph, archive 50
 * -> daily 58 mph, ratio 1.154 = exactly 1 knot. Left unconverted, every
 * historical wind report reads 15% low, so a genuinely severe 58 mph gust would
 * fall below the severe threshold and paint in the wrong colour band.
 *
 * Everything here normalises to ONE representation: hail in inches, wind in mph.
 */

export type StormType = 'hail' | 'wind';

/** NWS/SPC conversion. 50 kt — the severe criterion — is 57.5 mph. */
export const KNOTS_TO_MPH = 1.15078;

export interface ParsedReport {
  type: StormType;
  /** Calendar date of the report, "YYYY-MM-DD". */
  occurred_on: string;
  /** Local time of day, "HH:MM", or null when unparseable. */
  occurred_at: string | null;
  lat: number;
  lon: number;
  /** Hail inches or wind mph. Null for a damage-only report with no measurement. */
  value: number | null;
  /** City/place, when the source provides one. The archive has no place names. */
  location: string;
  state: string;
  /** Which feed this came from; the archive is authoritative. */
  source: 'daily' | 'archive';
}

/** Normalise a time to "HH:MM": "0025" -> "00:25", "14:37:00" -> "14:37". */
export function normalizeTime(raw: string | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  if (/^\d{2}:\d{2}/.test(t)) return t.slice(0, 5);
  if (/^\d{3,4}$/.test(t)) {
    const p = t.padStart(4, '0');
    return `${p.slice(0, 2)}:${p.slice(2, 4)}`;
  }
  return null;
}

/**
 * Stable identity for a report, so the same storm arriving from both feeds
 * collapses to one row.
 *
 * Coordinates are rounded to 2dp (~1 km) because the daily feed publishes 2dp
 * while the archive publishes 4dp for the identical report — matching on full
 * precision would never dedupe. Time is part of the key because several distinct
 * reports commonly share a day and a rounded position along one storm track.
 */
export function dedupeKey(r: Pick<ParsedReport, 'type' | 'occurred_on' | 'occurred_at' | 'lat' | 'lon'>): string {
  return [
    r.type,
    r.occurred_on,
    r.occurred_at ?? '',
    r.lat.toFixed(2),
    r.lon.toFixed(2),
  ].join('|');
}

/**
 * Parse a daily preliminary report file.
 *
 * @param iso the calendar date the file represents; the file itself carries only
 *   a time of day.
 */
export function parseDailyCsv(text: string, iso: string, type: StormType): ParsedReport[] {
  const out: ParsedReport[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('Time,')) continue;
    // Comments is the last column and may contain commas, but every field we
    // read sits before it, so a plain split is safe.
    const p = line.split(',');
    if (p.length < 7) continue;
    const lat = parseFloat(p[5]);
    const lon = parseFloat(p[6]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;

    const raw = parseInt(p[1], 10);
    let value: number | null;
    if (type === 'hail') {
      if (Number.isNaN(raw)) continue; // hail with no size tells a rep nothing
      value = raw / 100; // hundredths of an inch -> inches
    } else {
      value = Number.isNaN(raw) ? null : raw; // already mph; UNK -> null, still plotted
    }

    out.push({
      type,
      occurred_on: iso,
      occurred_at: normalizeTime(p[0]),
      lat,
      lon,
      value,
      location: (p[2] ?? '').trim(),
      state: (p[4] ?? '').trim(),
      source: 'daily',
    });
  }
  return out;
}

/**
 * Parse a per-year archive file.
 *
 * Reads by HEADER NAME rather than column position: the wind archive carries an
 * extra magnitude-type column ("MG"/"EG") that the hail archive doesn't, so
 * fixed offsets would be fragile across types and years.
 */
export function parseArchiveCsv(text: string, type: StormType): ParsedReport[] {
  const lines = text.split('\n');
  const header = lines[0]?.trim();
  if (!header) return [];
  const cols = header.split(',').map((c) => c.trim());
  const idx = (name: string) => cols.indexOf(name);
  const iDate = idx('date');
  const iTime = idx('time');
  const iMag = idx('mag');
  const iLat = idx('slat');
  const iLon = idx('slon');
  const iState = idx('st');
  if ([iDate, iMag, iLat, iLon].some((i) => i < 0)) return [];

  const out: ParsedReport[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const p = line.split(',');
    const lat = parseFloat(p[iLat]);
    const lon = parseFloat(p[iLon]);
    const date = (p[iDate] ?? '').trim();
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    // 0,0 is the archive's placeholder for an unknown position.
    if (lat === 0 && lon === 0) continue;

    const mag = parseFloat(p[iMag]);
    let value: number | null;
    if (type === 'hail') {
      if (Number.isNaN(mag) || mag <= 0) continue;
      value = mag; // already inches
    } else {
      // KNOTS -> MPH. Without this every historical wind report reads 15% low.
      value = Number.isNaN(mag) || mag <= 0 ? null : Math.round(mag * KNOTS_TO_MPH);
    }

    out.push({
      type,
      occurred_on: date,
      occurred_at: normalizeTime(p[iTime]),
      lat,
      lon,
      value,
      location: '', // the archive carries FIPS codes, not place names
      state: (p[iState] ?? '').trim(),
      source: 'archive',
    });
  }
  return out;
}

/**
 * Collapse reports to one per identity, preferring the archive.
 *
 * The two feeds overlap for any date the archive already covers, and the archive
 * is the quality-controlled version — its magnitude supersedes the preliminary
 * one. Later duplicates from the same source are dropped.
 */
export function dedupeReports(reports: ParsedReport[]): ParsedReport[] {
  const byKey = new Map<string, ParsedReport>();
  for (const r of reports) {
    const key = dedupeKey(r);
    const existing = byKey.get(key);
    if (!existing || (existing.source === 'daily' && r.source === 'archive')) {
      byKey.set(key, r);
    }
  }
  return [...byKey.values()];
}
