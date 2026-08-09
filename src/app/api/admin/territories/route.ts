import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyMarketFilter } from '@/lib/leads/markets';
import { isValidUUID } from '@/lib/utils/validation';
import {
  DEFAULT_TERRITORY_COLOR,
  TERRITORY_COLORS,
  TERRITORY_NAME_MAX_LENGTH,
  type TerritoryColor,
} from '@/lib/territories/constants';
import { validateTerritoryBoundary } from '@/lib/territories/geometry';
import {
  TERRITORY_DB_FIELDS,
  findTerritoryConflicts,
  loadTerritoryOwners,
  toTerritory,
  validateTerritoryMarket,
  validateTerritoryOwner,
  type TerritoryDbRow,
} from '@/lib/territories/server';

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('include_archived') === 'true';
    if (includeArchived && admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const supabase = db();
    let query = supabase.from('territories').select(TERRITORY_DB_FIELDS);
    query = applyMarketFilter(query, await marketFilterFor(admin.marketId, searchParams.get('market_id')));
    if (!includeArchived) query = query.is('archived_at', null);
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as TerritoryDbRow[];
    const { owners, error: ownerError } = await loadTerritoryOwners(
      supabase,
      rows.map((row) => row.owner_user_id)
    );
    if (ownerError) {
      return NextResponse.json({ success: false, error: ownerError }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      territories: rows.map((row) => toTerritory(row, owners)),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > TERRITORY_NAME_MAX_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Name must contain 1-${TERRITORY_NAME_MAX_LENGTH} characters` },
        { status: 400 }
      );
    }

    const marketId = Number(body.market_id);
    if (!Number.isInteger(marketId) || marketId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid market_id' }, { status: 400 });
    }

    const geometry = validateTerritoryBoundary(body.boundary);
    if (!geometry.success) {
      return NextResponse.json({ success: false, error: geometry.error }, { status: 400 });
    }

    const color = body.color === undefined ? DEFAULT_TERRITORY_COLOR : body.color;
    if (typeof color !== 'string' || !TERRITORY_COLORS.includes(color as TerritoryColor)) {
      return NextResponse.json({ success: false, error: 'Invalid territory color' }, { status: 400 });
    }

    const ownerUserId = body.owner_user_id === undefined || body.owner_user_id === null
      ? null
      : body.owner_user_id;
    if (
      ownerUserId !== null &&
      (typeof ownerUserId !== 'string' || !isValidUUID(ownerUserId))
    ) {
      return NextResponse.json({ success: false, error: 'Invalid owner_user_id' }, { status: 400 });
    }
    if (body.allow_overlap !== undefined && typeof body.allow_overlap !== 'boolean') {
      return NextResponse.json({ success: false, error: 'allow_overlap must be a boolean' }, { status: 400 });
    }

    const supabase = db();
    const market = await validateTerritoryMarket(supabase, marketId);
    if (!market.success) {
      return NextResponse.json({ success: false, error: market.error }, { status: market.status });
    }
    const owner = await validateTerritoryOwner(supabase, ownerUserId, marketId);
    if (!owner.success) {
      return NextResponse.json({ success: false, error: owner.error }, { status: owner.status });
    }

    if (body.allow_overlap !== true) {
      const overlap = await findTerritoryConflicts(supabase, marketId, geometry.boundary);
      if (overlap.error) {
        return NextResponse.json({ success: false, error: overlap.error }, { status: 500 });
      }
      if (overlap.conflicts.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Territory overlaps an active territory',
            conflicts: overlap.conflicts,
          },
          { status: 409 }
        );
      }
    }

    const { data, error } = await supabase
      .from('territories')
      .insert({
        name,
        market_id: marketId,
        boundary: geometry.boundary,
        ...geometry.bounds,
        color,
        owner_user_id: ownerUserId,
        created_by: admin.sub,
      })
      .select(TERRITORY_DB_FIELDS)
      .single();
    if (error) {
      const duplicate = error.code === '23505';
      return NextResponse.json(
        { success: false, error: duplicate ? 'An active territory with that name already exists' : error.message },
        { status: duplicate ? 409 : 500 }
      );
    }

    const owners = new Map();
    if (owner.owner) owners.set(owner.owner.id, owner.owner);
    return NextResponse.json(
      { success: true, territory: toTerritory(data as TerritoryDbRow, owners) },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
