import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthenticatedAdmin } from '@/lib/auth/jwt';
import {
  ImportJobError,
  importFileHash,
  processingCanResume,
  type ImportColumnMapping,
  type ImportJobStatus,
  type ImportJobView,
  type ImportPreviewSample,
  type ImportPreviewSummary,
  type ParsedImportFile,
} from '@/lib/leads/import-job';

export const IMPORT_JOB_SELECT = [
  'id',
  'status',
  'filename',
  'uploaded_by',
  'uploaded_by_name',
  'uploaded_by_role',
  'market_id',
  'storage_bucket',
  'storage_path',
  'file_hash',
  'file_size_bytes',
  'content_type',
  'source_columns',
  'field_mappings',
  'preview_summary',
  'preview_sample',
  'preview_errors',
  'confirmation_plan_ready',
  'row_count',
  'imported_count',
  'skipped_count',
  'duplicate_count',
  'dnc_count',
  'failure_code',
  'failure_detail',
  'created_at',
  'updated_at',
  'confirmed_at',
  'processing_started_at',
  'completed_at',
  'cancelled_at',
  'retention_expires_at',
  'file_deleted_at',
  'market:markets!market_id(name)',
].join(', ');

const IMPORT_JOB_INTERNAL_SELECT = `${IMPORT_JOB_SELECT}, confirmation_plan`;

export interface ImportJobDbRow {
  id: string;
  status: ImportJobStatus;
  filename: string;
  uploaded_by: string | null;
  uploaded_by_name: string;
  uploaded_by_role: 'admin' | 'setter' | 'closer' | null;
  market_id: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  file_hash: string | null;
  file_size_bytes: number | null;
  content_type: string | null;
  source_columns: unknown;
  field_mappings: unknown;
  preview_summary: unknown;
  preview_sample: unknown;
  preview_errors: unknown;
  confirmation_plan: unknown;
  confirmation_plan_ready: boolean;
  row_count: number;
  imported_count: number;
  skipped_count: number;
  duplicate_count: number;
  dnc_count: number;
  failure_code: string | null;
  failure_detail: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  processing_started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  retention_expires_at: string | null;
  file_deleted_at: string | null;
  market?: { name?: string | null } | { name?: string | null }[] | null;
}

function objectOrNull<T>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as T : null;
}

function arrayOrEmpty<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function importJobView(row: ImportJobDbRow): ImportJobView {
  const market = Array.isArray(row.market) ? row.market[0] : row.market;
  return {
    id: row.id,
    status: row.status,
    filename: row.filename,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    marketId: row.market_id,
    marketName: market?.name || null,
    fileSizeBytes: row.file_size_bytes,
    sourceColumns: arrayOrEmpty<string>(row.source_columns),
    fieldMappings: arrayOrEmpty<ImportColumnMapping>(row.field_mappings),
    preview: objectOrNull<ImportPreviewSummary>(row.preview_summary),
    sample: arrayOrEmpty<ImportPreviewSample>(row.preview_sample),
    errors: arrayOrEmpty<string>(row.preview_errors),
    imported: row.imported_count || 0,
    skipped: row.skipped_count || 0,
    duplicates: row.duplicate_count || 0,
    dnc: row.dnc_count || 0,
    failureCode: row.failure_code,
    failureDetail: row.failure_detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    processingStartedAt: row.processing_started_at,
    canRetryConfirmation:
      (row.status === 'failed' && row.confirmation_plan_ready)
      || (row.status === 'processing' && processingCanResume(row.processing_started_at)),
    retentionExpiresAt: row.retention_expires_at,
    fileDeletedAt: row.file_deleted_at,
  };
}

export async function loadImportJob(
  supabase: SupabaseClient,
  jobId: string,
  options: { includeConfirmationPlan?: boolean } = {}
): Promise<{ job: ImportJobDbRow | null; error: string | null }> {
  const { data, error } = await supabase
    .from('lead_import_batches')
    .select(options.includeConfirmationPlan ? IMPORT_JOB_INTERNAL_SELECT : IMPORT_JOB_SELECT)
    .eq('id', jobId)
    .maybeSingle();
  return {
    job: data ? data as unknown as ImportJobDbRow : null,
    error: error?.message || null,
  };
}

export function canViewImportJob(admin: AuthenticatedAdmin, job: ImportJobDbRow): boolean {
  return admin.role === 'admin' || job.uploaded_by === admin.sub;
}

/** Only the uploader can confirm or cancel; this preserves its attribution and role assignment. */
export function canMutateImportJob(admin: AuthenticatedAdmin, job: ImportJobDbRow): boolean {
  return job.uploaded_by === admin.sub;
}

export async function downloadImportFile(
  supabase: SupabaseClient,
  job: ImportJobDbRow
): Promise<Uint8Array> {
  if (!job.storage_bucket || !job.storage_path || job.file_deleted_at) {
    throw new ImportJobError('source_file_unavailable', 'The source file is no longer available.', 409);
  }
  const { data, error } = await supabase.storage.from(job.storage_bucket).download(job.storage_path);
  if (error || !data) {
    throw new ImportJobError(
      'source_file_unavailable',
      'The source file could not be read. Replace the file and try again.',
      409
    );
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!job.file_hash || importFileHash(bytes) !== job.file_hash) {
    throw new ImportJobError(
      'file_hash_mismatch',
      'The stored file failed its integrity check. Replace the file and try again.',
      409
    );
  }
  return bytes;
}

