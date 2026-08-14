import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const appointments = read('src/app/api/admin/appointments/route.ts');
const scheduleWork = read('src/app/api/admin/schedule-work/route.ts');
const page = read('src/app/admin/(app)/calendar/page.tsx');

describe('Schedule Desk contracts', () => {
  it('enforces calendar scope on both server queries', () => {
    for (const route of [appointments, scheduleWork]) {
      expect(route).toContain('resolveCalendarScope(admin.role');
      expect(route).toContain('calendarScopeAssignment(scope)');
      expect(route).toContain('applyLeadAccessFilter');
    }
    expect(page).toContain('permissions.canViewTeamData && (');
  });

  it('returns display owners and server-owned outcome permission', () => {
    expect(appointments).toContain('assigned_setter:admin_users!assigned_setter_id(id, name)');
    expect(appointments).toContain('assigned_closer:admin_users!assigned_closer_id(id, name)');
    expect(appointments).toContain('canRecordAppointmentOutcome({');
    expect(appointments).toContain('scheduleExceptions(');
  });

  it('keeps view, date, scope, and market in URL-backed state', () => {
    expect(page).toContain('useSearchParams()');
    expect(page).toContain("replaceParams({ view: nextView, date: calendarDateParam(nextAnchor) })");
    expect(page).toContain("replaceParams({ scope: value })");
    expect(page).toContain("replaceParams({ market_id: value })");
  });

  it('uses an agenda below the desktop grids and exposes field actions', () => {
    expect(page).toContain('className="lg:hidden"');
    expect(page).toContain('className="xl:hidden"');
    expect(page).toContain('Record Outcome');
    expect(page).toContain('Open Lead');
    expect(page).toContain('Directions');
    expect(page).toContain('!lead.is_dnc && phone');
  });

  it('returns only due follow-ups without a future scheduled appointment', () => {
    expect(scheduleWork).toContain(".lte('follow_up_date', dueBefore)");
    expect(scheduleWork).toContain(".not('status', 'in', CLOSED_STATUSES)");
    expect(scheduleWork).toContain(".gte('scheduled_at', nowIso)");
    expect(scheduleWork).toContain(".eq('outcome', 'scheduled')");
    expect(scheduleWork).toContain('if (!booked.has(lead.id)) work.push(lead)');
  });
});
