import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { assignImportDuplicates } from '@/lib/leads/dedupe';
import {
  createImportPreview,
  IMPORT_STORAGE_BUCKET,
  ImportJobError,
  importFileHash,
  importLeadId,
  importRetentionExpiry,
  importStoragePath,
  parseImportFile,
  validateImportFilename,
} from '@/lib/leads/import-job';
import {
  cleanupExpiredImportFiles,
  IMPORT_JOB_SELECT,
  importJobView,
  loadImportJob,
  markImportJobFailed,
  previewDatabaseValues,
  resolveImportMarket,
  storageContentType,
  type ImportJobDbRow,
} from '@/lib/leads/import-job.server';
import { db } from '@/lib/supabase/server';
import { checkConfiguredRateLimit } from '@/lib/utils/rate-limit';
import { LIMITS } from '@/lib/utils/validation';

function requestError(error: unknown, fallback = 'Import failed', job?: ReturnType<typeof importJobView>) {
  if (error instanceof ImportJobError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code, job },
      { status: error.status }
    );
  }
  return NextResponse.json({ success: false, error: fallback, job }, { status: 500 });
}

function requestedMarket(formData: FormData): number | null {
  const value = formData.get('market_id');
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ImportJobError('invalid_market', 'Select a valid market.');
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ImportJobError('invalid_market', 'Select a valid market.');
  }
  return parsed;
}

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const supabase = db();
    await cleanupExpiredImportFiles(supabase).catch(() => 0);
    const query = supabase
      .from('lead_import_batches')
      .select(IMPORT_JOB_SELECT)
      .eq('uploaded_by', admin.sub)
      .order('created_at', { ascending: false })
      .limit(20);
    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      jobs: (data || []).map((row) => importJobView(row as unknown as ImportJobDbRow)),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Could not load recent imports' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }

  // Bound spreadsheet parsing per account before reading the multipart body.
  const rateLimit = await checkConfiguredRateLimit(admin.sub, 'lead-import', 5, '10 m');
  if (!rateLimit.success) {
    const retryAfter = Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000));
    return NextResponse.json(
      { success: false, error: 'Import limit reached. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  let jobId: string | null = null;
  try {
    const formData = await request.formData();
    const fileValue = formData.get('file');
    if (!fileValue || typeof fileValue === 'string' || typeof fileValue.arrayBuffer !== 'function') {
      throw new ImportJobError('file_required', 'Select a file to upload.');
    }
    const filename = fileValue.name.trim();
    if (!filename) throw new ImportJobError('file_required', 'Select a file to upload.');
    if (filename.length > 255) {
      throw new ImportJobError('filename_too_long', 'The file name must be 255 characters or fewer.');
    }
    validateImportFilename(filename);
    if (fileValue.size > LIMITS.CSV_FILE_SIZE) {
      throw new ImportJobError('file_too_large', 'The file is larger than the 5 MB limit.');
    }

    const bytes = new Uint8Array(await fileValue.arrayBuffer());
    if (bytes.byteLength > LIMITS.CSV_FILE_SIZE) {
      throw new ImportJobError('file_too_large', 'The file is larger than the 5 MB limit.');
    }

    const supabase = db();
    const marketId = await resolveImportMarket(supabase, requestedMarket(formData));
    jobId = randomUUID();
    const storagePath = importStoragePath(admin.sub, jobId, filename);
    const contentType = storageContentType(filename, fileValue.type);
    const uploaderName = admin.name?.trim() || admin.email;
    const { error: createError } = await supabase
      .from('lead_import_batches')
      .insert({
        id: jobId,
        status: 'uploaded',
        filename,
        uploaded_by: admin.sub,
        uploaded_by_name: uploaderName,
        uploaded_by_role: admin.role,
        market_id: marketId,
        storage_bucket: IMPORT_STORAGE_BUCKET,
        storage_path: storagePath,
        file_hash: importFileHash(bytes),
        file_size_bytes: bytes.byteLength,
        content_type: contentType,
        retention_expires_at: importRetentionExpiry(),
      });
    if (createError) throw new Error(createError.message);

    const upload = await supabase.storage.from(IMPORT_STORAGE_BUCKET).upload(storagePath, bytes, {
      contentType,
      upsert: false,
    });
    if (upload.error) {
      throw new ImportJobError(
        'file_storage_failed',
        'The private source file could not be stored. Try the upload again.',
        500
      );
    }

    const parsed = parseImportFile(bytes, filename);
    const leadsWithIds = parsed.leads.map((lead, index) => ({
      ...lead,
      id: importLeadId(jobId!, index),
    }));
    const assigned = await assignImportDuplicates(supabase, leadsWithIds);
    const preview = createImportPreview(jobId, parsed, assigned);
    const { error: previewError } = await supabase
      .from('lead_import_batches')
      .update(previewDatabaseValues(parsed, preview))
      .eq('id', jobId)
      .eq('status', 'uploaded');
    if (previewError) throw new Error(previewError.message);

    const { data: job, error: loadError } = await supabase
      .from('lead_import_batches')
      .select(IMPORT_JOB_SELECT)
      .eq('id', jobId)
      .single();
    if (loadError || !job) throw new Error(loadError?.message || 'Import job was not saved');

    await cleanupExpiredImportFiles(supabase).catch(() => 0);
    return NextResponse.json(
      { success: true, job: importJobView(job as unknown as ImportJobDbRow) },
      { status: 201 }
    );
  } catch (error) {
    let failedJob: ReturnType<typeof importJobView> | undefined;
    if (jobId) {
      try {
        const supabase = db();
        await markImportJobFailed(supabase, jobId, error, 'uploaded');
        const loaded = await loadImportJob(supabase, jobId);
        if (loaded.job) failedJob = importJobView(loaded.job);
      } catch {
        // Preserve the original, actionable response when failure recording is unavailable.
      }
    }
    return requestError(error, 'The file could not be prepared for review.', failedJob);
  }
}
