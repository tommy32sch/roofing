import type { LeadStatus } from '@/types';

/**
 * Per-rep performance metrics.
 *
 * Setters and closers do different jobs, so one blended "performance" number
 * describes neither. This computes four separate families and keeps them
 * separate:
 *
 *   activity      — knocks and calls, attributed to whoever DID them
 *   funnel        — assigned leads converting through the pipeline
 *   revenue       — money, attributed to the closer who won it
 *   follow-through— did the appointments they booked actually happen
 *
 * Every rate returns null rather than 0 when its denominator is empty. "No data
 * yet" and "zero percent" are different facts, and rendering them identically is
 * how a brand-new rep ends up looking like the worst performer on the board.
 *
 * Pure and given explicit rows, so the attribution rules can be tested without
 * a database — which matters here because most of them are only wrong in ways
 * that look plausible.
 */

export interface MetricsLead {
  id: string;
  status: LeadStatus;
  deal_value: number | string | null;
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
  created_at: string;
}

export interface MetricsEvent {
  lead_id: string;
  created_by: string | null;
  /** knocked_at / called_at — when the work happened. */
  occurred_at: string;
}

export interface MetricsAppointment {
  lead_id: string;
  created_by: string | null;
  scheduled_at: string;
  outcome: string;
}

export interface RepMetrics {
  id: string;
  name: string;
  role: string;

  knocks: number;
  calls: number;

  setterLeads: number;
  appointmentsSet: number;
  setRate: number | null;

  closerLeads: number;
  inspected: number;
  proposals: number;
  sold: number;
  closeRate: number | null;

  revenue: number;
  avgDealSize: number | null;
  revenuePerAppointment: number | null;

  appointmentsBooked: number;
  completed: number;
  noShow: number;
  noShowRate: number | null;

  /** Median hours from a lead landing to its first knock. Null with no knocks. */
  medianHoursToFirstKnock: number | null;
}

/** Statuses that prove an appointment was booked at some point. */
const REACHED_APPOINTMENT = new Set<LeadStatus>([
  'appointment_set',
  'inspected',
  'proposal_sent',
  'sold',
  'lost',
]);

/** Statuses at or past an inspection. */
const REACHED_INSPECTED = new Set<LeadStatus>(['inspected', 'proposal_sent', 'sold']);

/** Statuses at or past a proposal. */
const REACHED_PROPOSAL = new Set<LeadStatus>(['proposal_sent', 'sold']);

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Whether an instant falls inside a half-open window. */
export function inWindow(iso: string, from?: string | null, to?: string | null): boolean {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  if (from) {
    const start = Date.parse(from);
    if (!Number.isNaN(start) && at < start) return false;
  }
  if (to) {
    const end = Date.parse(to);
    if (!Number.isNaN(end) && at >= end) return false;
  }
  return true;
}

