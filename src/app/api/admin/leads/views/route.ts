import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { db } from '@/lib/supabase/server';
import {
  LEAD_SAVED_VIEW_DB_FIELDS,
  savedViewInsert,
  toLeadSavedView,
  type LeadSavedViewDbRow,
} from '@/lib/leads/saved-views.server';
import {
  LEAD_VIEW_NAME_MAX_LENGTH,
  parseLeadViewDefinition,
} from '@/lib/leads/work-queue';

function validName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= LEAD_VIEW_NAME_MAX_LENGTH ? name : null;
}

export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { data, error } = await db()
      .from('lead_saved_views')
      .select(LEAD_SAVED_VIEW_DB_FIELDS)
      .eq('owner_user_id', admin.sub)
      .eq('definition_version', 1)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      views: ((data ?? []) as LeadSavedViewDbRow[])
        .map(toLeadSavedView)
        .filter((view) => view !== null),
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

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid body');
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const name = validName(body.name);
    if (!name) {
      return NextResponse.json(
        { success: false, error: `Name must contain 1-${LEAD_VIEW_NAME_MAX_LENGTH} characters` },
        { status: 400 }
      );
    }
    const definition = parseLeadViewDefinition(body.definition);
    if (!definition) {
      return NextResponse.json({ success: false, error: 'Invalid saved view' }, { status: 400 });
    }

    const { data, error } = await db()
      .from('lead_saved_views')
      .insert(savedViewInsert(admin.sub, name, definition))
      .select(LEAD_SAVED_VIEW_DB_FIELDS)
      .single();

    if (error) {
      const duplicate = error.code === '23505';
      return NextResponse.json(
        { success: false, error: duplicate ? 'You already have a view with that name' : error.message },
        { status: duplicate ? 409 : 500 }
      );
    }

    const view = toLeadSavedView(data as LeadSavedViewDbRow);
    if (!view) {
      return NextResponse.json({ success: false, error: 'Saved view could not be read' }, { status: 500 });
    }
    return NextResponse.json({ success: true, view }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
