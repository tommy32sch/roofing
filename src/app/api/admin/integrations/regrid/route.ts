import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { testRegridConnection } from '@/lib/integrations/regrid';
import { db } from '@/lib/supabase/server';
import {
  recordIntegrationRunSafely,
  saveSingletonConnection,
} from '@/lib/integrations/health.server';
import { integrationCadence } from '@/lib/integrations/health';

async function requireAdmin() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return { response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  if (admin.role !== 'admin') {
    return { response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { admin };
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireAdmin();
    if ('response' in access) return access.response;

    const body = await request.json().catch(() => ({}));
    const suppliedKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    const supabase = db();
    const settings = await supabase
      .from('app_settings')
      .select('regrid_api_key')
      .eq('id', 'default')
      .single();
    if (settings.error) {
      return NextResponse.json({ success: false, error: settings.error.message }, { status: 500 });
    }
    const savedKey = settings.data?.regrid_api_key?.trim() || '';
    const apiKey = suppliedKey || savedKey;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'API key is required' }, { status: 400 });
    }

    const startedAt = new Date().toISOString();
    const result = await testRegridConnection(apiKey);
    // An unsaved candidate key is not yet a connection and must not make the
    // durable provider look configured. Saved-key checks are real provider runs.
    if (!suppliedKey || suppliedKey === savedKey) {
      await recordIntegrationRunSafely(supabase, {
        provider: 'regrid',
        name: 'Regrid property enrichment',
        status: result.success ? 'success' : 'failure',
        itemsReceived: 1,
        itemsSucceeded: result.success ? 1 : 0,
        itemsFailed: result.success ? 0 : 1,
        error: result.success ? null : result.message,
        metadata: { test: true },
        startedAt,
      });
    }

    return NextResponse.json(
      result.success
        ? { success: true, message: result.message }
        : { success: false, error: result.message },
      { status: result.success ? 200 : 502 }
    );
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireAdmin();
    if ('response' in access) return access.response;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }
    if (
      body.auto_enrich_enabled !== undefined &&
      typeof body.auto_enrich_enabled !== 'boolean'
    ) {
      return NextResponse.json(
        { success: false, error: 'auto_enrich_enabled must be a boolean' },
        { status: 400 }
      );
    }
    const cadenceDecision = integrationCadence(body.expected_cadence_minutes);
    if (!cadenceDecision.ok) {
      return NextResponse.json({ success: false, error: cadenceDecision.error }, { status: 400 });
    }

    const suppliedKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (suppliedKey.length > 500) {
      return NextResponse.json({ success: false, error: 'API key is too long' }, { status: 400 });
    }

    const supabase = db();
    const current = await supabase
      .from('app_settings')
      .select('regrid_api_key, auto_enrich_enabled')
      .eq('id', 'default')
      .single();
    if (current.error || !current.data) {
      return NextResponse.json(
        { success: false, error: current.error?.message || 'Regrid settings were not found' },
        { status: 500 }
      );
    }

    const apiKey = suppliedKey || current.data.regrid_api_key?.trim() || '';
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'Enter a Regrid API key' }, { status: 400 });
    }
    const enabled = body.auto_enrich_enabled ?? !!current.data.auto_enrich_enabled;
    const updates: Record<string, unknown> = { auto_enrich_enabled: enabled };
    if (suppliedKey) updates.regrid_api_key = suppliedKey;

    const saved = await supabase
      .from('app_settings')
      .update(updates)
      .eq('id', 'default')
      .select('auto_enrich_enabled')
      .single();
    if (saved.error || !saved.data) {
      return NextResponse.json(
        { success: false, error: saved.error?.message || 'Regrid settings were not updated' },
        { status: 500 }
      );
    }

    await saveSingletonConnection(supabase, {
      provider: 'regrid',
      name: 'Regrid property enrichment',
      paused: !enabled,
      expectedCadenceMinutes: cadenceDecision.value,
    });

    return NextResponse.json({
      success: true,
      configuration: {
        secretStored: true,
        autoEnrichEnabled: saved.data.auto_enrich_enabled,
        expectedCadenceMinutes: cadenceDecision.value,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
