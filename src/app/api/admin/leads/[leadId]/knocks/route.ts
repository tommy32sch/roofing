import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import {
  KNOCK_DISPOSITION_VALUES,
  knockLabel,
  statusForDisposition,
  type KnockDisposition,
} from '@/lib/leads/knocks';

/**
 * Record a door knock.
 *
 * The single place knocks are written, so the derived state on `leads`
 * (last_knock_at / last_disposition / knock_count / do_not_knock) can't drift.
 * Knocks are append-only — a knock is an event that happened, not a row to edit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { leadId } = await params;
    if (!isValidUUID(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
    }

    const body = await request.json();
    const disposition = body.disposition as KnockDisposition;
    if (!KNOCK_DISPOSITION_VALUES.has(disposition)) {
      return NextResponse.json({ success: false, error: 'Invalid disposition' }, { status: 400 });
    }
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    const supabase = db();
    const { data: lead } = await supabase
      .from('leads')
      .select('id, status, knock_count, do_not_knock')
      .eq('id', leadId)
      .single();
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    const { data: knock, error } = await supabase
      .from('lead_knocks')
      .insert({ lead_id: leadId, disposition, notes, created_by: admin.sub })
      .select('*')
      .single();
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Derived state. do_not_knock is sticky once set — a later "not home" must
    // never quietly put the house back on the knock list.
    const nextStatus = statusForDisposition(disposition);
    const update: Record<string, unknown> = {
      last_knock_at: knock.knocked_at,
      last_disposition: disposition,
      knock_count: (lead.knock_count ?? 0) + 1,
    };
    if (disposition === 'do_not_knock') update.do_not_knock = true;
    // Don't drag a won/lost lead backwards into an earlier pipeline stage.
    const terminal = lead.status === 'sold' || lead.status === 'lost';
    if (nextStatus && !terminal && nextStatus !== lead.status) update.status = nextStatus;

    await supabase.from('leads').update(update).eq('id', leadId);

    // Reuse the existing 'visit' activity type so knocks appear in the timeline
    // and the activity feed without a parallel history UI.
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'visit',
      content: `Knocked — ${knockLabel(disposition)}${notes ? `: ${notes}` : ''}`,
      created_by: admin.sub,
    });

    if (update.status) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'status_change',
        content: `Status changed from ${lead.status} to ${update.status}`,
        old_status: lead.status,
        new_status: update.status,
        created_by: admin.sub,
      });
    }

    return NextResponse.json(
      { success: true, knock, statusChangedTo: update.status ?? null },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** Knock history for a lead, newest first. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const { leadId } = await params;
    if (!isValidUUID(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
    }
    const { data, error } = await db()
      .from('lead_knocks')
      .select('*, admin_users(name)')
      .eq('lead_id', leadId)
      .order('knocked_at', { ascending: false });
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, knocks: data ?? [] });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
