import { describe, it, expect, vi } from 'vitest';
import {
  backoffMs,
  createEntry,
  dueEntries,
  deadEntries,
  pendingCount,
  afterFailure,
  afterPermanentFailure,
  retryFailed,
  isSettled,
  isPermanentFailure,
  drainEntries,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  type OutboxEntry,
} from './outbox';

const OWNER = '11111111-1111-4111-8111-111111111111';

const entry = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: 'k1',
  ownerId: OWNER,
  kind: 'knock',
  payload: { disposition: 'not_home' },
  occurredAt: '2026-07-29T10:00:00.000Z',
  status: 'pending',
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
  ...over,
});

describe('backoffMs', () => {
  it('doubles per attempt and caps', () => {
    expect(backoffMs(1)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(2)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(3)).toBe(BASE_BACKOFF_MS * 4);
    expect(backoffMs(50)).toBe(MAX_BACKOFF_MS);
  });

  it('is zero before the first send', () => {
    expect(backoffMs(0)).toBe(0);
  });
});

describe('dueEntries', () => {
  it('returns due work oldest-first', () => {
    const list = [
      entry({ id: 'later', occurredAt: '2026-07-29T11:00:00.000Z' }),
      entry({ id: 'waiting', nextAttemptAt: 5_000 }),
      entry({ id: 'earlier', occurredAt: '2026-07-29T09:00:00.000Z' }),
    ];
    expect(dueEntries(list, 1_000).map((item) => item.id)).toEqual(['earlier', 'later']);
  });

  it('bypasses backoff only for an explicit retry or reconnect', () => {
    const waiting = entry({ nextAttemptAt: 60_000 });
    expect(dueEntries([waiting], 1_000)).toEqual([]);
    expect(dueEntries([waiting], 1_000, { ignoreBackoff: true })).toEqual([waiting]);
  });

  it('scopes work to the authenticated owner', () => {
    const other = entry({
      id: 'other',
      ownerId: '22222222-2222-4222-8222-222222222222',
    });
    expect(dueEntries([entry(), other], 1_000, { ownerId: OWNER }).map((item) => item.id))
      .toEqual(['k1']);
  });

  it('never abandons transient work because it retried many times', () => {
    expect(dueEntries([entry({ attempts: 500 })], 1_000)).toHaveLength(1);
  });

  it('keeps permanent failures out of automatic drain and honours a limit', () => {
    const list = Array.from({ length: 5 }, (_, index) =>
      entry({ id: `k${index}`, status: index === 0 ? 'failed' : 'pending' })
    );
    expect(dueEntries(list, 1_000, { limit: 2 }).map((item) => item.id)).toEqual(['k1', 'k2']);
  });
});

describe('failure state', () => {
  it('backs transient failures off without mutating or parking them', () => {
    const original = entry({ attempts: 100 });
    const out = afterFailure(original, 'network down', 10_000);
    expect(out).toMatchObject({
      attempts: 101,
      status: 'pending',
      nextAttemptAt: 10_000 + MAX_BACKOFF_MS,
      lastError: 'network down',
    });
    expect(original.attempts).toBe(100);
    expect(original.lastError).toBeNull();
  });

  it('retains permanent failures for a person to retry', () => {
    const failed = afterPermanentFailure(entry(), 'Invalid payload');
    expect(failed.status).toBe('failed');
    expect(deadEntries([failed])).toEqual([failed]);
    expect(pendingCount([failed])).toBe(0);

    expect(retryFailed(failed, 20_000)).toMatchObject({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 20_000,
      lastError: null,
    });
  });
});

describe('HTTP outcome classification', () => {
  it('settles only normal success responses', () => {
    expect(isSettled(200)).toBe(true);
    expect(isSettled(201)).toBe(true);
    expect(isSettled(409)).toBe(false);
    expect(isSettled(500)).toBe(false);
  });

  it('retries auth expiry, timeout, rate limiting, and server errors', () => {
    for (const status of [401, 403, 408, 429, 500, 503]) {
      expect(isPermanentFailure(status)).toBe(false);
    }
  });

  it('parks payload and missing-record failures instead of deleting them', () => {
    for (const status of [400, 404, 409, 422]) {
      expect(isPermanentFailure(status)).toBe(true);
    }
  });
});

