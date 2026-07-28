import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/020_storm_alerts.sql'),
  'utf8'
);

describe('storm alert migration security', () => {
  it('restricts the SECURITY DEFINER delivery claim function to service_role', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION claim_storm_alert_deliveries\(INTEGER\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION claim_storm_alert_deliveries\(INTEGER\)\s+TO service_role;/
    );
  });

  it('allows the outbox to cancel deliveries after a rule is disabled or a user unsubscribes', () => {
    expect(migration).toMatch(
      /CHECK \(status IN \('pending', 'processing', 'sent', 'failed', 'cancelled'\)\)/
    );
  });
});
