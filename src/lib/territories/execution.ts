import type { LeadPriority, LeadStatus, Territory, UserRole } from '@/types';
import { metersBetween, type LatLng } from '@/lib/leads/walk-up';

/** The mutually-exclusive field progress buckets shown inside a territory. */
export type TerritoryProgressState =
  | 'appointment'
  | 'follow_up'
  | 'contacted'
  | 'knocked'
  | 'unworked';

/** Whether a door needs another visit, and whether that visit has a date. */
export type TerritoryRevisitState = 'due' | 'needs_schedule' | 'scheduled' | 'none';
export type TerritoryExecutionState = 'empty' | 'not_started' | 'active' | 'stalled' | 'complete';

export interface TerritoryAppointmentEvidence {
  appointment_type?: string | null;
  outcome?: string | null;
}

/**
 * Compact lead contract for Territory Execution Mode.
 *
 * It deliberately remains compatible with the existing map's GeoLead shape so
 * the execution screen does not need a second representation of a map pin.
 */
export interface TerritoryExecutionLead {
  id: string;
  market_id: number;
  first_name: string;
  last_name: string;
  latitude: number;
  longitude: number;
  status: LeadStatus;
  priority: LeadPriority;
  estimated_roof_value: number | null;
  address_street: string | null;
  address_city: string | null;
  is_dnc: boolean;
  hail_date: string | null;
  hail_size_inches: number | null;
  last_knock_at: string | null;
  last_disposition: string | null;
  knock_count: number;
  do_not_knock: boolean;
  last_call_at: string | null;
  last_call_disposition: string | null;
  call_count: number;
  follow_up_date: string | null;
  has_appointment: boolean;
  progress_state: TerritoryProgressState;
  revisit_state: TerritoryRevisitState;
  actionable: boolean;
  last_field_activity_at: string | null;
}

export interface TerritoryProgressCounts {
  appointment: number;
  follow_up: number;
  contacted: number;
  knocked: number;
  unworked: number;
}

export interface TerritoryRevisitCounts {
  due: number;
  needs_schedule: number;
  scheduled: number;
}

export interface TerritoryExecutionSummary {
  territory_id: string;
  territory_name: string;
  market_id: number;
  color: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_role: UserRole | null;
  total_leads: number;
  actionable_leads: number;
  blocked_leads: number;
  coverage_percent: number;
  state: TerritoryExecutionState;
  progress: TerritoryProgressCounts;
  revisits: TerritoryRevisitCounts;
  last_field_activity_at: string | null;
  never_started: boolean;
  stalled: boolean;
}

export interface TerritoryExecutionSnapshot {
  territory: Territory;
  summary: TerritoryExecutionSummary;
  leads: TerritoryExecutionLead[];
}

export interface TerritoryLeadFacts {
  status: string;
  follow_up_date: string | null;
  last_knock_at: string | null;
  last_disposition: string | null;
  knock_count: number;
  do_not_knock: boolean;
  last_call_at: string | null;
  last_call_disposition: string | null;
  call_count: number;
  has_appointment?: boolean;
  appointments?: readonly TerritoryAppointmentEvidence[] | null;
}

export type TerritoryExecutionLeadInput = Omit<
  TerritoryExecutionLead,
  | 'has_appointment'
  | 'progress_state'
  | 'revisit_state'
  | 'actionable'
  | 'last_field_activity_at'
> & { appointments?: readonly TerritoryAppointmentEvidence[] | null };

export interface TerritoryClassificationClock {
  /** Calendar date where the rep is working, in YYYY-MM-DD form. */
  today: string;
  /** Instant used for elapsed-day rules and stall detection. */
  now: string;
}

const APPOINTMENT_STATUS_FALLBACK = new Set([
  'appointment_set',
  'inspected',
  'proposal_sent',
  'sold',
]);
const CLOSED_STATUSES = new Set(['sold', 'lost']);
const CONTACT_KNOCK_DISPOSITIONS = new Set([
  'callback',
  'call_back',
  'referral',
  'appointment_set',
  'contract_signed',
  'not_interested',
  'renter',
  'no_damage',
]);
const CONTACT_CALL_DISPOSITIONS = new Set([
  'call_back',
  'appointment_set',
  'do_not_call',
  'not_interested',
]);

export const TERRITORY_REVISIT_AFTER_DAYS = 14;
export const TERRITORY_STALL_AFTER_DAYS = 7;

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function newestInteraction(lead: TerritoryLeadFacts): {
  knock: boolean;
  call: boolean;
  at: number;
} {
  const knockAt = timestamp(lead.last_knock_at);
  const callAt = timestamp(lead.last_call_at);
  const at = Math.max(knockAt, callAt);
  return {
    knock: knockAt === at && at !== Number.NEGATIVE_INFINITY,
    call: callAt === at && at !== Number.NEGATIVE_INFINITY,
    at,
  };
}