describe('createEntry and counts', () => {
  it('binds a durable event to its owner and occurrence time', () => {
    const created = createEntry({
      id: 'abc',
      ownerId: OWNER,
      kind: 'knock',
      payload: { disposition: 'not_home' },
      occurredAt: '2026-07-29T10:00:00.000Z',
    });
    expect(created).toMatchObject({
      ownerId: OWNER,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      occurredAt: '2026-07-29T10:00:00.000Z',
    });
  });

  it('counts pending and failed work separately', () => {
    const pending = entry({ id: 'pending' });
    const failed = entry({ id: 'failed', status: 'failed' });
    expect(pendingCount([pending, failed])).toBe(1);
    expect(deadEntries([pending, failed])).toEqual([failed]);
  });
});

function memoryStore(initial: OutboxEntry[]) {
  const rows = new Map(initial.map((item) => [item.id, item]));
  return {
    rows,
    put: vi.fn(async (item: OutboxEntry) => {
      rows.set(item.id, item);
      return true;
    }),
    remove: vi.fn(async (id: string) => rows.delete(id)),
  };
}

describe('drainEntries', () => {
  it('sends only the current owner, oldest-first, and removes successes', async () => {
    const otherOwner = '22222222-2222-4222-8222-222222222222';
    const initial = [
      entry({ id: 'later', occurredAt: '2026-07-29T11:00:00.000Z' }),
      entry({ id: 'earlier', occurredAt: '2026-07-29T09:00:00.000Z' }),
      entry({ id: 'other', ownerId: otherOwner }),
    ];
    const store = memoryStore(initial);
    const sent: string[] = [];

    const result = await drainEntries(initial, 1_000, {
      ownerId: OWNER,
      put: store.put,
      remove: store.remove,
      send: async (item) => {
        sent.push(item.id);
        return { status: 201 };
      },
    });

    expect(sent).toEqual(['earlier', 'later']);
    expect(result).toMatchObject({ attempted: 2, settled: 2 });
    expect([...store.rows.keys()]).toEqual(['other']);
  });

  it('retains a 401 and network failure for later recovery', async () => {
    const auth = entry({ id: 'auth' });
    const network = entry({ id: 'network' });
    const store = memoryStore([auth, network]);

    await drainEntries([auth, network], 10_000, {
      ownerId: OWNER,
      put: store.put,
      remove: store.remove,
      send: async (item) => {
        if (item.id === 'auth') return { status: 401, error: 'Not authenticated' };
        throw new Error('offline');
      },
    });

    expect(store.rows.get('auth')).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'Not authenticated',
    });
    expect(store.rows.get('network')).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'offline',
    });
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('keeps a permanent error as visible failed work', async () => {
    const bad = entry({ id: 'bad' });
    const store = memoryStore([bad]);
    const result = await drainEntries([bad], 1_000, {
      ownerId: OWNER,
      put: store.put,
      remove: store.remove,
      send: async () => ({ status: 400, error: 'Invalid knocked_at' }),
    });

    expect(result.failed).toBe(1);
    expect(store.rows.get('bad')).toMatchObject({
      status: 'failed',
      lastError: 'Invalid knocked_at',
    });
  });

  it('lets an explicit retry or reconnect send work still in backoff', async () => {
    const waiting = entry({ nextAttemptAt: 60_000 });
    const store = memoryStore([waiting]);
    const send = vi.fn(async () => ({ status: 201 }));

    const scheduled = await drainEntries([waiting], 1_000, {
      ownerId: OWNER,
      put: store.put,
      remove: store.remove,
      send,
    });
    expect(scheduled.attempted).toBe(0);
    expect(send).not.toHaveBeenCalled();

    const forced = await drainEntries([waiting], 1_000, {
      ownerId: OWNER,
      force: true,
      put: store.put,
      remove: store.remove,
      send,
    });
    expect(forced).toMatchObject({ attempted: 1, settled: 1 });
    expect(send).toHaveBeenCalledOnce();
  });

  it('leaves the original row when local removal cannot commit', async () => {
    const saved = entry();
    const store = memoryStore([saved]);
    store.remove.mockImplementation(async () => false);
    const result = await drainEntries([saved], 1_000, {
      ownerId: OWNER,
      put: store.put,
      remove: store.remove,
      send: async () => ({ status: 200 }),
    });

    expect(result.persistenceFailures).toBe(1);
    expect(store.rows.has(saved.id)).toBe(true);
  });
});
