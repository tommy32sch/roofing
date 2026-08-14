import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import {
  canViewImportJob,
  importJobView,
  loadImportJob,
} from '@/lib/leads/import-job.server';
import { db } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/utils/validation';

export async function GET(
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

  const result = await loadImportJob(db(), jobId);
  if (result.error) {
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  }
  if (!result.job) {
    return NextResponse.json({ success: false, error: 'Import not found' }, { status: 404 });
  }
  if (!canViewImportJob(admin, result.job)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ success: true, job: importJobView(result.job) });
}
