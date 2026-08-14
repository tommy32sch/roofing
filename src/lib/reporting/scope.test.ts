import { describe, expect, it } from 'vitest';
import type { ReportScopeSelection } from './contracts';
import { reportFreshness } from './contracts';
import { previousEqualPeriod } from './comparison';
import {
  localReportPeriodBounds,
  parseReportScopeUrl,
  reportScopeForDevice,
  serializeReportScope,
} from './scope';
import { resolveReportScope } from './scope.server';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const SETTER_ID = '00000000-0000-4000-8000-000000000002';
const CLOSER_ID = '00000000-0000-4000-8000-000000000003';
const MEMBERS = [
  { id: ADMIN_ID, name: 'Admin', role: 'admin' as const },
  { id: SETTER_ID, name: 'Setter', role: 'setter' as const },
  { id: CLOSER_ID, name: 'Closer', role: 'closer' as const },
];

function rawScope(overrides: Partial<ReturnType<typeof parseReportScopeUrl>> = {}) {
  return {
    period: 'week',
    from: '2026-08-10T07:00:00.000Z',
    to: '2026-08-17T07:00:00.000Z',
    localDate: '2026-08-14',
    marketId: '1',
    actor: 'all',
    ...overrides,
  };
}

describe('report scope URL contract', () => {
  it('round trips market, member, period, local date, and explicit instants', () => {
    const scope: ReportScopeSelection = {
      period: 'month',
      from: '2026-08-01T07:00:00.000Z',
      to: '2026-09-01T07:00:00.000Z',
      localDate: '2026-08-14',
      marketId: 2,
      actor: { kind: 'member', memberId: SETTER_ID },
    };

    const parsed = parseReportScopeUrl(serializeReportScope(scope));
    expect(
      reportScopeForDevice(parsed, {
        role: 'admin',
        homeMarketId: 1,
        now: new Date(2026, 7, 14, 12),
      })
    ).toEqual(scope);
  });

  it('builds local midnight, Monday-week, and calendar-month boundaries', () => {
    const now = new Date(2026, 7, 14, 23, 30); // Friday
    const today = localReportPeriodBounds('today', now);
    const week = localReportPeriodBounds('week', now);
    const month = localReportPeriodBounds('month', now);
    const year = localReportPeriodBounds('year', now);

    expect(new Date(today.from).getHours()).toBe(0);
    expect(new Date(today.to).getDate()).toBe(15);
    expect(new Date(week.from).getDay()).toBe(1);
    expect(new Date(week.from).getDate()).toBe(10);
    expect(new Date(month.from).getDate()).toBe(1);
    expect(new Date(month.to).getMonth()).toBe(8);
    expect(new Date(year.from).getMonth()).toBe(0);
    expect(new Date(year.from).getDate()).toBe(1);
    expect(new Date(year.from).getFullYear()).toBe(2026);
    expect(new Date(year.to).getFullYear()).toBe(2027);
    expect(new Date(year.to).getMonth()).toBe(0);
    expect(new Date(year.to).getDate()).toBe(1);
    expect(today.localDate).toBe('2026-08-14');
  });

  it('keeps reps on Mine even when they open an admin URL', () => {
    const scope = reportScopeForDevice(rawScope({ actor: 'all' }), {
      role: 'setter',
      homeMarketId: 1,
      now: new Date(2026, 7, 14, 12),
    });
    expect(scope.actor).toEqual({ kind: 'mine' });
  });

  it('replaces a partial URL window as one boundary pair', () => {
    const scope = reportScopeForDevice(rawScope({ from: '2020-01-01T00:00:00Z', to: null }), {
      role: 'admin',
      homeMarketId: 1,
      now: new Date(2026, 7, 14, 12),
    });
    expect(new Date(scope.from).getFullYear()).toBe(2026);
    expect(Date.parse(scope.to)).toBeGreaterThan(Date.parse(scope.from));
  });
});

describe('server report scope resolution', () => {
  it('allows every admin team choice and resolves a member through the shared lead policy', () => {
    const result = resolveReportScope(rawScope({ actor: `member:${SETTER_ID}` }), {
      actor: { id: ADMIN_ID, name: 'Admin', role: 'admin', homeMarketId: 1 },
      members: MEMBERS,
      accessibleMarketIds: [1, 2],
      nowIso: '2026-08-14T18:00:00.000Z',
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        scope: { actor: { kind: 'member', memberId: SETTER_ID }, marketId: 1 },
        requestActor: { id: ADMIN_ID, role: 'admin' },
        leadActor: { id: SETTER_ID, role: 'setter' },
        leadScope: 'mine',
        activityUserId: SETTER_ID,
      },
    });
  });

  it.each(['all', `member:${CLOSER_ID}`])(
    'rejects broader %s scope for a setter before queries run',
    (actor) => {
      const result = resolveReportScope(rawScope({ actor }), {
        actor: { id: SETTER_ID, name: 'Setter', role: 'setter', homeMarketId: 1 },
        members: [MEMBERS[1]],
        accessibleMarketIds: [1, 2],
      });
      expect(result).toMatchObject({ ok: false, status: 403 });
    }
  );

  it('rejects invalid, inverted, and widened ranges', () => {
    const input = {
      actor: { id: ADMIN_ID, name: 'Admin', role: 'admin' as const, homeMarketId: 1 },
      members: MEMBERS,
      accessibleMarketIds: [1, 2],
    };
    expect(resolveReportScope(rawScope({ from: 'bad' }), input)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      resolveReportScope(rawScope({ from: '2026-08-17T07:00:00Z', to: '2026-08-10T07:00:00Z' }), input)
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      resolveReportScope(rawScope({ period: 'today', from: '2026-08-01T00:00:00Z', to: '2026-09-01T00:00:00Z' }), input)
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      resolveReportScope(
        rawScope({
          period: 'month',
          from: '2026-07-01',
          to: '2026-09-01T07:00:00.000Z',
        }),
        input
      )
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      resolveReportScope(
        rawScope({
          period: 'year',
          from: '2026-01-01T07:00:00.000Z',
          to: '2027-01-01T07:00:00.000Z',
          localDate: '2026-08-14',
        }),
        input
      )
    ).toMatchObject({ ok: true });
  });

  it('rejects an inaccessible market and a nonexistent calendar date', () => {
    const input = {
      actor: { id: ADMIN_ID, name: 'Admin', role: 'admin' as const, homeMarketId: 1 },
      members: MEMBERS,
      accessibleMarketIds: [1],
    };
    expect(resolveReportScope(rawScope({ marketId: '2' }), input)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(resolveReportScope(rawScope({ localDate: '2026-02-30' }), input)).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe('report comparisons and freshness', () => {
  it('uses the immediately preceding range of equal length', () => {
    expect(
      previousEqualPeriod('2026-08-10T07:00:00.000Z', '2026-08-17T07:00:00.000Z')
    ).toEqual({
      from: '2026-08-03T07:00:00.000Z',
      to: '2026-08-10T07:00:00.000Z',
    });
  });

  it('marks a brief stale after five minutes', () => {
    const asOf = '2026-08-14T18:00:00.000Z';
    expect(reportFreshness(asOf, Date.parse('2026-08-14T18:04:59.000Z'))).toBe('fresh');
    expect(reportFreshness(asOf, Date.parse('2026-08-14T18:05:01.000Z'))).toBe('stale');
  });
});
