import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { saveWebhookConnection } from '@/lib/integrations/health.server';
import { integrationCadence } from '@/lib/integrations/health';

async function requireAdmin() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return { response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  if (admin.role !== 'admin') {
    return { response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { admin };
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const access = await requireAdmin();
    if ('response' in access) return access.response;

    const { keyId } = await params;
    const supabase = db();

    const existing = await supabase
      .from('integration_api_keys')
      .select('id, name, created_at')
      .eq('id', keyId)
      .maybeSingle();
    if (existing.error) {
      return NextResponse.json({ success: false, error: existing.error.message }, { status: 500 });
    }
    if (!existing.data) {
      return NextResponse.json({ success: false, error: 'API key not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('integration_api_keys')
      .update({ is_active: false })
      .eq('id', keyId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    await saveWebhookConnection(supabase, {
      apiKeyId: keyId,
      name: existing.data.name,
      paused: true,
      configuredAt: existing.data.created_at,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const access = await requireAdmin();
    if ('response' in access) return access.response;

    const { keyId } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }
    const activeProvided = body.is_active !== undefined;
    if (activeProvided && typeof body.is_active !== 'boolean') {
      return NextResponse.json({ success: false, error: 'is_active must be a boolean' }, { status: 400 });
    }
    const cadenceProvided = Object.prototype.hasOwnProperty.call(body, 'expected_cadence_minutes');
    const cadenceDecision = cadenceProvided
      ? integrationCadence(body.expected_cadence_minutes)
      : { ok: true as const, value: undefined };
    if (!cadenceDecision.ok) {
      return NextResponse.json({ success: false, error: cadenceDecision.error }, { status: 400 });
    }

    if (!activeProvided && !cadenceProvided) {
      return NextResponse.json({ success: false, error: 'No connection changes supplied' }, { status: 400 });
    }

    const supabase = db();
    const existing = await supabase
      .from('integration_api_keys')
      .select('id, name, source_id, is_active, last_used_at, created_at, lead_sources(id, name, display_name)')
      .eq('id', keyId)
      .maybeSingle();
    if (existing.error) {
      return NextResponse.json({ success: false, error: existing.error.message }, { status: 500 });
    }
    if (!existing.data) {
      return NextResponse.json({ success: false, error: 'API key not found' }, { status: 404 });
    }

    let key = existing.data;
    if (activeProvided) {
      const updated = await supabase
        .from('integration_api_keys')
        .update({ is_active: body.is_active })
        .eq('id', keyId)
        .select('id, name, source_id, is_active, last_used_at, created_at, lead_sources(id, name, display_name)')
        .single();
      if (updated.error || !updated.data) {
        return NextResponse.json(
          { success: false, error: updated.error?.message || 'API key was not updated' },
          { status: 500 }
        );
      }
      key = updated.data;
    }

    await saveWebhookConnection(supabase, {
      apiKeyId: keyId,
      name: key.name,
      paused: !key.is_active,
      configuredAt: key.created_at,
      expectedCadenceMinutes: cadenceDecision.value,
    });

    // Never select or return the stored credential from a mutation response.
    return NextResponse.json({ success: true, key });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** Verify that the local receiver and selected key are ready. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const access = await requireAdmin();
    if ('response' in access) return access.response;

    const { keyId } = await params;
    const supabase = db();
    const key = await supabase
      .from('integration_api_keys')
      .select('id, name, is_active, created_at')
      .eq('id', keyId)
      .maybeSingle();
    if (key.error) {
      return NextResponse.json({ success: false, error: key.error.message }, { status: 500 });
    }
    if (!key.data) {
      return NextResponse.json({ success: false, error: 'API key not found' }, { status: 404 });
    }
    if (!key.data.is_active) {
      return NextResponse.json(
        { success: false, error: 'This webhook is paused. Resume it before testing.' },
        { status: 409 }
      );
    }

    await saveWebhookConnection(supabase, {
      apiKeyId: keyId,
      name: key.data.name,
      paused: false,
      configuredAt: key.data.created_at,
    });
    return NextResponse.json({
      success: true,
      message: 'Receiver and API key are ready. Send a vendor test payload to verify delivery.',
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
