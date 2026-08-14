import type { AppointmentOutcome, LeadStatus, UserRole } from '@/types';
import { statusForCallDisposition, type ColdCallDisposition } from '@/lib/leads/calls';
import { statusForDisposition, type KnockDisposition } from '@/lib/leads/knocks';
import { compareReportMetric, previousEqualPeriod } from './comparison';
import type {
  FunnelRow,
  OperationsExceptionGroup,
  OperationsExceptionItem,
  OperationsExceptions,
  ReportMemberOption,
  ReportMetric,
  ReportScope,
  TeamPulseRow,
  TrendPoint,
} from './contracts';
import { isStalledWork, stalledWorkThresholdDays } from './stalled-work';

export interface OperationsLeadRow {
  id: string;
  firstName: string;
  lastName: string;
  address: string | null;
  status: LeadStatus;
  dealValue: number;
  estimatedRoofValue: number;
  createdAt: string;
  updatedAt: string;
  followUpDate: string | null;
  lastKnockAt: string | null;
  lastCallAt: string | null;
  assignedSetterId: string | null;
  assignedCloserId: string | null;
}

export interface OperationsContactEvent {
  id: string;
  leadId: string;
  channel: 'knock' | 'call';
  disposition: string;
  occurredAt: string;
  createdBy: string | null;
}

export interface OperationsAppointmentRow {
  id: string;
  leadId: string;
  scheduledAt: string;
  createdAt: string;
  createdBy: string | null;
  outcome: AppointmentOutcome;
  outcomeAt: string | null;
  outcomeBy: string | null;
  assignedSetterId: string | null;
  assignedCloserId: string | null;
}

export interface OperationsSaleEvent {
  id: string;
  leadId: string;
  occurredAt: string;
  dealValue: number;
  estimatedRoofValue: number;
  assignedSetterId: string | null;
  assignedCloserId: string | null;
}

export interface OperationsActivityRow {
  leadId: string;
  occurredAt: string;
}

const FUNNEL: { status: LeadStatus; label: string }[] = [
  { status: 'new', label: 'New' },
  { status: 'contacted', label: 'Contacted' },
  { status: 'appointment_set', label: 'Appointment set' },
  { status: 'inspected', label: 'Inspected' },
  { status: 'proposal_sent', label: 'Proposal sent' },
  { status: 'sold', label: 'Sold' },
  { status: 'lost', label: 'Lost' },
];

const OPEN_STATUSES = new Set<LeadStatus>([
  'new',
  'contacted',
  'appointment_set',
  'inspected',
  'proposal_sent',
]);

