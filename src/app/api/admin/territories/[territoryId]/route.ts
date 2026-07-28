import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import {
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
  validateTerritoryOwner,
  type TerritoryDbRow,
} from '@/lib/territories/server';
import type { TerritoryBoundary } from '@/lib/territories/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ territoryId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    const { territoryId } = await params;
    if (!isValidUUID(territoryId)) {
      return NextResponse.json({ success: false, error: 'Invalid territory ID' }, { status: 400 });
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

    const supabase = db();
    const { data: existingData, error: existingError } = await supabase
      .from('territories')
      .select(TERRITORY_DB_FIELDS)
      .eq('id', territoryId)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
    }
    if (!existingData) {
      return NextResponse.json({ success: false, error: 'Territory not found' }, { status: 404 });
    }
    const existing = existingData as TerritoryDbRow;
    const updates: Record<string, unknown> = {};
    if (body.allow_overlap !== undefined && typeof body.allow_overlap !== 'boolean') {
      return NextResponse.json({ success: false, error: 'allow_overlap must be a boolean' }, { status: 400 });
    }

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > TERRITORY_NAME_MAX_LENGTH) {
        return NextResponse.json(
          { success: false, error: `Name must contain 1-${TERRITORY_NAME_MAX_LENGTH} characters` },
          { status: 400 }
        );
      }
      updates.name = name;
    }

    if (body.color !== undefined) {
      if (typeof body.color !== 'string' || !TERRITORY_COLORS.includes(body.color as TerritoryColor)) {
        return NextResponse.json({ success: false, error: 'Invalid territory color' }, { status: 400 });
      }
      updates.color = body.color;
    }

    let boundary: TerritoryBoundary = existing.boundary;
    if (body.boundary !== undefined) {
      const geometry = validateTerritoryBoundary(body.boundary);
      if (!geometry.success) {
        return NextResponse.json({ success: false, error: geometry.error }, { status: 400 });
      }
      boundary = geometry.boundary;
      updates.boundary = geometry.boundary;
      Object.assign(updates, geometry.bounds);
    }

    let ownersForResponse = new Map();
    if (body.owner_user_id !== undefined) {
      if (
        body.owner_user_id !== null &&
        (typeof body.owner_user_id !== 'string' || !isValidUUID(body.owner_user_id))
      ) {
        return NextResponse.json({ success: false, error: 'Invalid owner_user_id' }, { status: 400 });
      }
      const owner = await validateTerritoryOwner(
        supabase,
        body.owner_user_id as string | null,
        existing.market_id
      );
      if (!owner.success) {
        return NextResponse.json({ success: false, error: owner.error }, { status: owner.status });
      }
      if (owner.owner) ownersForResponse.set(owner.owner.id, owner.owner);
      updates.owner_user_id = body.owner_user_id;
    } else {
      // Resolve display data before mutating so an owner lookup failure cannot
      // make a successful update look like it failed.
      const loaded = await loadTerritoryOwners(supabase, [existing.owner_user_id]);
      if (loaded.error) {
        return NextResponse.json({ success: false, error: loaded.error }, { status: 500 });
      }
      ownersForResponse = loaded.owners;
    }

    let willBeActive = existing.archived_at == null;
    if (body.archived !== undefined) {
      if (typeof body.archived !== 'boolean') {
        return NextResponse.json({ success: false, error: 'archived must be a boolean' }, { status: 400 });
      }
      willBeActive = !body.archived;
      if (body.archived && existing.archived_at == null) {
        updates.archived_at = new Date().toISOString();
        updates.archived_by = admin.sub;
      } else if (!body.archived && existing.archived_at != null) {
        updates.archived_at = null;
        updates.archived_by = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
    }

    const geometryChanges = body.boundary !== undefined;
    const restoring = existing.archived_at != null && body.archived === false;
    if (willBeActive && (geometryChanges || restoring) && body.allow_overlap !== true) {
      const overlap = await findTerritoryConflicts(
        supabase,
        existing.market_id,
        boundary,
        territoryId
      );
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
      .update(updates)
      .eq('id', territoryId)
      .select(TERRITORY_DB_FIELDS)
      .single();
    if (error) {
      const duplicate = error.code === '23505';
      return NextResponse.json(
        { success: false, error: duplicate ? 'An active territory with that name already exists' : error.message },
        { status: duplicate ? 409 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      territory: toTerritory(data as TerritoryDbRow, ownersForResponse),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
