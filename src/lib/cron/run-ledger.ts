import type { SupabaseClient } from '@supabase/supabase-js';
import type { CronLock } from './lock';

export type ScheduledJobTerminalStatus = 'succeeded' | 'failed' | 'skipped';

export interface ScheduledJobCompletion {
  status: ScheduledJobTerminalStatus;
  summary?: Record<string, unknown>;
  error?: string;
}

export type ScheduledJobResult<T extends Record<string, unknown>> =
  | {
      success: true;
      skipped: true;
      reason: 'already_running';
      lock_backend: CronLock['backend'];
    }
  | ({
      success: true;
      skipped: false;
      lock_backend: CronLock['backend'];
    } & T);

const JOB_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Record an authenticated scheduled-job invocation before it does any work.
 *
 * This intentionally fails the invocation when the ledger cannot be written:
 * silently doing work without durable execution evidence recreates the exact
 * operational blind spot this table exists to remove. Scheduled work is
 * idempotent, so Vercel may safely retry a failed invocation.
 */
export async function beginScheduledJobRun(
  supabase: SupabaseClient,
  jobName: string
): Promise<string> {
  if (!JOB_NAME.test(jobName)) throw new Error('Invalid scheduled job name');

  const { data, error } = await supabase
    .from('scheduled_job_runs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`Could not start scheduled job ledger: ${error?.message ?? 'missing run id'}`);
  }
  return String(data.id);
}

/** Finish one ledger row exactly once with a bounded operational summary. */
export async function finishScheduledJobRun(
  supabase: SupabaseClient,
  runId: string,
  completion: ScheduledJobCompletion
): Promise<void> {
  const { data, error } = await supabase
    .from('scheduled_job_runs')
    .update({
      status: completion.status,
      finished_at: new Date().toISOString(),
      summary: completion.summary ?? null,
      error: completion.error?.slice(0, 2000) ?? null,
    })
    .eq('id', runId)
    .eq('status', 'running')
    .select('id')
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(
      `Could not finish scheduled job ledger: ${error?.message ?? 'run was not pending'}`
    );
  }
}

/**
 * Execute one idempotent scheduled job behind its lock and durable ledger.
 * Routes share this orchestration so a future job cannot accidentally omit
 * execution evidence or treat an overlapping invocation differently.
 */
export async function executeScheduledJob<T extends Record<string, unknown>>(options: {
  supabase: SupabaseClient;
  jobName: string;
  acquireLock: () => Promise<CronLock>;
  work: () => Promise<T>;
}): Promise<ScheduledJobResult<T>> {
  const runId = await beginScheduledJobRun(options.supabase, options.jobName);
  let lock: CronLock | undefined;

  try {
    lock = await options.acquireLock();
    if (!lock.acquired) {
      await finishScheduledJobRun(options.supabase, runId, {
        status: 'skipped',
        summary: { reason: 'already_running', lock_backend: lock.backend },
      });
      return {
        success: true,
        skipped: true,
        reason: 'already_running',
        lock_backend: lock.backend,
      };
    }

    const result = await options.work();
    await finishScheduledJobRun(options.supabase, runId, {
      status: 'succeeded',
      summary: { lock_backend: lock.backend, ...result },
    });
    return {
      success: true,
      skipped: false,
      lock_backend: lock.backend,
      ...result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduled job failed';
    try {
      await finishScheduledJobRun(options.supabase, runId, {
        status: 'failed',
        error: message,
      });
    } catch (ledgerError) {
      console.error('[scheduled-job-ledger]', ledgerError);
    }
    throw error;
  } finally {
    if (lock?.acquired) await lock.release();
  }
}
