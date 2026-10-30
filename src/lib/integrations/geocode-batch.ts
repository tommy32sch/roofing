import type { GeocodeQuery } from '@/lib/leads/geocode-query';
import {
  buildCassQuery,
  parseGeocodioResponse,
  MIN_ACCURACY,
  type CassGeocodeResult,
} from './geocode-cass';

const ENDPOINT = 'https://api.geocod.io/v2/geocode';
const MAX_ADDRESSES = 5000;
const REQUEST_SIZE = 50;
const CONCURRENCY = 4;
const LOOKUP_BUDGET_MS = 20000;

interface BatchGeocodeResult {
  locations: Map<string, CassGeocodeResult>;
  unmatchedIds: string[];
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function preciseLocation(response: unknown): CassGeocodeResult | null {
  if (!isRecord(response) || !Array.isArray(response.results)) return null;
  const first: unknown = response.results[0];
  if (!isRecord(first) || !isRecord(first.location)) return null;
  if (typeof first.accuracy !== 'number' || !Number.isFinite(first.accuracy) ||
      first.accuracy < MIN_ACCURACY || first.accuracy > 1) return null;
  const { lat, lng } = first.location;
  // Do not let the shared parser turn a malformed null/blank value into zero.
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const location = parseGeocodioResponse(response);
  return location?.precision === 'rooftop' ? location : null;
}

/** Bounded batches keep large uploads within the import route's time limit. */
export async function geocodeAddressesCass(
  entries: readonly { id: string; query: GeocodeQuery }[],
  apiKey: string
): Promise<BatchGeocodeResult> {
  const ids = [...new Set(entries.map((entry) => entry.id))];
  const empty = (error: string | null): BatchGeocodeResult => ({
    locations: new Map(),
    unmatchedIds: ids,
    error,
  });
  if (!entries.length) return empty(null);
  if (!apiKey?.trim()) return empty('Batch geocoding is not configured.');
  if (entries.length > MAX_ADDRESSES) {
    return empty('Batch geocoding supports at most 5,000 addresses.');
  }

  const queries = new Map<string, string>();
  for (const entry of entries) {
    const query = buildCassQuery(entry.query);
    if (query) queries.set(entry.id, query);
  }
  if (!queries.size) return empty(null);

  const params = new URLSearchParams({ api_key: apiKey.trim() });
  const pending = [...queries];
  const locations = new Map<string, CassGeocodeResult>();
  const signal = AbortSignal.timeout(LOOKUP_BUDGET_MS);
  let next = 0;
  let failure: string | null = null;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.ceil(pending.length / REQUEST_SIZE)) }, async () => {
    while (next < pending.length && !failure) {
      if (signal.aborted) {
        failure = 'Batch geocoding request timed out.';
        break;
      }
      const batch = pending.slice(next, next + REQUEST_SIZE);
      next += REQUEST_SIZE;
      try {
        const response = await fetch(`${ENDPOINT}?${params}`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(batch)),
          signal,
        });
        if (!response.ok) {
          failure = `Batch geocoding request failed (HTTP ${response.status}).`;
          break;
        }
        const payload: unknown = await response.json();
        const results = isRecord(payload) && isRecord(payload.results) ? payload.results : {};
        for (const [id] of batch) {
          if (!Object.prototype.hasOwnProperty.call(results, id)) continue;
          const result = results[id];
          const location = preciseLocation(isRecord(result) ? result.response : null);
          if (location) locations.set(id, location);
        }
      } catch (error) {
        const timedOut = signal.aborted || (error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError'));
        failure = timedOut ? 'Batch geocoding request timed out.' : 'Batch geocoding request failed.';
      }
    }
  }));
  return { locations, unmatchedIds: ids.filter((id) => !locations.has(id)), error: failure };
}
