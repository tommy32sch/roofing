import { describe, expect, it } from 'vitest';
import {
  applyQueuedCalls,
  callDerivedUpdate,
  resolveCalledAt,
} from './call-sync';
import { MAX_BACKDATE_MS, MAX_CLOCK_SKEW_MS } from './knock-sync';

const NOW = Date.parse('2026-07-29T12:00:00.000Z');

describe('resolveCalledAt', () => {
  it('defaults to now and honors a genuine offline timestamp', () => {
    expect(resolveCalledAt(undefined, NOW)).toEqual({
      ok: true,
      calledAt: '2026-07-29T12:00:00.000Z',
    });
    expect(resolveCalledAt('2026-07-29T10:05:00Z', NOW)).toEqual({
      ok: true,
      calledAt: '2026-07-29T10:05:00.000Z',
    });
  });

  it('allows modest skew but rejects poisoned timestamps', () => {
    expect(
      resolveCalledAt(new Date(NOW + MAX_CLOCK_SKEW_MS - 1_000).toISOString(), NOW).ok
    ).toBe(true);
    expect(
      resolveCalledAt(new Date(NOW + MAX_CLOCK_SKEW_MS + 1).toISOString(), NOW)
    ).toEqual({ ok: false, reason: 'too_far_future' });
    expect(
      resolveCalledAt(new Date(NOW - MAX_BACKDATE_MS - 1).toISOString(), NOW)
    ).toEqual({ ok: false, reason: 'too_old' });
    expect(resolveCalledAt('yesterday', NOW)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('callDerivedUpdate', () => {
  const base: Parameters<typeof callDerivedUpdate>[0] = {
    calledAt: '2026-07-29T11:00:00Z',
    disposition: 'call_back',
    currentLastCallAt: '2026-07-29T09:00:00Z',
    currentCallCount: 2,
    currentStatus: 'new',
    nextStatus: 'contacted',
  };

  it('advances summary state for the newest call', () => {
    expect(callDerivedUpdate(base)).toEqual({
      call_count: 3,
      last_call_at: '2026-07-29T11:00:00Z',
      last_call_disposition: 'call_back',
      status: 'contacted',
    });
  });

  it('counts late calls without replacing a newer visible result', () => {
    const result = callDerivedUpdate({ ...base, calledAt: '2026-07-28T08:00:00Z' });
    expect(result.call_count).toBe(3);
    expect(result).not.toHaveProperty('last_call_at');
    expect(result).not.toHaveProperty('last_call_disposition');
    expect(result.status).toBe('contacted');
  });

  it('makes Do Not Call sticky even when the event arrives late', () => {
    const result = callDerivedUpdate({
      ...base,
      calledAt: '2026-07-28T08:00:00Z',
      disposition: 'do_not_call',
    });
    expect(result.is_dnc).toBe(true);
    expect(result).not.toHaveProperty('last_call_at');
  });

  it('never regresses an advanced pipeline status', () => {
    for (const currentStatus of ['appointment_set', 'inspected', 'proposal_sent', 'sold', 'lost'] as const) {
      const result = callDerivedUpdate({ ...base, currentStatus });
      expect(result).not.toHaveProperty('status');
    }
  });
});

describe('applyQueuedCalls', () => {
  const lead = {
    id: 'lead-1',
    status: 'new' as const,
    last_call_at: null,
    last_call_disposition: null,
    call_count: 0,
    is_dnc: false,
    first_name: 'Terry',
  };

  it('applies queued work chronologically without mutating server data', () => {
    const server = [lead];
    const result = applyQueuedCalls(server, [
      {
        occurredAt: '2026-07-29T11:00:00.000Z',
        payload: { leadId: 'lead-1', disposition: 'call_back' },
      },
      {
        occurredAt: '2026-07-29T10:00:00.000Z',
        payload: { leadId: 'lead-1', disposition: 'left_voicemail' },
      },
    ]);

    expect(result[0]).toMatchObject({
      call_count: 2,
      last_call_at: '2026-07-29T11:00:00.000Z',
      last_call_disposition: 'call_back',
      status: 'contacted',
    });
    expect(server[0]).toEqual(lead);
  });

  it('optimistically suppresses calls after Do Not Call', () => {
    const result = applyQueuedCalls([lead], [
      {
        occurredAt: '2026-07-29T10:00:00.000Z',
        payload: { leadId: 'lead-1', disposition: 'do_not_call' },
      },
    ]);
    expect(result[0].is_dnc).toBe(true);
    expect(result[0].last_call_disposition).toBe('do_not_call');
  });

  it('leaves unrelated leads referentially unchanged', () => {
    const other = { ...lead, id: 'lead-2' };
    expect(
      applyQueuedCalls([other], [
        {
          occurredAt: '2026-07-29T10:00:00.000Z',
          payload: { leadId: 'lead-1', disposition: 'wrong_number' },
        },
      ])[0]
    ).toBe(other);
  });
});
