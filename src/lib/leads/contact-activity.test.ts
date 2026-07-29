import { describe, expect, it } from 'vitest';
import {
  defaultContactActivityScope,
  isValidContactActivityWindow,
  localContactActivityBounds,
  resolveContactActivityUser,
} from './contact-activity';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const REP_ID = '00000000-0000-4000-8000-000000000002';

describe('contact activity reporting', () => {
  it('builds local today, Monday-week and calendar-month windows', () => {
    const now = new Date(2026, 6, 29, 15, 30); // Wednesday, July 29
    const today = localContactActivityBounds('today', now);
    const week = localContactActivityBounds('week', now);
    const month = localContactActivityBounds('month', now);

    expect(new Date(today.start).getHours()).toBe(0);
    expect(new Date(today.end).getDate()).toBe(30);
    expect(new Date(week.start).getDay()).toBe(1);
    expect(new Date(week.start).getDate()).toBe(27);
    expect(new Date(month.start).getDate()).toBe(1);
    expect(new Date(month.end).getMonth()).toBe(7);
    expect(isValidContactActivityWindow('today', today.start, today.end)).toBe(true);
    expect(isValidContactActivityWindow('week', week.start, week.end)).toBe(true);
    expect(isValidContactActivityWindow('month', month.start, month.end)).toBe(true);
  });

  it('rejects malformed and widened reporting windows', () => {
    expect(isValidContactActivityWindow('today', null, null)).toBe(false);
    expect(
      isValidContactActivityWindow(
        'today',
        '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z'
      )
    ).toBe(false);
    expect(
      isValidContactActivityWindow(
        'month',
        '2026-07-01T00:00:00.000Z',
        '2026-07-02T00:00:00.000Z'
      )
    ).toBe(false);
  });

  it('defaults admins to the team and reps to their own account', () => {
    expect(defaultContactActivityScope('admin')).toBe('all');
    expect(defaultContactActivityScope('setter')).toBe('me');
    expect(defaultContactActivityScope('closer')).toBe('me');
  });

  it('allows admin account filters but keeps reps scoped to themselves', () => {
    expect(resolveContactActivityUser('admin', ADMIN_ID, 'all')).toEqual({
      ok: true,
      userId: null,
    });
    expect(resolveContactActivityUser('admin', ADMIN_ID, REP_ID)).toEqual({
      ok: true,
      userId: REP_ID,
    });
    expect(resolveContactActivityUser('setter', REP_ID, 'me')).toEqual({
      ok: true,
      userId: REP_ID,
    });
    expect(resolveContactActivityUser('setter', REP_ID, 'all')).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(resolveContactActivityUser('admin', ADMIN_ID, 'not-a-user')).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});
