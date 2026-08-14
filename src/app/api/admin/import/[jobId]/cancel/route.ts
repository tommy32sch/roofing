import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import {
  canMutateImportJob,
  importJobView,
  loadImportJob,
} from '@/lib/leads/import-job.server';
import { db } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/utils/validation';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }
  const { jobId } = await params;
  if (!isValidUUID(jobId)) {
    return NextResponse.json({ success: false, error: 'Invalid import ID' }, { status: 400 });
  }

  const supabase = db();
  const loaded = await loadImportJob(supabase, jobId);
  if (loaded.error) {
    return NextResponse.json({ success: false, error: loaded.error }, { status: 500 });
  }
  if (!loaded.job) {
    return NextResponse.json({ success: false, error: 'Import not found' }, { status: 404 });
  }
  if (!canMutateImportJob(admin, loaded.job)) {
    return NextResponse.json({ success: false, error: 'Only the uploader can cancel this import' }, { status: 403 });
  }
  if (loaded.job.status === 'cancelled') {
    return NextResponse.json({ success: true, idempotent: true, job: importJobView(loaded.job) });
  }
  if (loaded.job.status !== 'uploaded' && loaded.job.status !== 'review_ready') {
    return NextResponse.json(
      { success: false, error: 'This import can no longer be cancelled' },
      { status: 409 }
    );
  }

  let fileDeletedAt: string | null = null;
  if (loaded.job.storage_bucket && loaded.job.storage_path && !loaded.job.file_deleted_at) {
    const removed = await supabase.storage
      .from(loaded.job.storage_bucket)
      .remove([loaded.job.storage_path]);
    if (!removed.error) fileDeletedAt = new Date().toISOString();
  }

  const cancelledAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('lead_import_batches')
    .update({
      status: 'cancelled',
      cancelled_at: cancelledAt,
      file_deleted_at: fileDeletedAt ?? loaded.job.file_deleted_at,
    })
    .eq('id', jobId)
    .in('status', ['uploaded', 'review_ready'])
    .select('*')
    .maybeSingle();
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'Import state changed; reload and try again' }, { status: 409 });
  }

  const refreshed = await loadImportJob(supabase, jobId);
  if (refreshed.error || !refreshed.job) {
    return NextResponse.json({ success: false, error: refreshed.error || 'Import not found' }, { status: 500 });
  }
  return NextResponse.json({ success: true, job: importJobView(refreshed.job) });
}
