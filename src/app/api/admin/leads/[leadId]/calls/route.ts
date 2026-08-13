import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import {
  COLD_CALL_DISPOSITION_VALUES,
  type ColdCallDisposition,
} from '@/lib/leads/calls';
import { resolveCalledAt } from '@/lib/leads/call-sync';
import { authorizeLeadAccess } from '@/lib/leads/lead-visibility';

interface CallRpcResult {
  success: boolean;
  error?: 'lead_not_found' | 'client_id_conflict';
  duplicate?: boolean;
  call?: Record<string, unknown>;
  statusChangedTo?: string | null;
}

/**
 * Record a structured cold-call result for any authenticated app role.
 *
 * The RPC owns the event, summary fields, sticky Do Not Call state and timeline
 * activity in one transaction. Client ids make offline retries idempotent.
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
    const access = await authorizeLeadAccess(supabase, { id: admin.sub, role: admin.role }, leadId);
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    const body = await request.json();
    const disposition = body.disposition as ColdCallDisposition;
    if (!COLD_CALL_DISPOSITION_VALUES.has(disposition)) {
      return NextResponse.json({ success: false, error: 'Invalid disposition' }, { status: 400 });
    }
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

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

    // IndexedDB survives logout and account switching. A queued call may only
    // sync as the rep who originally recorded it.
    if (body.owner_id !== undefined) {
      if (
        typeof body.owner_id !== 'string' ||
        !isValidUUID(body.owner_id) ||
        body.owner_id !== admin.sub
      ) {
        return NextResponse.json(
          { success: false, error: 'Queued call belongs to a different user' },
          { status: 403 }
        );
      }
    }

    const when = resolveCalledAt(body.called_at);
    if (!when.ok) {
      return NextResponse.json(
        { success: false, error: `Invalid called_at (${when.reason})` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('record_lead_call', {
      p_lead_id: leadId,
      p_disposition: disposition,
      p_notes: notes,
      p_created_by: admin.sub,
      p_called_at: when.calledAt,
      p_client_id: clientId,
    });
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const result = data as CallRpcResult | null;
    if (!result?.success) {
      if (result?.error === 'lead_not_found') {
        return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
      }
      if (result?.error === 'client_id_conflict') {
        return NextResponse.json(
          { success: false, error: 'Client ID belongs to a different call' },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: false, error: 'Failed to record call' }, { status: 500 });
    }

    return NextResponse.json(
      {
        success: true,
        call: result.call,
        duplicate: result.duplicate ?? false,
        statusChangedTo: result.statusChangedTo ?? null,
      },
      { status: result.duplicate ? 200 : 201 }
    );
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** Structured cold-call history for a lead, newest first. */
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
    const access = await authorizeLeadAccess(supabase, { id: admin.sub, role: admin.role }, leadId);
    if (!access.ok) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    const { data, error } = await supabase
      .from('lead_calls')
      .select('*, admin_users(name)')
      .eq('lead_id', leadId)
      .order('called_at', { ascending: false });
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, calls: data ?? [] });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
