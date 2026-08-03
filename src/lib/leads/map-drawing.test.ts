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
      selectionBlockedReason: null,
      territoryBlockedReason:
        'Choose a single market to draw a territory — a territory is saved into one office.',
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
      selectionBlockedReason:
        'No mapped leads match the current filters, so there is nothing to select.',
      territoryBlockedReason: null,
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
      selectionBlockedReason: null,
      territoryBlockedReason: null,
    });
  });

  /**
   * The reason this exists. The tooltip explaining the disabled New territory
   * button is unreachable on a touchscreen, so the state has to be explainable
   * as visible text — which means the reason must be a value, not markup.
   */
  it('explains why a tool is blocked, so the message is not tooltip-only', () => {
    const allMarkets = mapDrawAvailability({ loading: false, shownLeadCount: 12, selectedMarketId: null });
    expect(allMarkets.territoryBlockedReason).toMatch(/single market/);

    const noLeads = mapDrawAvailability({ loading: false, shownLeadCount: 0, selectedMarketId: 1 });
    expect(noLeads.selectionBlockedReason).toMatch(/No mapped leads/);
  });

  /**
   * Loading resolves by itself, so surfacing it would flash a message on every
   * refetch. A blocked reason is for something the operator has to act on.
   */
  it('stays silent while loading, even when a real blocker is also present', () => {
    const r = mapDrawAvailability({ loading: true, shownLeadCount: 0, selectedMarketId: null });
    expect(r.selectionDisabled).toBe(true);
    expect(r.territoryDisabled).toBe(true);
    expect(r.selectionBlockedReason).toBeNull();
    expect(r.territoryBlockedReason).toBeNull();
  });

  it('reports both blockers at once when both apply', () => {
    const r = mapDrawAvailability({ loading: false, shownLeadCount: 0, selectedMarketId: null });
    expect(r.selectionBlockedReason).not.toBeNull();
    expect(r.territoryBlockedReason).not.toBeNull();
  });
});
