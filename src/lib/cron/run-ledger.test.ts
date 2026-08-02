import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beginScheduledJobRun, executeScheduledJob, finishScheduledJobRun } from './run-ledger';

function beginClient(result: { data: { id: string } | null; error: { message: string } | null }) {
  const single = vi.fn(async () => result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

function finishClient(error: { message: string } | null = null) {
  const maybeSingle = vi.fn(async () => ({ data: error ? null : { id: 'run-id' }, error }));
  const select = vi.fn(() => ({ maybeSingle }));
  const terminalEq = vi.fn(() => ({ select }));
  const firstEq = vi.fn(() => ({ eq: terminalEq }));
  const update = vi.fn(() => ({ eq: firstEq }));
  const from = vi.fn(() => ({ update }));
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    update,
    firstEq,
    terminalEq,
    select,
    maybeSingle,
  };
}

describe('scheduled job run ledger', () => {
  it('records a valid job before work begins', async () => {
    const db = beginClient({
      data: { id: '00000000-0000-4000-8000-000000000001' },
      error: null,
    });

    await expect(beginScheduledJobRun(db.client, 'appointment-reminders')).resolves.toBe(
      '00000000-0000-4000-8000-000000000001'
    );
    expect(db.from).toHaveBeenCalledWith('scheduled_job_runs');
    expect(db.insert).toHaveBeenCalledWith({ job_name: 'appointment-reminders', status: 'running' });
  });

  it('rejects names that cannot be safely grouped in the ledger', async () => {
    const db = beginClient({ data: null, error: null });
    await expect(beginScheduledJobRun(db.client, '../secret')).rejects.toThrow(
      'Invalid scheduled job name'
    );
    expect(db.from).not.toHaveBeenCalled();
  });

  it('fails closed when the invocation cannot be recorded', async () => {
    const db = beginClient({ data: null, error: { message: 'table unavailable' } });
    await expect(beginScheduledJobRun(db.client, 'storm-alerts')).rejects.toThrow(
      'Could not start scheduled job ledger: table unavailable'
    );
  });

  it('finishes only a still-running row and bounds stored error text', async () => {
    const db = finishClient();
    await finishScheduledJobRun(db.client, 'run-id', {
      status: 'failed',
      summary: { attempted: 2 },
      error: 'x'.repeat(3000),
    });

    expect(db.from).toHaveBeenCalledWith('scheduled_job_runs');
    expect(db.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        summary: { attempted: 2 },
        error: 'x'.repeat(2000),
      })
    );
    expect(db.firstEq).toHaveBeenCalledWith('id', 'run-id');
    expect(db.terminalEq).toHaveBeenCalledWith('status', 'running');
  });

  it('records skipped overlapping invocations without running work', async () => {
    const db = beginClient({
      data: { id: '00000000-0000-4000-8000-000000000001' },
      error: null,
    });
    const finish = finishClient();
    db.from.mockImplementationOnce(() => ({ insert: db.insert }) as never).mockImplementationOnce(
      () => ({ update: finish.update }) as never
    );
    const work = vi.fn(async () => ({ attempted: 1 }));

    await expect(
      executeScheduledJob({
        supabase: db.client,
        jobName: 'storm-alerts',
        acquireLock: async () => ({ acquired: false, backend: 'upstash', release: async () => {} }),
        work,
      })
    ).resolves.toEqual({
      success: true,
      skipped: true,
      reason: 'already_running',
      lock_backend: 'upstash',
    });
    expect(work).not.toHaveBeenCalled();
    expect(finish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        summary: { reason: 'already_running', lock_backend: 'upstash' },
      })
    );
  });

  it('records a successful summary and always releases the acquired lock', async () => {
    const db = beginClient({
      data: { id: '00000000-0000-4000-8000-000000000001' },
      error: null,
    });
    const finish = finishClient();
    db.from.mockImplementationOnce(() => ({ insert: db.insert }) as never).mockImplementationOnce(
      () => ({ update: finish.update }) as never
    );
    const release = vi.fn(async () => {});

    await expect(
      executeScheduledJob({
        supabase: db.client,
        jobName: 'appointment-reminders',
        acquireLock: async () => ({ acquired: true, backend: 'memory', release }),
        work: async () => ({ planned: 2, sent: 1 }),
      })
    ).resolves.toEqual({
      success: true,
      skipped: false,
      lock_backend: 'memory',
      planned: 2,
      sent: 1,
    });
    expect(finish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        summary: { lock_backend: 'memory', planned: 2, sent: 1 },
      })
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('records work failures before rethrowing and releases the lock', async () => {
    const db = beginClient({
      data: { id: '00000000-0000-4000-8000-000000000001' },
      error: null,
    });
    const finish = finishClient();
    db.from.mockImplementationOnce(() => ({ insert: db.insert }) as never).mockImplementationOnce(
      () => ({ update: finish.update }) as never
    );
    const release = vi.fn(async () => {});

    await expect(
      executeScheduledJob({
        supabase: db.client,
        jobName: 'storm-alerts',
        acquireLock: async () => ({ acquired: true, backend: 'upstash', release }),
        work: async () => {
          throw new Error('NOAA unavailable');
        },
      })
    ).rejects.toThrow('NOAA unavailable');
    expect(finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'NOAA unavailable' })
    );
    expect(release).toHaveBeenCalledOnce();
  });
});
