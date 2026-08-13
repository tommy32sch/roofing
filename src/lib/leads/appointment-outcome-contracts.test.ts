import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Static guard for the outcome-recording route.
 *
 * The rules that matter here are authorization ones, and they are easy to lose
 * in a refactor: an outcome is a judgement about a rep's own work, so the
 * person it reflects on must not be able to quietly overwrite someone else's
 * verdict. These assertions fail if either defence is dropped.
 */
const route = readFileSync(
  join(process.cwd(), 'src/app/api/admin/leads/[leadId]/appointments/[appointmentId]/route.ts'),
  'utf8'
);
const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/031_record_appointment_outcome.sql'),
  'utf8'
);

describe('appointment outcome route contract', () => {
  it('validates the outcome against the known set rather than trusting the body', () => {
    expect(route).toMatch(/isAppointmentOutcome\(body\.outcome\)/);
  });

  it('runs the authorization check before writing', () => {
    expect(route).toMatch(/canRecordAppointmentOutcome\(/);
    const guardAt = route.indexOf('canRecordAppointmentOutcome(');
    const writeAt = route.indexOf("rpc('record_appointment_outcome'");
    expect(guardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(guardAt);
  });

  it('refuses with 403 rather than silently ignoring the change', () => {
    expect(route).toMatch(/status:\s*403/);
  });

  it('records the result and history in one database transaction', () => {
    expect(route).toMatch(/rpc\('record_appointment_outcome'/);
    expect(migration).toMatch(/UPDATE lead_appointments/);
    expect(migration).toMatch(/INSERT INTO lead_activities/);
    expect(migration).toMatch(/outcome_at\s*= CASE/);
    expect(migration).toMatch(/outcome_by\s*= CASE/);
  });

  // Reverting to 'scheduled' undoes a mistake; leaving attribution behind would
  // point at a decision that no longer exists.
  it('clears attribution when an outcome is reverted', () => {
    expect(migration).toMatch(/p_outcome = 'scheduled' THEN NULL/);
  });

  it('prevents a stale rep request from overwriting a newer result', () => {
    expect(route).toMatch(/p_expected_outcome:/);
    expect(route).toMatch(/p_allow_overwrite: admin\.role === 'admin'/);
    expect(migration).toMatch(/appointment_changed/);
  });

  it('restricts permanent deletion to admins and does not call it cancellation', () => {
    const deleteStart = route.indexOf('export async function DELETE');
    const deleteRoute = route.slice(deleteStart);
    expect(deleteRoute).toMatch(/admin\.role !== 'admin'/);
    expect(deleteRoute).toMatch(/permanently delete/);
    expect(deleteRoute).not.toMatch(/cannot cancel|appointment canceled/);
  });

  it('keeps the transaction primitive private to the service role', () => {
    expect(migration).toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/);
    expect(migration).toMatch(/REVOKE ALL[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE[\s\S]*TO service_role/);
  });
});
