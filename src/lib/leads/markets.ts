/**
 * Market (office) filtering.
 *
 * The company runs more than one branch, and the agreed model is "home market,
 * switchable": a rep's views default to their own office, but they can switch
 * to another market or view all of them. Nothing here restricts access — it is
 * a default, not a permission boundary. If real per-office access control is
 * ever needed it belongs in middleware alongside the role checks, not here.
 */

/** Sentinel a caller sends to opt out of market filtering entirely. */
export const ALL_MARKETS = 'all';

/**
 * Decide which market a request should be scoped to.
 *
 * Resolution happens on the SERVER rather than relying on the client to always
 * send the parameter, so a request that omits it is still scoped to the
 * caller's own office instead of silently returning every market. The client
 * would otherwise have to win a race against loading the current user.
 *
 * @param param   raw `market_id` query parameter ('all', a numeric id, or absent)
 * @param homeMarketId the caller's home office, or null if they have none
 * @returns the market id to filter on, or null for no filtering
 */
export function resolveMarketFilter(
  param: string | null | undefined,
  homeMarketId: number | null | undefined
): number | null {
  if (param === ALL_MARKETS) return null;

  if (param != null && param !== '') {
    const id = Number(param);
    // A malformed id must not silently widen the query to every market — fall
    // back to the caller's own office, which is the safer of the two defaults.
    if (Number.isInteger(id) && id > 0) return id;
    return homeMarketId ?? null;
  }

  // No parameter: scope to the caller's office. Users without a home market
  // (the state every user is in before offices are assigned) see everything,
  // so adding markets doesn't hide leads from anyone until it's configured.
  return homeMarketId ?? null;
}

/**
 * Whether the map should jump to the selected office's own position.
 *
 * The map normally fits its view to the leads it is showing, which is strictly
 * better than a fixed centre — so this only takes over when there is nothing to
 * fit. Pure and tested because the failure it guards against is invisible until
 * you happen to click the one market that has no leads.
 *
 * @param loading true while the new market's leads are still in flight. Acting
 *   early would recentre using the PREVIOUS market's pins, then let the fit
 *   immediately override it — two animations for one click.
 */
export function shouldRecenterMap({
  loading,
  hasLeads,
  hasCenter,
}: {
  loading: boolean;
  hasLeads: boolean;
  hasCenter: boolean;
}): boolean {
  return !loading && !hasLeads && hasCenter;
}

/**
 * Narrow a Supabase query to a market when one is in effect.
 *
 * The parameter is deliberately unconstrained. Expressing this as
 * `T extends { eq(...): T }` makes TypeScript re-enter Supabase's already
 * deeply-generic query-builder type and blow the instantiation depth limit on
 * longer chains. Keeping the structural assertion as a single contained cast
 * costs one unchecked call here and keeps every call site inferring cleanly.
 */
export function applyMarketFilter<T>(query: T, marketId: number | null): T {
  if (marketId == null) return query;
  return (query as { eq(column: string, value: number): T }).eq('market_id', marketId);
}
