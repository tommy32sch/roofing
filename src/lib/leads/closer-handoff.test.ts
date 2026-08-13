import { describe, expect, it } from 'vitest';
import { isAssignableCloserRole, resolveCloserHandoff } from './closer-handoff';

const CLOSER_ID = '00000000-0000-4000-8000-000000000003';
const OTHER_ID = '00000000-0000-4000-8000-000000000004';

describe('isAssignableCloserRole', () => {
  it('accepts a closer or an admin and refuses a setter', () => {
    expect(isAssignableCloserRole('closer')).toBe(true);
    expect(isAssignableCloserRole('admin')).toBe(true);
    expect(isAssignableCloserRole('setter')).toBe(false);
    expect(isAssignableCloserRole(null)).toBe(false);
  });
});

describe('resolveCloserHandoff', () => {
  it('requires a closer when none is assigned and none is sent', () => {
    expect(resolveCloserHandoff(null, undefined)).toEqual({
      ok: false,
      error: 'A closer is required to book this appointment',
    });
  });

  it('keeps the current closer when the caller does not send a new one', () => {
    expect(resolveCloserHandoff(CLOSER_ID, null)).toEqual({ ok: true, closerId: CLOSER_ID });
  });

  it('uses a valid requested closer', () => {
    expect(resolveCloserHandoff(CLOSER_ID, OTHER_ID)).toEqual({ ok: true, closerId: OTHER_ID });
  });

  it('rejects a malformed closer id', () => {
    expect(resolveCloserHandoff(null, 'not-a-uuid')).toEqual({
      ok: false,
      error: 'Invalid closer',
    });
  });
});
