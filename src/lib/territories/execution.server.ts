import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadPriority, LeadStatus, Territory } from '@/types';
import { applyLeadAccessFilter, type LeadActor } from '@/lib/leads/lead-visibility';
import { pointInPolygon } from './geometry';
import { loadTerritoryOwners, toTerritory, type TerritoryDbRow } from './server';
import type { TerritoryBounds } from './types';
import {
  buildTerritoryExecutionLead,
  summarizeTerritoryExecution,
  type TerritoryAppointmentEvidence,
  type TerritoryClassificationClock,
  type TerritoryExecutionLead,
  type TerritoryExecutionLeadInput,
  type TerritoryExecutionSnapshot,
  type TerritoryExecutionSummary,
} from './execution';

export const TERRITORY_EXECUTION_DB_FIELDS =
  'id, name, market_id, boundary, min_lat, max_lat, min_lng, max_lng, color, owner_user_id, archived_at, created_at, updated_at';

export const TERRITORY_EXECUTION_LEAD_FIELDS =
  'id, market_id, first_name, last_name, latitude, longitude, status, priority, ' +
  'estimated_roof_value, address_street, address_city, is_dnc, hail_date, hail_size_inches, ' +
  'last_knock_at, last_disposition, knock_count, do_not_knock, last_call_at, ' +
  'last_call_disposition, call_count, follow_up_date, assigned_setter_id, assigned_closer_id, ' +
  'lead_appointments(appointment_type, outcome)';

const DATABASE_PAGE_SIZE = 1000;

interface ExecutionTerritoryDbRow extends TerritoryDbRow, TerritoryBounds {}

interface ExecutionLeadDbRow {
  id: string;
  market_id: number | string | null;
  first_name: string;
  last_name: string;
  latitude: number | string | null;
  longitude: number | string | null;
  status: LeadStatus;
  priority: LeadPriority;
  estimated_roof_value: number | string | null;
  address_street: string | null;
  address_city: string | null;
  is_dnc: boolean;
  hail_date: string | null;
  hail_size_inches: number | string | null;
  last_knock_at: string | null;
  last_disposition: string | null;
  knock_count: number | null;
  do_not_knock: boolean;
  last_call_at: string | null;
  last_call_disposition: string | null;
  call_count: number | null;
  follow_up_date: string | null;
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
  lead_appointments?: TerritoryAppointmentEvidence[] | null;
}

export type TerritoryExecutionLoadResult =
  | { ok: true; snapshot: TerritoryExecutionSnapshot }
  | { ok: false; status: 404 | 500; error: string };

