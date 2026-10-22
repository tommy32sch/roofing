import { describe, it, expect } from 'vitest';
import {
  bulkDeleteConfirmed,
  describeFieldwork,
  parseDeletionReceipt,
  parseLeadIdList,
  photoPathsToRemove,
  totalDestroyed,
  isSignificantDeletion,
  deletedLeadLabel,
} from './lead-deletion';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('parseLeadIdList', () => {
  it('accepts valid ids and drops duplicates', () => {
    expect(parseLeadIdList([A, B, A], 500)).toEqual({ ok: true, ids: [A, B] });
  });

  it('rejects anything that is not a list of UUIDs', () => {
    for (const value of [undefined, null, A, {}, [A, 'nope'], [A, 7]]) {
      expect(parseLeadIdList(value, 500).ok, JSON.stringify(value)).toBe(false);
    }
  });

  it('rejects an empty list and one over the cap', () => {
    expect(parseLeadIdList([], 500).ok).toBe(false);
    expect(parseLeadIdList([A, B], 1)).toEqual({ ok: false, error: 'lead_ids must contain 1-1 leads' });
  });

  // The cap applies after de-duplication, so repeats cannot push a list over.
  it('counts unique ids against the cap', () => {
    expect(parseLeadIdList([A, A, A], 1)).toEqual({ ok: true, ids: [A] });
  });
});

const receipt = (over: Record<string, unknown> = {}) => ({
  dry_run: false,
  requested_count: 2,
  found_count: 2,
  deleted_count: 2,
  worked_count: 1,
  activities: 6,
  knocks: 14,
  calls: 2,
  photos: 1,
  appointments: 1,
  photo_paths: [`${A}/roof.jpg`],
  ...over,
});

describe('parseDeletionReceipt', () => {
  it('reads a complete receipt', () => {
    expect(parseDeletionReceipt(receipt(), { requested: 2, dryRun: false })).toEqual({
      dryRun: false,
      requested: 2,
      found: 2,
      deleted: 2,
      worked: 1,
      destroyed: { activities: 6, knocks: 14, calls: 2, photos: 1, appointments: 1 },
      photoPaths: [`${A}/roof.jpg`],
    });
  });

  it('accepts leads that were already gone', () => {
    const r = parseDeletionReceipt(
      receipt({ found_count: 1, deleted_count: 1 }),
      { requested: 2, dryRun: false }
    );
    expect(r?.found).toBe(1);
    expect(r?.deleted).toBe(1);
  });

  it('accepts a dry run that deleted nothing', () => {
    const r = parseDeletionReceipt(
      receipt({ dry_run: true, deleted_count: 0, photo_paths: [] }),
      { requested: 2, dryRun: true }
    );
    expect(r?.dryRun).toBe(true);
    expect(r?.deleted).toBe(0);
  });

  // "Deleted" must never be reported on a result that does not add up.
  it('rejects a receipt that does not account for the request', () => {
    const bad = [
      null,
      [],
      'ok',
      receipt({ deleted_count: 1 }),
      receipt({ found_count: 3, deleted_count: 3 }),
      receipt({ requested_count: 3 }),
      receipt({ dry_run: true }),
      receipt({ worked_count: 3 }),
      receipt({ knocks: -1 }),
      receipt({ calls: 1.5 }),
      receipt({ photos: '1' }),
      receipt({ photo_paths: null }),
      receipt({ photo_paths: [7] }),
    ];
    for (const data of bad) {
      expect(parseDeletionReceipt(data, { requested: 2, dryRun: false }), JSON.stringify(data)).toBeNull();
    }
  });

  it('rejects a dry run that claims to have deleted', () => {
    expect(
      parseDeletionReceipt(receipt({ dry_run: true }), { requested: 2, dryRun: true })
    ).toBeNull();
  });
});

describe('photoPathsToRemove', () => {
  it('keeps only paths inside a deleted lead folder', () => {
    expect(
      photoPathsToRemove(
        [`${A}/a.jpg`, `${B}/b.jpg`, `${A}/../${B}/c.jpg`, 'loose.jpg', `x${A}/d.jpg`],
        [A]
      )
    ).toEqual([`${A}/a.jpg`]);
  });

  it('removes nothing when no lead was deleted', () => {
    expect(photoPathsToRemove([`${A}/a.jpg`], [])).toEqual([]);
  });
});

describe('describeFieldwork', () => {
  it('lists the fieldwork that goes with a deletion', () => {
    expect(describeFieldwork({ knocks: 14, calls: 1, appointments: 2, photos: 1, activities: 9 }))
      .toBe('14 knocks, 1 call, 2 appointments, 1 photo');
  });

  it('is empty when there is none', () => {
    expect(describeFieldwork({ activities: 4 })).toBe('');
  });
});

describe('bulkDeleteConfirmed', () => {
  it('requires the exact number of selected leads', () => {
    expect(bulkDeleteConfirmed('48', 48)).toBe(true);
    expect(bulkDeleteConfirmed(' 48 ', 48)).toBe(true);
    expect(bulkDeleteConfirmed('4', 48)).toBe(false);
    expect(bulkDeleteConfirmed('delete', 48)).toBe(false);
    expect(bulkDeleteConfirmed('', 0)).toBe(false);
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
