import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ batch: vi.fn(), region: vi.fn(), key: vi.fn() }));
vi.mock('@/lib/integrations/geocode-batch', () => ({ geocodeAddressesCass: mocks.batch }));
vi.mock('@/lib/integrations/geocode', () => ({ getGeoDefaults: mocks.region, getCassKey: mocks.key }));
import { locateImportAddresses } from './import-locations.server';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.region.mockResolvedValue({ city: 'Phoenix', state: 'AZ' });
  mocks.key.mockResolvedValue('configured-key');
  mocks.batch.mockResolvedValue({ locations: new Map(), unmatchedIds: [], error: null });
});

describe('import address lookup', () => {
  it('uses the import market, excludes duplicates and invalid addresses, and respects each lead ZIP', async () => {
    const address = { address_street: '1 Main St', address_city: null, address_state: null, address_zip: '85132' };
    await locateImportAddresses([
      { id: 'eligible', ...address, is_flagged_duplicate: false },
      { id: 'duplicate', ...address, is_flagged_duplicate: true },
      { id: 'no-street', ...address, address_street: null, is_flagged_duplicate: false },
    ], 2);
    expect(mocks.region).toHaveBeenCalledWith(2);
    expect(mocks.batch).toHaveBeenCalledWith([
      { id: 'eligible', query: { street: '1 Main St', city: null, state: 'AZ', zip: '85132' } },
    ], 'configured-key');
  });
});