export async function markImportJobFailed(
  supabase: SupabaseClient,
  jobId: string,
  error: unknown,
  expectedStatus?: ImportJobStatus
): Promise<void> {
  const code = error instanceof ImportJobError ? error.code : 'processing_failed';
  const message = error instanceof Error ? error.message : 'Import processing failed.';
  const updates: Record<string, unknown> = {
    status: 'failed',
    failed_at: new Date().toISOString(),
    failure_code: code.slice(0, 100),
    failure_detail: message.slice(0, 1000),
  };
  if (expectedStatus === 'processing') {
    try {
      const [all, duplicates, dnc] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('import_batch_id', jobId),
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .eq('import_batch_id', jobId).eq('is_flagged_duplicate', true),
        supabase.from('leads').select('id', { count: 'exact', head: true })
          .eq('import_batch_id', jobId).eq('is_dnc', true),
      ]);
      if (!all.error && all.count != null) updates.imported_count = all.count;
      if (!duplicates.error && duplicates.count != null) updates.duplicate_count = duplicates.count;
      if (!dnc.error && dnc.count != null) updates.dnc_count = dnc.count;
    } catch {
      // Failure recording must not depend on the optional partial-count read.
    }
  }
  let query = supabase
    .from('lead_import_batches')
    .update(updates)
    .eq('id', jobId);
  if (expectedStatus) query = query.eq('status', expectedStatus);
  const { error: updateError } = await query;
  if (updateError) throw new Error(updateError.message);
}

export async function resolveImportMarket(
  supabase: SupabaseClient,
  requestedMarketId: number | null
): Promise<number | null> {
  const { data, error } = await supabase
    .from('markets')
    .select('id')
    .eq('is_active', true)
    .order('sort_order')
    .order('name');
  if (error) throw new ImportJobError('markets_unavailable', 'Office data is unavailable.', 503);
  const markets = (data || []) as { id: number }[];
  if (requestedMarketId != null && !markets.some((market) => market.id === requestedMarketId)) {
    throw new ImportJobError('invalid_market', 'Select an active market.', 400);
  }
  if (requestedMarketId == null && markets.length > 1) {
    throw new ImportJobError('market_required', 'Select the market for this file.', 400);
  }
  return requestedMarketId ?? markets[0]?.id ?? null;
}

/**
 * Remove a bounded set of expired private files. Cleanup failure does not block
 * current work; a later page load retries it. Receipts remain in the database.
 */
export async function cleanupExpiredImportFiles(
  supabase: SupabaseClient,
  now = new Date()
): Promise<number> {
  const { data, error } = await supabase
    .from('lead_import_batches')
    .select('id, status, storage_bucket, storage_path')
    .lt('retention_expires_at', now.toISOString())
    .is('file_deleted_at', null)
    .not('storage_path', 'is', null)
    .neq('status', 'processing')
    .limit(50);
  if (error || !data) return 0;

  let removed = 0;
  for (const row of data as {
    id: string;
    status: ImportJobStatus;
    storage_bucket: string | null;
    storage_path: string | null;
  }[]) {
    if (!row.storage_bucket || !row.storage_path) continue;
    const result = await supabase.storage.from(row.storage_bucket).remove([row.storage_path]);
    if (result.error) continue;
    const timestamp = now.toISOString();
    const updates: Record<string, unknown> = { file_deleted_at: timestamp };
    if (row.status === 'uploaded' || row.status === 'review_ready') {
      Object.assign(updates, {
        status: 'cancelled',
        cancelled_at: timestamp,
        failure_code: 'source_file_expired',
        failure_detail: 'The private source file expired after 30 days.',
      });
    } else if (row.status === 'failed') {
      Object.assign(updates, {
        confirmation_plan: null,
        confirmation_plan_ready: false,
        failure_code: 'source_file_expired',
        failure_detail: 'The private source file expired after 30 days. Upload the file again.',
      });
    }
    const { error: updateError } = await supabase
      .from('lead_import_batches')
      .update(updates)
      .eq('id', row.id);
    if (!updateError) removed++;
  }
  return removed;
}

export function previewDatabaseValues(
  parsed: ParsedImportFile,
  preview: {
    summary: ImportPreviewSummary;
    sample: ImportPreviewSample[];
    errors: string[];
  }
): Record<string, unknown> {
  return {
    status: 'review_ready',
    row_count: preview.summary.totalRows,
    skipped_count: parsed.skipped,
    source_columns: parsed.sourceColumns,
    field_mappings: parsed.fieldMappings,
    preview_summary: preview.summary,
    preview_sample: preview.sample,
    preview_errors: preview.errors,
    duplicate_count: preview.summary.duplicateCandidates,
    dnc_count: preview.summary.dncOnlyRows,
    failure_code: null,
    failure_detail: null,
    failed_at: null,
    confirmation_plan_ready: false,
  };
}

export function storageContentType(filename: string, provided: string | null | undefined): string {
  if (provided?.trim()) return provided.slice(0, 200);
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}
