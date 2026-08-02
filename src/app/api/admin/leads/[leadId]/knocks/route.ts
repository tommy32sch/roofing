import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import {
  KNOCK_DISPOSITION_VALUES,
  type KnockDisposition,
} from '@/lib/leads/knocks';
import { resolveKnockedAt } from '@/lib/leads/knock-sync';
import { authorizeLeadAccess } from '@/lib/leads/lead-visibility';

interface KnockRpcResult {
  success: boolean;
  error?: 'lead_not_found' | 'client_id_conflict';
  duplicate?: boolean;
  knock?: Record<string, unknown>;
  statusChangedTo?: string | null;
}

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

    const supabase = db();
    const access = await authorizeLeadAccess(supabase, admin.role, leadId);
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    const body = await request.json();
    const disposition = body.disposition as KnockDisposition;
    if (!KNOCK_DISPOSITION_VALUES.has(disposition)) {
      return NextResponse.json({ success: false, error: 'Invalid disposition' }, { status: 400 });
    }
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    // Offline capture. The phone owns the identity and the time: the id makes a
    // replay idempotent, and the timestamp is when the door was actually
    // knocked rather than when the queue happened to drain.
    let clientId: string | null = null;
    if (body.client_id !== undefined && body.client_id !== null) {
      if (typeof body.client_id !== 'string') {
        return NextResponse.json({ success: false, error: 'Invalid client ID' }, { status: 400 });
      }
      clientId = body.client_id.trim();
      if (!clientId || !isValidUUID(clientId)) {
        return NextResponse.json({ success: false, error: 'Invalid client ID' }, { status: 400 });
      }
    }

    // IndexedDB survives logout and user switching. Bind a queued event to the
    // rep who created it so another signed-in account can never inherit it.
    if (body.owner_id !== undefined) {
      if (
        typeof body.owner_id !== 'string' ||
        !isValidUUID(body.owner_id) ||
        body.owner_id !== admin.sub
      ) {
        return NextResponse.json(
          { success: false, error: 'Queued knock belongs to a different user' },
          { status: 403 }
        );
      }
    }
    const when = resolveKnockedAt(body.knocked_at);
    if (!when.ok) {
      return NextResponse.json(
        { success: false, error: `Invalid knocked_at (${when.reason})` },
        { status: 400 }
      );
    }

    // The RPC holds a row lock and records the event, denormalised lead fields,
    // and timeline activities in one transaction. A replay can therefore never
    // find an inserted event whose derived state was only half-written.
    const { data, error } = await supabase.rpc('record_lead_knock', {
      p_lead_id: leadId,
      p_disposition: disposition,
      p_notes: notes,
      p_created_by: admin.sub,
      p_knocked_at: when.knockedAt,
      p_client_id: clientId,
    });
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const result = data as KnockRpcResult | null;
    if (!result?.success) {
      if (result?.error === 'lead_not_found') {
        return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
      }
      if (result?.error === 'client_id_conflict') {
        return NextResponse.json(
          { success: false, error: 'Client ID belongs to a different knock' },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: false, error: 'Failed to record knock' }, { status: 500 });
    }

    return NextResponse.json(
      {
        success: true,
        knock: result.knock,
        duplicate: result.duplicate ?? false,
        statusChangedTo: result.statusChangedTo ?? null,
      },
      { status: result.duplicate ? 200 : 201 }
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

    const supabase = db();
    const access = await authorizeLeadAccess(supabase, admin.role, leadId);
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    const { data, error } = await supabase
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