export function computeRepMetrics(input: {
  users: { id: string; name: string; role: string }[];
  leads: MetricsLead[];
  knocks: MetricsEvent[];
  calls: MetricsEvent[];
  appointments: MetricsAppointment[];
  from?: string | null;
  to?: string | null;
}): RepMetrics[] {
  const { users, leads, knocks, calls, appointments, from, to } = input;

  // Activity is attributed to the person who did it, NOT to whoever the lead is
  // assigned to. A setter covering someone else's territory for a day did that
  // work, and crediting it to the absent assignee would hide it entirely.
  const knocksInWindow = knocks.filter((k) => inWindow(k.occurred_at, from, to));
  const callsInWindow = calls.filter((c) => inWindow(c.occurred_at, from, to));

  // Earliest knock per lead, across all time — "time to first contact" is a
  // property of the lead's whole life, so windowing it would report the first
  // knock INSIDE the window as if it were the first ever.
  const firstKnockByLead = new Map<string, number>();
  for (const knock of knocks) {
    const at = Date.parse(knock.occurred_at);
    if (Number.isNaN(at)) continue;
    const current = firstKnockByLead.get(knock.lead_id);
    if (current === undefined || at < current) firstKnockByLead.set(knock.lead_id, at);
  }

  const leadById = new Map(leads.map((l) => [l.id, l]));

  return users.map((user) => {
    const setterLeads = leads.filter((l) => l.assigned_setter_id === user.id);
    const closerLeads = leads.filter((l) => l.assigned_closer_id === user.id);

    const appointmentsSet = setterLeads.filter((l) => REACHED_APPOINTMENT.has(l.status)).length;
    const inspected = closerLeads.filter((l) => REACHED_INSPECTED.has(l.status)).length;
    const proposals = closerLeads.filter((l) => REACHED_PROPOSAL.has(l.status)).length;
    const soldLeads = closerLeads.filter((l) => l.status === 'sold');
    const sold = soldLeads.length;

    const revenue = soldLeads.reduce((sum, l) => sum + toNumber(l.deal_value), 0);

    // Appointments this rep BOOKED, which is what their no-show rate is about —
    // a closer should not be marked down for a setter's optimistic booking.
    const booked = appointments.filter(
      (a) => a.created_by === user.id && inWindow(a.scheduled_at, from, to)
    );
    const completed = booked.filter((a) => a.outcome === 'completed').length;
    const noShow = booked.filter((a) => a.outcome === 'no_show').length;

    // Cancellations are excluded from the denominator: a homeowner who calls
    // ahead is a different event from one who leaves a closer on the doorstep,
    // and folding them in would let a rep improve the rate by cancelling.
    const decided = completed + noShow;

    // Closer appointments actually run, used as the honest close-rate
    // denominator — dividing by assigned leads punishes a closer for leads that
    // never reached an appointment at all.
    const closerAppointmentsRun = appointments.filter((a) => {
      if (a.outcome !== 'completed') return false;
      if (!inWindow(a.scheduled_at, from, to)) return false;
      return leadById.get(a.lead_id)?.assigned_closer_id === user.id;
    }).length;

    const hoursToFirstKnock: number[] = [];
    for (const lead of setterLeads) {
      const first = firstKnockByLead.get(lead.id);
      const created = Date.parse(lead.created_at);
      if (first === undefined || Number.isNaN(created)) continue;
      if (first < created) continue; // clock skew; a knock cannot precede the lead
      hoursToFirstKnock.push((first - created) / 3_600_000);
    }

    return {
      id: user.id,
      name: user.name,
      role: user.role,

      knocks: knocksInWindow.filter((k) => k.created_by === user.id).length,
      calls: callsInWindow.filter((c) => c.created_by === user.id).length,

      setterLeads: setterLeads.length,
      appointmentsSet,
      setRate: ratio(appointmentsSet, setterLeads.length),

      closerLeads: closerLeads.length,
      inspected,
      proposals,
      sold,
      closeRate: ratio(sold, closerAppointmentsRun),

      revenue,
      avgDealSize: ratio(revenue, sold),
      revenuePerAppointment: ratio(revenue, closerAppointmentsRun),

      appointmentsBooked: booked.length,
      completed,
      noShow,
      noShowRate: ratio(noShow, decided),

      medianHoursToFirstKnock: median(hoursToFirstKnock),
    };
  });
}

/** ISO week-start (Monday) for an instant, as YYYY-MM-DD. */
export function weekStart(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const day = d.getUTCDay();
  const offset = day === 0 ? 6 : day - 1; // Monday-based
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offset));
  return monday.toISOString().slice(0, 10);
}

export interface TrendPoint {
  weekStart: string;
  knocks: number;
  calls: number;
  appointmentsSet: number;
  sold: number;
  revenue: number;
}

/**
 * Weekly series for one rep — what the leaderboard expands into.
 *
 * Weeks with no activity are emitted as zeros rather than omitted, so a gap
 * reads as "did nothing that week" instead of the chart silently closing up and
 * implying continuous work.
 */
export function repTrend(input: {
  userId: string;
  leads: MetricsLead[];
  knocks: MetricsEvent[];
  calls: MetricsEvent[];
  appointments: MetricsAppointment[];
  weeks: string[];
}): TrendPoint[] {
  const { userId, leads, knocks, calls, appointments, weeks } = input;
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const empty = (): Omit<TrendPoint, 'weekStart'> => ({
    knocks: 0,
    calls: 0,
    appointmentsSet: 0,
    sold: 0,
    revenue: 0,
  });
  const buckets = new Map(weeks.map((w) => [w, empty()]));

  for (const knock of knocks) {
    if (knock.created_by !== userId) continue;
    const w = weekStart(knock.occurred_at);
    const bucket = w ? buckets.get(w) : undefined;
    if (bucket) bucket.knocks += 1;
  }
  for (const call of calls) {
    if (call.created_by !== userId) continue;
    const w = weekStart(call.occurred_at);
    const bucket = w ? buckets.get(w) : undefined;
    if (bucket) bucket.calls += 1;
  }
  for (const appointment of appointments) {
    const w = weekStart(appointment.scheduled_at);
    const bucket = w ? buckets.get(w) : undefined;
    if (!bucket) continue;
    if (appointment.created_by === userId) bucket.appointmentsSet += 1;

    const lead = leadById.get(appointment.lead_id);
    if (lead?.assigned_closer_id === userId && lead.status === 'sold') {
      bucket.sold += 1;
      bucket.revenue += toNumber(lead.deal_value);
    }
  }

  return weeks.map((w) => ({ weekStart: w, ...(buckets.get(w) ?? empty()) }));
}
