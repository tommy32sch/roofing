import { describe, it, expect } from 'vitest';
import {
  parseDailyCsv,
  parseArchiveCsv,
  normalizeTime,
  dedupeKey,
  dedupeReports,
  KNOTS_TO_MPH,
  type ParsedReport,
} from './parse';

// Real rows, copied verbatim from NOAA SPC on 2025-07-24.
const DAILY_HAIL = `Time,Size,Location,County,State,Lat,Lon,Comments
1549,100,4 W Elkins,Chaves,NM,34.44,-104.00,(ABQ)
1600,125,2 N Greeley,Weld,CO,40.41,-104.72,Quarter to half dollar (BOU)
1700,UNK,Nowhere,Some,TX,31.00,-99.00,no size given`;

const DAILY_WIND = `Time,Speed,Location,County,State,Lat,Lon,Comments
0030,61,4 SW Des Moines,Polk,IA,41.76,-93.57,(DMX)
1535,UNK,5 NNW Riggsville,Cheboygan,MI,45.64,-84.65,Numerous trees down, visible funnel. Time estimated via radar. (APX)`;

// Note the wind archive's EXTRA magnitude-type column ("MG") before the trailing
// dates, which the hail archive does not have — hence header-name parsing.
const ARCHIVE_HAIL = `om,yr,mo,dy,date,time,tz,st,stf,stn,mag,inj,fat,loss,closs,slat,slon,elat,elon,len,wid,ns,sn,sg,f1,f2,f3,f4,edat,etime
2507241549-01,2025,07,24,2025-07-24,15:49:00,3,NM,35,0,1.00,0,0,0,0,34.4400,-104.0000,34.4400,-104.0000,0,0,0,0,0,11,0,0,0,2025-07-24,16:10:00`;

const ARCHIVE_WIND = `om,yr,mo,dy,date,time,tz,st,stf,stn,mag,inj,fat,loss,closs,slat,slon,elat,elon,len,wid,ns,sn,sg,f1,f2,f3,f4,mt,edat,etime
2507240030-01,2025,07,24,2025-07-24,00:30:00,3,IA,19,0,53.0000,0,0,0,0,41.7600,-93.5700,41.7600,-93.5700,0,0,0,0,0,153,0,0,0,MG,2025-07-24,00:30:00`;

describe('normalizeTime', () => {
  it('normalises both feeds to HH:MM', () => {
    expect(normalizeTime('0025')).toBe('00:25'); // daily
    expect(normalizeTime('1549')).toBe('15:49');
    expect(normalizeTime('14:37:00')).toBe('14:37'); // archive
    expect(normalizeTime('937')).toBe('09:37'); // 3-digit
  });

  it('returns null rather than guessing', () => {
    expect(normalizeTime('')).toBeNull();
    expect(normalizeTime(undefined)).toBeNull();
    expect(normalizeTime('UNK')).toBeNull();
  });
});

describe('parseDailyCsv', () => {
  it('converts hail hundredths to inches', () => {
    const rows = parseDailyCsv(DAILY_HAIL, '2025-07-24', 'hail');
    expect(rows.map((r) => r.value)).toEqual([1, 1.25]);
    expect(rows[0]).toMatchObject({
      type: 'hail',
      occurred_on: '2025-07-24',
      occurred_at: '15:49',
      lat: 34.44,
      lon: -104,
      location: '4 W Elkins',
      state: 'NM',
      source: 'daily',
    });
  });

  it('drops hail with no measured size, which tells a rep nothing', () => {
    expect(parseDailyCsv(DAILY_HAIL, '2025-07-24', 'hail')).toHaveLength(2);
  });

  it('keeps wind in mph and preserves UNK damage reports as null', () => {
    const rows = parseDailyCsv(DAILY_WIND, '2025-07-24', 'wind');
    expect(rows).toHaveLength(2);
    expect(rows[0].value).toBe(61);
    expect(rows[1].value).toBeNull(); // damage-only, still worth plotting
  });

  // Comments is the last column and contains commas; a naive split must not
  // corrupt the fields before it.
  it('is unaffected by commas inside the comment', () => {
    const rows = parseDailyCsv(DAILY_WIND, '2025-07-24', 'wind');
    expect(rows[1]).toMatchObject({ lat: 45.64, lon: -84.65, state: 'MI' });
  });
});

