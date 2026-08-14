import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import {
  loadEmailImportConnection,
  loadRegridConnection,
  loadWebhookConnections,
} from '@/lib/integrations/health.server';
import {
  safeIntegrationError,
  type IntegrationConnection,
  type IntegrationConnectionsResponse,
  type IntegrationProvider,
} from '@/lib/integrations/health';

export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = db();
    const generatedAt = new Date();
    const adapters: {
      provider: IntegrationProvider;
      load: () => Promise<IntegrationConnection[]>;
    }[] = [
      {
        provider: 'webhook',
        load: () => loadWebhookConnections(supabase, generatedAt),
      },
      {
        provider: 'email_import',
        load: async () => [await loadEmailImportConnection(supabase, generatedAt)],
      },
      {
        provider: 'regrid',
        load: async () => [await loadRegridConnection(supabase, generatedAt)],
      },
    ];

    const settled = await Promise.allSettled(adapters.map((adapter) => adapter.load()));
    const connections: IntegrationConnection[] = [];
    const providerErrors: Partial<Record<IntegrationProvider, string>> = {};
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        connections.push(...result.value);
      } else {
        providerErrors[adapters[index].provider] =
          safeIntegrationError(result.reason) || 'Connection status is unavailable';
      }
    });

    const body: IntegrationConnectionsResponse = {
      success: true,
      generatedAt: generatedAt.toISOString(),
      connections,
      providerErrors,
    };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