function inWindow(value: string | null, from: string, to: string): boolean {
  if (!value) return false;
  const at = Date.parse(value);
  return !Number.isNaN(at) && at >= Date.parse(from) && at < Date.parse(to);
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function leadName(lead: OperationsLeadRow): string {
  return `${lead.firstName} ${lead.lastName}`.trim() || 'Unnamed lead';
}

function latestInstant(values: (string | null | undefined)[]): string {
  const valid = values
    .filter((value): value is string => !!value && !Number.isNaN(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return valid[0] ?? new Date(0).toISOString();
}

function scopedParams(scope: ReportScope): URLSearchParams {
  const params = new URLSearchParams({
    market_id: scope.marketId == null ? 'all' : String(scope.marketId),
    from: scope.from,
    to: scope.to,
  });
  if (scope.actor.kind === 'all') params.set('user_id', 'all');
  if (scope.actor.kind === 'mine') params.set('user_id', 'me');
  if (scope.actor.kind === 'member') params.set('user_id', scope.actor.memberId);
  return params;
}

function href(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function leadQueueHref(
  scope: ReportScope,
  extra: Record<string, string | undefined> = {}
): string {
  const params = new URLSearchParams({
    market_id: scope.marketId == null ? 'all' : String(scope.marketId),
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  return href('/admin/leads', params);
}

export function isContactEvent(event: OperationsContactEvent): boolean {
  return event.channel === 'knock'
    ? statusForDisposition(event.disposition as KnockDisposition) === 'contacted'
    : statusForCallDisposition(event.disposition as ColdCallDisposition) === 'contacted';
}

function uniqueSales(events: OperationsSaleEvent[]): OperationsSaleEvent[] {
  const byLead = new Map<string, OperationsSaleEvent>();
  for (const event of events) {
    const existing = byLead.get(event.leadId);
    if (!existing || Date.parse(event.occurredAt) > Date.parse(existing.occurredAt)) {
      byLead.set(event.leadId, event);
    }
  }
  return [...byLead.values()];
}

export function buildOperationsMetrics(input: {
  scope: ReportScope;
  leads: OperationsLeadRow[];
  contactEvents: OperationsContactEvent[];
  appointments: OperationsAppointmentRow[];
  sales: OperationsSaleEvent[];
}): ReportMetric[] {
  const prior = previousEqualPeriod(input.scope.from, input.scope.to);
  const currentLeads = input.leads.filter((lead) =>
    inWindow(lead.createdAt, input.scope.from, input.scope.to)
  );
  const priorLeads = input.leads.filter((lead) =>
    inWindow(lead.createdAt, prior.from, prior.to)
  );
  const currentContacts = input.contactEvents.filter(
    (event) => isContactEvent(event) && inWindow(event.occurredAt, input.scope.from, input.scope.to)
  );
  const priorContacts = input.contactEvents.filter(
    (event) => isContactEvent(event) && inWindow(event.occurredAt, prior.from, prior.to)
  );
  const currentAppointments = input.appointments.filter((appointment) =>
    inWindow(appointment.scheduledAt, input.scope.from, input.scope.to)
  );
  const priorAppointments = input.appointments.filter((appointment) =>
    inWindow(appointment.scheduledAt, prior.from, prior.to)
  );
  const currentSales = uniqueSales(
    input.sales.filter((sale) => inWindow(sale.occurredAt, input.scope.from, input.scope.to))
  );
  const priorSales = uniqueSales(
    input.sales.filter((sale) => inWindow(sale.occurredAt, prior.from, prior.to))
  );
  const currentRevenue = currentSales.reduce((sum, sale) => sum + sale.dealValue, 0);
  const priorRevenue = priorSales.reduce((sum, sale) => sum + sale.dealValue, 0);
  const activityParams = scopedParams(input.scope);
  const appointmentParams = scopedParams(input.scope);

  const values: Omit<ReportMetric, 'comparison'>[] = [
    {
      key: 'new_leads',
      label: 'New leads',
      value: currentLeads.length,
      unit: 'count',
      href: leadQueueHref(input.scope, { sort: 'created_at', order: 'desc' }),
    },
    {
      key: 'contacts',
      label: 'Contacts',
      value: currentContacts.length,
      unit: 'count',
      href: href('/admin/activity', activityParams),
    },
    {
      key: 'appointments',
      label: 'Appointments',
      value: currentAppointments.length,
      unit: 'count',
      href: href('/admin/calendar', appointmentParams),
    },
    {
      key: 'sold_jobs',
      label: 'Sold jobs',
      value: currentSales.length,
      unit: 'count',
      href: leadQueueHref(input.scope, { status: 'sold' }),
    },
    {
      key: 'revenue',
      label: 'Revenue',
      value: currentRevenue,
      unit: 'currency',
      href: leadQueueHref(input.scope, { status: 'sold', sort: 'deal_value', order: 'desc' }),
    },
  ];
  const previous = [
    priorLeads.length,
    priorContacts.length,
    priorAppointments.length,
    priorSales.length,
    priorRevenue,
  ];

  return values.map((metric, index) => ({
    ...metric,
    comparison: compareReportMetric(metric.value, previous[index]),
  }));
}

export function buildFunnel(scope: ReportScope, leads: OperationsLeadRow[]): FunnelRow[] {
  return FUNNEL.map(({ status, label }) => {
    const rows = leads.filter((lead) => lead.status === status);
    return {
      status,
      label,
      count: rows.length,
      value: rows.reduce(
        (sum, lead) => sum + (lead.dealValue || lead.estimatedRoofValue),
        0
      ),
      href: leadQueueHref(scope, { status }),
    };
  });
}

export function buildOperationsExceptions(input: {
  scope: ReportScope;
  leads: OperationsLeadRow[];
  upcomingAppointments: OperationsAppointmentRow[];
  recentActivities: OperationsActivityRow[];
  itemLimit?: number;
}): OperationsExceptions {
  const itemLimit = input.itemLimit ?? 12;
  const latestActivity = new Map<string, string>();
  for (const activity of input.recentActivities) {
    latestActivity.set(
      activity.leadId,
      latestInstant([latestActivity.get(activity.leadId), activity.occurredAt])
    );
  }

  const overdue = input.leads.filter(
    (lead) =>
      OPEN_STATUSES.has(lead.status) &&
      !!lead.followUpDate &&
      lead.followUpDate < input.scope.localDate
  );
  const unassigned = input.leads.filter(
    (lead) =>
      (lead.status === 'new' || lead.status === 'contacted') &&
      lead.assignedSetterId == null
  );
  const missingOwner = input.upcomingAppointments.filter(
    (appointment) => appointment.outcome === 'scheduled' && appointment.assignedCloserId == null
  );
  const leadById = new Map(input.leads.map((lead) => [lead.id, lead]));
  const stalled = input.leads
    .map((lead) => ({
      lead,
      lastWorkAt: latestInstant([
        lead.updatedAt,
        lead.lastKnockAt,
        lead.lastCallAt,
        latestActivity.get(lead.id),
        lead.createdAt,
      ]),
    }))
    .filter(({ lead, lastWorkAt }) =>
      isStalledWork({ status: lead.status, lastWorkAt, asOf: input.scope.asOf })
    );

  const items: OperationsExceptionItem[] = [
    ...overdue.map((lead): OperationsExceptionItem => ({
      id: `overdue:${lead.id}`,
      kind: 'overdue_follow_up',
      severity: 'urgent',
      title: leadName(lead),
      detail: `${lead.address || 'No address'} · due ${lead.followUpDate}`,
      rule: `Follow-up date is before ${input.scope.localDate}.`,
      href: `/admin/leads/${lead.id}`,
      occurredAt: null,
    })),
    ...missingOwner.map((appointment): OperationsExceptionItem => {
      const lead = leadById.get(appointment.leadId);
      return {
        id: `owner:${appointment.id}`,
        kind: 'appointment_owner',
        severity: 'urgent',
        title: lead ? leadName(lead) : 'Appointment without owner',
        detail: lead?.address || 'No address',
        rule: 'A scheduled appointment must have an assigned closer.',
        href: `/admin/leads/${appointment.leadId}`,
        occurredAt: appointment.scheduledAt,
      };
    }),
    ...stalled.map(({ lead, lastWorkAt }): OperationsExceptionItem => {
      const threshold = stalledWorkThresholdDays(lead.status) ?? 0;
      return {
        id: `stalled:${lead.id}`,
        kind: 'stalled_deal',
        severity: 'warning',
        title: leadName(lead),
        detail: lead.address || 'No address',
        rule: `${FUNNEL.find((row) => row.status === lead.status)?.label ?? lead.status} has no recorded work for ${threshold} days.`,
        href: `/admin/leads/${lead.id}`,
        occurredAt: lastWorkAt,
      };
    }),
    ...unassigned.map((lead): OperationsExceptionItem => ({
      id: `unassigned:${lead.id}`,
      kind: 'unassigned_lead',
      severity: 'warning',
      title: leadName(lead),
      detail: `${lead.address || 'No address'} · ${lead.status === 'new' ? 'new lead' : 'contacted'}`,
      rule: 'A new or contacted lead must have an assigned setter.',
      href: `/admin/leads/${lead.id}`,
      occurredAt: lead.createdAt,
    })),
  ];

  items.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'urgent' ? -1 : 1;
    const aTime = a.occurredAt ? Date.parse(a.occurredAt) : 0;
    const bTime = b.occurredAt ? Date.parse(b.occurredAt) : 0;
    return aTime - bTime || a.id.localeCompare(b.id);
  });

  const groups: OperationsExceptionGroup[] = [
    {
      kind: 'overdue_follow_up',
      label: 'Overdue follow-ups',
      count: overdue.length,
      rule: `Follow-up date is before ${input.scope.localDate}.`,
      href: leadQueueHref(input.scope, {
        follow_up_before: input.scope.localDate,
        sort: 'follow_up_date',
        order: 'asc',
      }),
    },
    {
      kind: 'unassigned_lead',
      label: 'Unassigned leads',
      count: unassigned.length,
      rule: 'New or contacted lead has no assigned setter.',
      href: leadQueueHref(input.scope, { assigned_setter: 'unassigned' }),
    },
    {
      kind: 'appointment_owner',
      label: 'Appointments missing ownership',
      count: missingOwner.length,
      rule: 'Scheduled appointment has no assigned closer.',
      href: leadQueueHref(input.scope, {
        assigned_closer: 'unassigned',
        status: 'appointment_set',
      }),
    },
    {
      kind: 'stalled_deal',
      label: 'Stalled active deals',
      count: stalled.length,
      rule: 'Appointment, inspection, and proposal stages use 3, 5, and 7 day limits.',
      href: leadQueueHref(input.scope, { sort: 'updated_at', order: 'asc' }),
    },
  ];

  return {
    total: groups.reduce((sum, group) => sum + group.count, 0),
    items: items.slice(0, itemLimit),
    groups,
  };
}

function visibleMembers(
  members: ReportMemberOption[],
  scope: ReportScope,
  currentUserId: string
): ReportMemberOption[] {
  if (scope.actor.kind === 'all') return members;
  const id = scope.actor.kind === 'mine' ? currentUserId : scope.actor.memberId;
  return members.filter((member) => member.id === id);
}

export function buildTeamPulse(input: {
  scope: ReportScope;
  currentUserId: string;
  members: ReportMemberOption[];
  contacts: OperationsContactEvent[];
  appointments: OperationsAppointmentRow[];
  outcomeAppointments: OperationsAppointmentRow[];
  sales: OperationsSaleEvent[];
}): TeamPulseRow[] {
  const members = visibleMembers(input.members, input.scope, input.currentUserId);
  const currentSales = uniqueSales(
    input.sales.filter((sale) => inWindow(sale.occurredAt, input.scope.from, input.scope.to))
  );
  return members
    .map((member) => {
      const params = new URLSearchParams({
        user_id: member.id,
        from: input.scope.from,
        to: input.scope.to,
      });
      if (input.scope.marketId != null) params.set('market_id', String(input.scope.marketId));
      return {
        memberId: member.id,
        name: member.name,
        role: member.role,
        knocks: input.contacts.filter(
          (event) =>
            event.channel === 'knock' &&
            event.createdBy === member.id &&
            inWindow(event.occurredAt, input.scope.from, input.scope.to)
        ).length,
        calls: input.contacts.filter(
          (event) =>
            event.channel === 'call' &&
            event.createdBy === member.id &&
            inWindow(event.occurredAt, input.scope.from, input.scope.to)
        ).length,
        appointments: input.appointments.filter(
          (appointment) =>
            appointment.createdBy === member.id &&
            inWindow(appointment.scheduledAt, input.scope.from, input.scope.to)
        ).length,
        outcomes: input.outcomeAppointments.filter((appointment) => {
          if (!inWindow(appointment.outcomeAt, input.scope.from, input.scope.to)) return false;
          const owner = appointment.outcomeBy ?? appointment.assignedCloserId;
          return appointment.outcome !== 'scheduled' && owner === member.id;
        }).length,
        soldJobs: currentSales.filter((sale) => {
          const owner = sale.assignedCloserId ?? sale.assignedSetterId;
          return owner === member.id;
        }).length,
        href: href('/admin/performance', params),
      };
    })
    .sort((a, b) => {
      const bTotal = b.knocks + b.calls + b.appointments + b.outcomes + b.soldJobs;
      const aTotal = a.knocks + a.calls + a.appointments + a.outcomes + a.soldJobs;
      return bTotal - aTotal || a.name.localeCompare(b.name);
    });
}

export function buildLeadTrend(scope: ReportScope, leads: OperationsLeadRow[]): TrendPoint[] {
  const start = Date.parse(scope.from);
  const end = Date.parse(scope.to);
  const bucketCount = scope.period === 'today' ? 8 : scope.period === 'week' ? 7 : 12;
  const duration = end - start;
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const bucketDuration = duration / bucketCount;
  const values = Array.from({ length: bucketCount }, () => 0);

  for (const lead of leads) {
    const at = Date.parse(lead.createdAt);
    if (!Number.isFinite(at) || at < start || at >= end) continue;
    const index = Math.min(bucketCount - 1, Math.floor((at - start) / bucketDuration));
    values[index] += 1;
  }

  return values.map((value, index) => ({
    from: new Date(start + index * bucketDuration).toISOString(),
    to: new Date(start + (index + 1) * bucketDuration).toISOString(),
    value,
  }));
}

export function numericValue(value: unknown): number {
  return money(value);
}

export function roleLabel(role: UserRole): string {
  return role === 'admin' ? 'Admin' : role === 'setter' ? 'Setter' : 'Closer';
}
