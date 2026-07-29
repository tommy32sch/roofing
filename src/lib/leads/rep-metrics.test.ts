import { describe, it, expect } from 'vitest';
import {
  computeRepMetrics,
  repTrend,
  median,
  inWindow,
  weekStart,
  type MetricsLead,
  type MetricsEvent,
  type MetricsAppointment,
} from './rep-metrics';

const SETTER = 'setter-1';
const CLOSER = 'closer-1';
const OTHER = 'other-1';

const users = [
  { id: SETTER, name: 'Sam Setter', role: 'setter' },
  { id: CLOSER, name: 'Cleo Closer', role: 'closer' },
];

const lead = (over: Partial<MetricsLead> = {}): MetricsLead => ({
  id: 'lead-1',
  status: 'new',
  deal_value: null,
  assigned_setter_id: SETTER,
  assigned_closer_id: CLOSER,
  created_at: '2026-07-01T10:00:00.000Z',
  ...over,
});

const ev = (over: Partial<MetricsEvent> = {}): MetricsEvent => ({
  lead_id: 'lead-1',
  created_by: SETTER,
  occurred_at: '2026-07-15T10:00:00.000Z',
  ...over,
});

const appt = (over: Partial<MetricsAppointment> = {}): MetricsAppointment => ({
  lead_id: 'lead-1',
  created_by: SETTER,
  scheduled_at: '2026-07-15T17:00:00.000Z',
  outcome: 'completed',
  ...over,
});

const compute = (over: Partial<Parameters<typeof computeRepMetrics>[0]> = {}) =>
  computeRepMetrics({
    users,
    leads: [],
    knocks: [],
    calls: [],
    appointments: [],
    ...over,
  });

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns null for nothing rather than zero', () => {
    expect(median([])).toBeNull();
  });
});

describe('inWindow', () => {
  it('is inclusive of the start and exclusive of the end', () => {
    expect(inWindow('2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z', '2026-07-16T00:00:00Z')).toBe(true);
    expect(inWindow('2026-07-16T00:00:00Z', '2026-07-15T00:00:00Z', '2026-07-16T00:00:00Z')).toBe(false);
  });

  it('treats missing bounds as unbounded', () => {
    expect(inWindow('2026-07-15T00:00:00Z')).toBe(true);
    expect(inWindow('2026-07-15T00:00:00Z', null, null)).toBe(true);
  });

  it('excludes unparseable instants', () => {
    expect(inWindow('nope', null, null)).toBe(false);
  });
});

describe('weekStart', () => {
  it('snaps to the Monday of that week', () => {
    // 2026-07-29 is a Wednesday.
    expect(weekStart('2026-07-29T12:00:00Z')).toBe('2026-07-27');
  });

  it('treats Sunday as the end of the prior week, not the start', () => {
    // 2026-08-02 is a Sunday.
    expect(weekStart('2026-08-02T12:00:00Z')).toBe('2026-07-27');
  });

  it('returns a Monday for a Monday', () => {
    expect(weekStart('2026-07-27T00:00:00Z')).toBe('2026-07-27');
  });

  it('returns null for junk', () => {
    expect(weekStart('nope')).toBeNull();
  });
});

describe('computeRepMetrics — attribution', () => {
  // Activity belongs to whoever did it. A setter covering someone else's
  // territory did that work; crediting the absent assignee would hide it.
  it('credits knocks and calls to the actor, not the lead assignee', () => {
    const [setter, closer] = compute({
      leads: [lead()],
      knocks: [ev({ created_by: CLOSER })],
      calls: [ev({ created_by: CLOSER })],
    });
    expect(setter.knocks).toBe(0);
    expect(closer.knocks).toBe(1);
    expect(closer.calls).toBe(1);
  });

  it('ignores activity by someone outside the reported set', () => {
    const [setter] = compute({ leads: [lead()], knocks: [ev({ created_by: OTHER })] });
    expect(setter.knocks).toBe(0);
  });

  it('splits setter and closer funnels by their own assignment column', () => {
    const [setter, closer] = compute({
      leads: [
        lead({ id: 'a', status: 'appointment_set' }),
        lead({ id: 'b', status: 'new', assigned_closer_id: null }),
      ],
    });
    expect(setter.setterLeads).toBe(2);
    expect(closer.closerLeads).toBe(1);
  });
});

