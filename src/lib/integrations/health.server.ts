import type { SupabaseClient } from '@supabase/supabase-js';
import {
  integrationHealth,
  safeIntegrationError,
  type IntegrationConnection,
  type IntegrationConfigurationValue,
  type IntegrationProvider,
  type IntegrationRunSummary,
  type IntegrationRunStatus,
} from './health';

const RECENT_VOLUME_WINDOW_HOURS = 7 * 24;
const VOLUME_PAGE_SIZE = 1_000;

interface ConnectionRow {
  id: string;
  provider: IntegrationProvider;
  api_key_id: string | null;
  name: string;
  is_paused: boolean;
  expected_cadence_minutes: number | null;
  configured_at: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_summary: string | null;
  consecutive_failures: number;
}

interface RunRow {
  id: string;
  status: IntegrationRunStatus;
  started_at: string;
  finished_at: string;
  items_received: number;
  items_succeeded: number;
  items_failed: number;
  error_summary: string | null;
}

interface WebhookKeyRow {
  id: string;
  name: string;
  source_id: number | null;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  lead_sources: { display_name: string } | { display_name: string }[] | null;
}

function relationToOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function runSummary(row: RunRow): IntegrationRunSummary {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    itemsReceived: row.items_received,
    itemsSucceeded: row.items_succeeded,
    itemsFailed: row.items_failed,
    errorSummary: safeIntegrationError(row.error_summary),
  };
}

async function connectionHistory(
  supabase: SupabaseClient,
  connectionId: string | null,
  now: Date
): Promise<{ recentRuns: IntegrationRunSummary[]; recentVolume: number }> {
  if (!connectionId) return { recentRuns: [], recentVolume: 0 };

  const recent = await supabase
    .from('integration_runs')
    .select(
      'id, status, started_at, finished_at, items_received, items_succeeded, items_failed, error_summary'
    )
    .eq('connection_id', connectionId)
    .order('started_at', { ascending: false })
    .limit(10);
  if (recent.error) throw new Error(recent.error.message);

  const since = new Date(
    now.getTime() - RECENT_VOLUME_WINDOW_HOURS * 60 * 60 * 1_000
  ).toISOString();
  let recentVolume = 0;
  let offset = 0;
  while (true) {
    const page = await supabase
      .from('integration_runs')
      .select('items_succeeded')
      .eq('connection_id', connectionId)
      .gte('started_at', since)
      .range(offset, offset + VOLUME_PAGE_SIZE - 1);
    if (page.error) throw new Error(page.error.message);

    const rows = (page.data ?? []) as { items_succeeded: number | null }[];
    recentVolume += rows.reduce((sum, row) => sum + (row.items_succeeded ?? 0), 0);
    if (rows.length < VOLUME_PAGE_SIZE) break;
    offset += VOLUME_PAGE_SIZE;
  }

  return {
    recentRuns: ((recent.data ?? []) as unknown as RunRow[]).map(runSummary),
    recentVolume,
  };
}

async function buildConnection(
  supabase: SupabaseClient,
  input: {
    id: string;
    provider: IntegrationProvider;
    name: string;
    configured: boolean;
    paused: boolean;
    configuredAt: string | null;
    row: ConnectionRow | null;
    configuration: Record<string, IntegrationConfigurationValue>;
  },
  now: Date
): Promise<IntegrationConnection> {
  const history = await connectionHistory(supabase, input.row?.id ?? null, now);
  const decision = integrationHealth({
    configured: input.configured,
    paused: input.paused,
    configuredAt: input.configuredAt,
    expectedCadenceMinutes: input.row?.expected_cadence_minutes ?? null,
    lastAttemptAt: input.row?.last_attempt_at ?? null,
    lastSuccessAt: input.row?.last_success_at ?? null,
    lastFailureAt: input.row?.last_failure_at ?? null,
    consecutiveFailures: input.row?.consecutive_failures ?? 0,
  }, now);

  return {
    id: input.id,
    provider: input.provider,
    name: input.name,
    state: decision.state,
    stateReason: decision.reason,
    stateReasonAt: decision.reasonAt,
    configured: input.configured,
    paused: input.paused,
    expectedCadenceMinutes: input.row?.expected_cadence_minutes ?? null,
    lastAttemptAt: input.row?.last_attempt_at ?? null,
    lastSuccessAt: input.row?.last_success_at ?? null,
    lastFailureAt: input.row?.last_failure_at ?? null,
    consecutiveFailures: input.row?.consecutive_failures ?? 0,
    recentVolume: history.recentVolume,
    recentVolumeWindowHours: RECENT_VOLUME_WINDOW_HOURS,
    safeErrorSummary: safeIntegrationError(input.row?.last_error_summary),
    configuration: input.configuration,
    recentRuns: history.recentRuns,
  };
}

