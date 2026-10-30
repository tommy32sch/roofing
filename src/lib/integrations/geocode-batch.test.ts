import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeocodeQuery } from '@/lib/leads/geocode-query';
import { geocodeAddressesCass } from './geocode-batch';

const fetchMock = vi.fn<typeof fetch>();
const KEY = 'private-api-key';
const QUERY: GeocodeQuery = {
  street: '101 Test St',
  city: 'Test City',
  state: 'AZ',
  zip: '85001',
};

function entry(id: string, overrides: Partial<GeocodeQuery> = {}) {
  return { id, query: { ...QUERY, ...overrides } };
}

function match(lat: unknown, lng: unknown, type = 'rooftop', accuracy: unknown = 1) {
  return {
    query: { formatted_address: 'Provider address' },
    response: {
      results: [{ location: { lat, lng }, accuracy_type: type, accuracy, source: 'County' }],
    },
  };
}

function respond(results: unknown) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('batch commercial geocoding', () => {
  it('posts one ID-keyed JSON object and maps reordered responses to the correct leads', async () => {
    respond({
      second: match(34.2, -111.2, 'parcel_centroid'),
      unexpected: match(35, -110),
      first: match(33.1, -112.1, 'building_centroid'),
    });

    const result = await geocodeAddressesCass([
      entry('first'),
      entry('second', { street: '202 Test St', city: null }),
    ], ` ${KEY} `);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://api.geocod.io/v2/geocode?api_key=${KEY}`);
    expect(options).toMatchObject({
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      first: '101 Test St, Test City, AZ, 85001',
      second: '202 Test St, AZ, 85001',
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(result.locations.get('first')).toMatchObject({ latitude: 33.1, longitude: -112.1 });
    expect(result.locations.get('second')).toMatchObject({ latitude: 34.2, longitude: -111.2 });
    expect([...result.locations.keys()]).toEqual(['first', 'second']);
    expect(result.unmatchedIds).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('leaves approximate, low-confidence, malformed, invalid, and missing results unmatched', async () => {
    const results = {
      precise: match(33, -112),
      street: match(33, -112, 'street_center'),
      area: match(33, -112, 'place'),
      uncertain: match(33, -112, 'rooftop', 0.5),
      missingLatitude: match(null, -112),
      missingLongitude: match(33, ''),
      outOfRangeLatitude: match(91, -112),
      outOfRangeLongitude: match(33, -181),
      origin: match(0, 0),
      malformed: { response: { results: 'not an array' } },
      empty: { response: { results: [] } },
      noResponse: { query: QUERY },
    };
    respond(results);
    const ids = [...Object.keys(results), 'missing', 'blankAddress'];

    const result = await geocodeAddressesCass(ids.map((id) => entry(id, {
      street: id === 'blankAddress' ? '  ' : QUERY.street,
    })), KEY);

    expect([...result.locations.keys()]).toEqual(['precise']);
    expect(result.unmatchedIds).toEqual(ids.filter((id) => id !== 'precise'));
    expect(result.error).toBeNull();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty('blankAddress');
  });

  it.each([null, [], 'malformed', {}])('treats a missing or malformed results object as unmatched', async (results) => {
    respond(results);

    const result = await geocodeAddressesCass([entry('first')], KEY);

    expect(result.locations.size).toBe(0);
    expect(result.unmatchedIds).toEqual(['first']);
    expect(result.error).toBeNull();
  });

  it('returns a safe failure for a non-success response without reading its body', async () => {
    const response = new Response(`Private address and ${KEY}`, { status: 429 });
    const readBody = vi.spyOn(response, 'json');
    fetchMock.mockResolvedValue(response);

    const result = await geocodeAddressesCass([entry('first')], KEY);

    expect(result.locations.size).toBe(0);
    expect(result.unmatchedIds).toEqual(['first']);
    expect(result.error).toBe('Batch geocoding request failed (HTTP 429).');
    expect(readBody).not.toHaveBeenCalled();
  });

  it('does not expose provider bodies or request details after a network or JSON failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`Private address and ${KEY}`));
    const networkFailure = await geocodeAddressesCass([entry('first')], KEY);
    fetchMock.mockResolvedValueOnce(new Response(`Private address and ${KEY}`));
    const jsonFailure = await geocodeAddressesCass([entry('first')], KEY);

    for (const result of [networkFailure, jsonFailure]) {
      expect(result.locations.size).toBe(0);
      expect(result.unmatchedIds).toEqual(['first']);
      expect(result.error).toBe('Batch geocoding request failed.');
    }
  });

  it('ends the lookup within its shared time budget and returns a safe timeout error', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Private details', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));

    const pending = geocodeAddressesCass([entry('first')], KEY);
    await vi.advanceTimersByTimeAsync(20000);
    const result = await pending;

    expect(timeout).toHaveBeenCalledWith(20000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.locations.size).toBe(0);
    expect(result.unmatchedIds).toEqual(['first']);
    expect(result.error).toBe('Batch geocoding request timed out.');
  });

  it('does not fetch when the API key is missing', async () => {
    const result = await geocodeAddressesCass([entry('first')], '  ');

    expect(result.error).toBe('Batch geocoding is not configured.');
    expect(result.unmatchedIds).toEqual(['first']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch empty or unqueryable input', async () => {
    const empty = await geocodeAddressesCass([], '');
    const blank = await geocodeAddressesCass([entry('blank', { street: '  ' })], KEY);

    expect(empty).toEqual({ locations: new Map(), unmatchedIds: [], error: null });
    expect(blank).toEqual({ locations: new Map(), unmatchedIds: ['blank'], error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects more than 5,000 entries before making a request', async () => {
    const entries = Array.from({ length: 5001 }, (_, index) => entry(String(index)));

    const result = await geocodeAddressesCass(entries, KEY);

    expect(result.error).toBe('Batch geocoding supports at most 5,000 addresses.');
    expect(result.unmatchedIds).toHaveLength(5001);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('splits large uploads into small requests and keeps precise matches if another request fails', async () => {
    let active = 0;
    let peakActive = 0;
    fetchMock.mockImplementation(async (_url, options) => {
      const addresses = JSON.parse(String(options?.body)) as Record<string, string>;
      expect(Object.keys(addresses).length).toBeLessThanOrEqual(50);
      active++;
      peakActive = Math.max(active, peakActive);
      await Promise.resolve();
      active--;
      if ('50' in addresses) return new Response('Private provider details', { status: 503 });
      return new Response(JSON.stringify({ results: Object.fromEntries(
        Object.keys(addresses).map((id) => [id, match(33, -112)])
      ) }));
    });
    const result = await geocodeAddressesCass(Array.from({ length: 101 }, (_, index) => entry(String(index))), KEY);
    expect(peakActive).toBeLessThanOrEqual(4);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.locations.size).toBe(51);
    expect(result.unmatchedIds).toHaveLength(50);
    expect(result.error).toBe('Batch geocoding request failed (HTTP 503).');
  });
});
