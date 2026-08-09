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
import type { ColdCallDisposition } from '@/lib/leads/calls';
import { useAppShell } from '@/components/providers/app-shell-provider';

interface ResultPayloadBase {
  leadId: string;
  notes?: string | null;
  /** For optimistic UI and confirmation copy — never sent. */
  leadName?: string;
}

export interface KnockResultPayload extends ResultPayloadBase {
  disposition: KnockDisposition;
}

export interface ColdCallResultPayload extends ResultPayloadBase {
  disposition: ColdCallDisposition;
}

export type KnockResultOutboxEntry = OutboxEntry<KnockResultPayload> & {
  kind: 'knock';
};

export type ColdCallResultOutboxEntry = OutboxEntry<ColdCallResultPayload> & {
  kind: 'cold_call';
};

export type LeadResultOutboxEntry =
  | KnockResultOutboxEntry
  | ColdCallResultOutboxEntry;

/** Existing IndexedDB rows already use `kind: "knock"` and need no migration. */
export function isKnockResultEntry(
  entry: OutboxEntry<unknown>
): entry is KnockResultOutboxEntry {
  return entry.kind === 'knock';
}

export function isColdCallResultEntry(
  entry: OutboxEntry<unknown>
): entry is ColdCallResultOutboxEntry {
  return entry.kind === 'cold_call';
}

export function isLeadResultEntry(
  entry: OutboxEntry<unknown>
): entry is LeadResultOutboxEntry {
  return isKnockResultEntry(entry) || isColdCallResultEntry(entry);
}

/**
 * Build the network request separately from the drain loop so routing and
 * timestamp semantics are testable without IndexedDB, React or a network.
 */
export function leadResultRequest(entry: LeadResultOutboxEntry): {
  url: string;
  body: Record<string, unknown>;
} {
  const knock = isKnockResultEntry(entry);
  return {
    url: `/api/admin/leads/${entry.payload.leadId}/${knock ? 'knocks' : 'calls'}`,
    body: {
      client_id: entry.id,
      owner_id: entry.ownerId,
      disposition: entry.payload.disposition,
      notes: entry.payload.notes ?? null,
      [knock ? 'knocked_at' : 'called_at']: entry.occurredAt,
    },
  };
}

/**
 * One durable queue for both kinds of field result.
 *
 * A phone can place a cellular call while browser data is unavailable, so call
 * results need the same "save first, deliver later" guarantee as door knocks.
 * One drainer also preserves owner scoping, retry ordering and failure
 * visibility without two tabs racing over the same IndexedDB store.
 */
export function useLeadResultOutbox(options: {
  ownerId: string | null;
  onSettled?: () => void;
}) {
  const { connection } = useAppShell();
  const [entries, setEntries] = useState<LeadResultOutboxEntry[]>([]);
  const [storageError, setStorageError] = useState(false);
  const flushing = useRef(false);
  const onSettled = useRef(options.onSettled);
  onSettled.current = options.onSettled;

  const ownedResults = useCallback(
    (stored: OutboxEntry[]) =>
      stored.filter(
        (entry): entry is LeadResultOutboxEntry =>
          entry.ownerId === options.ownerId && isLeadResultEntry(entry)
      ),
    [options.ownerId]
  );

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
      const owned = ownedResults(stored);
      // Merge with work accepted while IndexedDB was rehydrating.
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
  }, [options.ownerId, ownedResults]);

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
      const result = await drainEntries<KnockResultPayload | ColdCallResultPayload>(
        ownedResults(stored),
        Date.now(),
        {
          ownerId: options.ownerId,
          force,
          put,
          remove,
          send: async (genericEntry) => {
            // drainEntries retains the common OutboxEntry shape. Reapply the
            // kind guard before channel-specific routing.
            if (!isLeadResultEntry(genericEntry)) {
              return { status: 400, error: 'Unknown offline result type' };
            }
            const request = leadResultRequest(genericEntry);
            const res = await fetch(request.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(request.body),
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
        }
      );

      const next = await readAll();
      if (next === null) {
        setStorageError(true);
      } else {
        setStorageError(false);
        setEntries(ownedResults(next));
      }
      if (result.settled > 0) onSettled.current?.();
    } finally {
      flushing.current = false;
    }
  }, [options.ownerId, ownedResults]);

  const enqueue = useCallback(
    async (
      kind: 'knock' | 'cold_call',
      payload: KnockResultPayload | ColdCallResultPayload
    ) => {
      if (!options.ownerId) throw new Error('Identity is not loaded');
      const entry = {
        ...createEntry({
          id: crypto.randomUUID(),
          ownerId: options.ownerId,
          kind,
          payload,
          occurredAt: new Date().toISOString(),
        }),
        kind,
      } as LeadResultOutboxEntry;
      if (!(await put(entry))) {
        setStorageError(true);
        throw new Error('This browser could not save the result');
      }
      setStorageError(false);
      setEntries((previous) => [...previous, entry]);
      if (typeof navigator === 'undefined' || navigator.onLine) void flush();
      return entry;
    },
    [flush, options.ownerId]
  );

  const enqueueKnock = useCallback(
    (payload: KnockResultPayload) => enqueue('knock', payload),
    [enqueue]
  );

  const enqueueCall = useCallback(
    (payload: ColdCallResultPayload) => enqueue('cold_call', payload),
    [enqueue]
  );

  const retryFailed = useCallback(async () => {
    if (!options.ownerId) return;
    const stored = await readAll();
    if (stored === null) {
      setStorageError(true);
      return;
    }
    const ownedFailed = deadEntries<KnockResultPayload | ColdCallResultPayload>(
      ownedResults(stored)
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
    setEntries(ownedResults(next));
    if (ownedFailed.length > 0) void flush(true);
  }, [flush, options.ownerId, ownedResults]);

  useEffect(() => {
    if (!connection.online) return;
    void flush(true);
    const timer = setInterval(() => void flush(), 30_000);
    return () => clearInterval(timer);
  }, [connection.online, flush]);

  const failedEntries = deadEntries<KnockResultPayload | ColdCallResultPayload>(entries);

  return {
    pending: pendingCount<KnockResultPayload | ColdCallResultPayload>(entries),
    failed: failedEntries.length,
    lastError: failedEntries[0]?.lastError ?? null,
    online: connection.online,
    storageError,
    entries,
    enqueueKnock,
    enqueueCall,
    flush,
    retryFailed,
  };
}
