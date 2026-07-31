import { describe, it, expect } from 'vitest';
import { canViewLead } from './lead-visibility';

describe('canViewLead', () => {
  it('lets an admin see any lead', () => {
    for (const s of ['new', 'contacted', 'appointment_set', 'sold', 'lost', null]) {
      expect(canViewLead('admin', s), String(s)).toBe(true);
    }
  });

  // Setters knock every door, so they see every lead. Deliberate: knowing who
  // owns a door is what stops two reps knocking it.
  it('lets a setter see any lead', () => {
    for (const s of ['new', 'contacted', 'sold', null]) {
      expect(canViewLead('setter', s), String(s)).toBe(true);
    }
  });

  it('lets a closer see a sold lead', () => {
    expect(canViewLead('closer', 'sold')).toBe(true);
  });

  // The restriction this exists for — matches the lead detail route.
  it('refuses a closer any lead that is not sold', () => {
    for (const s of ['new', 'contacted', 'appointment_set', 'inspected', 'proposal_sent', 'lost']) {
      expect(canViewLead('closer', s), s).toBe(false);
    }
  });

  /**
   * Fails closed. A missing status normally means the lead row could not be
   * read at all, and defaulting to "probably fine" is the wrong instinct in an
   * access check.
   */
  it('refuses a closer when the status is unknown', () => {
    expect(canViewLead('closer', null)).toBe(false);
    expect(canViewLead('closer', undefined)).toBe(false);
    expect(canViewLead('closer', '')).toBe(false);
  });
});
