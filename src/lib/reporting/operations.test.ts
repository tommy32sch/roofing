import { describe, expect, it } from 'vitest';
import type { LeadStatus } from '@/types';
import type { ReportScope } from './contracts';
import {
  buildFunnel,
  buildLeadTrend,
  buildOperationsExceptions,
  buildOperationsMetrics,
  buildTeamPulse,
  type OperationsAppointmentRow,
  type OperationsContactEvent,
  type OperationsLeadRow,
  type OperationsSaleEvent,
} from './operations';
import { isStalledWork, STALLED_WORK_DAYS } from './stalled-work';

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
const SETTER_ID = '00000000-0000-4000-8000-000000000002';
const CLOSER_ID = '00000000-0000-4000-8000-000000000003';

const scope: ReportScope = {
  period: 'week',
  from: '2026-08-10T07:00:00.000Z',
  to: '2026-08-17T07:00:00.000Z',
  localDate: '2026-08-14',
  marketId: 1,
  actor: { kind: 'all' },
  asOf: '2026-08-14T18:00:00.000Z',
};

function lead(
  id: string,
  overrides: Partial<OperationsLeadRow> = {}
): OperationsLeadRow {
  return {
    id,
    firstName: 'Lead',
    lastName: id,
    address: '100 Main St',
    status: 'new',
    dealValue: 0,
    estimatedRoofValue: 10_000,
    createdAt: '2026-08-12T12:00:00.000Z',
    updatedAt: '2026-08-12T12:00:00.000Z',
    followUpDate: null,
    lastKnockAt: null,
    lastCallAt: null,
    assignedSetterId: SETTER_ID,
    assignedCloserId: CLOSER_ID,
    ...overrides,
  };
}

function appointment(
  id: string,
  overrides: Partial<OperationsAppointmentRow> = {}
): OperationsAppointmentRow {
  return {
    id,
    leadId: 'lead-current',
    scheduledAt: '2026-08-13T18:00:00.000Z',
    createdAt: '2026-08-11T18:00:00.000Z',
    createdBy: SETTER_ID,
    outcome: 'scheduled',
    outcomeAt: null,
    outcomeBy: null,
    assignedSetterId: SETTER_ID,
    assignedCloserId: CLOSER_ID,
    ...overrides,
  };
}

function contact(
  id: string,
  channel: OperationsContactEvent['channel'],
  disposition: string,
  occurredAt = '2026-08-12T18:00:00.000Z'
): OperationsContactEvent {
  return { id, leadId: 'lead-current', channel, disposition, occurredAt, createdBy: SETTER_ID };
}

function sale(
  id: string,
  occurredAt: string,
  dealValue: number
): OperationsSaleEvent {
  return {
    id,
    leadId: id,
    occurredAt,
    dealValue,
    estimatedRoofValue: 0,
    assignedSetterId: SETTER_ID,
    assignedCloserId: CLOSER_ID,
  };
}

describe('operations KPI and funnel models', () => {
  it('uses one current window and one equal prior window for every KPI', () => {
    const metrics = buildOperationsMetrics({
      scope,
      leads: [
        lead('lead-current'),
        lead('lead-prior', { createdAt: '2026-08-05T12:00:00.000Z' }),
      ],
      contactEvents: [
        contact('live-current', 'knock', 'call_back'),
        contact('no-answer', 'knock', 'not_home'),
        contact('live-prior', 'call', 'not_interested', '2026-08-06T18:00:00.000Z'),
      ],
      appointments: [
        appointment('current'),
        appointment('prior', { scheduledAt: '2026-08-06T18:00:00.000Z' }),
      ],
      sales: [
        sale('sold-current', '2026-08-12T18:00:00.000Z', 20_000),
        sale('sold-prior', '2026-08-06T18:00:00.000Z', 10_000),
      ],
    });

    expect(metrics.map((metric) => [metric.key, metric.value, metric.comparison.previous])).toEqual([
      ['new_leads', 1, 1],
      ['contacts', 1, 1],
      ['appointments', 1, 1],
      ['sold_jobs', 1, 1],
      ['revenue', 20_000, 10_000],
    ]);
    expect(metrics.find((metric) => metric.key === 'revenue')?.comparison).toMatchObject({
      delta: 10_000,
      percent: 100,
      direction: 'up',
    });
  });

  it('shows current counts and uses actual value before system estimate', () => {
    const funnel = buildFunnel(scope, [
      lead('new-estimate', { estimatedRoofValue: 15_000 }),
      lead('new-deal', { dealValue: 22_000, estimatedRoofValue: 15_000 }),
      lead('sold', { status: 'sold', dealValue: 30_000 }),
    ]);
    expect(funnel.find((row) => row.status === 'new')).toMatchObject({ count: 2, value: 37_000 });
    expect(funnel.find((row) => row.status === 'sold')).toMatchObject({ count: 1, value: 30_000 });
  });
});

