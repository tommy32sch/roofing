'use client';

import { useAppShell } from '@/components/providers/app-shell-provider';
import { ALL_MARKETS } from '@/lib/leads/markets';
import type { Market } from '@/types';

export { ALL_MARKETS };

interface MarketsState {
  markets: Market[];
  /** The signed-in user's home office, or null if they have none. */
  homeMarketId: number | null;
  loading: boolean;
  error: string | null;
}

/**
 * Stable domain hook backed by the server-loaded application shell. It keeps
 * market-filter pages independent from the provider's wider contract.
 */
export function useMarkets(): MarketsState {
  const { hasIssue, markets, user } = useAppShell();
  return {
    markets,
    homeMarketId: user.homeMarketId,
    loading: false,
    error: hasIssue('markets_unavailable')
      ? 'Office filters are temporarily unavailable.'
      : null,
  };
}
