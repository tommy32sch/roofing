import { describe, expect, it } from 'vitest';
import { mapDrawAvailability } from './map-drawing';

describe('map draw controls', () => {
  it('keeps lead-area selection available in All Markets', () => {
    expect(mapDrawAvailability({
      loading: false,
      shownLeadCount: 12,
      selectedMarketId: null,
    })).toEqual({
      selectionDisabled: false,
      territoryDisabled: true,
    });
  });

  it('allows an empty market to receive its first saved territory', () => {
    expect(mapDrawAvailability({
      loading: false,
      shownLeadCount: 0,
      selectedMarketId: 2,
    })).toEqual({
      selectionDisabled: true,
      territoryDisabled: false,
    });
  });

  it('disables both actions while map leads are loading', () => {
    expect(mapDrawAvailability({
      loading: true,
      shownLeadCount: 12,
      selectedMarketId: 2,
    })).toEqual({
      selectionDisabled: true,
      territoryDisabled: true,
    });
  });
});