async function providerRows(
  supabase: SupabaseClient,
  provider: IntegrationProvider
): Promise<ConnectionRow[]> {
  const result = await supabase
    .from('integration_connections')
    .select(
      'id, provider, api_key_id, name, is_paused, expected_cadence_minutes, configured_at, ' +
      'last_attempt_at, last_success_at, last_failure_at, last_error_summary, consecutive_failures'
    )
    .eq('provider', provider);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as unknown as ConnectionRow[];
}

/** One health row per webhook key. No credential value leaves the server. */
export async function loadWebhookConnections(
  supabase: SupabaseClient,
  now = new Date()
): Promise<IntegrationConnection[]> {
  const [keysResult, rows] = await Promise.all([
    supabase
      .from('integration_api_keys')
      .select('id, name, source_id, is_active, last_used_at, created_at, lead_sources(display_name)')
      .order('created_at', { ascending: false }),
    providerRows(supabase, 'webhook'),
  ]);
  if (keysResult.error) throw new Error(keysResult.error.message);

  const keys = (keysResult.data ?? []) as unknown as WebhookKeyRow[];
  if (keys.length === 0) {
    return [await buildConnection(supabase, {
      id: 'webhook',
      provider: 'webhook',
      name: 'Webhook intake',
      configured: false,
      paused: false,
      configuredAt: null,
      row: null,
      configuration: {
        endpointPath: '/api/webhooks/inbound',
        secretStored: false,
        sourceName: null,
        apiKeyId: null,
      },
    }, now)];
  }

  const rowByKey = new Map(rows.map((row) => [row.api_key_id, row]));
  return Promise.all(keys.map((key) => {
    const row = rowByKey.get(key.id) ?? null;
    const source = relationToOne(key.lead_sources);
    return buildConnection(supabase, {
      id: row?.id ?? `webhook:${key.id}`,
      provider: 'webhook',
      name: key.name,
      configured: true,
      paused: !key.is_active || !!row?.is_paused,
      configuredAt: row?.configured_at ?? key.created_at,
      row,
      configuration: {
        endpointPath: '/api/webhooks/inbound',
        secretStored: true,
        sourceName: source?.display_name ?? null,
        apiKeyId: key.id,
      },
    }, now);
  }));
}

/** Singleton email-import adapter. Sender addresses are configuration, not run metadata. */
export async function loadEmailImportConnection(
  supabase: SupabaseClient,
  now = new Date()
): Promise<IntegrationConnection> {
  const [settingsResult, rows] = await Promise.all([
    supabase
      .from('app_settings')
      .select('email_import_enabled, allowed_sender_emails, updated_at')
      .eq('id', 'default')
      .single(),
    providerRows(supabase, 'email_import'),
  ]);
  if (settingsResult.error) throw new Error(settingsResult.error.message);

  const settings = settingsResult.data as {
    email_import_enabled: boolean | null;
    allowed_sender_emails: string[] | null;
    updated_at: string | null;
  };
  const row = rows[0] ?? null;
  const allowedSenderEmails = settings.allowed_sender_emails ?? [];
  const configured = !!row || !!settings.email_import_enabled || allowedSenderEmails.length > 0;
  return buildConnection(supabase, {
    id: row?.id ?? 'email_import',
    provider: 'email_import',
    name: row?.name ?? 'Email import',
    configured,
    paused: configured && !settings.email_import_enabled,
    configuredAt: row?.configured_at ?? (configured ? settings.updated_at : null),
    row,
    configuration: {
      endpointPath: '/api/webhooks/email',
      enabled: !!settings.email_import_enabled,
      allowedSenderEmails,
      allowedSenderCount: allowedSenderEmails.length,
    },
  }, now);
}

/** Singleton Regrid adapter. Only the presence of the stored secret is returned. */
export async function loadRegridConnection(
  supabase: SupabaseClient,
  now = new Date()
): Promise<IntegrationConnection> {
  const [settingsResult, rows] = await Promise.all([
    supabase
      .from('app_settings')
      .select('regrid_api_key, auto_enrich_enabled, updated_at')
      .eq('id', 'default')
      .single(),
    providerRows(supabase, 'regrid'),
  ]);
  if (settingsResult.error) throw new Error(settingsResult.error.message);

  const settings = settingsResult.data as {
    regrid_api_key: string | null;
    auto_enrich_enabled: boolean | null;
    updated_at: string | null;
  };
  const row = rows[0] ?? null;
  const configured = !!settings.regrid_api_key?.trim();
  return buildConnection(supabase, {
    id: row?.id ?? 'regrid',
    provider: 'regrid',
    name: row?.name ?? 'Regrid property enrichment',
    configured,
    paused: configured && !settings.auto_enrich_enabled,
    configuredAt: row?.configured_at ?? (configured ? settings.updated_at : null),
    row,
    configuration: {
      secretStored: configured,
      autoEnrichEnabled: !!settings.auto_enrich_enabled,
    },
  }, now);
}

