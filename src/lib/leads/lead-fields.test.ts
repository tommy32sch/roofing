import { describe, it, expect } from 'vitest';
import {
  pickWritableLeadFields,
  statusDenialReason,
  LEAD_ADMIN_ONLY_FIELDS,
  LEAD_EDITABLE_FIELDS,
} from './lead-fields';

describe('pickWritableLeadFields', () => {
  /**
   * The bug this module exists for. The create route spread the raw request body
   * into a service-role insert, so a setter could POST these four columns and
   * award themselves a sale the performance leaderboard then counted.
   */
  it('drops financial and setter-assignment fields for a setter', () => {
    const out = pickWritableLeadFields(
      {
        first_name: 'A',
        deal_value: 250000,
        assigned_setter_id: 'self',
        market_id: 2,
      },
      'setter'
    );
    expect(out).toEqual({ first_name: 'A' });
  });

  it('lets a setter hand a lead to a closer', () => {
    expect(pickWritableLeadFields({ assigned_closer_id: 'self' }, 'setter')).toEqual({
      assigned_closer_id: 'self',
    });
  });

  it('drops financial and assignment fields for a closer', () => {
    expect(pickWritableLeadFields({ deal_value: 1, assigned_closer_id: 'self' }, 'closer')).toEqual({});
  });

  it('keeps them for an admin', () => {
    const out = pickWritableLeadFields({ deal_value: 9000, assigned_setter_id: 'u1' }, 'admin');
    expect(out).toEqual({ deal_value: 9000, assigned_setter_id: 'u1' });
  });

  // Server-controlled columns must never be writable, at any role. id and
  // created_by would let a caller forge provenance; is_flagged_duplicate would
  // let them hide a lead from dedupe.
  it('ignores server-controlled columns even for an admin', () => {
    const out = pickWritableLeadFields(
      {
        id: 'forged',
        created_by: 'someone-else',
        created_by_name: 'Someone Else',
        is_flagged_duplicate: false,
        latitude: 1,
        longitude: 2,
        estimated_roof_value: 1,
        phone_normalized: '+15550000000',
        created_at: '2020-01-01',
        first_name: 'Real',
      },
      'admin'
    );
    expect(out).toEqual({ first_name: 'Real' });
  });

  it('passes through ordinary property and contact fields', () => {
    const body = {
      first_name: 'A', last_name: 'B', phone: '555', email: 'a@b.co',
      address_street: '1 Main', address_city: 'Phoenix', address_state: 'AZ', address_zip: '85001',
      sqft: 2000, stories: 1, roof_type: 'shingle', status: 'new', priority: 'high',
    };
    expect(pickWritableLeadFields(body, 'setter')).toEqual(body);
  });

  it('is empty for an empty body', () => {
    expect(pickWritableLeadFields({}, 'setter')).toEqual({});
  });

  // A dropped key must be absent, not present-and-undefined — an explicit
  // undefined would still appear in the insert payload.
  it('omits dropped keys rather than setting them undefined', () => {
    const out = pickWritableLeadFields({ deal_value: 5 }, 'setter');
    expect('deal_value' in out).toBe(false);
  });

  it('keeps a falsy value that is legitimately writable', () => {
    expect(pickWritableLeadFields({ roof_age: 0, source_notes: '' }, 'setter')).toEqual({
      roof_age: 0,
      source_notes: '',
    });
  });
});

describe('field sets', () => {
  it('treats every admin-only field as editable, so admins can still set them', () => {
    for (const f of LEAD_ADMIN_ONLY_FIELDS) {
      expect(LEAD_EDITABLE_FIELDS.has(f), f).toBe(true);
    }
  });

  it('never exposes provenance or derived columns', () => {
    for (const f of ['id', 'created_by', 'created_by_name', 'created_at', 'updated_at',
      'latitude', 'longitude', 'phone_normalized', 'estimated_roof_value', 'is_flagged_duplicate']) {
      expect(LEAD_EDITABLE_FIELDS.has(f), f).toBe(false);
    }
  });
});

describe('statusDenialReason', () => {
  it('stops a setter marking a lead sold', () => {
    expect(statusDenialReason('sold', 'setter')).toBe('Setters cannot mark a lead as sold');
  });

  it('stops a setter using a closer-only status', () => {
    for (const s of ['inspected', 'proposal_sent']) {
      expect(statusDenialReason(s, 'setter'), s).toBe('Setters cannot set this status');
    }
  });

  it('allows the statuses a setter owns', () => {
    for (const s of ['new', 'contacted', 'appointment_set', 'lost']) {
      expect(statusDenialReason(s, 'setter'), s).toBeNull();
    }
  });

  it('does not restrict admins or closers', () => {
    expect(statusDenialReason('sold', 'admin')).toBeNull();
    expect(statusDenialReason('sold', 'closer')).toBeNull();
  });

  it('stops a setter moving a sold lead to another status', () => {
    expect(statusDenialReason('lost', 'setter', 'sold')).toBe('Setters cannot change a sold lead');
    expect(statusDenialReason('new', 'setter', 'sold')).toBe('Setters cannot change a sold lead');
  });

  // No status in the payload means no transition was requested.
  it('is silent when no status is supplied', () => {
    expect(statusDenialReason(undefined, 'setter')).toBeNull();
    expect(statusDenialReason(null, 'setter')).toBeNull();
    expect(statusDenialReason('', 'setter')).toBeNull();
    expect(statusDenialReason(42, 'setter')).toBeNull();
  });
});
