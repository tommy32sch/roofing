import { describe, expect, it } from 'vitest';
import {
  isColdCallResultEntry,
  isKnockResultEntry,
  isLeadResultEntry,
  leadResultRequest,
  type ColdCallResultOutboxEntry,
  type KnockResultOutboxEntry,
} from './useLeadResultOutbox';
import type { OutboxEntry } from './outbox';

const BASE = {
  ownerId: '11111111-1111-4111-8111-111111111111',
  occurredAt: '2026-07-29T10:05:00.000Z',
  status: 'pending' as const,
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
};

describe('lead result outbox routing', () => {
  it('keeps an existing kind=knock row backward compatible', () => {
    const stored = {
      ...BASE,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'knock',
      payload: {
        leadId: 'lead-1',
        disposition: 'not_home',
      },
    } as KnockResultOutboxEntry;

    expect(isKnockResultEntry(stored)).toBe(true);
    expect(isLeadResultEntry(stored)).toBe(true);
    expect(leadResultRequest(stored)).toEqual({
      url: '/api/admin/leads/lead-1/knocks',
      body: {
        client_id: stored.id,
        owner_id: BASE.ownerId,
        disposition: 'not_home',
        notes: null,
        knocked_at: BASE.occurredAt,
      },
    });
  });

  it('routes a cold call with called_at through the same queue', () => {
    const stored = {
      ...BASE,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'cold_call',
      payload: {
        leadId: 'lead-2',
        disposition: 'left_voicemail',
        notes: 'Try after work',
      },
    } as ColdCallResultOutboxEntry;

    expect(isColdCallResultEntry(stored)).toBe(true);
    expect(isLeadResultEntry(stored)).toBe(true);
    expect(leadResultRequest(stored)).toEqual({
      url: '/api/admin/leads/lead-2/calls',
      body: {
        client_id: stored.id,
        owner_id: BASE.ownerId,
        disposition: 'left_voicemail',
        notes: 'Try after work',
        called_at: BASE.occurredAt,
      },
    });
  });

  it('leaves unrelated future outbox work for its own drainer', () => {
    const future = {
      ...BASE,
      id: 'future',
      kind: 'lead_create',
      payload: {},
    } satisfies OutboxEntry;

    expect(isLeadResultEntry(future)).toBe(false);
  });
});
