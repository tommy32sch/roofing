import { resolveMarketFilter } from './markets';

/**
 * The market a request should be scoped to: the explicit `market_id` parameter
 * when the caller sends one, otherwise their home office.
 *
 * The authenticated session already read the live user row, including the
 * home market. Reusing that value prevents every market-filtered API request
 * from reading the same account a second time.
 */
export async function marketFilterFor(
  homeMarketId: number | null,
  param: string | null
): Promise<number | null> {
  return resolveMarketFilter(param, homeMarketId);
}
