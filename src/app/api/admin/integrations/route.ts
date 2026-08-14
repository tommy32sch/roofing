import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { randomBytes } from 'crypto';
import { saveWebhookConnection } from '@/lib/integrations/health.server';

export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    // API keys are lead-injection credentials — admin only.
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = db();

    const { data: keys, error } = await supabase
      .from('integration_api_keys')
      .select(
        'id, name, api_key, source_id, is_active, last_used_at, created_at, ' +
        'lead_sources(id, name, display_name)'
      )
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    type IntegrationKeyRow = {
      id: string;
      name: string;
      api_key: string;
      source_id: number | null;
      is_active: boolean;
      last_used_at: string | null;
      created_at: string;
      lead_sources: { id: number; name: string; display_name: string } | null;
    };
    const rows = (keys ?? []) as unknown as IntegrationKeyRow[];

    // Mask API keys — only show last 8 chars
    const maskedKeys = rows.map((key) => ({
      ...key,
      api_key: `${'•'.repeat(24)}${key.api_key.slice(-8)}`,
    }));

    return NextResponse.json({ success: true, keys: maskedKeys });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    // API keys are lead-injection credentials — admin only.
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { name, source_id } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
    }

    if (name.trim().length > 100) {
      return NextResponse.json({ success: false, error: 'Name must be 100 characters or less' }, { status: 400 });
    }
    const sourceId = source_id == null || source_id === '' ? null : Number(source_id);
    if (sourceId != null && (!Number.isInteger(sourceId) || sourceId <= 0)) {
      return NextResponse.json({ success: false, error: 'Invalid lead source' }, { status: 400 });
    }

    // Generate a secure API key
    const apiKey = `rl_${randomBytes(32).toString('hex')}`;

    const supabase = db();

    const { data: key, error } = await supabase
      .from('integration_api_keys')
      .insert({
        name: name.trim(),
        api_key: apiKey,
        source_id: sourceId,
      })
      .select(
        'id, name, api_key, source_id, is_active, last_used_at, created_at, ' +
        'lead_sources(id, name, display_name)'
      )
      .single();

    if (error || !key) {
      return NextResponse.json({ success: false, error: error?.message || 'API key was not created' }, { status: 500 });
    }

    const created = key as unknown as {
      id: string;
      name: string;
      api_key: string;
      created_at: string;
    };

    try {
      await saveWebhookConnection(supabase, {
        apiKeyId: created.id,
        name: created.name,
        paused: false,
        configuredAt: created.created_at,
      });
    } catch (connectionError) {
      // Do not strand a credential that was never shown to the admin.
      await supabase.from('integration_api_keys').delete().eq('id', created.id);
      return NextResponse.json(
        {
          success: false,
          error: connectionError instanceof Error
            ? connectionError.message
            : 'Integration connection was not created',
        },
        { status: 500 }
      );
    }

    // Return the full API key only once — it won't be shown again
    return NextResponse.json({
      success: true,
      key: created,
      message: 'Save this API key — it will not be shown again.',
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
