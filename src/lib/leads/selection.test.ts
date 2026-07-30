import { describe, it, expect } from 'vitest';
import {
  leadFilterKey,
  selectionSurvivesFilterChange,
  LEAD_FILTER_FIELDS,
  type LeadFilterScope,
} from './selection';

const EMPTY: LeadFilterScope = {
  status: '',
  priority: '',
  search: '',
  streetNumber: '',
  streetDir: '',
  streetName: '',
  streets: '',
  dncOnly: false,
  marketId: '',
  createdBy: '',
};

/** A non-default value for each field, used to prove the key reacts to it. */
const CHANGED: LeadFilterScope = {
  status: 'new',
  priority: 'high',
  search: 'lopez',
  streetNumber: '3880',
  streetDir: 'E',
  streetName: 'Monte Vista',
  streets: 'Oak St|Coronado Rd',
  dncOnly: true,
  marketId: '2',
  createdBy: 'user-1',
};

describe('leadFilterKey', () => {
  it('is stable for the same filter set', () => {
    expect(leadFilterKey(EMPTY)).toBe(leadFilterKey({ ...EMPTY }));
    expect(leadFilterKey(CHANGED)).toBe(leadFilterKey({ ...CHANGED }));
  });

  /**
   * The guard that matters. If someone adds a filter to the leads page and
   * forgets to include it here, the selection would survive that filter change
   * and bulk-assign could write to rows the operator cannot see.
   */
  it('changes when ANY single filter changes', () => {
    const base = leadFilterKey(EMPTY);
    for (const field of LEAD_FILTER_FIELDS) {
      const mutated = { ...EMPTY, [field]: CHANGED[field] } as LeadFilterScope;
      expect(leadFilterKey(mutated), `key ignores "${field}"`).not.toBe(base);
    }
  });

  it('covers every field of the scope', () => {
    expect(new Set(LEAD_FILTER_FIELDS)).toEqual(new Set(Object.keys(EMPTY)));
  });

  /**
   * Concatenation would make these identical. A colliding key means the
   * selection is NOT cleared, which is the destructive case.
   */
  it('does not collide when a value moves between fields', () => {
    const asStatus = leadFilterKey({ ...EMPTY, status: 'new' });
    const asPriority = leadFilterKey({ ...EMPTY, priority: 'new' });
    expect(asStatus).not.toBe(asPriority);
  });

  it('does not collide on values containing the streets separator', () => {
    const a = leadFilterKey({ ...EMPTY, streets: 'Oak|Elm' });
    const b = leadFilterKey({ ...EMPTY, streets: 'Oak', streetName: 'Elm' });
    expect(a).not.toBe(b);
  });

  it('distinguishes the DNC toggle in both directions', () => {
    expect(leadFilterKey({ ...EMPTY, dncOnly: true })).not.toBe(leadFilterKey(EMPTY));
  });
});

describe('selectionSurvivesFilterChange', () => {
  it('keeps a selection while the filter is unchanged, so paging accumulates', () => {
    const key = leadFilterKey(CHANGED);
    expect(selectionSurvivesFilterChange(key, key)).toBe(true);
  });

  // The reported bug, as a test: rows picked with no filter must not remain
  // selected once the list narrows to Do Not Call.
  it('drops a selection when the operator narrows to DNC', () => {
    const before = leadFilterKey(EMPTY);
    const after = leadFilterKey({ ...EMPTY, dncOnly: true });
    expect(selectionSurvivesFilterChange(before, after)).toBe(false);
  });

  it('drops a selection when the market changes', () => {
    const az = leadFilterKey({ ...EMPTY, marketId: '1' });
    const mn = leadFilterKey({ ...EMPTY, marketId: '2' });
    expect(selectionSurvivesFilterChange(az, mn)).toBe(false);
  });

  it('drops a selection when a search is applied or cleared', () => {
    const none = leadFilterKey(EMPTY);
    const searched = leadFilterKey({ ...EMPTY, search: 'lopez' });
    expect(selectionSurvivesFilterChange(none, searched)).toBe(false);
    expect(selectionSurvivesFilterChange(searched, none)).toBe(false);
  });
});
