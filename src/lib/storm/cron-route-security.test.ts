import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(
  join(process.cwd(), 'src/app/api/cron/storm-alerts/route.ts'),
  'utf8'
);

describe('storm alert cron route security', () => {
  it('fails closed when CRON_SECRET is missing and checks the Bearer header', () => {
    expect(route).toMatch(/if \(!secret \|\|/);
    expect(route).toContain("request.headers.get('authorization') !== `Bearer ${secret}`");
    expect(route).toContain('status: 401');
  });
});
