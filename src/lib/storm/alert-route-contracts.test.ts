import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('storm alert route contracts and access control', () => {
  it('gates both settings handlers on admin role', () => {
    const source = read('src/app/api/admin/storm-alerts/settings/route.ts');
    expect((source.match(/export async function (GET|PATCH)/g) ?? [])).toHaveLength(2);
    expect((source.match(/admin\.role !== 'admin'/g) ?? [])).toHaveLength(2);
    for (const field of [
      'market_id',
      'market_name',
      'radius_miles',
      'hail_min_inches',
      'wind_min_mph',
      'include_unmeasured_wind',
      'last_success_at',
      'last_error',
      'subscriptions',
      'email_configured',
    ]) expect(source).toContain(field);
  });

  it('scopes alert reads and the list to explicit subscriptions', () => {
    const list = read('src/app/api/admin/storm-alerts/route.ts');
    const markRead = read('src/app/api/admin/storm-alerts/[alertId]/read/route.ts');
    expect(list).toContain(".from('storm_alert_subscriptions')");
    expect(list).toContain(".eq('user_id', admin.sub)");
    expect(list).toContain('unread_count');
    expect(markRead).toContain(".from('storm_alert_subscriptions')");
    expect(markRead).toContain(".eq('user_id', admin.sub)");
    expect(markRead).toContain("error: 'Alert not found'");
  });
});
