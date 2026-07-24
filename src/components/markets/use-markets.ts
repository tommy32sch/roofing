'use client';

import { useEffect, useState } from 'react';
import type { Market } from '@/types';

/** Sentinel for "don't filter by market" — mirrors ALL_MARKETS on the server. */
export const ALL_MARKETS = 'all';

interface MarketsState {
  markets: Market[];
  /** The signed-in user's home office, or null if they have none. */
  homeMarketId: number | null;
  loading: boolean;
}

/**
 * Loads the office list and the current user's home office together.
 *
 * Both are needed before a picker can render a sensible default, and every
 * screen with a market filter needs the same pair, so they're fetched here once
 * rather than repeated per page. Returns an empty list when markets aren't set
 * up yet (or the migration hasn't run), which callers use to hide the picker
 * entirely — a single-office company should never see it.
 */
export function useMarkets(): MarketsState {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [homeMarketId, setHomeMarketId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/admin/markets').then((r) => r.json()).catch(() => null),
      fetch('/api/admin/auth/me').then((r) => r.json()).catch(() => null),
    ])
      .then(([marketData, meData]) => {
        if (cancelled) return;
        if (marketData?.success) setMarkets(marketData.markets ?? []);
        if (meData?.success) setHomeMarketId(meData.admin?.market_id ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { markets, homeMarketId, loading };
}