describe('computeRepMetrics — funnel', () => {
  it('counts a lead past appointment_set as an appointment set', () => {
    const [setter] = compute({
      leads: [
        lead({ id: 'a', status: 'appointment_set' }),
        lead({ id: 'b', status: 'sold' }),
        lead({ id: 'c', status: 'lost' }),
        lead({ id: 'd', status: 'new' }),
      ],
    });
    expect(setter.appointmentsSet).toBe(3);
    expect(setter.setRate).toBeCloseTo(3 / 4, 6);
  });

  it('counts inspected and proposal cumulatively', () => {
    const [, closer] = compute({
      leads: [
        lead({ id: 'a', status: 'inspected' }),
        lead({ id: 'b', status: 'proposal_sent' }),
        lead({ id: 'c', status: 'sold' }),
        lead({ id: 'd', status: 'contacted' }),
      ],
    });
    expect(closer.inspected).toBe(3);
    expect(closer.proposals).toBe(2);
    expect(closer.sold).toBe(1);
  });

  // Dividing by assigned leads punishes a closer for leads that never got as
  // far as an appointment — which is the setter's half of the job.
  it('measures close rate against appointments actually run', () => {
    const [, closer] = compute({
      leads: [lead({ id: 'a', status: 'sold' }), lead({ id: 'b', status: 'contacted' })],
      appointments: [
        appt({ lead_id: 'a', outcome: 'completed' }),
        appt({ lead_id: 'b', outcome: 'completed' }),
      ],
    });
    expect(closer.closeRate).toBeCloseTo(1 / 2, 6);
  });
});

describe('computeRepMetrics — revenue', () => {
  it('sums only won deals, to the closer', () => {
    const [setter, closer] = compute({
      leads: [
        lead({ id: 'a', status: 'sold', deal_value: 12000 }),
        lead({ id: 'b', status: 'proposal_sent', deal_value: 9000 }),
      ],
    });
    expect(closer.revenue).toBe(12000);
    expect(setter.revenue).toBe(0);
  });

  it('averages deal size over won deals only', () => {
    const [, closer] = compute({
      leads: [
        lead({ id: 'a', status: 'sold', deal_value: 10000 }),
        lead({ id: 'b', status: 'sold', deal_value: 20000 }),
        lead({ id: 'c', status: 'lost', deal_value: 50000 }),
      ],
    });
    expect(closer.avgDealSize).toBe(15000);
  });

  it('copes with deal_value arriving as a numeric string', () => {
    const [, closer] = compute({
      leads: [lead({ id: 'a', status: 'sold', deal_value: '7500.50' })],
    });
    expect(closer.revenue).toBeCloseTo(7500.5, 2);
  });

  it('treats a null or unparseable value as zero rather than NaN', () => {
    const [, closer] = compute({
      leads: [
        lead({ id: 'a', status: 'sold', deal_value: null }),
        lead({ id: 'b', status: 'sold', deal_value: 'abc' }),
      ],
    });
    expect(closer.revenue).toBe(0);
    expect(closer.avgDealSize).toBe(0);
  });
});

describe('computeRepMetrics — follow-through', () => {
  it('attributes no-shows to whoever booked the appointment', () => {
    const [setter, closer] = compute({
      leads: [lead()],
      appointments: [
        appt({ created_by: SETTER, outcome: 'no_show' }),
        appt({ created_by: SETTER, outcome: 'completed' }),
      ],
    });
    expect(setter.appointmentsBooked).toBe(2);
    expect(setter.noShow).toBe(1);
    expect(setter.noShowRate).toBeCloseTo(0.5, 6);
    expect(closer.appointmentsBooked).toBe(0);
  });

  // Otherwise a rep improves their rate by cancelling anything they expect to
  // lose, which is exactly the wrong incentive.
  it('excludes cancellations from the no-show denominator', () => {
    const [setter] = compute({
      leads: [lead()],
      appointments: [
        appt({ outcome: 'completed' }),
        appt({ outcome: 'no_show' }),
        appt({ outcome: 'cancelled' }),
        appt({ outcome: 'cancelled' }),
      ],
    });
    expect(setter.noShowRate).toBeCloseTo(0.5, 6);
    expect(setter.appointmentsBooked).toBe(4);
  });

  it('leaves the rate null while everything is still scheduled', () => {
    const [setter] = compute({
      leads: [lead()],
      appointments: [appt({ outcome: 'scheduled' }), appt({ outcome: 'scheduled' })],
    });
    expect(setter.noShowRate).toBeNull();
  });
});

describe('computeRepMetrics — speed', () => {
  it('measures the median gap from lead created to first knock', () => {
    const [setter] = compute({
      leads: [
        lead({ id: 'a', created_at: '2026-07-01T00:00:00Z' }),
        lead({ id: 'b', created_at: '2026-07-01T00:00:00Z' }),
      ],
      knocks: [
        ev({ lead_id: 'a', occurred_at: '2026-07-01T02:00:00Z' }),
        ev({ lead_id: 'b', occurred_at: '2026-07-01T06:00:00Z' }),
      ],
    });
    expect(setter.medianHoursToFirstKnock).toBeCloseTo(4, 6);
  });

  it('uses the earliest knock, not the latest', () => {
    const [setter] = compute({
      leads: [lead({ id: 'a', created_at: '2026-07-01T00:00:00Z' })],
      knocks: [
        ev({ lead_id: 'a', occurred_at: '2026-07-05T00:00:00Z' }),
        ev({ lead_id: 'a', occurred_at: '2026-07-01T03:00:00Z' }),
      ],
    });
    expect(setter.medianHoursToFirstKnock).toBeCloseTo(3, 6);
  });

  // Windowing this would report the first knock INSIDE the window as if it were
  // the first ever, flattering anyone whose real first touch was months ago.
  it('finds the first knock across all time, not just the window', () => {
    const [setter] = compute({
      leads: [lead({ id: 'a', created_at: '2026-07-01T00:00:00Z' })],
      knocks: [ev({ lead_id: 'a', occurred_at: '2026-07-01T05:00:00Z' })],
      from: '2026-07-20T00:00:00Z',
      to: '2026-07-30T00:00:00Z',
    });
    expect(setter.medianHoursToFirstKnock).toBeCloseTo(5, 6);
  });

  it('discards a knock timestamped before its own lead', () => {
    const [setter] = compute({
      leads: [lead({ id: 'a', created_at: '2026-07-10T00:00:00Z' })],
      knocks: [ev({ lead_id: 'a', occurred_at: '2026-07-01T00:00:00Z' })],
    });
    expect(setter.medianHoursToFirstKnock).toBeNull();
  });

  it('is null when a lead has never been knocked', () => {
    const [setter] = compute({ leads: [lead()] });
    expect(setter.medianHoursToFirstKnock).toBeNull();
  });
});

