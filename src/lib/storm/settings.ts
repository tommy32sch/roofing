export const DEFAULT_STORM_ALERT_RULE = {
  enabled: false,
  radius_miles: 50,
  hail_min_inches: 1,
  wind_min_mph: 58,
  include_unmeasured_wind: false,
} as const;

export interface StormAlertSettingsInput {
  market_id: number;
  enabled: boolean;
  radius_miles: number;
  hail_min_inches: number;
  wind_min_mph: number;
  include_unmeasured_wind: boolean;
  subscriber_user_ids: string[];
}

export function parseStormAlertSettings(
  body: unknown,
  isValidUserId: (id: string) => boolean
): { value: StormAlertSettingsInput; error: null } | { value: null; error: string } {
  if (!body || typeof body !== 'object') return { value: null, error: 'Invalid request body' };
  const input = body as Record<string, unknown>;
  const marketId = Number(input.market_id);
  const radius = Number(input.radius_miles);
  const hail = Number(input.hail_min_inches);
  const wind = Number(input.wind_min_mph);
  if (!Number.isInteger(marketId) || marketId <= 0) return { value: null, error: 'Invalid market_id' };
  if (typeof input.enabled !== 'boolean') return { value: null, error: 'enabled must be boolean' };
  if (!Number.isFinite(radius) || radius < 5 || radius > 150) {
    return { value: null, error: 'radius_miles must be between 5 and 150' };
  }
  if (!Number.isFinite(hail) || hail < 0 || hail > 10) {
    return { value: null, error: 'hail_min_inches must be between 0 and 10' };
  }
  if (!Number.isFinite(wind) || wind < 0 || wind > 250) {
    return { value: null, error: 'wind_min_mph must be between 0 and 250' };
  }
  if (typeof input.include_unmeasured_wind !== 'boolean') {
    return { value: null, error: 'include_unmeasured_wind must be boolean' };
  }
  if (!Array.isArray(input.subscriber_user_ids) ||
      input.subscriber_user_ids.some((id) => typeof id !== 'string' || !isValidUserId(id))) {
    return { value: null, error: 'subscriber_user_ids must contain valid user IDs' };
  }
  const subscriberIds = [...new Set(input.subscriber_user_ids as string[])];
  if (subscriberIds.length > 100) return { value: null, error: 'At most 100 subscribers are allowed' };
  if (input.enabled && subscriberIds.length === 0) {
    return { value: null, error: 'At least one subscriber is required to enable alerts' };
  }
  return {
    value: {
      market_id: marketId,
      enabled: input.enabled,
      radius_miles: radius,
      hail_min_inches: hail,
      wind_min_mph: wind,
      include_unmeasured_wind: input.include_unmeasured_wind,
      subscriber_user_ids: subscriberIds,
    },
    error: null,
  };
}

export function combinedIngestionHealth(
  states: { type: string; last_success_at: string | null; last_error: string | null }[]
): { last_success_at: string | null; last_error: string | null } {
  const byType = new Map(states.map((state) => [state.type, state]));
  const both = ['hail', 'wind'].map((type) => byType.get(type));
  const successes = both.map((state) => state?.last_success_at ?? null);
  const lastSuccess = successes.every(Boolean)
    ? [...successes as string[]].sort()[0]
    : null;
  const errors = both
    .flatMap((state) => state?.last_error ? [`${state.type}: ${state.last_error}`] : []);
  return { last_success_at: lastSuccess, last_error: errors.length ? errors.join(' · ') : null };
}