describe('parseArchiveCsv', () => {
  it('takes hail magnitude as inches, unconverted', () => {
    const rows = parseArchiveCsv(ARCHIVE_HAIL, 'hail');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'hail',
      occurred_on: '2025-07-24',
      occurred_at: '15:49',
      lat: 34.44,
      lon: -104,
      value: 1,
      state: 'NM',
      source: 'archive',
    });
  });

  // THE trap. Archive wind is knots; the daily feed is mph. Verified against the
  // same reports in both feeds: 53 kt here is the 61 mph in DAILY_WIND above.
  it('converts archive wind from knots to mph', () => {
    const rows = parseArchiveCsv(ARCHIVE_WIND, 'wind');
    expect(rows[0].value).toBe(61);
    expect(Math.round(53 * KNOTS_TO_MPH)).toBe(61);
  });

  it('maps the severe threshold correctly: 50 kt is 58 mph', () => {
    const csv = ARCHIVE_WIND.replace('53.0000', '50.0000');
    expect(parseArchiveCsv(csv, 'wind')[0].value).toBe(58);
  });

  // Reading by header name, not offset: the wind file has an extra "mt" column,
  // so hard-coded positions would drift between types.
  it('reads columns by name across both archive layouts', () => {
    expect(parseArchiveCsv(ARCHIVE_WIND, 'wind')[0].lat).toBe(41.76);
    expect(parseArchiveCsv(ARCHIVE_HAIL, 'hail')[0].lat).toBe(34.44);
  });

  it('skips the 0,0 unknown-position placeholder', () => {
    const csv = ARCHIVE_HAIL.replace('34.4400,-104.0000,34.4400,-104.0000', '0,0,0,0');
    expect(parseArchiveCsv(csv, 'hail')).toHaveLength(0);
  });

  it('returns nothing for a missing or unrecognised header', () => {
    expect(parseArchiveCsv('', 'hail')).toEqual([]);
    expect(parseArchiveCsv('nope,not,a,header\n1,2,3,4', 'hail')).toEqual([]);
  });
});

describe('dedupeKey / dedupeReports', () => {
  // The daily feed publishes 2dp coordinates and the archive 4dp for the SAME
  // report, so matching on full precision would never collapse them.
  it('matches the same report across feeds despite coordinate precision', () => {
    const daily = parseDailyCsv(DAILY_WIND, '2025-07-24', 'wind')[0];
    const archive = parseArchiveCsv(ARCHIVE_WIND, 'wind')[0];
    expect(dedupeKey(daily)).toBe(dedupeKey(archive));
  });

  it('prefers the archive, which is the quality-controlled version', () => {
    const daily = parseDailyCsv(DAILY_WIND, '2025-07-24', 'wind')[0];
    const archive = parseArchiveCsv(ARCHIVE_WIND, 'wind')[0];
    for (const order of [[daily, archive], [archive, daily]]) {
      const merged = dedupeReports(order as ParsedReport[]);
      expect(merged).toHaveLength(1);
      expect(merged[0].source).toBe('archive');
    }
  });

  it('keeps genuinely different reports apart', () => {
    const hail = parseDailyCsv(DAILY_HAIL, '2025-07-24', 'hail');
    expect(dedupeReports(hail)).toHaveLength(2);
  });

  it('distinguishes the same place and day at different times', () => {
    const a = { type: 'hail' as const, occurred_on: '2025-07-24', occurred_at: '10:00', lat: 40, lon: -100 };
    const b = { ...a, occurred_at: '14:00' };
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });

  it('does not merge hail into wind at the same spot and time', () => {
    const a = { type: 'hail' as const, occurred_on: '2025-07-24', occurred_at: '10:00', lat: 40, lon: -100 };
    expect(dedupeKey(a)).not.toBe(dedupeKey({ ...a, type: 'wind' as const }));
  });
});
