import type { LeadStatus } from '@/types';
import { statusForDisposition, type KnockDisposition } from './knocks';

/**
 * Rules for accepting a knock that may have been taken offline.
 *
 * A knock replayed from a phone arrives late and out of order, so the server
 * cannot treat "most recently received" as "most recent". These are pure so the
 * awkward cases — a clock-skewed handset, a knock replayed after a newer one,
 * a queue drained days later — are testable without a database.
 */

/** How far ahead of the server a handset's clock may be and still be believed. */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** Older than this and we assume a stuck queue rather than a real knock. */
export const MAX_BACKDATE_MS = 30 * 24 * 3_600_000;

export type KnockTimeVerdict =
  | { ok: true; knockedAt: string }
  | { ok: false; reason: 'invalid' | 'too_far_future' | 'too_old' };

/**
 * Validate a client-supplied knock time.
 *
 * A phone with a wrong clock must not be able to write a knock into next year
 * and permanently poison recency for that door, so the future is clamped hard
 * while a modest skew is tolerated.
 */
export function resolveKnockedAt(
  supplied: unknown,
  nowMs: number = Date.now()
): KnockTimeVerdict {
  if (supplied === undefined || supplied === null || supplied === '') {
    return { ok: true, knockedAt: new Date(nowMs).toISOString() };
  }
  if (typeof supplied !== 'string') return { ok: false, reason: 'invalid' };

  const ms = Date.parse(supplied);
  if (Number.isNaN(ms)) return { ok: false, reason: 'invalid' };
  if (ms > nowMs + MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'too_far_future' };
  if (ms < nowMs - MAX_BACKDATE_MS) return { ok: false, reason: 'too_old' };

  return { ok: true, knockedAt: new Date(ms).toISOString() };
}

/**
 * Whether this knock should become the lead's visible latest.
 *
 * The outbox drains oldest-first, but a phone that was offline for a day can
 * still deliver yesterday's knock after today's. `last_knock_at` and
 * `last_disposition` describe the MOST RECENT knock, so an older arrival must
 * be stored as history without dragging the door's state backwards.
 */
export function isNewerThanCurrent(
  knockedAt: string,
  currentLastKnockAt: string | null | undefined
): boolean {
  if (!currentLastKnockAt) return true;
  const incoming = Date.parse(knockedAt);
  const current = Date.parse(currentLastKnockAt);
  if (Number.isNaN(incoming)) return false;
  if (Number.isNaN(current)) return true;
  return incoming >= current;
}

const STATUS_RANK: Record<LeadStatus, number> = {
  new: 0,
  contacted: 1,
  appointment_set: 2,
  inspected: 3,
  proposal_sent: 4,
  sold: 5,
  lost: 5,
};

/** Door outcomes may advance the pipeline, but never move it backwards. */
export function shouldAdvanceStatus(
  current: LeadStatus,
  target: LeadStatus | null
): target is LeadStatus {
  return target !== null && STATUS_RANK[target] > STATUS_RANK[current];
}

export interface KnockDerivedUpdate {
  knock_count: number;
  do_not_knock?: true;
  last_knock_at?: string;
  last_disposition?: KnockDisposition;
  status?: LeadStatus;
}

/**
 * Which derived fields a knock updates on the lead.
 *
 * Split out because the answer differs for a late arrival: it always counts
 * toward knock_count and can always set do_not_knock — that flag is sticky and
 * a "do not knock" is never made stale by a later visit. Recency fields follow
 * event time, while pipeline progress is monotonic and independent of arrival.
 */
export function knockDerivedUpdate(input: {
  knockedAt: string;
  disposition: KnockDisposition;
  currentLastKnockAt: string | null | undefined;
  currentKnockCount: number | null | undefined;
  currentStatus: LeadStatus;
  nextStatus: LeadStatus | null;
}): KnockDerivedUpdate {
  const update: KnockDerivedUpdate = {
    knock_count: (input.currentKnockCount ?? 0) + 1,
  };

  // Sticky regardless of ordering: a house asked not to be knocked stays that
  // way even if the request arrives after a later "not home".
  if (input.disposition === 'do_not_knock') update.do_not_knock = true;

  if (isNewerThanCurrent(input.knockedAt, input.currentLastKnockAt)) {
    update.last_knock_at = input.knockedAt;
    update.last_disposition = input.disposition;
  }

  // Contact is a business fact, independent of which event is newest. A
  // yesterday callback arriving after today's "not home" may still advance a
  // new lead to contacted, but no disposition may regress inspected/proposal.
  if (shouldAdvanceStatus(input.currentStatus, input.nextStatus)) {
    update.status = input.nextStatus;
  }

  return update;
}

export interface KnockLeadState {
  id: string;
  status: LeadStatus;
  last_knock_at: string | null;
  last_disposition: string | null;
  knock_count: number;
  do_not_knock: boolean;
}

export interface QueuedKnock {
  occurredAt: string;
  payload: {
    leadId: string;
    disposition: KnockDisposition;
  };
}

/**
 * Overlay unsynced events on server leads without mutating either input.
 *
 * This survives refetches and reloads: the IndexedDB rows remain the optimistic
 * source until the atomic server write lands and the outbox removes them.
 */
export function applyQueuedKnocks<T extends KnockLeadState>(
  leads: T[],
  entries: QueuedKnock[]
): T[] {
  if (entries.length === 0) return leads;

  const byLead = new Map<string, QueuedKnock[]>();
  for (const entry of entries) {
    const list = byLead.get(entry.payload.leadId) ?? [];
    list.push(entry);
    byLead.set(entry.payload.leadId, list);
  }
  for (const list of byLead.values()) {
    list.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  return leads.map((lead) => {
    const queued = byLead.get(lead.id);
    if (!queued) return lead;

    let optimistic = { ...lead };
    for (const entry of queued) {
      const update = knockDerivedUpdate({
        knockedAt: entry.occurredAt,
        disposition: entry.payload.disposition,
        currentLastKnockAt: optimistic.last_knock_at,
        currentKnockCount: optimistic.knock_count,
        currentStatus: optimistic.status,
        nextStatus: statusForDisposition(entry.payload.disposition),
      });
      optimistic = { ...optimistic, ...update };
    }
    return optimistic;
  });
}
