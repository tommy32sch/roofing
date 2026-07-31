import { describe, it, expect } from 'vitest';
import {
  buildLeadDeletionRecord,
  totalDestroyed,
  isSignificantDeletion,
  deletedLeadLabel,
} from './lead-deletion';

const lead = {
  id: 'lead-1',
  first_name: 'Jane',
  last_name: 'Smith',
  phone: '555-0100',
  email: 'jane@example.com',
  address_street: '1421 E Palm Ln',
  address_city: 'Phoenix',
  address_state: 'AZ',
  address_zip: '85006',
  status: 'appointment_set',
  deal_value: 18000,
  market_id: 1,
  assigned_setter_id: 'setter-1',
  assigned_closer_id: null,
  created_at: '2026-06-01T00:00:00.000Z',
  created_by: 'admin-1',
};

const deleter = { sub: 'admin-9', name: 'Poopsy Belle', email: 'p@b.co', role: 'admin' };

describe('buildLeadDeletionRecord', () => {
  it('snapshots the lead rather than referencing it', () => {
    const r = buildLeadDeletionRecord(lead, deleter, { activities: 3, knocks: 2 });
    expect(r.lead_id).toBe('lead-1');
    expect(r.first_name).toBe('Jane');
    expect(r.address_street).toBe('1421 E Palm Ln');
    expect(r.status).toBe('appointment_set');
    expect(r.deal_value).toBe(18000);
    // The row it names is gone, so the values must stand alone.
    expect(r.lead_created_at).toBe('2026-06-01T00:00:00.000Z');
  });

  it('records who deleted it, by name and role', () => {
    const r = buildLeadDeletionRecord(lead, deleter);
    expect(r.deleted_by).toBe('admin-9');
    expect(r.deleted_by_name).toBe('Poopsy Belle');
    expect(r.deleted_by_role).toBe('admin');
  });

  // An audit trail that goes blank when someone leaves is not an audit trail.
  it('falls back to email when the account has no name', () => {
    expect(buildLeadDeletionRecord(lead, { ...deleter, name: null }).deleted_by_name).toBe('p@b.co');
    expect(buildLeadDeletionRecord(lead, { ...deleter, name: '   ' }).deleted_by_name).toBe('p@b.co');
    expect(
      buildLeadDeletionRecord(lead, { ...deleter, name: null, email: null }).deleted_by_name
    ).toBeNull();
  });

  it('defaults every destroyed count to zero', () => {
    const r = buildLeadDeletionRecord(lead, deleter);
    for (const k of ['activities_destroyed', 'knocks_destroyed', 'calls_destroyed',
      'photos_destroyed', 'appointments_destroyed']) {
      expect(r[k], k).toBe(0);
    }
  });

  it('carries the counts through', () => {
    const r = buildLeadDeletionRecord(lead, deleter, {
      activities: 4, knocks: 14, calls: 2, photos: 5, appointments: 1,
    });
    expect(r.knocks_destroyed).toBe(14);
    expect(r.photos_destroyed).toBe(5);
    expect(r.appointments_destroyed).toBe(1);
  });

  it('survives a sparse lead row', () => {
    const r = buildLeadDeletionRecord({ id: 'x' }, deleter);
    expect(r.lead_id).toBe('x');
    expect(r.first_name).toBeNull();
    expect(r.deal_value).toBeNull();
  });
});

describe('totalDestroyed', () => {
  it('sums every child record lost', () => {
    expect(totalDestroyed({ activities: 4, knocks: 14, calls: 2, photos: 5, appointments: 1 })).toBe(26);
  });

  it('is zero for an untouched lead', () => {
    expect(totalDestroyed({})).toBe(0);
  });
});

describe('isSignificantDeletion', () => {
  /**
   * The distinction that makes the list readable. Deleting a duplicate nobody
   * worked is routine; deleting a lead with fieldwork against it is not.
   */
  it('flags a deletion that destroyed fieldwork', () => {
    expect(isSignificantDeletion({ knocks: 1 })).toBe(true);
    expect(isSignificantDeletion({ calls: 1 })).toBe(true);
    expect(isSignificantDeletion({ appointments: 1 })).toBe(true);
  });

  // Activities and photos alone are bookkeeping — every lead has activities.
  it('does not flag a lead that was never worked', () => {
    expect(isSignificantDeletion({})).toBe(false);
    expect(isSignificantDeletion({ activities: 6, photos: 2 })).toBe(false);
  });
});

describe('deletedLeadLabel', () => {
  it('prefers the name', () => {
    expect(deletedLeadLabel({ first_name: 'Jane', last_name: 'Smith' })).toBe('Jane Smith');
  });

  it('copes with half a name', () => {
    expect(deletedLeadLabel({ first_name: 'Jane', last_name: null })).toBe('Jane');
  });

  it('falls back to the address, then to a placeholder', () => {
    expect(deletedLeadLabel({ address_street: '1421 E Palm Ln' })).toBe('1421 E Palm Ln');
    expect(deletedLeadLabel({})).toBe('Unnamed lead');
  });
});
