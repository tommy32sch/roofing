import { describe, it, expect } from 'vitest';
import {
  resolveKnockedAt,
  isNewerThanCurrent,
  knockDerivedUpdate,
  shouldAdvanceStatus,
  applyQueuedKnocks,
  MAX_CLOCK_SKEW_MS,
  MAX_BACKDATE_MS,
} from './knock-sync';

const NOW = Date.parse('2026-07-29T12:00:00.000Z');

describe('resolveKnockedAt', () => {
  it('defaults to now when the client sends nothing', () => {
    const out = resolveKnockedAt(undefined, NOW);
    expect(out).toEqual({ ok: true, knockedAt: '2026-07-29T12:00:00.000Z' });
    expect(resolveKnockedAt(null, NOW).ok).toBe(true);
    expect(resolveKnockedAt('', NOW).ok).toBe(true);
  });

  // The whole point: a knock taken at 10:05 and synced at 11:30 is a 10:05
  // knock, because recency is what the map colours doors by.
  it('honours a genuine offline timestamp', () => {
    const out = resolveKnockedAt('2026-07-29T10:05:00.000Z', NOW);
    expect(out).toEqual({ ok: true, knockedAt: '2026-07-29T10:05:00.000Z' });
  });

  it('tolerates a modest clock skew', () => {
    const slightlyAhead = new Date(NOW + MAX_CLOCK_SKEW_MS - 1_000).toISOString();
    expect(resolveKnockedAt(slightlyAhead, NOW).ok).toBe(true);
  });

  // A handset with a wrong clock must not be able to write a knock into next
  // year and poison that door's recency permanently.
  it('rejects a timestamp far in the future', () => {
    const wayAhead = new Date(NOW + 48 * 3_600_000).toISOString();
    expect(resolveKnockedAt(wayAhead, NOW)).toEqual({ ok: false, reason: 'too_far_future' });
  });

  it('rejects a timestamp older than the backdate window', () => {
    const ancient = new Date(NOW - MAX_BACKDATE_MS - 1_000).toISOString();
    expect(resolveKnockedAt(ancient, NOW)).toEqual({ ok: false, reason: 'too_old' });
  });

  it('accepts a knock from inside the backdate window', () => {
    const lastWeek = new Date(NOW - 7 * 24 * 3_600_000).toISOString();
    expect(resolveKnockedAt(lastWeek, NOW).ok).toBe(true);
  });

  it('rejects junk rather than coercing it', () => {
    expect(resolveKnockedAt('yesterday', NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveKnockedAt(12345, NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveKnockedAt({}, NOW)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('normalises equivalent instants', () => {
    const a = resolveKnockedAt('2026-07-29T10:05:00Z', NOW);
    const b = resolveKnockedAt('2026-07-29T10:05:00.000Z', NOW);
    expect(a).toEqual(b);
  });
});

describe('isNewerThanCurrent', () => {
  it('is true when the lead has never been knocked', () => {
    expect(isNewerThanCurrent('2026-07-29T10:00:00Z', null)).toBe(true);
    expect(isNewerThanCurrent('2026-07-29T10:00:00Z', undefined)).toBe(true);
  });

  it('is true for a later knock', () => {
    expect(isNewerThanCurrent('2026-07-29T11:00:00Z', '2026-07-29T10:00:00Z')).toBe(true);
  });

  // The out-of-order case: a phone offline for a day delivers yesterday's knock
  // after today's already landed.
  it('is false for a knock older than what the lead already shows', () => {
    expect(isNewerThanCurrent('2026-07-28T09:00:00Z', '2026-07-29T10:00:00Z')).toBe(false);
  });

  it('treats an identical timestamp as current', () => {
    expect(isNewerThanCurrent('2026-07-29T10:00:00Z', '2026-07-29T10:00:00Z')).toBe(true);
  });
});

describe('knockDerivedUpdate', () => {
  const base: Parameters<typeof knockDerivedUpdate>[0] = {
    knockedAt: '2026-07-29T11:00:00Z',
    disposition: 'callback',
    currentLastKnockAt: '2026-07-29T09:00:00Z',
    currentKnockCount: 2,
    currentStatus: 'new',
    nextStatus: 'contacted',
  };

  it('advances the door state for the newest knock', () => {
    const out = knockDerivedUpdate(base);
    expect(out).toMatchObject({
      knock_count: 3,
      last_knock_at: '2026-07-29T11:00:00Z',
      last_disposition: 'callback',
      status: 'contacted',
    });
  });

  // A late arrival is real history and must count, but it must not make the
  // door display an older disposition. Contact still advances the pipeline
  // because that fact is independent of which knock is newest.
  it('counts a late contact without dragging recency backwards', () => {
    const out = knockDerivedUpdate({ ...base, knockedAt: '2026-07-28T08:00:00Z' });
    expect(out.knock_count).toBe(3);
    expect(out).not.toHaveProperty('last_knock_at');
    expect(out).not.toHaveProperty('last_disposition');
    expect(out.status).toBe('contacted');
  });

  // do_not_knock is sticky in both directions of arrival order: a house that
  // asked not to be knocked must not be re-listed by a later "not home".
  it('sets do_not_knock even when the knock arrives late', () => {
    const out = knockDerivedUpdate({
      ...base,
      knockedAt: '2026-07-28T08:00:00Z',
      disposition: 'do_not_knock',
      nextStatus: null,
    });
    expect(out.do_not_knock).toBe(true);
    expect(out).not.toHaveProperty('last_knock_at');
  });

  it('never pulls a sold or lost lead back into an earlier stage', () => {
    for (const currentStatus of ['sold', 'lost'] as const) {
      const out = knockDerivedUpdate({ ...base, currentStatus });
      expect(out).not.toHaveProperty('status');
      expect(out.last_knock_at).toBe('2026-07-29T11:00:00Z');
    }
  });

  it('leaves status alone when the disposition implies no change', () => {
    const out = knockDerivedUpdate({ ...base, nextStatus: null });
    expect(out).not.toHaveProperty('status');
  });

  it('does not rewrite status to the value it already has', () => {
    const out = knockDerivedUpdate({ ...base, currentStatus: 'contacted' });
    expect(out).not.toHaveProperty('status');
  });

  it('does not regress later pipeline stages', () => {
    for (const currentStatus of ['appointment_set', 'inspected', 'proposal_sent'] as const) {
      const out = knockDerivedUpdate({ ...base, currentStatus });
      expect(out).not.toHaveProperty('status');
    }
  });

  it('counts the first ever knock from a null count', () => {
    const out = knockDerivedUpdate({
      ...base,
      currentKnockCount: null,
      currentLastKnockAt: null,
    });
    expect(out.knock_count).toBe(1);
    expect(out.last_knock_at).toBe('2026-07-29T11:00:00Z');
  });
});

describe('shouldAdvanceStatus', () => {
  it('only permits forward pipeline movement', () => {
    expect(shouldAdvanceStatus('new', 'contacted')).toBe(true);
    expect(shouldAdvanceStatus('contacted', 'appointment_set')).toBe(true);
    expect(shouldAdvanceStatus('inspected', 'contacted')).toBe(false);
    expect(shouldAdvanceStatus('proposal_sent', 'appointment_set')).toBe(false);
    expect(shouldAdvanceStatus('sold', 'appointment_set')).toBe(false);
    expect(shouldAdvanceStatus('lost', 'contacted')).toBe(false);
    expect(shouldAdvanceStatus('new', null)).toBe(false);
  });
});

describe('applyQueuedKnocks', () => {
  const lead = {
    id: 'lead-1',
    status: 'new' as const,
    last_knock_at: null,
    last_disposition: null,
    knock_count: 0,
    do_not_knock: false,
    first_name: 'Terry',
  };

  it('overlays queued work in occurrence order without mutating server data', () => {
    const server = [lead];
    const result = applyQueuedKnocks(server, [
      {
        occurredAt: '2026-07-29T11:00:00.000Z',
        payload: { leadId: 'lead-1', disposition: 'callback' },
      },
      {
        occurredAt: '2026-07-29T10:00:00.000Z',
        payload: { leadId: 'lead-1', disposition: 'not_home' },
      },
    ]);

    expect(result[0]).toMatchObject({
      knock_count: 2,
      last_knock_at: '2026-07-29T11:00:00.000Z',
      last_disposition: 'callback',
      status: 'contacted',
    });
    expect(server[0]).toEqual(lead);
  });

  it('makes a queued do-not-knock immediately sticky on the map', () => {
    const result = applyQueuedKnocks([lead], [
      {
        occurredAt: '2026-07-29T10:00:00.000Z',
        payload: { leadId: 'lead-1', disposition: 'do_not_knock' },
      },
    ]);
    expect(result[0].do_not_knock).toBe(true);
    expect(result[0].last_disposition).toBe('do_not_knock');
  });

  it('leaves unrelated leads referentially unchanged', () => {
    const other = { ...lead, id: 'lead-2' };
    expect(
      applyQueuedKnocks([other], [
        {
          occurredAt: '2026-07-29T10:00:00.000Z',
          payload: { leadId: 'lead-1', disposition: 'not_home' },
        },
      ])[0]
    ).toBe(other);
  });
});
