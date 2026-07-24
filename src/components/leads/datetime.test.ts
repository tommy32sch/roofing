import { describe, it, expect } from 'vitest';
import { combineDateTime, DEFAULT_TIME } from './datetime';

const DATE = '2026-08-25';

describe('combineDateTime', () => {
  it('is empty with no date, regardless of time', () => {
    expect(combineDateTime('', '', false)).toBe('');
    expect(combineDateTime('', '14:30', false)).toBe('');
    expect(combineDateTime('', '', true)).toBe('');
  });

  it('combines a date and a complete time', () => {
    expect(combineDateTime(DATE, '14:30', false)).toBe(`${DATE}T14:30`);
  });

  it('defaults the time when a date is chosen but the time is left empty', () => {
    // The common one-tap path: pick a date, get a submittable value immediately.
    expect(combineDateTime(DATE, '', false)).toBe(`${DATE}T${DEFAULT_TIME}`);
  });

  // The regression this whole component exists to prevent: a US-locale
  // <input type="time"> reports value === '' while the AM/PM segment is still
  // unset. If a half-typed time collapsed the value to '', the submit button
  // would grey out mid-entry — exactly the reported bug. A date must keep the
  // value blocked ONLY while the time is genuinely mid-entry...
  it('holds the value back while the time is a partial entry (badInput)', () => {
    expect(combineDateTime(DATE, '', true)).toBe('');
  });

  // ...and the instant that partial entry resolves to a real time, the value is
  // usable again — so the disable can never get permanently stuck.
  it('recovers the moment the partial time becomes complete', () => {
    expect(combineDateTime(DATE, '', true)).toBe(''); // mid-entry: 3, no meridiem
    expect(combineDateTime(DATE, '15:00', false)).toBe(`${DATE}T15:00`); // 3:00 PM chosen
  });

  it('never emits the default over a time the user actually entered', () => {
    expect(combineDateTime(DATE, '07:45', false)).toBe(`${DATE}T07:45`);
    expect(combineDateTime(DATE, '23:15', false)).toBe(`${DATE}T23:15`);
  });
});
