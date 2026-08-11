import { describe, it, expect } from 'vitest';
import {
  KNOCK_DISPOSITIONS,
  KNOCK_DISPOSITION_VALUES,
  QUICK_KNOCK_DISPOSITIONS,
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

describe('QUICK_KNOCK_DISPOSITIONS', () => {
  it('are all real, selectable dispositions', () => {
    for (const v of QUICK_KNOCK_DISPOSITIONS) {
      expect(KNOCK_DISPOSITION_VALUES.has(v), v).toBe(true);
    }
  });

  /**
   * The promise these make is one tap, so every promoted outcome must be
   * terminal — nothing that opens a scheduling step, a won-lead step, or a
   * follow-up-date prompt. If a later edit adds one of those to the quick list,
   * the popup would fire the flow with no way to complete it, and this fails
   * before it ships.
   */
  it('are terminal — none open a follow-up or a downstream flow', () => {
    const OPENS_A_FLOW = new Set([
      'appointment_set',   // opens scheduling
      'contract_signed',   // opens the won-lead workflow
      'callback',          // prompts for a follow-up date
      'call_back',         // prompts for a follow-up date
    ]);
    for (const v of QUICK_KNOCK_DISPOSITIONS) {
      expect(OPENS_A_FLOW.has(v), `${v} opens a flow and cannot be one tap`).toBe(false);
    }
  });

  it('is a short list — the popup has room for two, not nine', () => {
    expect(QUICK_KNOCK_DISPOSITIONS.length).toBeLessThanOrEqual(2);
  });
});
