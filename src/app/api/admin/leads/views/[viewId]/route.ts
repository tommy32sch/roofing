import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { db } from '@/lib/supabase/server';
import {
  LEAD_SAVED_VIEW_DB_FIELDS,
  toLeadSavedView,
  type LeadSavedViewDbRow,
} from '@/lib/leads/saved-views.server';
import {
  LEAD_VIEW_NAME_MAX_LENGTH,
  parseLeadViewDefinition,
} from '@/lib/leads/work-queue';
import { isValidUUID } from '@/lib/utils/validation';

function validName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= LEAD_VIEW_NAME_MAX_LENGTH ? name : null;
}

async function parsedBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ viewId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const { viewId } = await params;
    if (!isValidUUID(viewId)) {
      return NextResponse.json({ success: false, error: 'Invalid view ID' }, { status: 400 });
    }

    const body = await parsedBody(request);
    if (!body) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = validName(body.name);
      if (!name) {
        return NextResponse.json(
          { success: false, error: `Name must contain 1-${LEAD_VIEW_NAME_MAX_LENGTH} characters` },
          { status: 400 }
        );
      }
      updates.name = name;
    }
    if (body.definition !== undefined) {
      const definition = parseLeadViewDefinition(body.definition);
      if (!definition) {
        return NextResponse.json({ success: false, error: 'Invalid saved view' }, { status: 400 });
      }
      updates.definition_version = 1;
      updates.definition = definition;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await db()
      .from('lead_saved_views')
      .update(updates)
      .eq('id', viewId)
      .eq('owner_user_id', admin.sub)
      .select(LEAD_SAVED_VIEW_DB_FIELDS)
      .maybeSingle();

    if (error) {
      const duplicate = error.code === '23505';
      return NextResponse.json(
        { success: false, error: duplicate ? 'You already have a view with that name' : error.message },
        { status: duplicate ? 409 : 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'Saved view not found' }, { status: 404 });
    }

    const view = toLeadSavedView(data as LeadSavedViewDbRow);
    if (!view) {
      return NextResponse.json({ success: false, error: 'Saved view could not be read' }, { status: 500 });
    }
    return NextResponse.json({ success: true, view });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ viewId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const { viewId } = await params;
    if (!isValidUUID(viewId)) {
      return NextResponse.json({ success: false, error: 'Invalid view ID' }, { status: 400 });
    }

    const { data, error } = await db()
      .from('lead_saved_views')
      .delete()
      .eq('id', viewId)
      .eq('owner_user_id', admin.sub)
      .select('id')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'Saved view not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