export interface TerritoryProgressPage {
  summaries: TerritoryExecutionSummary[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export type TerritoryProgressLoadResult =
  | { ok: true; progress: TerritoryProgressPage }
  | { ok: false; status: 500; error: string };

function finiteNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toExecutionLead(
  row: ExecutionLeadDbRow,
  clock: TerritoryClassificationClock
): TerritoryExecutionLead | null {
  const marketId = finiteNumber(row.market_id);
  const latitude = finiteNumber(row.latitude);
  const longitude = finiteNumber(row.longitude);
  if (marketId == null || latitude == null || longitude == null) return null;

  const input: TerritoryExecutionLeadInput = {
    id: row.id,
    market_id: marketId,
    first_name: row.first_name,
    last_name: row.last_name,
    latitude,
    longitude,
    status: row.status,
    priority: row.priority,
    estimated_roof_value: finiteNumber(row.estimated_roof_value),
    address_street: row.address_street,
    address_city: row.address_city,
    is_dnc: row.is_dnc,
    hail_date: row.hail_date,
    hail_size_inches: finiteNumber(row.hail_size_inches),
    last_knock_at: row.last_knock_at,
    last_disposition: row.last_disposition,
    knock_count: row.knock_count ?? 0,
    do_not_knock: row.do_not_knock,
    last_call_at: row.last_call_at,
    last_call_disposition: row.last_call_disposition,
    call_count: row.call_count ?? 0,
    follow_up_date: row.follow_up_date,
    appointments: row.lead_appointments ?? [],
  };
  return buildTerritoryExecutionLead(input, clock);
}

function unionBounds(territories: readonly ExecutionTerritoryDbRow[]): TerritoryBounds {
  return territories.reduce<TerritoryBounds>(
    (bounds, territory) => ({
      min_lat: Math.min(bounds.min_lat, territory.min_lat),
      max_lat: Math.max(bounds.max_lat, territory.max_lat),
      min_lng: Math.min(bounds.min_lng, territory.min_lng),
      max_lng: Math.max(bounds.max_lng, territory.max_lng),
    }),
    { min_lat: Infinity, max_lat: -Infinity, min_lng: Infinity, max_lng: -Infinity }
  );
}

/**
 * Fetch every candidate row despite Supabase's per-response row cap. Mandatory
 * filters are applied in SQL; exact polygon membership remains in the shared,
 * tested geometry code.
 */
async function loadMarketLeadCandidates(
  supabase: SupabaseClient,
  marketId: number,
  bounds: TerritoryBounds,
  actor: LeadActor,
  clock: TerritoryClassificationClock
): Promise<{ leads: TerritoryExecutionLead[]; error: string | null }> {
  const leads: TerritoryExecutionLead[] = [];
  for (let offset = 0; ; offset += DATABASE_PAGE_SIZE) {
    let query = supabase
      .from('leads')
      .select(TERRITORY_EXECUTION_LEAD_FIELDS)
      .eq('market_id', marketId)
      .eq('is_flagged_duplicate', false)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .gte('latitude', bounds.min_lat)
      .lte('latitude', bounds.max_lat)
      .gte('longitude', bounds.min_lng)
      .lte('longitude', bounds.max_lng)
      .order('id', { ascending: true })
      .range(offset, offset + DATABASE_PAGE_SIZE - 1);
    query = applyLeadAccessFilter(query, actor);
    const { data, error } = await query;

    if (error) return { leads: [], error: error.message };
    const rows = (data ?? []) as unknown as ExecutionLeadDbRow[];
    for (const row of rows) {
      const lead = toExecutionLead(row, clock);
      if (lead) leads.push(lead);
    }
    if (rows.length < DATABASE_PAGE_SIZE) break;
  }
  return { leads, error: null };
}

function insideTerritory(
  territory: ExecutionTerritoryDbRow,
  leads: readonly TerritoryExecutionLead[]
): TerritoryExecutionLead[] {
  return leads.filter(
    (lead) =>
      lead.market_id === territory.market_id &&
      pointInPolygon([lead.latitude, lead.longitude], territory.boundary)
  );
}

async function territoryWithOwner(
  supabase: SupabaseClient,
  row: ExecutionTerritoryDbRow
): Promise<{ territory: Territory | null; error: string | null }> {
  const loaded = await loadTerritoryOwners(supabase, [row.owner_user_id]);
  if (loaded.error) return { territory: null, error: loaded.error };
  return { territory: toTerritory(row, loaded.owners), error: null };
}

export async function loadTerritoryExecutionSnapshot(
  supabase: SupabaseClient,
  territoryId: string,
  actor: LeadActor,
  clock: TerritoryClassificationClock
): Promise<TerritoryExecutionLoadResult> {
  let territoryQuery = supabase
    .from('territories')
    .select(TERRITORY_EXECUTION_DB_FIELDS)
    .eq('id', territoryId)
    .is('archived_at', null);
  if (actor.role !== 'admin') territoryQuery = territoryQuery.eq('owner_user_id', actor.id);
  const { data, error } = await territoryQuery.maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: 'Territory not found' };
  const row = data as unknown as ExecutionTerritoryDbRow;

  const ownerResult = await territoryWithOwner(supabase, row);
  if (ownerResult.error || !ownerResult.territory) {
    return { ok: false, status: 500, error: ownerResult.error ?? 'Could not load territory owner' };
  }

  const candidateResult = await loadMarketLeadCandidates(supabase, row.market_id, row, actor, clock);
  if (candidateResult.error) return { ok: false, status: 500, error: candidateResult.error };

  const leads = insideTerritory(row, candidateResult.leads);
  const summary = summarizeTerritoryExecution(ownerResult.territory, leads, clock.now);
  return {
    ok: true,
    snapshot: { territory: ownerResult.territory, summary, leads },
  };
}

export async function loadTerritoryProgressPage(
  supabase: SupabaseClient,
  options: {
    actor: LeadActor;
    marketId: number | null;
    page: number;
    limit: number;
    clock: TerritoryClassificationClock;
  }
): Promise<TerritoryProgressLoadResult> {
  const offset = (options.page - 1) * options.limit;
  let query = supabase
    .from('territories')
    .select(TERRITORY_EXECUTION_DB_FIELDS, { count: 'exact' })
    .is('archived_at', null);
  if (options.marketId != null) query = query.eq('market_id', options.marketId);
  if (options.actor.role !== 'admin') query = query.eq('owner_user_id', options.actor.id);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + options.limit - 1);
  if (error) return { ok: false, status: 500, error: error.message };

  const rows = (data ?? []) as unknown as ExecutionTerritoryDbRow[];
  const loadedOwners = await loadTerritoryOwners(
    supabase,
    rows.map((row) => row.owner_user_id)
  );
  if (loadedOwners.error) return { ok: false, status: 500, error: loadedOwners.error };

  const leadsByMarket = new Map<number, TerritoryExecutionLead[]>();
  const territoriesByMarket = new Map<number, ExecutionTerritoryDbRow[]>();
  for (const row of rows) {
    const group = territoriesByMarket.get(row.market_id) ?? [];
    group.push(row);
    territoriesByMarket.set(row.market_id, group);
  }

  for (const [marketId, marketTerritories] of territoriesByMarket) {
    const loaded = await loadMarketLeadCandidates(
      supabase,
      marketId,
      unionBounds(marketTerritories),
      options.actor,
      options.clock
    );
    if (loaded.error) return { ok: false, status: 500, error: loaded.error };
    leadsByMarket.set(marketId, loaded.leads);
  }

  const summaries = rows.map((row) => {
    const territory = toTerritory(row, loadedOwners.owners);
    const leads = insideTerritory(row, leadsByMarket.get(row.market_id) ?? []);
    return summarizeTerritoryExecution(territory, leads, options.clock.now);
  });
  const total = count ?? 0;

  return {
    ok: true,
    progress: {
      summaries,
      total,
      page: options.page,
      limit: options.limit,
      total_pages: Math.ceil(total / options.limit),
    },
  };
}
