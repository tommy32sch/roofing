import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

const migration = read('supabase/migrations/023_contact_results.sql');
const callRoute = read('src/app/api/admin/leads/[leadId]/calls/route.ts');
const knockRoute = read('src/app/api/admin/leads/[leadId]/knocks/route.ts');
const backup = read('scripts/backup-db.ts');

describe('structured contact result contracts', () => {
  it('extends knock values additively and preserves both legacy values', () => {
    for (const value of ['call_back', 'referral', 'contract_signed', 'renter']) {
      expect(migration).toContain(
        `ALTER TYPE knock_disposition ADD VALUE IF NOT EXISTS '${value}'`
      );
    }
    expect(migration).toContain("WHEN 'callback' THEN 'Go Back'");
    expect(migration).toContain("WHEN 'no_damage' THEN 'No Damage'");
  });

  it('does not let result logging bypass appointment or won workflows', () => {
    const knockContactBlock = migration.slice(
      migration.indexOf("WHEN v_disposition IN (\n      'callback'"),
      migration.indexOf("v_current_rank := CASE v_lead.status")
    );
    expect(knockContactBlock).toContain("'appointment_set'");
    expect(knockContactBlock).toContain("'contract_signed'");
    expect(knockContactBlock).toContain("THEN 'contacted'::lead_status");
    expect(knockContactBlock).not.toContain("THEN 'appointment_set'::lead_status");

    const callFunction = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION record_lead_call'));
    expect(callFunction).toContain("'appointment_set'");
    expect(callFunction).toContain("THEN 'contacted'::lead_status");
    expect(callFunction).not.toContain("THEN 'appointment_set'::lead_status");
  });

  it('records calls, lead summary, DNC state and timeline activity atomically', () => {
    expect(migration).toContain('CREATE TABLE lead_calls');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION record_lead_call');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('call_count = COALESCE(call_count, 0) + 1');
    expect(migration).toContain("is_dnc = is_dnc OR v_disposition = 'do_not_call'");
    expect(migration).toContain("'call',\n    'Cold called — ' || v_label");
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION record_lead_call');
    expect(migration).toContain('TO service_role');
  });

  it('keeps newly added enum values out of unsafe direct enum comparisons', () => {
    expect(migration).toContain('v_disposition := p_disposition::TEXT');
    expect(migration).not.toContain("p_disposition = 'call_back'");
    expect(migration).not.toContain("p_disposition = 'contract_signed'");
  });

  it('makes the all-role route a validating wrapper around the atomic RPC', () => {
    expect(callRoute).toContain('getAuthenticatedAdmin()');
    expect(callRoute).not.toContain("admin.role !== 'admin'");
    expect(callRoute).not.toContain("admin.role === 'setter'");
    expect(callRoute).toContain('body.owner_id !== admin.sub');
    expect(callRoute).toContain('resolveCalledAt(body.called_at)');
    expect(callRoute).toContain(".rpc('record_lead_call'");
    expect(callRoute).not.toContain(".from('lead_calls')\n      .insert");
    expect(callRoute).not.toContain(".from('leads').update");
  });

  it('retains the existing knock route and backs up structured calls', () => {
    expect(knockRoute).toContain(".rpc('record_lead_knock'");
    expect(backup).toContain("'lead_calls'");
  });
});
