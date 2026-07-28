import { describe, expect, it } from 'vitest';
import {
  deliveryDedupeKey,
  deliveryRetryAt,
  addMatchToEvent,
  haversineMiles,
  matchStormReports,
  notificationForEventChange,
  recentStormDates,
  reportQualifies,
  shouldUpdateStoredReport,
  stormSeverityBand,
  type AlertRule,
  type StoredStormReport,
} from './alerts';

const rule: AlertRule = {
  market_id: 1,
  radius_miles: 50,
  hail_min_inches: 1,
  wind_min_mph: 58,
  include_unmeasured_wind: false,
  center_lat: 33.4484,
  center_lon: -112.074,
};

const report = (
  type: 'hail' | 'wind',
  value: number | null,
  lat = rule.center_lat,
  lon = rule.center_lon
): StoredStormReport => ({
  id: 1,
  type,
  value,
  lat,
  lon,
  occurred_on: '2026-07-27',
  occurred_at: '12:00',
  location: 'Phoenix',
  state: 'AZ',
  source: 'daily',
});

describe('recentStormDates', () => {
  it('returns current plus previous two SPC report days oldest first', () => {
    expect(recentStormDates(new Date('2026-07-27T23:59:00Z'))).toEqual([
      '2026-07-25',
      '2026-07-26',
      '2026-07-27',
    ]);
  });

  it('holds the previous report date until SPC rolls at 12 UTC', () => {
    expect(recentStormDates(new Date('2026-01-01T11:59:00Z'))).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
    ]);
    expect(recentStormDates(new Date('2026-01-01T12:00:00Z'))).toEqual([
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
    ]);
  });
});

describe('storm matching', () => {
  it('uses inclusive hail and wind thresholds', () => {
    expect(reportQualifies(report('hail', 1), rule)).toBe(true);
    expect(reportQualifies(report('hail', 0.99), rule)).toBe(false);
    expect(reportQualifies(report('wind', 58), rule)).toBe(true);
    expect(reportQualifies(report('wind', 57), rule)).toBe(false);
  });

  it('excludes unmeasured wind unless explicitly opted in', () => {
    expect(reportQualifies(report('wind', null), rule)).toBe(false);
    expect(reportQualifies(report('wind', null), { ...rule, include_unmeasured_wind: true })).toBe(true);
  });

  it('includes a report exactly on the configured distance boundary', () => {
    const north = report('hail', 1, 34.1711, -112.074);
    const distance = haversineMiles(rule.center_lat, rule.center_lon, north.lat, north.lon);
    const exact = { ...rule, radius_miles: distance };
    expect(matchStormReports([north], [exact])).toHaveLength(1);
    expect(matchStormReports([north], [{ ...exact, radius_miles: distance - 0.001 }])).toHaveLength(0);
  });

  it('matches overlapping market radii independently', () => {
    const second = { ...rule, market_id: 2 };
    expect(matchStormReports([report('hail', 1.5)], [rule, second]).map((m) => m.marketId)).toEqual([1, 2]);
  });
});

describe('severity and idempotency', () => {
  it('maps standard severity bands for both units', () => {
    expect([0.9, 1, 1.5, 2].map((v) => stormSeverityBand('hail', v))).toEqual([0, 1, 2, 3]);
    expect([57, 58, 74, 90].map((v) => stormSeverityBand('wind', v))).toEqual([0, 1, 2, 3]);
    expect(stormSeverityBand('wind', null)).toBe(0);
  });

  it('dedupes initial regardless of band and escalation per higher band', () => {
    const base = { eventId: 'e', userId: 'u' };
    expect(deliveryDedupeKey({ ...base, kind: 'initial', severityBand: 1 }))
      .toBe(deliveryDedupeKey({ ...base, kind: 'initial', severityBand: 3 }));
    expect(deliveryDedupeKey({ ...base, kind: 'escalation', severityBand: 2 }))
      .not.toBe(deliveryDedupeKey({ ...base, kind: 'escalation', severityBand: 3 }));
  });

  it('queues at most one notification for a completed ingestion batch', () => {
    expect(notificationForEventChange(
      null,
      { reportCount: 4, severityBand: 3 }
    )).toBe('initial');
    expect(notificationForEventChange(
      { reportCount: 4, severityBand: 1 },
      { reportCount: 7, severityBand: 3 }
    )).toBe('escalation');
    expect(notificationForEventChange(
      { reportCount: 4, severityBand: 2 },
      { reportCount: 7, severityBand: 2 }
    )).toBeNull();
  });

  it('stops retrying after three claimed attempts', () => {
    const now = new Date('2026-07-27T12:00:00Z');
    expect(deliveryRetryAt(1, now)).toBe('2026-07-27T12:05:00.000Z');
    expect(deliveryRetryAt(2, now)).toBe('2026-07-27T12:30:00.000Z');
    expect(deliveryRetryAt(3, now)).toBeNull();
  });

  it('never lets a preliminary daily row replace an archive row', () => {
    expect(shouldUpdateStoredReport('archive', 'daily')).toBe(false);
    expect(shouldUpdateStoredReport('daily', 'daily')).toBe(true);
    expect(shouldUpdateStoredReport('daily', 'archive')).toBe(true);
  });

  it('groups reports into one aggregate and only escalates on a higher band', () => {
    const initial = addMatchToEvent(
      {
        centroidLat: 33,
        centroidLon: -112,
        peakValue: null,
        reportCount: 0,
        closestDistanceMiles: 12,
        severityBand: 0,
      },
      { report: report('hail', 1), distanceMiles: 12, severityBand: 1 }
    );
    expect(initial.notification).toBe('initial');
    const sameBand = addMatchToEvent(
      initial.aggregate,
      { report: { ...report('hail', 1.25), id: 2, lat: 34 }, distanceMiles: 8, severityBand: 1 }
    );
    expect(sameBand.notification).toBeNull();
    expect(sameBand.aggregate).toMatchObject({ reportCount: 2, peakValue: 1.25, closestDistanceMiles: 8 });
    expect(sameBand.aggregate.centroidLat).toBeCloseTo((rule.center_lat + 34) / 2);
    const higher = addMatchToEvent(
      sameBand.aggregate,
      { report: { ...report('hail', 1.5), id: 3 }, distanceMiles: 10, severityBand: 2 }
    );
    expect(higher.notification).toBe('escalation');
    expect(higher.aggregate.severityBand).toBe(2);
  });
});