function hasActiveCallback(lead: TerritoryLeadFacts): boolean {
  const newest = newestInteraction(lead);
  return (
    (newest.knock && (lead.last_disposition === 'callback' || lead.last_disposition === 'call_back')) ||
    (newest.call && lead.last_call_disposition === 'call_back')
  );
}

/** A real appointment row is stronger evidence than the denormalized lead status. */
export function hasNonCancelledAppointment(lead: TerritoryLeadFacts): boolean {
  return (
    lead.has_appointment === true ||
    !!lead.appointments?.some((appointment) => appointment.outcome !== 'cancelled')
  );
}

/**
 * Classify a lead once, with explicit precedence.
 *
 * `lost` is intentionally absent from the status fallback. A lead may be lost
 * before an appointment ever existed; only an appointment row proves otherwise.
 */
export function classifyTerritoryProgress(lead: TerritoryLeadFacts): TerritoryProgressState {
  if (hasNonCancelledAppointment(lead) || APPOINTMENT_STATUS_FALLBACK.has(lead.status)) {
    return 'appointment';
  }

  const closed = CLOSED_STATUSES.has(lead.status);
  if (!closed && (lead.follow_up_date != null || hasActiveCallback(lead))) {
    return 'follow_up';
  }

  if (
    lead.status !== 'new' ||
    (!!lead.last_disposition && CONTACT_KNOCK_DISPOSITIONS.has(lead.last_disposition)) ||
    (!!lead.last_call_disposition && CONTACT_CALL_DISPOSITIONS.has(lead.last_call_disposition))
  ) {
    return 'contacted';
  }

  if (lead.knock_count > 0 || timestamp(lead.last_knock_at) !== Number.NEGATIVE_INFINITY) {
    return 'knocked';
  }
  return 'unworked';
}

export function lastTerritoryFieldActivityAt(lead: TerritoryLeadFacts): string | null {
  const knockAt = timestamp(lead.last_knock_at);
  const callAt = timestamp(lead.last_call_at);
  if (knockAt === Number.NEGATIVE_INFINITY && callAt === Number.NEGATIVE_INFINITY) return null;
  return knockAt >= callAt ? lead.last_knock_at : lead.last_call_at;
}

/** Door work that may still be acted on inside the territory. */
export function isTerritoryLeadActionable(
  lead: TerritoryLeadFacts,
  progress = classifyTerritoryProgress(lead)
): boolean {
  return !CLOSED_STATUSES.has(lead.status) && !lead.do_not_knock && progress !== 'appointment';
}

/**
 * Derive the revisit queue without storing another copy of workflow state.
 * Explicit dates win, followed by undated callbacks and the 14-day not-home rule.
 */
export function classifyTerritoryRevisit(
  lead: TerritoryLeadFacts,
  clock: TerritoryClassificationClock,
  progress = classifyTerritoryProgress(lead)
): TerritoryRevisitState {
  if (!isTerritoryLeadActionable(lead, progress)) return 'none';

  if (lead.follow_up_date) {
    return lead.follow_up_date <= clock.today ? 'due' : 'scheduled';
  }

  if (hasActiveCallback(lead)) return 'needs_schedule';

  const newest = newestInteraction(lead);
  if (newest.knock && lead.last_disposition === 'not_home') {
    const now = timestamp(clock.now);
    const dueAt = newest.at + TERRITORY_REVISIT_AFTER_DAYS * 86_400_000;
    if (now !== Number.NEGATIVE_INFINITY && dueAt <= now) return 'due';
  }

  return 'none';
}

export function buildTerritoryExecutionLead(
  lead: TerritoryExecutionLeadInput,
  clock: TerritoryClassificationClock
): TerritoryExecutionLead {
  const progress = classifyTerritoryProgress(lead);
  const { appointments, ...mapLead } = lead;
  return {
    ...mapLead,
    has_appointment: !!appointments?.some((appointment) => appointment.outcome !== 'cancelled'),
    progress_state: progress,
    revisit_state: classifyTerritoryRevisit(lead, clock, progress),
    actionable: isTerritoryLeadActionable(lead, progress),
    last_field_activity_at: lastTerritoryFieldActivityAt(lead),
  };
}

/**
 * Recompute derived execution fields after the offline outbox overlays a newer
 * knock or call. Appointment evidence is retained as a boolean server fact.
 */
export function refreshTerritoryExecutionLead(
  lead: TerritoryExecutionLead,
  clock: TerritoryClassificationClock
): TerritoryExecutionLead {
  const progress = classifyTerritoryProgress(lead);
  return {
    ...lead,
    progress_state: progress,
    revisit_state: classifyTerritoryRevisit(lead, clock, progress),
    actionable: isTerritoryLeadActionable(lead, progress),
    last_field_activity_at: lastTerritoryFieldActivityAt(lead),
  };
}

