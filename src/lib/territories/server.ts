import type { SupabaseClient } from '@supabase/supabase-js';
import type { Territory, UserRole } from '@/types';
import { polygonBounds, polygonsOverlap } from './geometry';
import type { TerritoryBoundary } from './types';

export const TERRITORY_DB_FIELDS =
  'id, name, market_id, boundary, color, owner_user_id, archived_at, created_at, updated_at';

export interface TerritoryDbRow {
  id: string;
  name: string;
  market_id: number;
  boundary: TerritoryBoundary;
  color: string;
  owner_user_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TerritoryOwner {
  id: string;
  name: string;
  role: UserRole;
  market_id: number | null;
}

export interface TerritoryConflict {
  id: string;
  name: string;
  owner_user_id: string | null;
  owner_name: string | null;
}

export function toTerritory(
  row: TerritoryDbRow,
  owners: ReadonlyMap<string, TerritoryOwner>
): Territory {
  const owner = row.owner_user_id ? owners.get(row.owner_user_id) : undefined;
  return {
    id: row.id,
    name: row.name,
    market_id: row.market_id,
    boundary: row.boundary,
    color: row.color,
    owner_user_id: row.owner_user_id,
    owner_name: owner?.name ?? null,
    owner_role: owner?.role ?? null,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function loadTerritoryOwners(
  supabase: SupabaseClient,
  ownerIds: Iterable<string | null>
): Promise<{ owners: Map<string, TerritoryOwner>; error: string | null }> {
  const ids = [...new Set([...ownerIds].filter((id): id is string => id != null))];
  if (ids.length === 0) return { owners: new Map(), error: null };

  const { data, error } = await supabase
    .from('admin_users')
    .select('id, name, role, market_id')
    .in('id', ids);
  if (error) return { owners: new Map(), error: error.message };

  const owners = new Map<string, TerritoryOwner>();
  for (const row of (data ?? []) as TerritoryOwner[]) owners.set(row.id, row);
  return { owners, error: null };
}

export async function validateTerritoryOwner(
  supabase: SupabaseClient,
  ownerUserId: string | null,
  marketId: number
): Promise<
  | { success: true; owner: TerritoryOwner | null }
  | { success: false; error: string; status: 400 | 500 }
> {
  if (ownerUserId == null) return { success: true, owner: null };

  const { data, error } = await supabase
    .from('admin_users')
    .select('id, name, role, market_id')
    .eq('id', ownerUserId)
    .maybeSingle();
  if (error) return { success: false, error: error.message, status: 500 };
  if (!data || (data.role !== 'setter' && data.role !== 'admin')) {
    return { success: false, error: 'Territory owner must be a setter or admin', status: 400 };
  }
  if (data.market_id != null && data.market_id !== marketId) {
    return { success: false, error: 'Territory owner belongs to a different market', status: 400 };
  }
  return { success: true, owner: data as TerritoryOwner };
}

export async function validateTerritoryMarket(
  supabase: SupabaseClient,
  marketId: number
): Promise<{ success: true } | { success: false; error: string; status: 400 | 500 }> {
  const { data, error } = await supabase
    .from('markets')
    .select('id, is_active')
    .eq('id', marketId)
    .maybeSingle();
  if (error) return { success: false, error: error.message, status: 500 };
  if (!data?.is_active) {
    return { success: false, error: 'Market not found or inactive', status: 400 };
  }
  return { success: true };
}

/**
 * Find active same-market territories whose interiors overlap this boundary.
 * Bounding columns narrow the candidates before the exact in-process test.
 */
export async function findTerritoryConflicts(
  supabase: SupabaseClient,
  marketId: number,
  boundary: TerritoryBoundary,
  excludeId?: string
): Promise<{ conflicts: TerritoryConflict[]; error: string | null }> {
  const bounds = polygonBounds(boundary);
  let query = supabase
    .from('territories')
    .select('id, name, boundary, owner_user_id')
    .eq('market_id', marketId)
    .is('archived_at', null)
    .lt('min_lat', bounds.max_lat)
    .gt('max_lat', bounds.min_lat)
    .lt('min_lng', bounds.max_lng)
    .gt('max_lng', bounds.min_lng);
  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query;
  if (error) return { conflicts: [], error: error.message };

  const rows = ((data ?? []) as {
    id: string;
    name: string;
    boundary: TerritoryBoundary;
    owner_user_id: string | null;
  }[]).filter((row) => polygonsOverlap(boundary, row.boundary));

  const { owners, error: ownerError } = await loadTerritoryOwners(
    supabase,
    rows.map((row) => row.owner_user_id)
  );
  if (ownerError) return { conflicts: [], error: ownerError };

  return {
    conflicts: rows.map((row) => ({
      id: row.id,
      name: row.name,
      owner_user_id: row.owner_user_id,
      owner_name: row.owner_user_id ? owners.get(row.owner_user_id)?.name ?? null : null,
    })),
    error: null,
  };
}
