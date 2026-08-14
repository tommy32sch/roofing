import type { SupabaseClient } from '@supabase/supabase-js';
import { applyLeadAccessFilter } from '@/lib/leads/lead-visibility';
import { applyMarketFilter } from '@/lib/leads/markets';
import type {
  OperationsOverviewData,
  OperationsSectionName,
  ReportMemberOption,
  ReportSection,
} from './contracts';
import {
  buildFunnel,
  buildLeadTrend,
  buildOperationsExceptions,
  buildOperationsMetrics,
  buildTeamPulse,
  numericValue,
  type OperationsActivityRow,
  type OperationsAppointmentRow,
  type OperationsContactEvent,
  type OperationsLeadRow,
  type OperationsSaleEvent,
} from './operations';
import { previousEqualPeriod } from './comparison';
import type { ResolvedReportScope } from './scope.server';

const PAGE_SIZE = 750;

interface QueryError {
  message: string;
}

interface PageResult<T> {
  data: T[] | null;
  error: QueryError | null;
}

async function collectPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await loadPage(offset, offset + PAGE_SIZE - 1);
    if (page.error) throw new Error(page.error.message);
    const data = page.data ?? [];
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

function embeddedOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function scopedLeadQuery<T>(
  query: T,
  resolved: ResolvedReportScope,
  foreignTable?: string
): T {
  return applyLeadAccessFilter(query, resolved.leadActor, {
    scope: resolved.leadScope,
    foreignTable,
  });
}

interface LeadDatabaseRow {
  id: string;
  first_name: string;
  last_name: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  status: OperationsLeadRow['status'];
  deal_value: number | string | null;
  estimated_roof_value: number | string | null;
  created_at: string;
  updated_at: string;
  follow_up_date: string | null;
  last_knock_at: string | null;
  last_call_at: string | null;
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
}

function formatAddress(row: LeadDatabaseRow): string | null {
  const value = [row.address_street, row.address_city, row.address_state]
    .filter(Boolean)
    .join(', ');
  return value || null;
}

async function loadLeads(
  client: SupabaseClient,
  resolved: ResolvedReportScope
): Promise<OperationsLeadRow[]> {
  const rows = await collectPages<LeadDatabaseRow>((from, to) => {
    let query = applyMarketFilter(
      client
        .from('leads')
        .select(
          'id, first_name, last_name, address_street, address_city, address_state, status, ' +
            'deal_value, estimated_roof_value, created_at, updated_at, follow_up_date, ' +
            'last_knock_at, last_call_at, assigned_setter_id, assigned_closer_id'
        )
        .eq('is_flagged_duplicate', false),
      resolved.scope.marketId
    );
    query = scopedLeadQuery(query, resolved);
    return query.order('id', { ascending: true }).range(from, to).returns<LeadDatabaseRow[]>();
  });

  return rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    address: formatAddress(row),
    status: row.status,
    dealValue: numericValue(row.deal_value),
    estimatedRoofValue: numericValue(row.estimated_roof_value),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    followUpDate: row.follow_up_date,
    lastKnockAt: row.last_knock_at,
    lastCallAt: row.last_call_at,
    assignedSetterId: row.assigned_setter_id,
    assignedCloserId: row.assigned_closer_id,
  }));
}

interface ContactDatabaseRow {
  id: string;
  lead_id: string;
  disposition: string;
  created_by: string | null;
  knocked_at?: string;
  called_at?: string;
}

async function loadContactChannel(
  client: SupabaseClient,
  resolved: ResolvedReportScope,
  input: {
    channel: 'knock' | 'call';
    from: string;
    to: string;
  }
): Promise<OperationsContactEvent[]> {
  const table = input.channel === 'knock' ? 'lead_knocks' : 'lead_calls';
  const column = input.channel === 'knock' ? 'knocked_at' : 'called_at';
  const rows = await collectPages<ContactDatabaseRow>((from, to) => {
    let query = client
      .from(table)
      .select(
        `id, lead_id, disposition, created_by, ${column}, ` +
          'leads!lead_id!inner(id, market_id, assigned_setter_id, assigned_closer_id, is_flagged_duplicate)'
      )
      .gte(column, input.from)
      .lt(column, input.to)
      .eq('leads.is_flagged_duplicate', false);
    if (resolved.scope.marketId != null) {
      query = query.eq('leads.market_id', resolved.scope.marketId);
    }
    if (resolved.activityUserId) query = query.eq('created_by', resolved.activityUserId);
    // Activity attribution follows the existing Contact Activity policy: an
    // admin selecting one account sees work performed by that account even if
    // the lead was reassigned later. Reps still receive the shared current-lead
    // visibility filter.
    query = applyLeadAccessFilter(query, resolved.requestActor, {
      scope: resolved.requestActor.role === 'admin' ? 'all' : 'mine',
      foreignTable: 'leads',
    });
    return query
      .order(column, { ascending: true })
      .range(from, to)
      .returns<ContactDatabaseRow[]>();
  });

  return rows.map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    channel: input.channel,
    disposition: row.disposition,
    occurredAt: input.channel === 'knock' ? row.knocked_at! : row.called_at!,
    createdBy: row.created_by,
  }));
}

