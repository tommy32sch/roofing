import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const page = read('src/app/admin/(app)/today/page.tsx');
const command = read('src/components/today/TodayAppointmentCommand.tsx');
const actions = read('src/components/leads/AppointmentOutcomeActions.tsx');
const outcomeClient = read('src/lib/leads/appointment-outcome-client.ts');
const leadDetail = read('src/app/admin/(app)/leads/[leadId]/page.tsx');
const route = read('src/app/api/admin/today/route.ts');
const conflicts = read('src/lib/leads/appointment-guard.ts');
const reminders = read('src/lib/appointments/reminder-service.ts');

describe('Today command center contracts', () => {
  it('loads today and prior unresolved visits under one visibility boundary', () => {
    expect(route).toMatch(/function appointmentQuery\(kind: 'today' \| 'prior'/);
    expect(route).toMatch(/\.lt\('scheduled_at', start!\)\.eq\('outcome', 'scheduled'\)/);
    expect(route).toMatch(/\.eq\('leads\.is_flagged_duplicate', false\)/);
    expect(route).toMatch(/if \(marketId != null\)/);
    expect(route).toMatch(/resolveLeadDataScope\(actor, searchParams\.get\('scope'\)\)/);
    expect(route.match(/applyLeadAccessFilter\(/g) ?? []).toHaveLength(4);
  });

  it('shows the Mine and Everyone control only to an admin', () => {
    expect(page).toContain('permissions.canViewTeamData && (');
    expect(page).toContain("{s === 'mine' ? 'Mine' : 'Everyone'}");
    expect(page).toContain('permissions.canBulkAssignLeads');
  });

  it('returns one clock, exact counts, outcome fields, and server-owned permission', () => {
    for (const field of ['generatedAt', 'priorUnresolvedAppointments', 'outcome_at', 'outcome_by', 'can_record_outcome']) {
      expect(route).toContain(field);
    }
    expect(route).toMatch(/select\(APPOINTMENT_FIELDS, \{ count: 'exact' \}\)/);
    expect(route).toMatch(/canRecordAppointmentOutcome\(/);
  });

  it('uses the shared clock and pure command model in the page', () => {
    expect(page).toMatch(/buildTodayCommandCenter\(/);
    expect(page).toMatch(/setNowIso\(json\.generatedAt\)/);
    expect(page).toMatch(/window\.setInterval\(refreshClock, 60_000\)/);
    expect(page).toMatch(/visibilitychange/);
  });

  it('records all three visible results by PATCH and never DELETE', () => {
    for (const label of ['Completed', 'No-show', 'Cancelled']) expect(actions).toContain(label);
    expect(page).toMatch(/saveAppointmentOutcome\(/);
    expect(outcomeClient).toMatch(/method: 'PATCH'/);
    expect(outcomeClient).toMatch(/JSON\.stringify\(\{ outcome: input\.outcome \}\)/);
    expect(page).not.toMatch(/method: 'DELETE'/);
  });

  it('preserves cancellation and result capture on Lead Detail', () => {
    expect(leadDetail).toMatch(/<AppointmentOutcomeActions/);
    expect(leadDetail).toMatch(/handleAppointmentOutcome\(appt, 'cancelled'\)/);
    expect(leadDetail).toMatch(/user\.role === 'admin'/);
    expect(leadDetail).toContain('Delete appointment permanently');
  });

  it('shows next stop, progress, awaiting results, and later today accessibly', () => {
    for (const copy of ['Next stop', 'Daily progress', 'Awaiting results', 'Later today']) {
      expect(command).toContain(copy);
    }
    expect(command).toMatch(/<time dateTime=/);
    expect(actions).toMatch(/role="group"/);
    expect(command).toMatch(/aria-busy=/);
    expect(command).toMatch(/role="alert"/);
  });

  it('stops cancelled visits from blocking slots or sending reminders', () => {
    expect(conflicts).toMatch(/\.eq\('outcome', 'scheduled'\)/);
    expect(reminders).toMatch(/\.eq\('outcome', 'scheduled'\)/);
    expect(reminders).toMatch(/appt\.outcome !== 'scheduled'/);
  });
});
