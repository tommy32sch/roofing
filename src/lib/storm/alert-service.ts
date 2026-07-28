import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/integrations/email';
import { buildStormAlertEmail } from '@/lib/notifications/storm-alert-email';
import {
  addMatchToEvent,
  deliveryDedupeKey,
  deliveryRetryAt,
  matchStormReports,
  notificationForEventChange,
  recentStormDates,
  type AlertMatch,
  type AlertRule,
  type StoredStormReport,
} from './alerts';

interface EventRow {
  id: string;
  market_id: number;
  type: 'hail' | 'wind';
  occurred_on: string;
  centroid_lat: number;
  centroid_lon: number;
  peak_value: number | null;
  report_count: number;
  closest_distance_miles: number;
  severity_band: number;
}

interface DeliveryRow {
  id: string;
  event_id: string;
  user_id: string;
  kind: 'initial' | 'escalation';
  severity_band: number;
  attempt_count: number;
  dedupe_key: string;
}

export interface ProcessAlertResult {
  reports_scanned: number;
  matches: number;
  new_hits: number;
  events_created: number;
  deliveries_queued: number;
}

export interface DeliveryResult {
  claimed: number;
  sent: number;
  failed: number;
  cancelled: number;
}

const duplicate = (error: { code?: string } | null) => error?.code === '23505';

/**
 * Match the recent stored lookback into durable events and an email outbox.
 *
 * Every write has a DB uniqueness boundary. The Redis cron lock prevents normal
 * overlap; these constraints make a duplicate invocation safe even without it.
 */
