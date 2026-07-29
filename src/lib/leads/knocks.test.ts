import { describe, it, expect } from 'vitest';
import {
  KNOCK_DISPOSITIONS,
  KNOCK_DISPOSITION_VALUES,
  knockLabel,
  knockRecency,
  statusForDisposition,
} from './knocks';

describe('KNOCK_DISPOSITIONS', () => {
  it('exposes the exact selectable product list in order', () => {
    expect(KNOCK_DISPOSITIONS.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 'not_home', label: 'Not Home' },
      { value: 'callback', label: 'Go Back' },
      { value: 'call_back', label: 'Call Back' },
      { value: 'referral', label: 'Referral' },
      { value: 'appointment_set', label: 'Appointment' },
      { value: 'contract_signed', label: 'Contract Signed' },
      { value: 'not_interested', label: 'Not Interested' },
      { value: 'renter', label: 'Renter' },
      { value: 'do_not_knock', label: 'Do Not Knock' },
    ]);
  });

  it('accepts legacy no_damage without showing it as a selectable result', () => {
    expect(KNOCK_DISPOSITION_VALUES.has('no_damage')).toBe(true);
    expect(KNOCK_DISPOSITIONS.map((result) => result.value as string)).not.toContain('no_damage');
    expect(knockLabel('no_damage')).toBe('No Damage');
  });
});

describe('statusForDisposition', () => {
  it('does not bypass required appointment or won-lead workflows', () => {
    expect(statusForDisposition('appointment_set')).toBe('contacted');
    expect(statusForDisposition('contract_signed')).toBe('contacted');
  });

  it('counts answering the door as contact', () => {
    expect(statusForDisposition('callback')).toBe('contacted');
    expect(statusForDisposition('call_back')).toBe('contacted');
    expect(statusForDisposition('referral')).toBe('contacted');
    expect(statusForDisposition('not_interested')).toBe('contacted');
    expect(statusForDisposition('renter')).toBe('contacted');
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
    expect(() => statusForDisposition('no_damage')).not.toThrow();
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
    expect(knockLabel('not_home')).toBe('Not Home');
    expect(knockLabel('callback')).toBe('Go Back');
    expect(knockLabel('do_not_knock')).toBe('Do Not Knock');
  });
  it('falls back to the raw value', () => {
    expect(knockLabel('mystery')).toBe('mystery');
  });
});
