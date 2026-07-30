import { describe, it, expect } from 'vitest';
import {
  parseAssigneeFilter,
  applyAssigneeFilter,
  assigneeLabel,
  ASSIGNEE_COLUMN,
  UNASSIGNED,
} from './assignment-filter';

const UUID = '310f8b84-7434-46c3-8907-06117b2b383f';

/** Records the calls a PostgREST builder would receive. */
function fakeQuery() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const q = {
    calls,
    eq(...args: unknown[]) { calls.push({ fn: 'eq', args }); return q; },
    is(...args: unknown[]) { calls.push({ fn: 'is', args }); return q; },
    not(...args: unknown[]) { calls.push({ fn: 'not', args }); return q; },
  };
  return q;
}

describe('parseAssigneeFilter', () => {
  it('treats absent or blank as no filter', () => {
    expect(parseAssigneeFilter(null)).toEqual({ kind: 'any' });
    expect(parseAssigneeFilter(undefined)).toEqual({ kind: 'any' });
    expect(parseAssigneeFilter('')).toEqual({ kind: 'any' });
    expect(parseAssigneeFilter('   ')).toEqual({ kind: 'any' });
  });

  // The operationally important one: "who owns nothing" cannot be a user id.
  it('recognises the unassigned sentinel, case-insensitively', () => {
    expect(parseAssigneeFilter(UNASSIGNED)).toEqual({ kind: 'unassigned' });
    expect(parseAssigneeFilter('Unassigned')).toEqual({ kind: 'unassigned' });
    expect(parseAssigneeFilter('  UNASSIGNED  ')).toEqual({ kind: 'unassigned' });
  });

  it('accepts a real user id', () => {
    expect(parseAssigneeFilter(UUID)).toEqual({ kind: 'user', userId: UUID });
  });

  // A filter we cannot understand must not widen the result set.
  it('rejects anything else rather than ignoring it', () => {
    for (const bad of ['chris', '123', 'null', 'undefined', "' OR 1=1--", `${UUID}x`]) {
      expect(parseAssigneeFilter(bad), bad).toEqual({ kind: 'invalid' });
    }
  });
});

describe('applyAssigneeFilter', () => {
  it('adds nothing for "any"', () => {
    const q = fakeQuery();
    applyAssigneeFilter(q, 'setter', { kind: 'any' });
    expect(q.calls).toEqual([]);
  });

  it('uses IS NULL for unassigned, not an equality', () => {
    const q = fakeQuery();
    applyAssigneeFilter(q, 'setter', { kind: 'unassigned' });
    expect(q.calls).toEqual([{ fn: 'is', args: ['assigned_setter_id', null] }]);
  });

  it('matches the right column per role', () => {
    const setter = fakeQuery();
    applyAssigneeFilter(setter, 'setter', { kind: 'user', userId: UUID });
    expect(setter.calls).toEqual([{ fn: 'eq', args: ['assigned_setter_id', UUID] }]);

    const closer = fakeQuery();
    applyAssigneeFilter(closer, 'closer', { kind: 'user', userId: UUID });
    expect(closer.calls).toEqual([{ fn: 'eq', args: ['assigned_closer_id', UUID] }]);
  });

  // Fail closed. An unsatisfiable pair is the honest response to a filter we
  // could not parse — an empty list, never the whole book.
  it('narrows to nothing for an invalid filter', () => {
    const q = fakeQuery();
    applyAssigneeFilter(q, 'closer', { kind: 'invalid' });
    expect(q.calls).toEqual([
      { fn: 'is', args: ['assigned_closer_id', null] },
      { fn: 'not', args: ['assigned_closer_id', 'is', null] },
    ]);
  });

  it('covers both assignable roles', () => {
    expect(Object.keys(ASSIGNEE_COLUMN).sort()).toEqual(['closer', 'setter']);
  });
});

describe('assigneeLabel', () => {
  it('shows the name when there is one', () => {
    expect(assigneeLabel('C. Simmons')).toBe('C. Simmons');
  });

  it('shows an em dash rather than blank or "null"', () => {
    expect(assigneeLabel(null)).toBe('—');
    expect(assigneeLabel(undefined)).toBe('—');
    expect(assigneeLabel('')).toBe('—');
    expect(assigneeLabel('   ')).toBe('—');
  });
});
