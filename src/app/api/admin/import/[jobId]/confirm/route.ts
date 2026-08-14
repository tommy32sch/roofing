import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { assignImportDuplicates } from '@/lib/leads/dedupe';
import {
  assignmentsFromConfirmationPlan,
  confirmationPlan,
  createImportPreview,
  ImportJobError,
  importActivityId,
  importLeadId,
  importPreviewMatches,
  parseImportFile,
  processingCanResume,
} from '@/lib/leads/import-job';
import {
  canMutateImportJob,
  downloadImportFile,
  importJobView,
  loadImportJob,
  markImportJobFailed,
  previewDatabaseValues,
} from '@/lib/leads/import-job.server';
import { assignmentForNewLead } from '@/lib/leads/lead-visibility';
import { db } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/utils/validation';

export const maxDuration = 60;

function errorResponse(error: unknown) {
  if (error instanceof ImportJobError) {
    return NextResponse.json(
      { success: false, error: error.message, code: error.code },
      { status: error.status }
    );
  }
  return NextResponse.json(
    {
      success: false,
      error: error instanceof Error ? error.message : 'Confirmation failed',
      code: 'processing_failed',
    },
    { status: 500 }
  );
}

async function reloadResponse(jobId: string, status = 200) {
  const loaded = await loadImportJob(db(), jobId);
  if (loaded.error || !loaded.job) {
    return NextResponse.json(
      { success: false, error: loaded.error || 'Import not found' },
      { status: loaded.error ? 500 : 404 }
    );
  }
  return NextResponse.json({ success: true, job: importJobView(loaded.job) }, { status });
}

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
  const loaded = await loadImportJob(supabase, jobId, { includeConfirmationPlan: true });
  if (loaded.error) {
    return NextResponse.json({ success: false, error: loaded.error }, { status: 500 });
  }
  if (!loaded.job) {
    return NextResponse.json({ success: false, error: 'Import not found' }, { status: 404 });
  }
  if (!canMutateImportJob(admin, loaded.job)) {
    return NextResponse.json({ success: false, error: 'Only the uploader can confirm this import' }, { status: 403 });
  }
  if (loaded.job.status === 'completed') {
    return NextResponse.json({
      success: true,
      idempotent: true,
      job: importJobView(loaded.job),
    });
  }
  if (loaded.job.status === 'cancelled' || loaded.job.status === 'uploaded') {
    return NextResponse.json(
      { success: false, error: 'This import is not ready for confirmation' },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  let job = loaded.job;
  try {
    if (job.status === 'processing' && !processingCanResume(job.processing_started_at)) {
      return NextResponse.json(
        { success: true, pending: true, job: importJobView(job) },
        { status: 202 }
      );
    }

    if (job.status === 'failed' && !job.confirmation_plan) {
      return NextResponse.json(
        { success: false, error: job.failure_detail || 'Replace the file and try again' },
        { status: 409 }
      );
    }

    const claimFrom = job.status;
    let claim = supabase
      .from('lead_import_batches')
      .update({
        status: 'processing',
        processing_started_at: now,
        confirmed_by: admin.sub,
        confirmed_by_name: admin.name?.trim() || admin.email,
        confirmed_at: job.confirmed_at || now,
        failed_at: null,
        failure_code: null,
        failure_detail: null,
      })
      .eq('id', jobId)
      .eq('status', claimFrom);
    if (claimFrom === 'processing' && job.processing_started_at) {
      claim = claim.eq('processing_started_at', job.processing_started_at);
    } else if (claimFrom === 'processing') {
      claim = claim.is('processing_started_at', null);
    }
    const { data: claimed, error: claimError } = await claim.select('id').maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) return reloadResponse(jobId, 202);

    const claimedJob = await loadImportJob(supabase, jobId, { includeConfirmationPlan: true });
    if (claimedJob.error || !claimedJob.job) {
      throw new Error(claimedJob.error || 'Import job disappeared after confirmation');
    }
    job = claimedJob.job;

    const bytes = await downloadImportFile(supabase, job);
    const parsed = parseImportFile(bytes, job.filename);
    const leadsWithIds = parsed.leads.map((lead, index) => ({
      ...lead,
      id: importLeadId(jobId, index),
    }));
    const expectedIds = leadsWithIds.map((lead) => lead.id);
    let assigned = assignmentsFromConfirmationPlan(job.confirmation_plan, expectedIds);

    if (job.confirmation_plan && !assigned) {
      throw new ImportJobError(
        'confirmation_plan_invalid',
        'The saved confirmation plan is invalid. Cancel this import and upload the file again.',
        409
      );
    }

    if (!assigned) {
      assigned = await assignImportDuplicates(supabase, leadsWithIds);
      const currentPreview = createImportPreview(jobId, parsed, assigned);
      const storedPreview = job.preview_summary && typeof job.preview_summary === 'object'
        ? job.preview_summary as Parameters<typeof importPreviewMatches>[0]
        : null;
      if (!importPreviewMatches(storedPreview, currentPreview.summary)) {
        const { error: changedError } = await supabase
          .from('lead_import_batches')
          .update({
            ...previewDatabaseValues(parsed, currentPreview),
            processing_started_at: null,
            confirmed_by: null,
            confirmed_by_name: null,
            confirmed_at: null,
            confirmation_plan: null,
          })
          .eq('id', jobId)
          .eq('status', 'processing');
        if (changedError) throw new Error(changedError.message);
        const refreshed = await loadImportJob(supabase, jobId);
        return NextResponse.json(
          {
            success: false,
            code: 'review_changed',
            error: 'Duplicate conditions changed. Review the updated counts before confirming.',
            job: refreshed.job ? importJobView(refreshed.job) : undefined,
          },
          { status: 409 }
        );
      }

      const { error: planError } = await supabase
        .from('lead_import_batches')
        .update({
          confirmation_plan: confirmationPlan(assigned),
          confirmation_plan_ready: true,
        })
        .eq('id', jobId)
        .eq('status', 'processing');
      if (planError) throw new Error(planError.message);
    }

    const uploaderRole = job.uploaded_by_role;
    if (!job.uploaded_by || !uploaderRole) {
      throw new ImportJobError(
        'uploader_unavailable',
        'The uploader account is no longer available. Cancel this import.',
        409
      );
    }
    const assignment = assignmentForNewLead({ id: job.uploaded_by, role: uploaderRole });
    const annotatedLeads = leadsWithIds.map((lead) => {
      const duplicateOfId = assigned!.get(lead.id) ?? null;
      return {
        ...lead,
        market_id: job.market_id,
        ...assignment,
        created_by: job.uploaded_by,
        created_by_name: job.uploaded_by_name,
        import_batch_id: jobId,
        is_flagged_duplicate: duplicateOfId !== null,
        duplicate_of_id: duplicateOfId,
      };
    });

    const batchSize = 100;
    for (let i = 0; i < annotatedLeads.length; i += batchSize) {
      const batch = annotatedLeads.slice(i, i + batchSize);
      const ids = batch.map((lead) => lead.id);
      const { data: existing, error: existingError } = await supabase
        .from('leads')
        .select('id, import_batch_id')
        .in('id', ids);
      if (existingError) throw new Error(existingError.message);
      if ((existing || []).some((lead) => lead.import_batch_id !== jobId)) {
        throw new ImportJobError(
          'lead_id_collision',
          'A generated lead ID conflicts with another import. Cancel this import and upload it again.',
          409
        );
      }

      const { error: insertError } = await supabase
        .from('leads')
        .upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
      if (insertError) throw new Error(`Lead batch ${Math.floor(i / batchSize) + 1}: ${insertError.message}`);

      const activities = batch.map((lead, offset) => ({
        id: importActivityId(jobId, i + offset),
        lead_id: lead.id,
        activity_type: 'created' as const,
        content: lead.is_dnc
          ? 'Imported from CSV (flagged Do Not Call)'
          : lead.is_flagged_duplicate
            ? 'Imported from CSV (flagged as duplicate)'
            : 'Imported from CSV',
        created_by: job.uploaded_by,
      }));
      const { error: activityError } = await supabase
        .from('lead_activities')
        .upsert(activities, { onConflict: 'id', ignoreDuplicates: true });
      if (activityError) {
        throw new Error(`Activity batch ${Math.floor(i / batchSize) + 1}: ${activityError.message}`);
      }
    }

    const imported = annotatedLeads.length;
    const duplicates = annotatedLeads.filter((lead) => lead.is_flagged_duplicate).length;
    const dnc = annotatedLeads.filter((lead) => lead.is_dnc).length;
    const completedAt = new Date().toISOString();
    const { data: completed, error: completeError } = await supabase
      .from('lead_import_batches')
      .update({
        status: 'completed',
        imported_count: imported,
        skipped_count: parsed.skipped,
        duplicate_count: duplicates,
        dnc_count: dnc,
        preview_errors: parsed.errors.slice(0, 25),
        completed_at: completedAt,
        confirmation_plan: null,
        confirmation_plan_ready: false,
        failure_code: null,
        failure_detail: null,
      })
      .eq('id', jobId)
      .eq('status', 'processing')
      .select('id')
      .maybeSingle();
    if (completeError) throw new Error(completeError.message);
    if (!completed) throw new Error('Import completion claim was lost');

    return reloadResponse(jobId);
  } catch (error) {
    try {
      await markImportJobFailed(supabase, jobId, error, 'processing');
    } catch {
      // Return the original failure if the receipt cannot be updated.
    }
    return errorResponse(error);
  }
}