describe('computeRepMetrics — empty denominators', () => {
  // A brand-new rep must not render as the worst performer on the board.
  it('returns null rates, never zero, when there is nothing to divide by', () => {
    const [setter] = compute();
    expect(setter.setRate).toBeNull();
    expect(setter.closeRate).toBeNull();
    expect(setter.avgDealSize).toBeNull();
    expect(setter.revenuePerAppointment).toBeNull();
    expect(setter.noShowRate).toBeNull();
    expect(setter.medianHoursToFirstKnock).toBeNull();
  });

  it('still reports counts as zero', () => {
    const [setter] = compute();
    expect(setter.knocks).toBe(0);
    expect(setter.revenue).toBe(0);
    expect(setter.setterLeads).toBe(0);
  });

  it('returns one row per user even with no data at all', () => {
    expect(compute()).toHaveLength(2);
  });
});

describe('computeRepMetrics — windowing', () => {
  it('counts only activity inside the window', () => {
    const [setter] = compute({
      leads: [lead()],
      knocks: [
        ev({ occurred_at: '2026-07-10T00:00:00Z' }),
        ev({ occurred_at: '2026-07-25T00:00:00Z' }),
      ],
      from: '2026-07-20T00:00:00Z',
      to: '2026-07-30T00:00:00Z',
    });
    expect(setter.knocks).toBe(1);
  });

  it('counts everything when unbounded', () => {
    const [setter] = compute({
      leads: [lead()],
      knocks: [
        ev({ occurred_at: '2026-01-01T00:00:00Z' }),
        ev({ occurred_at: '2026-07-25T00:00:00Z' }),
      ],
    });
    expect(setter.knocks).toBe(2);
  });
});

describe('repTrend', () => {
  const weeks = ['2026-07-13', '2026-07-20', '2026-07-27'];

  it('buckets activity into the right week', () => {
    const out = repTrend({
      userId: SETTER,
      leads: [lead()],
      knocks: [
        ev({ occurred_at: '2026-07-15T10:00:00Z' }),
        ev({ occurred_at: '2026-07-16T10:00:00Z' }),
        ev({ occurred_at: '2026-07-29T10:00:00Z' }),
      ],
      calls: [],
      appointments: [],
      weeks,
    });
    expect(out.map((p) => p.knocks)).toEqual([2, 0, 1]);
  });

  // A closed-up gap implies continuous work that did not happen.
  it('emits zero weeks rather than omitting them', () => {
    const out = repTrend({
      userId: SETTER,
      leads: [],
      knocks: [],
      calls: [],
      appointments: [],
      weeks,
    });
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.knocks === 0 && p.revenue === 0)).toBe(true);
  });

  it('credits sold revenue to the closer, in the appointment week', () => {
    const out = repTrend({
      userId: CLOSER,
      leads: [lead({ id: 'a', status: 'sold', deal_value: 8000 })],
      knocks: [],
      calls: [],
      appointments: [appt({ lead_id: 'a', scheduled_at: '2026-07-21T17:00:00Z' })],
      weeks,
    });
    expect(out[1]).toMatchObject({ weekStart: '2026-07-20', sold: 1, revenue: 8000 });
  });

  it('ignores other people’s activity', () => {
    const out = repTrend({
      userId: SETTER,
      leads: [],
      knocks: [ev({ created_by: OTHER, occurred_at: '2026-07-15T10:00:00Z' })],
      calls: [],
      appointments: [],
      weeks,
    });
    expect(out.every((p) => p.knocks === 0)).toBe(true);
  });

  it('drops activity outside the requested weeks', () => {
    const out = repTrend({
      userId: SETTER,
      leads: [],
      knocks: [ev({ occurred_at: '2026-06-01T10:00:00Z' })],
      calls: [],
      appointments: [],
      weeks,
    });
    expect(out.every((p) => p.knocks === 0)).toBe(true);
  });
});
