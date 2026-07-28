import { describe, expect, it } from 'vitest';
import { combinedIngestionHealth, parseStormAlertSettings } from './settings';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const valid = (id: string) => id === uuid;
const base = {
  market_id: 1,
  enabled: false,
  radius_miles: 50,
  hail_min_inches: 1,
  wind_min_mph: 58,
  include_unmeasured_wind: false,
  subscriber_user_ids: [uuid],
};

describe('storm alert settings validation', () => {
  it('normalizes numeric inputs and dedupes subscribers', () => {
    const result = parseStormAlertSettings(
      { ...base, radius_miles: '25', subscriber_user_ids: [uuid, uuid] },
      valid
    );
    expect(result.error).toBeNull();
    if (!result.value) throw new Error('expected valid settings');
    expect(result.value.radius_miles).toBe(25);
    expect(result.value.subscriber_user_ids).toEqual([uuid]);
  });

  it('requires a subscriber only when enabling', () => {
    expect(parseStormAlertSettings({ ...base, enabled: true, subscriber_user_ids: [] }, valid).error)
      .toMatch(/subscriber/);
    expect(parseStormAlertSettings({ ...base, enabled: false, subscriber_user_ids: [] }, valid).error)
      .toBeNull();
  });

  it('enforces configured ranges and UUIDs', () => {
    expect(parseStormAlertSettings({ ...base, radius_miles: 151 }, valid).error).toMatch(/radius/);
    expect(parseStormAlertSettings({ ...base, hail_min_inches: -1 }, valid).error).toMatch(/hail/);
    expect(parseStormAlertSettings({ ...base, wind_min_mph: 251 }, valid).error).toMatch(/wind/);
    expect(parseStormAlertSettings({ ...base, subscriber_user_ids: ['bad'] }, valid).error).toMatch(/user IDs/);
  });
});

describe('combined ingestion health', () => {
  it('uses the older of the two successes so freshness means both feeds', () => {
    expect(combinedIngestionHealth([
      { type: 'hail', last_success_at: '2026-07-27T12:00:00Z', last_error: null },
      { type: 'wind', last_success_at: '2026-07-27T11:55:00Z', last_error: null },
    ])).toEqual({ last_success_at: '2026-07-27T11:55:00Z', last_error: null });
  });

  it('is not healthy until both types have succeeded and labels errors by type', () => {
    expect(combinedIngestionHealth([
      { type: 'hail', last_success_at: '2026-07-27T12:00:00Z', last_error: null },
      { type: 'wind', last_success_at: null, last_error: 'timeout' },
    ])).toEqual({ last_success_at: null, last_error: 'wind: timeout' });
  });
});
