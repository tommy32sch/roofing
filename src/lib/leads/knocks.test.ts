import { describe, it, expect } from 'vitest';
import { statusForDisposition, knockRecency, knockLabel, KNOCK_DISPOSITIONS } from './knocks';

describe('statusForDisposition', () => {
  it('books an appointment', () => {
    expect(statusForDisposition('appointment_set')).toBe('appointment_set');
  });

  it('counts answering the door as contact', () => {
    expect(statusForDisposition('callback')).toBe('contacted');
    expect(statusForDisposition('not_interested')).toBe('contacted');
    expect(statusForDisposition('no_damage')).toBe('contacted');
  });

  it('does NOT treat an unanswered door as contact', () => {
    // Otherwise every rep's contact rate inflates with empty houses.
    expect(statusForDisposition('not_home')).toBeNull();
  });

  it('leaves status alone for do-not-knock', () => {
    expect(statusForDisposition('do_not_knock')).toBeNull();
  });

  it('covers every disposition', () => {
    for (const d of KNOCK_DISPOSITIONS) {
      expect(() => statusForDisposition(d.value)).not.toThrow();
    }
  });
});

describe('knockRecency', () => {
  const now = new Date('2026-08-01T12:00:00Z').getTime();
  it('never knocked', () => expect(knockRecency(null, now)).toBe('never'));
  it('recent within two weeks', () => {
    expect(knockRecency('2026-07-30T12:00:00Z', now)).toBe('recent');
    expect(knockRecency('2026-07-18T13:00:00Z', now)).toBe('recent');
  });
  it('stale beyond two weeks', () => {
    expect(knockRecency('2026-07-01T12:00:00Z', now)).toBe('stale');
  });
});

describe('knockLabel', () => {
  it('renders human labels', () => {
    expect(knockLabel('not_home')).toBe('Not home');
    expect(knockLabel('do_not_knock')).toBe('Do not knock');
  });
  it('falls back to the raw value', () => {
    expect(knockLabel('mystery')).toBe('mystery');
  });
});
