'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createEntry,
  deadEntries,
  drainEntries,
  pendingCount,
  retryFailed as retryFailedEntry,
  type OutboxEntry,
} from './outbox';
import { readAll, put, remove } from './store';
import type { KnockDisposition } from '@/lib/leads/knocks';

export interface KnockPayload {
  leadId: string;
  disposition: KnockDisposition;
  notes?: string | null;
  /** For optimistic UI and the failure message — never sent. */
  leadName?: string;
}

/**
 * Queue knocks locally and drain them when the network allows.
 *
 * The rep's action is accepted immediately and durably; the request is an
 * implementation detail that may happen seconds or hours later. That inversion
 * is the point — a canvasser cannot wait at a door to find out whether a POST
 * succeeded, and today a failure silently discards the knock.
 */
export function useKnockOutbox(options: {
  ownerId: string | null;
  onSettled?: () => void;
}) {
  const [entries, setEntries] = useState<OutboxEntry<KnockPayload>[]>([]);
  const [online, setOnline] = useState(true);
  const [storageError, setStorageError] = useState(false);
  const flushing = useRef(false);
  // Held in a ref so the flush loop never becomes a dependency that restarts it.
  const onSettled = useRef(options.onSettled);
  onSettled.current = options.onSettled;

  // Rehydrate only this rep's work. IndexedDB survives logout and impersonation,
  // so an unscoped queue would attribute the previous rep's knocks to the next.
  useEffect(() => {
    if (!options.ownerId) {
      setEntries([]);
      return;
    }

    let cancelled = false;
    readAll().then((stored) => {
      if (cancelled) return;
      if (stored === null) {
        setStorageError(true);
        return;
      }
      setStorageError(false);
      const owned = (stored as OutboxEntry<KnockPayload>[]).filter(
        (entry) => entry.ownerId === options.ownerId
      );
      // A rep can tap a door while the initial read is still resolving. Merge
      // instead of replacing so that newly committed work cannot disappear
      // from the badge for the rest of the session.
      setEntries((current) => {
        const merged = new Map(owned.map((entry) => [entry.id, entry]));
        for (const entry of current) {
          if (entry.ownerId === options.ownerId) merged.set(entry.id, entry);
        }
        return [...merged.values()];
      });
    });
    return () => {
      cancelled = true;
    };
  }, [options.ownerId]);

  useEffect(() => {
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const flush = useCallback(async (force = false) => {
    if (!options.ownerId || flushing.current) return;
    flushing.current = true;
    try {
      const stored = await readAll();
      if (stored === null) {
        setStorageError(true);
        return;
      }
      setStorageError(false);
      const storedEntries = stored as OutboxEntry<KnockPayload>[];
      const result = await drainEntries(storedEntries, Date.now(), {
        ownerId: options.ownerId,
        force,
        put,
        remove,
        send: async (entry) => {
          const res = await fetch(`/api/admin/leads/${entry.payload.leadId}/knocks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: entry.id,
              owner_id: entry.ownerId,
              disposition: entry.payload.disposition,
              notes: entry.payload.notes ?? null,
              knocked_at: entry.occurredAt,
            }),
          });
          const body = await res.json().catch(() => null);
          return {
            status: res.status,
            error:
              body && typeof body.error === 'string'
                ? body.error
                : undefined,
          };
        },
      });

      const next = await readAll();
      if (next === null) {
        setStorageError(true);
      } else {
        setStorageError(false);
        setEntries(
          (next as OutboxEntry<KnockPayload>[]).filter(
            (entry) => entry.ownerId === options.ownerId
          )
        );
      }
      if (result.settled > 0) onSettled.current?.();
    } finally {
      flushing.current = false;
    }
  }, [options.ownerId]);

  /** Accept a knock. Resolves as soon as it is durable, not when it is sent. */
  const enqueue = useCallback(
    async (payload: KnockPayload) => {
      if (!options.ownerId) throw new Error('Identity is not loaded');
      const entry = createEntry<KnockPayload>({
        id: crypto.randomUUID(),
        ownerId: options.ownerId,
        kind: 'knock',
        payload,
        occurredAt: new Date().toISOString(),
      });
      if (!(await put(entry))) {
        setStorageError(true);
        throw new Error('This browser could not save the knock');
      }
      setStorageError(false);
      setEntries((prev) => [...prev, entry]);
      // Fire and forget: the caller has its confirmation already.
      if (typeof navigator === 'undefined' || navigator.onLine) void flush();
      return entry;
    },
    [flush, options.ownerId]
  );

  const retryFailed = useCallback(async () => {
    if (!options.ownerId) return;
    const stored = await readAll();
    if (stored === null) {
      setStorageError(true);
      return;
    }
    const ownedFailed = deadEntries(
      (stored as OutboxEntry<KnockPayload>[]).filter(
        (entry) => entry.ownerId === options.ownerId
      )
    );
    const now = Date.now();
    for (const entry of ownedFailed) {
      await put(retryFailedEntry(entry, now));
    }
    const next = await readAll();
    if (next === null) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setEntries(
      (next as OutboxEntry<KnockPayload>[]).filter(
        (entry) => entry.ownerId === options.ownerId
      )
    );
    if (ownedFailed.length > 0) void flush(true);
  }, [flush, options.ownerId]);

  // Drain on reconnect, and poll gently so a backoff window still clears while
  // the rep stays on the page.
  useEffect(() => {
    if (!online) return;
    // Reconnecting is an explicit signal that the previous network failure may
    // be gone. Try immediately rather than making the rep wait out backoff.
    void flush(true);
    const timer = setInterval(() => void flush(), 30_000);
    return () => clearInterval(timer);
  }, [online, flush]);

  return {
    pending: pendingCount(entries),
    failed: deadEntries(entries).length,
    lastError: deadEntries(entries)[0]?.lastError ?? null,
    online,
    storageError,
    entries,
    enqueue,
    flush,
    retryFailed,
  };
}
