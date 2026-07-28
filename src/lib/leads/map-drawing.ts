export type MapDrawPurpose = 'selection' | 'territory';

export function mapDrawAvailability(input: {
  loading: boolean;
  shownLeadCount: number;
  selectedMarketId: number | null;
}) {
  return {
    selectionDisabled: input.loading || input.shownLeadCount === 0,
    territoryDisabled: input.loading || input.selectedMarketId == null,
  };
}
