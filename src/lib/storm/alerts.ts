import type { ParsedReport, StormType } from './parse';

export const RECENT_STORM_LOOKBACK_DAYS = 3;
export const STORM_ALERT_MAX_ATTEMPTS = 3;

export interface AlertRule {
  market_id: number;
  radius_miles: number;
  hail_min_inches: number;
  wind_min_mph: number;
  include_unmeasured_wind: boolean;
  center_lat: number;
  center_lon: number;
}

export interface StoredStormReport extends ParsedReport {
  id: number;
}

export interface AlertMatch {
  marketId: number;
  report: StoredStormReport;
  distanceMiles: number;
  severityBand: number;
}

export interface EventAggregate {
  centroidLat: number;
  centroidLon: number;
  peakValue: number | null;
  reportCount: number;
  closestDistanceMiles: number;
  severityBand: number;
}

/**
 * Current NOAA/SPC report day plus the preceding dates, oldest first.
 *
 * SPC report days run 12:00 UTC through 11:59 UTC, not midnight-to-midnight.
 * Shifting the clock back twelve hours turns that boundary into an ordinary UTC
 * date boundary and avoids requesting tomorrow's not-yet-started file overnight.
 */
export function recentStormDates(now: Date = new Date(), count = RECENT_STORM_LOOKBACK_DAYS): string[] {
  if (!Number.isFinite(now.getTime()) || count < 1) return [];
  const dates: string[] = [];
  const shifted = new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const at = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
  for (let daysAgo = count - 1; daysAgo >= 0; daysAgo--) {
    const date = new Date(at);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

/** Great-circle distance. Stable at city and multi-county market scales. */
export function haversineMiles(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const radians = Math.PI / 180;
  const dLat = (bLat - aLat) * radians;
  const dLon = (bLon - aLon) * radians;
  const lat1 = aLat * radians;
  const lat2 = bLat * radians;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Standard business severity band, independent of a market's chosen minimum.
 *
 * 0: below standard or unmeasured wind damage
 * 1: 1in hail / 58mph wind
 * 2: 1.5in hail / 74mph wind
 * 3: 2in hail / 90mph wind
 */
export function stormSeverityBand(type: StormType, value: number | null): number {
  if (value == null) return 0;
  const thresholds = type === 'hail' ? [1, 1.5, 2] : [58, 74, 90];
  if (value >= thresholds[2]) return 3;
  if (value >= thresholds[1]) return 2;
  if (value >= thresholds[0]) return 1;
  return 0;
}

export function reportQualifies(
  report: Pick<StoredStormReport, 'type' | 'value'>,
  rule: Pick<AlertRule, 'hail_min_inches' | 'wind_min_mph' | 'include_unmeasured_wind'>
): boolean {
  if (report.type === 'hail') {
    return report.value != null && report.value >= rule.hail_min_inches;
  }
  if (report.value == null) return rule.include_unmeasured_wind;
  return report.value >= rule.wind_min_mph;
}

/** Match reports to every enabled rule whose circular market radius contains it. */
export function matchStormReports(
  reports: StoredStormReport[],
  rules: AlertRule[]
): AlertMatch[] {
  const matches: AlertMatch[] = [];
  for (const rule of rules) {
    for (const report of reports) {
      if (!reportQualifies(report, rule)) continue;
      const distanceMiles = haversineMiles(
        rule.center_lat,
        rule.center_lon,
        report.lat,
        report.lon
      );
      // Inclusive: a report exactly on either configured boundary qualifies.
      if (distanceMiles > rule.radius_miles) continue;
      matches.push({
        marketId: rule.market_id,
        report,
        distanceMiles,
        severityBand: stormSeverityBand(report.type, report.value),
      });
    }
  }
  return matches;
}

export function addMatchToEvent(
  previous: EventAggregate,
  match: Pick<AlertMatch, 'distanceMiles' | 'severityBand' | 'report'>
): { aggregate: EventAggregate; notification: 'initial' | 'escalation' | null } {
  const nextCount = previous.reportCount + 1;
  const peakValue = previous.peakValue == null
    ? match.report.value
    : match.report.value == null
      ? previous.peakValue
      : Math.max(previous.peakValue, match.report.value);
  const severityBand = Math.max(previous.severityBand, match.severityBand);
  return {
    aggregate: {
      centroidLat: (previous.centroidLat * previous.reportCount + match.report.lat) / nextCount,
      centroidLon: (previous.centroidLon * previous.reportCount + match.report.lon) / nextCount,
      peakValue,
      reportCount: nextCount,
      closestDistanceMiles: Math.min(previous.closestDistanceMiles, match.distanceMiles),
      severityBand,
    },
    notification: previous.reportCount === 0
      ? 'initial'
      : severityBand > previous.severityBand
        ? 'escalation'
        : null,
  };
}

/**
 * Choose at most one notification after a whole ingestion batch is applied.
 *
 * Without this batch boundary, a first 1-inch report followed by a 2-inch
 * report in the same NOAA refresh would queue both an initial and escalation
 * email, even though neither email is sent until the final aggregate exists.
 */
export function notificationForEventChange(
  previous: Pick<EventAggregate, 'reportCount' | 'severityBand'> | null,
  next: Pick<EventAggregate, 'reportCount' | 'severityBand'>
): 'initial' | 'escalation' | null {
  const previousCount = previous?.reportCount ?? 0;
  const previousBand = previous?.severityBand ?? 0;
  if (previousCount === 0 && next.reportCount > 0) return 'initial';
  if (next.severityBand > previousBand) return 'escalation';
  return null;
}

export function deliveryDedupeKey(args: {
  eventId: string;
  userId: string;
  kind: 'initial' | 'escalation';
  severityBand: number;
}): string {
  const suffix = args.kind === 'initial' ? 'initial' : `escalation:${args.severityBand}`;
  return `${args.eventId}:${args.userId}:email:${suffix}`;
}

/** Retry 5 minutes after attempt 1, then 30 minutes after attempt 2. */
export function deliveryRetryAt(attemptCount: number, now: Date = new Date()): string | null {
  if (attemptCount >= STORM_ALERT_MAX_ATTEMPTS) return null;
  const minutes = attemptCount <= 1 ? 5 : 30;
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** Daily rows may be corrected; preliminary data must never replace a QC archive row. */
export function shouldUpdateStoredReport(
  existingSource: 'daily' | 'archive',
  incomingSource: 'daily' | 'archive'
): boolean {
  return existingSource === 'daily' || incomingSource === 'archive';
}
