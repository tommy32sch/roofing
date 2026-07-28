import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isEmailConfigured } from '@/lib/integrations/email';
import { db } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/utils/validation';
import {
  combinedIngestionHealth,
  DEFAULT_STORM_ALERT_RULE,
  parseStormAlertSettings,
} from '@/lib/storm/settings';

interface RuleRow {
  market_id: number;
  enabled: boolean;
  radius_miles: number;
  hail_min_inches: number;
  wind_min_mph: number;
  include_unmeasured_wind: boolean;
}

interface SubscriptionRow {
  market_id: number;
  user_id: string;
  email_enabled: boolean;
}

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  if (admin.role !== 'admin') return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const supabase = db();
    const [{ data: markets, error: marketError }, { data: rules, error: ruleError },
      { data: subscriptions, error: subscriptionError }, { data: users, error: userError },
      { data: ingestion, error: ingestionError }] = await Promise.all([
      supabase.from('markets').select('id, name').eq('is_active', true).order('sort_order').order('name'),
      supabase.from('storm_alert_rules').select('market_id, enabled, radius_miles, hail_min_inches, wind_min_mph, include_unmeasured_wind'),
      supabase.from('storm_alert_subscriptions').select('market_id, user_id, email_enabled'),
      supabase.from('admin_users').select('id, name'),
      supabase.from('storm_ingestion_state').select('type, last_success_at, last_error'),
    ]);
    const error = marketError || ruleError || subscriptionError || userError || ingestionError;
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

    const health = combinedIngestionHealth(ingestion ?? []);
    const responseRules = buildRules(
      markets ?? [],
      (rules ?? []) as RuleRow[],
      (subscriptions ?? []) as SubscriptionRow[],
      users ?? [],
      health
    );
    return NextResponse.json({
      success: true,
      rules: responseRules,
      email_configured: isEmailConfigured(),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  if (admin.role !== 'admin') return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = parseStormAlertSettings(body, isValidUUID);
  if (!parsed.value) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }

  try {
    const supabase = db();
    const input = parsed.value;
    const { data: market, error: marketError } = await supabase
      .from('markets')
      .select('id, name, center_lat, center_lng, is_active')
      .eq('id', input.market_id)
      .single();
    if (marketError || !market || !market.is_active) {
      return NextResponse.json({ success: false, error: 'Active market not found' }, { status: 404 });
    }
    if (input.enabled && (market.center_lat == null || market.center_lng == null)) {
      return NextResponse.json(
        { success: false, error: 'Market needs a map center before storm alerts can be enabled' },
        { status: 400 }
      );
    }

    const { data: subscribers, error: subscriberError } = input.subscriber_user_ids.length
      ? await supabase
        .from('admin_users')
        .select('id, name')
        .in('id', input.subscriber_user_ids)
      : { data: [], error: null };
    if (subscriberError) throw new Error(subscriberError.message);
    if ((subscribers ?? []).length !== input.subscriber_user_ids.length) {
      return NextResponse.json({ success: false, error: 'One or more subscribers do not exist' }, { status: 400 });
    }

    const { data: existingSubscriptions, error: existingError } = await supabase
      .from('storm_alert_subscriptions')
      .select('user_id')
      .eq('market_id', input.market_id);
    if (existingError) throw new Error(existingError.message);
    const wanted = new Set(input.subscriber_user_ids);
    const removed = (existingSubscriptions ?? [])
      .map((row) => row.user_id)
      .filter((id) => !wanted.has(id));
    if (removed.length) {
      const { error } = await supabase
        .from('storm_alert_subscriptions')
        .delete()
        .eq('market_id', input.market_id)
        .in('user_id', removed);
      if (error) throw new Error(error.message);
    }
    if (input.subscriber_user_ids.length) {
      const { error } = await supabase
        .from('storm_alert_subscriptions')
        .upsert(
          input.subscriber_user_ids.map((userId) => ({
            market_id: input.market_id,
            user_id: userId,
            email_enabled: true,
          })),
          { onConflict: 'market_id,user_id' }
        );
      if (error) throw new Error(error.message);
    }

    const { data: savedRule, error: saveError } = await supabase
      .from('storm_alert_rules')
      .upsert({
        market_id: input.market_id,
        enabled: input.enabled,
        radius_miles: input.radius_miles,
        hail_min_inches: input.hail_min_inches,
        wind_min_mph: input.wind_min_mph,
        include_unmeasured_wind: input.include_unmeasured_wind,
      }, { onConflict: 'market_id' })
      .select('market_id, enabled, radius_miles, hail_min_inches, wind_min_mph, include_unmeasured_wind')
      .single<RuleRow>();
    if (saveError || !savedRule) throw new Error(saveError?.message || 'Failed to save storm alert rule');

    const { data: ingestion } = await supabase
      .from('storm_ingestion_state')
      .select('type, last_success_at, last_error');
    const health = combinedIngestionHealth(ingestion ?? []);
    const rule = buildRules(
      [{ id: market.id, name: market.name }],
      [savedRule],
      input.subscriber_user_ids.map((userId) => ({
        market_id: input.market_id,
        user_id: userId,
        email_enabled: true,
      })),
      subscribers ?? [],
      health
    )[0];
    return NextResponse.json({ success: true, rule });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

function buildRules(
  markets: { id: number; name: string }[],
  rules: RuleRow[],
  subscriptions: SubscriptionRow[],
  users: { id: string; name: string }[],
  health: { last_success_at: string | null; last_error: string | null }
) {
  const ruleMap = new Map(rules.map((rule) => [rule.market_id, rule]));
  const userMap = new Map(users.map((user) => [user.id, user.name]));
  return markets.map((market) => {
    const row = ruleMap.get(market.id);
    return {
      market_id: market.id,
      market_name: market.name,
      enabled: row?.enabled ?? DEFAULT_STORM_ALERT_RULE.enabled,
      radius_miles: Number(row?.radius_miles ?? DEFAULT_STORM_ALERT_RULE.radius_miles),
      hail_min_inches: Number(row?.hail_min_inches ?? DEFAULT_STORM_ALERT_RULE.hail_min_inches),
      wind_min_mph: Number(row?.wind_min_mph ?? DEFAULT_STORM_ALERT_RULE.wind_min_mph),
      include_unmeasured_wind: row?.include_unmeasured_wind ?? DEFAULT_STORM_ALERT_RULE.include_unmeasured_wind,
      ...health,
      subscriptions: subscriptions
        .filter((subscription) => subscription.market_id === market.id)
        .map((subscription) => ({
          user_id: subscription.user_id,
          user_name: userMap.get(subscription.user_id) ?? 'Unknown user',
          email_enabled: subscription.email_enabled,
        })),
    };
  });
}