describe('operations exception rules', () => {
  it('keeps stalled-work limits in one status-specific policy', () => {
    expect(STALLED_WORK_DAYS).toEqual({ appointment_set: 3, inspected: 5, proposal_sent: 7 });
    for (const [status, days] of Object.entries(STALLED_WORK_DAYS)) {
      expect(
        isStalledWork({
          status: status as LeadStatus,
          lastWorkAt: new Date(Date.parse(scope.asOf) - days * 86_400_000).toISOString(),
          asOf: scope.asOf,
        })
      ).toBe(true);
    }
    expect(
      isStalledWork({
        status: 'inspected',
        lastWorkAt: new Date(Date.parse(scope.asOf) - 4 * 86_400_000).toISOString(),
        asOf: scope.asOf,
      })
    ).toBe(false);
  });

  it('returns actionable rows with the exact rule that caused each exception', () => {
    const data = buildOperationsExceptions({
      scope,
      leads: [
        lead('overdue', { followUpDate: '2026-08-13' }),
        lead('unassigned', { assignedSetterId: null }),
        lead('appointment', { status: 'appointment_set', assignedCloserId: null }),
        lead('stalled', {
          status: 'inspected',
          updatedAt: '2026-08-08T18:00:00.000Z',
          createdAt: '2026-08-01T18:00:00.000Z',
        }),
      ],
      upcomingAppointments: [
        appointment('missing-owner', {
          leadId: 'appointment',
          assignedCloserId: null,
          scheduledAt: '2026-08-15T18:00:00.000Z',
        }),
      ],
      recentActivities: [],
    });

    expect(Object.fromEntries(data.groups.map((group) => [group.kind, group.count]))).toEqual({
      overdue_follow_up: 1,
      unassigned_lead: 1,
      appointment_owner: 1,
      stalled_deal: 1,
    });
    expect(data.items[0].severity).toBe('urgent');
    expect(data.items.every((item) => item.href.startsWith('/admin/leads/'))).toBe(true);
    expect(data.items.find((item) => item.kind === 'stalled_deal')?.rule).toMatch(/days/);
  });
});

describe('operations trend and team pulse', () => {
  it('keeps quiet trend buckets instead of compressing time', () => {
    const trend = buildLeadTrend(scope, [
      lead('first', { createdAt: '2026-08-10T12:00:00.000Z' }),
      lead('last', { createdAt: '2026-08-16T12:00:00.000Z' }),
    ]);
    expect(trend).toHaveLength(7);
    expect(trend.reduce((sum, point) => sum + point.value, 0)).toBe(2);
    expect(trend.some((point) => point.value === 0)).toBe(true);
  });

  it('attributes field work, outcomes, and sold jobs to the people who own them', () => {
    const rows = buildTeamPulse({
      scope,
      currentUserId: ADMIN_ID,
      members: [
        { id: SETTER_ID, name: 'Setter', role: 'setter' },
        { id: CLOSER_ID, name: 'Closer', role: 'closer' },
      ],
      contacts: [contact('knock', 'knock', 'not_home'), contact('call', 'call', 'left_voicemail')],
      appointments: [appointment('booked')],
      outcomeAppointments: [
        appointment('completed', {
          outcome: 'completed',
          outcomeAt: '2026-08-13T20:00:00.000Z',
          outcomeBy: CLOSER_ID,
        }),
      ],
      sales: [sale('sold', '2026-08-13T20:00:00.000Z', 25_000)],
    });
    expect(rows.find((row) => row.memberId === SETTER_ID)).toMatchObject({
      knocks: 1,
      calls: 1,
      appointments: 1,
      outcomes: 0,
      soldJobs: 0,
    });
    expect(rows.find((row) => row.memberId === CLOSER_ID)).toMatchObject({
      outcomes: 1,
      soldJobs: 1,
    });
  });
});