export async function saveSingletonConnection(
  supabase: SupabaseClient,
  input: {
    provider: 'email_import' | 'regrid';
    name: string;
    paused: boolean;
    expectedCadenceMinutes?: number | null;
  }
): Promise<string> {
  const existing = await supabase
    .from('integration_connections')
    .select('id, expected_cadence_minutes')
    .eq('provider', input.provider)
    .is('api_key_id', null)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const values = {
    name: input.name,
    is_paused: input.paused,
    ...(input.expectedCadenceMinutes !== undefined
      ? { expected_cadence_minutes: input.expectedCadenceMinutes }
      : {}),
  };
  if (existing.data) {
    const updated = await supabase
      .from('integration_connections')
      .update(values)
      .eq('id', existing.data.id)
      .select('id')
      .single();
    if (updated.error || !updated.data) throw new Error(updated.error?.message || 'Connection was not updated');
    return updated.data.id;
  }

  const inserted = await supabase
    .from('integration_connections')
    .insert({ provider: input.provider, api_key_id: null, ...values })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || 'Connection was not created');
  return inserted.data.id;
}

export async function saveWebhookConnection(
  supabase: SupabaseClient,
  input: {
    apiKeyId: string;
    name: string;
    paused: boolean;
    configuredAt?: string;
    expectedCadenceMinutes?: number | null;
  }
): Promise<string> {
  const existing = await supabase
    .from('integration_connections')
    .select('id')
    .eq('api_key_id', input.apiKeyId)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const values = {
    name: input.name,
    is_paused: input.paused,
    ...(input.expectedCadenceMinutes !== undefined
      ? { expected_cadence_minutes: input.expectedCadenceMinutes }
      : {}),
  };
  if (existing.data) {
    const updated = await supabase
      .from('integration_connections')
      .update(values)
      .eq('id', existing.data.id)
      .select('id')
      .single();
    if (updated.error || !updated.data) throw new Error(updated.error?.message || 'Connection was not updated');
    return updated.data.id;
  }

  const inserted = await supabase
    .from('integration_connections')
    .insert({
      provider: 'webhook',
      api_key_id: input.apiKeyId,
      configured_at: input.configuredAt ?? new Date().toISOString(),
      ...values,
    })
    .select('id')
    .single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || 'Connection was not created');
  return inserted.data.id;
}

export interface RecordIntegrationRunInput {
  provider: IntegrationProvider;
  apiKeyId?: string | null;
  name: string;
  status: IntegrationRunStatus;
  itemsReceived?: number;
  itemsSucceeded?: number;
  itemsFailed?: number;
  error?: unknown;
  metadata?: Record<string, string | number | boolean | null>;
  startedAt?: string;
}

/**
 * Record provider health without making intake depend on the health console.
 * Callers decide whether a recording failure should be logged; lead creation
 * must not be rolled back because observability is temporarily unavailable.
 */
export async function recordIntegrationRun(
  supabase: SupabaseClient,
  input: RecordIntegrationRunInput
): Promise<string> {
  const { data, error } = await supabase.rpc('record_integration_run', {
    p_provider: input.provider,
    p_api_key_id: input.apiKeyId ?? null,
    p_name: input.name,
    p_status: input.status,
    p_items_received: input.itemsReceived ?? 0,
    p_items_succeeded: input.itemsSucceeded ?? 0,
    p_items_failed: input.itemsFailed ?? 0,
    p_error_summary: safeIntegrationError(input.error),
    p_metadata: input.metadata ?? {},
    p_started_at: input.startedAt ?? new Date().toISOString(),
  });

  if (error || typeof data !== 'string') {
    throw new Error(error?.message || 'Integration health receipt was not created');
  }
  return data;
}

/** Health persistence must never make lead intake fail. */
export async function recordIntegrationRunSafely(
  supabase: SupabaseClient,
  input: RecordIntegrationRunInput
): Promise<boolean> {
  try {
    await recordIntegrationRun(supabase, input);
    return true;
  } catch (error) {
    console.error('Integration health recording failed:', safeIntegrationError(error));
    return false;
  }
}
