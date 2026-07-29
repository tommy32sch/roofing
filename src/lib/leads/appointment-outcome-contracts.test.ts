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

describe('appointment outcome route contract', () => {
  it('validates the outcome against the known set rather than trusting the body', () => {
    expect(route).toMatch(/isAppointmentOutcome\(body\.outcome\)/);
  });

  it('runs the authorization check before writing', () => {
    expect(route).toMatch(/canRecordOutcome\(/);
    const guardAt = route.indexOf('canRecordOutcome(');
    const writeAt = route.indexOf('updates.outcome =');
    expect(guardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(guardAt);
  });

  it('refuses with 403 rather than silently ignoring the change', () => {
    expect(route).toMatch(/status:\s*403/);
  });

  it('records who decided and when', () => {
    expect(route).toMatch(/updates\.outcome_at\s*=/);
    expect(route).toMatch(/updates\.outcome_by\s*=/);
  });

  // Reverting to 'scheduled' undoes a mistake; leaving attribution behind would
  // point at a decision that no longer exists.
  it('clears attribution when an outcome is reverted', () => {
    expect(route).toMatch(/outcome === 'scheduled' \? null/);
  });

  it('writes the outcome into the lead timeline', () => {
    expect(route).toMatch(/lead_activities/);
    expect(route).toMatch(/appointmentOutcomeLabel\(/);
  });
});
