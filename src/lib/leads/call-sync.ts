import type { LeadStatus } from '@/types';
import {
  statusForCallDisposition,
  type ColdCallDisposition,
} from './calls';
import {
  isNewerThanCurrent,
  MAX_BACKDATE_MS,
  MAX_CLOCK_SKEW_MS,
  shouldAdvanceStatus,
} from './knock-sync';

export type CallTimeVerdict =
  | { ok: true; calledAt: string }
  | { ok: false; reason: 'invalid' | 'too_far_future' | 'too_old' };

/** Validate an offline call timestamp without trusting a broken device clock. */
export function resolveCalledAt(
  supplied: unknown,
  nowMs: number = Date.now()
): CallTimeVerdict {
  if (supplied === undefined || supplied === null || supplied === '') {
    return { ok: true, calledAt: new Date(nowMs).toISOString() };
  }
  if (typeof supplied !== 'string') return { ok: false, reason: 'invalid' };

  const ms = Date.parse(supplied);
  if (Number.isNaN(ms)) return { ok: false, reason: 'invalid' };
  if (ms > nowMs + MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'too_far_future' };
  if (ms < nowMs - MAX_BACKDATE_MS) return { ok: false, reason: 'too_old' };

  return { ok: true, calledAt: new Date(ms).toISOString() };
}

export interface CallDerivedUpdate {
  call_count: number;
  is_dnc?: true;
  last_call_at?: string;
  last_call_disposition?: ColdCallDisposition;
  status?: LeadStatus;
}

/**
 * Derive the lead summary from an append-only call that may arrive out of order.
 *
 * Every accepted event increments the count. Only the chronologically newest
 * call controls the visible last-call fields, while Do Not Call remains sticky
 * regardless of arrival order.
 */
export function callDerivedUpdate(input: {
  calledAt: string;
  disposition: ColdCallDisposition;
  currentLastCallAt: string | null | undefined;
  currentCallCount: number | null | undefined;
  currentStatus: LeadStatus;
  nextStatus: LeadStatus | null;
}): CallDerivedUpdate {
  const update: CallDerivedUpdate = {
    call_count: (input.currentCallCount ?? 0) + 1,
  };

  if (input.disposition === 'do_not_call') update.is_dnc = true;

  if (isNewerThanCurrent(input.calledAt, input.currentLastCallAt)) {
    update.last_call_at = input.calledAt;
    update.last_call_disposition = input.disposition;
  }

  if (shouldAdvanceStatus(input.currentStatus, input.nextStatus)) {
    update.status = input.nextStatus;
  }

  return update;
}

export interface CallLeadState {
  id: string;
  status: LeadStatus;
  last_call_at: string | null;
  last_call_disposition: string | null;
  call_count: number;
  is_dnc: boolean;
}

export interface QueuedCall {
  occurredAt: string;
  payload: {
    leadId: string;
    disposition: ColdCallDisposition;
  };
}

/** Overlay unsynced cold calls on map leads without mutating server data. */
export function applyQueuedCalls<T extends CallLeadState>(
  leads: T[],
  entries: QueuedCall[]
): T[] {
  if (entries.length === 0) return leads;

  const byLead = new Map<string, QueuedCall[]>();
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
      const update = callDerivedUpdate({
        calledAt: entry.occurredAt,
        disposition: entry.payload.disposition,
        currentLastCallAt: optimistic.last_call_at,
        currentCallCount: optimistic.call_count,
        currentStatus: optimistic.status,
        nextStatus: statusForCallDisposition(entry.payload.disposition),
      });
      optimistic = { ...optimistic, ...update };
    }
    return optimistic;
  });
}
