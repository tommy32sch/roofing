import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { clear, put, readAll, remove } from './store';
import type { OutboxEntry } from './outbox';

const DB_NAME = 'roof-leads-offline';

const entry = (id = 'knock-1'): OutboxEntry => ({
  id,
  ownerId: '11111111-1111-4111-8111-111111111111',
  kind: 'knock',
  payload: { leadId: 'lead-1', disposition: 'not_home' },
  occurredAt: '2026-07-29T10:00:00.000Z',
  status: 'pending',
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
});

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('database delete blocked'));
  });
}

beforeEach(async () => {
  vi.stubGlobal('indexedDB', fakeIndexedDB);
  await deleteDatabase();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('IndexedDB outbox store', () => {
  it('confirms a committed write and reads the complete entry back', async () => {
    const saved = entry();
    expect(await put(saved)).toBe(true);
    expect(await readAll()).toEqual([saved]);
  });

  it('updates by stable client id and removes only after commit', async () => {
    const saved = entry();
    await put(saved);
    await put({ ...saved, attempts: 2, lastError: 'offline' });
    expect(await readAll()).toEqual([{ ...saved, attempts: 2, lastError: 'offline' }]);

    expect(await remove(saved.id)).toBe(true);
    expect(await readAll()).toEqual([]);
  });

  it('clears queued test data transactionally', async () => {
    await put(entry('a'));
    await put(entry('b'));
    expect(await clear()).toBe(true);
    expect(await readAll()).toEqual([]);
  });

  it('reports unavailable storage instead of pretending the knock is durable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await put(entry())).toBe(false);
    expect(await remove('knock-1')).toBe(false);
    expect(await readAll()).toBeNull();
  });

  it('reports a transaction/write failure without deleting existing work', async () => {
    const saved = entry();
    await put(saved);
    const unclonable = {
      ...entry('bad'),
      payload: { callback: () => 'functions cannot be cloned into IndexedDB' },
    };

    expect(await put(unclonable)).toBe(false);
    expect(await readAll()).toEqual([saved]);
  });
});
