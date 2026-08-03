export type MapDrawPurpose = 'selection' | 'territory';

/**
 * Which drawing tools are available, and why a blocked one is blocked.
 *
 * The reason travels with the disabled flag rather than being written beside
 * the button, so the two cannot disagree about what is wrong.
 *
 * Blocked reasons deliberately ignore `loading`. It clears on its own within a
 * moment, and surfacing it would flash a message on every refetch — these
 * reasons are for states the operator has to act on, not ones that resolve
 * themselves.
 */
export function mapDrawAvailability(input: {
  loading: boolean;
  shownLeadCount: number;
  selectedMarketId: number | null;
}) {
  const noLeads = input.shownLeadCount === 0;
  const noMarket = input.selectedMarketId == null;

  return {
    selectionDisabled: input.loading || noLeads,
    territoryDisabled: input.loading || noMarket,
    selectionBlockedReason:
      !input.loading && noLeads
        ? 'No mapped leads match the current filters, so there is nothing to select.'
        : null,
    /**
     * A territory is saved INTO one office. While All Markets is selected there
     * is no way to know which office a drawn shape belongs to, so the tool waits
     * rather than filing it in the wrong one.
     */
    territoryBlockedReason:
      !input.loading && noMarket
        ? 'Choose a single market to draw a territory — a territory is saved into one office.'
        : null,
  };
}
