/**
 * Durable write queue for work done in the field.
 *
 * A canvasser is on a phone, walking, with signal that comes and goes between
 * houses. The failure this exists to prevent is quiet: a knock POST fails, a
 * toast appears, the rep has already turned to the next door, and the record is
 * gone. Knock recency drives what the map colours and what the Today queue
 * surfaces, so a missing knock is not a missing row — it is a door that looks
 * un-knocked and gets knocked again.
 *
 * All the decisions live here as pure functions over plain data, so the retry
 * arithmetic and the ordering rules can be tested without IndexedDB, a network,
 * or a phone. Storage and fetch are adapters supplied by the caller.
 */

export type OutboxStatus = 'pending' | 'failed';

export interface OutboxEntry<T = unknown> {
  /** Client-generated, and the server's idempotency key. Stable across retries. */
  id: string;
  /** Prevents one rep's saved field work from syncing as the next signed-in rep. */
  ownerId: string;
  /** What kind of work this is; lets one queue carry more than knocks later. */
  kind: string;
  payload: T;
  /** When the user actually did the thing — not when it was sent. */
  occurredAt: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms; entries are not retried before this. */
  nextAttemptAt: number;
  lastError?: string | null;
}

/** First backoff step, in ms. Doubles per attempt up to the cap. */
export const BASE_BACKOFF_MS = 2_000;

/** Never wait longer than this between attempts. */
export const MAX_BACKOFF_MS = 5 * 60_000;

/**
 * Delay before attempt number `attempts` (1-based).
 *
 * Exponential with a cap: a rep who walks back into coverage should not wait
 * ten minutes for a queue that has been failing all morning, but a genuinely
 * down server should not be hammered either.
 */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const raw = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  return Math.min(raw, MAX_BACKOFF_MS);
}

export function createEntry<T>(input: {
  id: string;
  ownerId: string;
  kind: string;
  payload: T;
  occurredAt: string;
  now?: number;
}): OutboxEntry<T> {
  return {
    id: input.id,
    ownerId: input.ownerId,
    kind: input.kind,
    payload: input.payload,
    occurredAt: input.occurredAt,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: input.now ?? 0,
    lastError: null,
  };
}

/**
 * Entries eligible to send right now, oldest first.
 *
 * Oldest-first matters: knocks replayed out of order would write
 * `last_disposition` in the wrong sequence, so the newest knock might not be
 * the one the door ends up showing.
 */
export function dueEntries<T>(
  entries: OutboxEntry<T>[],
  now: number,
  options: { limit?: number; ownerId?: string; ignoreBackoff?: boolean } = {}
): OutboxEntry<T>[] {
  const due = entries
    .filter((e) => e.status === 'pending')
    .filter((e) => options.ownerId === undefined || e.ownerId === options.ownerId)
    .filter((e) => options.ignoreBackoff || e.nextAttemptAt <= now)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return options.limit ? due.slice(0, options.limit) : due;
}

/** Entries that have exhausted their retries and need a human. */
export function deadEntries<T>(entries: OutboxEntry<T>[]): OutboxEntry<T>[] {
  return entries.filter((e) => e.status === 'failed');
}

/** What the badge should say — work the rep has done that the server lacks. */
export function pendingCount<T>(entries: OutboxEntry<T>[]): number {
  return entries.filter((e) => e.status === 'pending').length;
}

/**
 * The entry's next state after a failed attempt.
 *
 * Returns a NEW object rather than mutating, so a caller holding the old one
 * for optimistic UI is never surprised.
 */
export function afterFailure<T>(
  entry: OutboxEntry<T>,
  error: string,
  now: number
): OutboxEntry<T> {
  const attempts = entry.attempts + 1;
  return {
    ...entry,
    attempts,
    status: 'pending',
    nextAttemptAt: now + backoffMs(attempts),
    lastError: error,
  };
}

/** Park a payload the server says it can never accept, without deleting it. */
export function afterPermanentFailure<T>(
  entry: OutboxEntry<T>,
  error: string
): OutboxEntry<T> {
  return {
    ...entry,
    attempts: entry.attempts + 1,
    status: 'failed',
    lastError: error,
  };
}

/** A person explicitly chose to retry work that previously needed attention. */
export function retryFailed<T>(
  entry: OutboxEntry<T>,
  now: number
): OutboxEntry<T> {
  return {
    ...entry,
    attempts: 0,
    status: 'pending',
    nextAttemptAt: now,
    lastError: null,
  };
}

/**
 * Whether a server response means "this is done, drop it".
 *
 * The API returns a normal 200 for an idempotent replay. A 409 means the same
 * client id was reused for different work and must remain visible as a failure.
 */
export function isSettled(status: number): boolean {
  return status >= 200 && status < 300;
}

export function isPermanentFailure(status: number): boolean {
  // Auth can recover after a login refresh. Request timeout and rate limiting
  // are also explicitly retryable.
  if (status === 401 || status === 403 || status === 408 || status === 429) {
    return false;
  }
  return status >= 400 && status < 500;
}

export interface OutboxDelivery {
  status: number;
  error?: string;
}

export interface DrainResult {
  attempted: number;
  settled: number;
  deferred: number;
  failed: number;
  persistenceFailures: number;
}

/**
 * Drain one owner's due entries with injected network and storage adapters.
 *
 * No `sending` state is persisted. If the tab closes at any instruction, the
 * original pending row remains and is safe to replay; the server's client id
 * makes concurrent tabs harmless.
 */
export async function drainEntries<T>(
  entries: OutboxEntry<T>[],
  now: number,
  adapters: {
    ownerId: string;
    /** Explicit retry/reconnect bypasses backoff; scheduled polling does not. */
    force?: boolean;
    send: (entry: OutboxEntry<T>) => Promise<OutboxDelivery>;
    put: (entry: OutboxEntry<T>) => Promise<boolean>;
    remove: (id: string) => Promise<boolean>;
  }
): Promise<DrainResult> {
  const result: DrainResult = {
    attempted: 0,
    settled: 0,
    deferred: 0,
    failed: 0,
    persistenceFailures: 0,
  };

  for (const entry of dueEntries(entries, now, {
    ownerId: adapters.ownerId,
    ignoreBackoff: adapters.force,
  })) {
    result.attempted++;
    let delivery: OutboxDelivery | null = null;
    let message = 'network error';

    try {
      delivery = await adapters.send(entry);
      message = delivery.error || `server responded ${delivery.status}`;
    } catch (error) {
      if (error instanceof Error && error.message) message = error.message;
    }

    if (delivery && isSettled(delivery.status)) {
      if (await adapters.remove(entry.id)) result.settled++;
      else result.persistenceFailures++;
      continue;
    }

    const next =
      delivery && isPermanentFailure(delivery.status)
        ? afterPermanentFailure(entry, message)
        : afterFailure(entry, message, now);

    if (!(await adapters.put(next))) {
      result.persistenceFailures++;
    } else if (next.status === 'failed') {
      result.failed++;
    } else {
      result.deferred++;
    }
  }

  return result;
}