interface AppointmentLeadEmbed {
  id: string;
  market_id: number | null;
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
  is_flagged_duplicate: boolean;
}

interface AppointmentDatabaseRow {
  id: string;
  lead_id: string;
  scheduled_at: string;
  created_at: string;
  created_by: string | null;
  outcome: OperationsAppointmentRow['outcome'];
  outcome_at: string | null;
  outcome_by: string | null;
  leads: AppointmentLeadEmbed | AppointmentLeadEmbed[] | null;
}

type AppointmentWindow =
  | { column: 'scheduled_at' | 'outcome_at'; from: string; to: string }
  | { column: 'scheduled_at'; from: string; to?: undefined };

async function loadAppointments(
  client: SupabaseClient,
  resolved: ResolvedReportScope,
  window: AppointmentWindow,
  scheduledOnly = false
): Promise<OperationsAppointmentRow[]> {
  const rows = await collectPages<AppointmentDatabaseRow>((from, to) => {
    let query = client
      .from('lead_appointments')
      .select(
        'id, lead_id, scheduled_at, created_at, created_by, outcome, outcome_at, outcome_by, ' +
          'leads!lead_id!inner(id, market_id, assigned_setter_id, assigned_closer_id, is_flagged_duplicate)'
      )
      .gte(window.column, window.from)
      .eq('leads.is_flagged_duplicate', false);
    if (window.to) query = query.lt(window.column, window.to);
    if (scheduledOnly) query = query.eq('outcome', 'scheduled');
    if (resolved.scope.marketId != null) {
      query = query.eq('leads.market_id', resolved.scope.marketId);
    }
    query = scopedLeadQuery(query, resolved, 'leads');
    return query
      .order(window.column, { ascending: true })
      .range(from, to)
      .returns<AppointmentDatabaseRow[]>();
  });

  return rows.flatMap((row) => {
    const lead = embeddedOne(row.leads);
    if (!lead) return [];
    return [{
      id: row.id,
      leadId: row.lead_id,
      scheduledAt: row.scheduled_at,
      createdAt: row.created_at,
      createdBy: row.created_by,
      outcome: row.outcome ?? 'scheduled',
      outcomeAt: row.outcome_at,
      outcomeBy: row.outcome_by,
      assignedSetterId: lead.assigned_setter_id,
      assignedCloserId: lead.assigned_closer_id,
    }];
  });
}

interface SaleLeadEmbed extends AppointmentLeadEmbed {
  deal_value: number | string | null;
  estimated_roof_value: number | string | null;
}

interface SaleDatabaseRow {
  id: string;
  lead_id: string;
  created_at: string;
  leads: SaleLeadEmbed | SaleLeadEmbed[] | null;
}

async function loadSales(
  client: SupabaseClient,
  resolved: ResolvedReportScope,
  fromInstant: string,
  toInstant: string
): Promise<OperationsSaleEvent[]> {
  const rows = await collectPages<SaleDatabaseRow>((from, to) => {
    let query = client
      .from('lead_activities')
      .select(
        'id, lead_id, created_at, ' +
          'leads!lead_id!inner(id, deal_value, estimated_roof_value, market_id, assigned_setter_id, assigned_closer_id, is_flagged_duplicate)'
      )
      .eq('activity_type', 'status_change')
      .eq('new_status', 'sold')
      .gte('created_at', fromInstant)
      .lt('created_at', toInstant)
      .eq('leads.is_flagged_duplicate', false);
    if (resolved.scope.marketId != null) {
      query = query.eq('leads.market_id', resolved.scope.marketId);
    }
    query = scopedLeadQuery(query, resolved, 'leads');
    return query
      .order('created_at', { ascending: true })
      .range(from, to)
      .returns<SaleDatabaseRow[]>();
  });

  return rows.flatMap((row) => {
    const lead = embeddedOne(row.leads);
    if (!lead) return [];
    return [{
      id: row.id,
      leadId: row.lead_id,
      occurredAt: row.created_at,
      dealValue: numericValue(lead.deal_value),
      estimatedRoofValue: numericValue(lead.estimated_roof_value),
      assignedSetterId: lead.assigned_setter_id,
      assignedCloserId: lead.assigned_closer_id,
    }];
  });
}

interface ActivityDatabaseRow {
  lead_id: string;
  created_at: string;
}