function emptyProgressCounts(): TerritoryProgressCounts {
  return { appointment: 0, follow_up: 0, contacted: 0, knocked: 0, unworked: 0 };
}

/** Aggregate the exact lead snapshot returned to the caller. */
export function summarizeTerritoryExecution(
  territory: Pick<
    Territory,
    'id' | 'name' | 'market_id' | 'color' | 'owner_user_id' | 'owner_name' | 'owner_role' | 'created_at'
  >,
  leads: readonly TerritoryExecutionLead[],
  now: string
): TerritoryExecutionSummary {
  const progress = emptyProgressCounts();
  const revisits: TerritoryRevisitCounts = { due: 0, needs_schedule: 0, scheduled: 0 };
  let actionableLeads = 0;
  let lastActivityMs = Number.NEGATIVE_INFINITY;
  let lastActivity: string | null = null;

  for (const lead of leads) {
    progress[lead.progress_state] += 1;
    if (lead.actionable) actionableLeads += 1;
    if (lead.revisit_state !== 'none') revisits[lead.revisit_state] += 1;
    const at = timestamp(lead.last_field_activity_at);
    if (at > lastActivityMs) {
      lastActivityMs = at;
      lastActivity = lead.last_field_activity_at;
    }
  }

  const neverStarted = lastActivity == null;
  const anchor = neverStarted ? timestamp(territory.created_at) : lastActivityMs;
  const nowMs = timestamp(now);
  const hasOutstandingWork = leads.some(
    (lead) =>
      lead.actionable &&
      (lead.progress_state === 'unworked' ||
        lead.revisit_state === 'due' ||
        lead.revisit_state === 'needs_schedule')
  );
  const stalled =
    hasOutstandingWork &&
    anchor !== Number.NEGATIVE_INFINITY &&
    nowMs !== Number.NEGATIVE_INFINITY &&
    anchor + TERRITORY_STALL_AFTER_DAYS * 86_400_000 <= nowMs;
  const coveragePercent = leads.length === 0
    ? 0
    : Math.round(((leads.length - progress.unworked) / leads.length) * 100);
  const state: TerritoryExecutionState = leads.length === 0
    ? 'empty'
    : !hasOutstandingWork
      ? 'complete'
      : stalled
        ? 'stalled'
        : neverStarted
          ? 'not_started'
          : 'active';

  return {
    territory_id: territory.id,
    territory_name: territory.name,
    market_id: territory.market_id,
    color: territory.color,
    owner_user_id: territory.owner_user_id,
    owner_name: territory.owner_name,
    owner_role: territory.owner_role,
    total_leads: leads.length,
    actionable_leads: actionableLeads,
    blocked_leads: leads.length - actionableLeads,
    coverage_percent: coveragePercent,
    state,
    progress,
    revisits,
    last_field_activity_at: lastActivity,
    never_started: neverStarted,
    stalled,
  };
}

export interface RankedTerritoryLead {
  lead: TerritoryExecutionLead;
  distance_meters: number;
}

/** Client-side route ordering; location is never sent to the server endpoints. */
export function rankUnworkedLeadsByDistance(
  leads: readonly TerritoryExecutionLead[],
  origin: LatLng
): RankedTerritoryLead[] {
  return leads
    .filter((lead) => lead.progress_state === 'unworked' && lead.actionable)
    .map((lead) => ({ lead, distance_meters: metersBetween(origin, lead) }))
    .sort((a, b) => a.distance_meters - b.distance_meters || a.lead.id.localeCompare(b.lead.id));
}

export function findNearestUnworkedLead(
  leads: readonly TerritoryExecutionLead[],
  origin: LatLng
): RankedTerritoryLead | null {
  return rankUnworkedLeadsByDistance(leads, origin)[0] ?? null;
}

/**
 * Keep unfinished revisit promises at the current door; otherwise advance from
 * the latest optimistic lead list. A null origin deliberately falls back to
 * manual selection instead of guessing an ordering that looks geographic.
 */
export function nextTerritoryLeadId(
  leads: readonly TerritoryExecutionLead[],
  currentLeadId: string,
  origin: LatLng | null
): string | null {
  const selected = leads.find((lead) => lead.id === currentLeadId);
  if (!selected) return null;
  if (
    selected.actionable &&
    (selected.progress_state === 'unworked' ||
      selected.revisit_state === 'due' ||
      selected.revisit_state === 'needs_schedule')
  ) {
    return selected.id;
  }
  if (!origin) return null;
  return findNearestUnworkedLead(leads, origin)?.lead.id ?? null;
}

/** Roles permitted to operate the field-execution workflow. */
export function canExecuteTerritories(role: UserRole): boolean {
  return role === 'admin' || role === 'setter';
}