export async function processStormAlerts(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<ProcessAlertResult> {
  const { data: rawRules, error: rulesError } = await supabase
    .from('storm_alert_rules')
    .select('market_id, radius_miles, hail_min_inches, wind_min_mph, include_unmeasured_wind')
    .eq('enabled', true);
  if (rulesError) throw new Error(rulesError.message);
  if (!rawRules?.length) {
    return { reports_scanned: 0, matches: 0, new_hits: 0, events_created: 0, deliveries_queued: 0 };
  }

  const marketIds = rawRules.map((row) => row.market_id);
  const { data: markets, error: marketsError } = await supabase
    .from('markets')
    .select('id, name, center_lat, center_lng, is_active')
    .in('id', marketIds)
    .eq('is_active', true);
  if (marketsError) throw new Error(marketsError.message);
  const marketMap = new Map((markets ?? []).map((market) => [market.id, market]));

  const rules: AlertRule[] = rawRules.flatMap((row) => {
    const market = marketMap.get(row.market_id);
    if (!market || market.center_lat == null || market.center_lng == null) return [];
    return [{
      market_id: row.market_id,
      radius_miles: Number(row.radius_miles),
      hail_min_inches: Number(row.hail_min_inches),
      wind_min_mph: Number(row.wind_min_mph),
      include_unmeasured_wind: !!row.include_unmeasured_wind,
      center_lat: Number(market.center_lat),
      center_lon: Number(market.center_lng),
    }];
  });
  if (rules.length === 0) {
    return { reports_scanned: 0, matches: 0, new_hits: 0, events_created: 0, deliveries_queued: 0 };
  }

  const from = recentStormDates(now)[0];
  const { data: rawReports, error: reportError } = await supabase
    .from('storm_reports')
    .select('id, type, occurred_on, occurred_at, lat, lon, value, location, state, source')
    .gte('occurred_on', from);
  if (reportError) throw new Error(reportError.message);
  const reports = (rawReports ?? []).map((row) => ({
    ...row,
    id: Number(row.id),
    type: row.type as 'hail' | 'wind',
    value: row.value == null ? null : Number(row.value),
    lat: Number(row.lat),
    lon: Number(row.lon),
    source: row.source as 'daily' | 'archive',
    location: row.location ?? '',
    state: row.state ?? '',
  })) as StoredStormReport[];

  const matches = matchStormReports(reports, rules);
  const subscribers = await loadSubscribers(supabase, rules.map((rule) => rule.market_id));
  const groups = new Map<string, AlertMatch[]>();
  for (const match of matches) {
    const key = `${match.marketId}:${match.report.type}:${match.report.occurred_on}`;
    groups.set(key, [...(groups.get(key) ?? []), match]);
  }
  let newHits = 0;
  let eventsCreated = 0;
  let deliveriesQueued = 0;

  for (const group of groups.values()) {
    const first = group[0];
    const { data: before, error: beforeError } = await supabase
      .from('storm_alert_events')
      .select('report_count, severity_band')
      .eq('market_id', first.marketId)
      .eq('type', first.report.type)
      .eq('occurred_on', first.report.occurred_on)
      .maybeSingle();
    if (beforeError) throw new Error(beforeError.message);

    for (const match of group) {
      const result = await applyMatch(supabase, match);
      newHits += result.newHit ? 1 : 0;
      eventsCreated += result.eventCreated ? 1 : 0;
    }

    const { data: after, error: afterError } = await supabase
      .from('storm_alert_events')
      .select('id, report_count, severity_band')
      .eq('market_id', first.marketId)
      .eq('type', first.report.type)
      .eq('occurred_on', first.report.occurred_on)
      .single();
    if (afterError || !after) {
      throw new Error(afterError?.message || 'Alert event disappeared after matching');
    }
    const notification = notificationForEventChange(
      before
        ? {
            reportCount: Number(before.report_count),
            severityBand: Number(before.severity_band),
          }
        : null,
      {
        reportCount: Number(after.report_count),
        severityBand: Number(after.severity_band),
      }
    );
    if (notification) {
      deliveriesQueued += await queueDeliveries(
        supabase,
        after.id,
        subscribers.get(first.marketId) ?? [],
        notification,
        Number(after.severity_band)
      );
    }
  }

  return {
    reports_scanned: reports.length,
    matches: matches.length,
    new_hits: newHits,
    events_created: eventsCreated,
    deliveries_queued: deliveriesQueued,
  };
}

async function loadSubscribers(supabase: SupabaseClient, marketIds: number[]) {
  const { data, error } = await supabase
    .from('storm_alert_subscriptions')
    .select('market_id, user_id')
    .in('market_id', [...new Set(marketIds)])
    .eq('email_enabled', true);
  if (error) throw new Error(error.message);
  const byMarket = new Map<number, string[]>();
  for (const row of data ?? []) {
    byMarket.set(row.market_id, [...(byMarket.get(row.market_id) ?? []), row.user_id]);
  }
  return byMarket;
}

async function applyMatch(
  supabase: SupabaseClient,
  match: AlertMatch
): Promise<{ newHit: boolean; eventCreated: boolean }> {
  const { data: existingEvent, error: eventReadError } = await supabase
    .from('storm_alert_events')
    .select('id, market_id, type, occurred_on, centroid_lat, centroid_lon, peak_value, report_count, closest_distance_miles, severity_band')
    .eq('market_id', match.marketId)
    .eq('type', match.report.type)
    .eq('occurred_on', match.report.occurred_on)
    .maybeSingle<EventRow>();
  if (eventReadError) throw new Error(eventReadError.message);
  let event = existingEvent;

  let eventCreated = false;
  if (!event) {
    const inserted = await supabase
      .from('storm_alert_events')
      .insert({
        market_id: match.marketId,
        type: match.report.type,
        occurred_on: match.report.occurred_on,
        centroid_lat: match.report.lat,
        centroid_lon: match.report.lon,
        peak_value: match.report.value,
        report_count: 0,
        closest_distance_miles: match.distanceMiles,
        severity_band: 0,
      })
      .select('id, market_id, type, occurred_on, centroid_lat, centroid_lon, peak_value, report_count, closest_distance_miles, severity_band')
      .single<EventRow>();
    if (inserted.error && !duplicate(inserted.error)) throw new Error(inserted.error.message);
    if (inserted.data) {
      event = inserted.data;
      eventCreated = true;
    } else {
      const reread = await supabase
        .from('storm_alert_events')
        .select('id, market_id, type, occurred_on, centroid_lat, centroid_lon, peak_value, report_count, closest_distance_miles, severity_band')
        .eq('market_id', match.marketId)
        .eq('type', match.report.type)
        .eq('occurred_on', match.report.occurred_on)
        .single<EventRow>();
      if (reread.error || !reread.data) throw new Error(reread.error?.message || 'Alert event disappeared');
      event = reread.data;
    }
  }

  const { data: existingHit, error: hitReadError } = await supabase
    .from('storm_alert_hits')
    .select('id, severity_band, observed_value')
    .eq('market_id', match.marketId)
    .eq('storm_report_id', match.report.id)
    .maybeSingle();
  if (hitReadError) throw new Error(hitReadError.message);

  if (existingHit) {
    if (match.severityBand <= Number(existingHit.severity_band)) {
      return { newHit: false, eventCreated };
    }
    const previousBand = Number(event.severity_band);
    const nextBand = Math.max(previousBand, match.severityBand);
    const nextPeak = maxNullable(event.peak_value, match.report.value);
    const { error: hitUpdateError } = await supabase
      .from('storm_alert_hits')
      .update({ observed_value: match.report.value, severity_band: match.severityBand })
      .eq('id', existingHit.id);
    if (hitUpdateError) throw new Error(hitUpdateError.message);
    const { error: eventUpdateError } = await supabase
      .from('storm_alert_events')
      .update({ peak_value: nextPeak, severity_band: nextBand, last_reported_at: new Date().toISOString() })
      .eq('id', event.id);
    if (eventUpdateError) throw new Error(eventUpdateError.message);
    return { newHit: false, eventCreated };
  }

  const hitInsert = await supabase.from('storm_alert_hits').insert({
    event_id: event.id,
    market_id: match.marketId,
    storm_report_id: match.report.id,
    distance_miles: match.distanceMiles,
    observed_value: match.report.value,
    severity_band: match.severityBand,
  });
  if (hitInsert.error) {
    if (duplicate(hitInsert.error)) return { newHit: false, eventCreated };
    throw new Error(hitInsert.error.message);
  }

  const previousCount = Number(event.report_count);
  const advanced = addMatchToEvent({
    centroidLat: Number(event.centroid_lat),
    centroidLon: Number(event.centroid_lon),
    peakValue: event.peak_value == null ? null : Number(event.peak_value),
    reportCount: previousCount,
    closestDistanceMiles: Number(event.closest_distance_miles),
    severityBand: Number(event.severity_band),
  }, match);
  const { error: updateError } = await supabase
    .from('storm_alert_events')
    .update({
      centroid_lat: advanced.aggregate.centroidLat,
      centroid_lon: advanced.aggregate.centroidLon,
      peak_value: advanced.aggregate.peakValue,
      report_count: advanced.aggregate.reportCount,
      closest_distance_miles: advanced.aggregate.closestDistanceMiles,
      severity_band: advanced.aggregate.severityBand,
      last_reported_at: new Date().toISOString(),
    })
    .eq('id', event.id);
  if (updateError) throw new Error(updateError.message);

  return { newHit: true, eventCreated };
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(Number(a), Number(b));
}

async function queueDeliveries(
  supabase: SupabaseClient,
  eventId: string,
  userIds: string[],
  kind: 'initial' | 'escalation',
  severityBand: number
): Promise<number> {
  if (userIds.length === 0) return 0;
  const rows = userIds.map((userId) => ({
    event_id: eventId,
    user_id: userId,
    channel: 'email',
    kind,
    severity_band: severityBand,
    dedupe_key: deliveryDedupeKey({ eventId, userId, kind, severityBand }),
  }));
  const { data, error } = await supabase
    .from('storm_alert_deliveries')
    .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Claim and send the durable email outbox. */
export async function deliverStormAlertEmails(
  supabase: SupabaseClient,
  limit = 25
): Promise<DeliveryResult> {
  const { data, error } = await supabase.rpc('claim_storm_alert_deliveries', { p_limit: limit });
  if (error) throw new Error(error.message);
  const deliveries = (data ?? []) as DeliveryRow[];
  let sent = 0;
  let failed = 0;
  let cancelled = 0;

  for (const delivery of deliveries) {
    try {
      const [{ data: event }, { data: user }] = await Promise.all([
        supabase
          .from('storm_alert_events')
          .select('id, market_id, type, occurred_on, centroid_lat, centroid_lon, peak_value, report_count, closest_distance_miles, severity_band, markets!inner(name)')
          .eq('id', delivery.event_id)
          .single(),
        supabase.from('admin_users').select('name, email').eq('id', delivery.user_id).single(),
      ]);
      const marketJoin = event?.markets as unknown as { name?: string } | { name?: string }[] | null;
      const marketName = Array.isArray(marketJoin) ? marketJoin[0]?.name : marketJoin?.name;
      if (!event || !user?.email || !marketName) throw new Error('Alert event, market, or recipient is missing');

      const [{ data: rule, error: ruleError }, { data: subscription, error: subscriptionError }] = await Promise.all([
        supabase
          .from('storm_alert_rules')
          .select('enabled')
          .eq('market_id', event.market_id)
          .eq('enabled', true)
          .maybeSingle(),
        supabase
          .from('storm_alert_subscriptions')
          .select('email_enabled')
          .eq('market_id', event.market_id)
          .eq('user_id', delivery.user_id)
          .eq('email_enabled', true)
          .maybeSingle(),
      ]);
      if (ruleError || subscriptionError) {
        throw new Error(ruleError?.message || subscriptionError?.message || 'Subscription check failed');
      }
      if (!rule || !subscription) {
        await supabase
          .from('storm_alert_deliveries')
          .update({
            status: 'cancelled',
            locked_at: null,
            last_error: 'Market alerts disabled or recipient unsubscribed',
          })
          .eq('id', delivery.id);
        cancelled++;
        continue;
      }

      const built = buildStormAlertEmail({
        marketId: event.market_id,
        recipientName: user.name,
        marketName,
        type: event.type as 'hail' | 'wind',
        occurredOn: event.occurred_on,
        peakValue: event.peak_value == null ? null : Number(event.peak_value),
        reportCount: Number(event.report_count),
        closestDistanceMiles: Number(event.closest_distance_miles),
        centroidLat: Number(event.centroid_lat),
        centroidLon: Number(event.centroid_lon),
        severityBand: Number(event.severity_band),
        kind: delivery.kind,
        appUrl: process.env.NEXT_PUBLIC_APP_URL || null,
      });
      const result = await sendEmail({
        to: user.email,
        subject: built.subject,
        html: built.html,
        text: built.text,
        idempotencyKey: delivery.dedupe_key,
      });
      if (!result.sent) {
        const detail = 'detail' in result ? result.detail || result.reason : result.reason;
        throw new Error(detail);
      }
      await supabase
        .from('storm_alert_deliveries')
        .update({
          status: 'sent',
          provider_message_id: result.id,
          sent_at: new Date().toISOString(),
          locked_at: null,
          last_error: null,
        })
        .eq('id', delivery.id);
      sent++;
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : 'Email delivery failed';
      const retryAt = deliveryRetryAt(Number(delivery.attempt_count));
      await supabase
        .from('storm_alert_deliveries')
        .update({
          status: 'failed',
          next_attempt_at: retryAt ?? new Date().toISOString(),
          locked_at: null,
          last_error: detail.slice(0, 1000),
        })
        .eq('id', delivery.id);
      failed++;
    }
  }

  return { claimed: deliveries.length, sent, failed, cancelled };
}