async function loadRecentActivities(
  client: SupabaseClient,
  leadIds: string[],
  asOf: string
): Promise<OperationsActivityRow[]> {
  if (leadIds.length === 0) return [];
  const cutoff = new Date(Date.parse(asOf) - 7 * 86_400_000).toISOString();
  const rows: ActivityDatabaseRow[] = [];

  for (let index = 0; index < leadIds.length; index += 150) {
    const ids = leadIds.slice(index, index + 150);
    const chunk = await collectPages<ActivityDatabaseRow>((from, to) =>
      client
        .from('lead_activities')
        .select('lead_id, created_at')
        .in('lead_id', ids)
        .gte('created_at', cutoff)
        .lte('created_at', asOf)
        .order('created_at', { ascending: false })
        .range(from, to)
    );
    rows.push(...chunk);
  }
  return rows.map((row) => ({ leadId: row.lead_id, occurredAt: row.created_at }));
}

function errorText(section: OperationsSectionName): string {
  if (section === 'teamPulse') return 'Team pulse did not load.';
  return `${section[0].toUpperCase()}${section.slice(1)} did not load.`;
}

async function section<T>(
  name: OperationsSectionName,
  promise: Promise<T>,
  fallback: T
): Promise<ReportSection<T>> {
  try {
    return { status: 'ready', data: await promise, error: null };
  } catch (error) {
    console.error(`[operations-overview] ${name}`, error);
    return { status: 'error', data: fallback, error: errorText(name) };
  }
}

export async function loadOperationsOverview(input: {
  client: SupabaseClient;
  resolved: ResolvedReportScope;
  members: ReportMemberOption[];
  currentUserId: string;
}): Promise<Pick<OperationsOverviewData, 'sections' | 'partialErrors'>> {
  const { client, resolved } = input;
  const prior = previousEqualPeriod(resolved.scope.from, resolved.scope.to);
  const leadsPromise = loadLeads(client, resolved);
  const contactsPromise = Promise.all([
    loadContactChannel(client, resolved, {
      channel: 'knock',
      from: prior.from,
      to: resolved.scope.to,
    }),
    loadContactChannel(client, resolved, {
      channel: 'call',
      from: prior.from,
      to: resolved.scope.to,
    }),
  ]).then(([knocks, calls]) => [...knocks, ...calls]);
  const appointmentsPromise = loadAppointments(client, resolved, {
    column: 'scheduled_at',
    from: prior.from,
    to: resolved.scope.to,
  });
  const outcomeAppointmentsPromise = loadAppointments(client, resolved, {
    column: 'outcome_at',
    from: prior.from,
    to: resolved.scope.to,
  });
  const salesPromise = loadSales(client, resolved, prior.from, resolved.scope.to);
  const upcomingAppointmentsPromise = loadAppointments(
    client,
    resolved,
    { column: 'scheduled_at', from: resolved.scope.asOf },
    true
  );
  const recentActivitiesPromise = leadsPromise.then((leads) =>
    loadRecentActivities(
      client,
      leads
        .filter((lead) =>
          lead.status === 'appointment_set' ||
          lead.status === 'inspected' ||
          lead.status === 'proposal_sent'
        )
        .map((lead) => lead.id),
      resolved.scope.asOf
    )
  );

  const [exceptions, metrics, trend, funnel, teamPulse] = await Promise.all([
    section(
      'exceptions',
      Promise.all([leadsPromise, upcomingAppointmentsPromise, recentActivitiesPromise]).then(
        ([leads, upcomingAppointments, recentActivities]) =>
          buildOperationsExceptions({
            scope: resolved.scope,
            leads,
            upcomingAppointments,
            recentActivities,
          })
      ),
      { total: 0, items: [], groups: [] }
    ),
    section(
      'metrics',
      Promise.all([leadsPromise, contactsPromise, appointmentsPromise, salesPromise]).then(
        ([leads, contactEvents, appointments, sales]) =>
          buildOperationsMetrics({
            scope: resolved.scope,
            leads,
            contactEvents,
            appointments,
            sales,
          })
      ),
      []
    ),
    section(
      'trend',
      leadsPromise.then((leads) => buildLeadTrend(resolved.scope, leads)),
      []
    ),
    section(
      'funnel',
      leadsPromise.then((leads) => buildFunnel(resolved.scope, leads)),
      []
    ),
    section(
      'teamPulse',
      Promise.all([
        contactsPromise,
        appointmentsPromise,
        outcomeAppointmentsPromise,
        salesPromise,
      ]).then(([contacts, appointments, outcomeAppointments, sales]) =>
        buildTeamPulse({
          scope: resolved.scope,
          currentUserId: input.currentUserId,
          members: input.members,
          contacts,
          appointments,
          outcomeAppointments,
          sales,
        })
      ),
      []
    ),
  ]);

  const sections = { exceptions, metrics, trend, funnel, teamPulse };
  const partialErrors = (Object.entries(sections) as [
    OperationsSectionName,
    ReportSection<unknown>,
  ][])
    .filter(([, value]) => value.status === 'error')
    .map(([name, value]) => ({ section: name, message: value.error ?? errorText(name) }));

  return { sections, partialErrors };
}
