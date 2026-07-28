import { describe, expect, it } from 'vitest';
import { TERRITORY_COLORS } from './constants';
import { toTerritory, type TerritoryDbRow, type TerritoryOwner } from './server';

const row: TerritoryDbRow = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'North Phoenix',
  market_id: 1,
  boundary: [[33, -112], [34, -112], [34, -111]],
  color: TERRITORY_COLORS[0],
  owner_user_id: '00000000-0000-4000-8000-000000000002',
  archived_at: null,
  created_at: '2026-07-27T00:00:00.000Z',
  updated_at: '2026-07-27T01:00:00.000Z',
};

const owner: TerritoryOwner = {
  id: row.owner_user_id!,
  name: 'Taylor',
  role: 'setter',
  market_id: 1,
};

describe('toTerritory', () => {
  it('returns the stable public API contract with flattened owner fields', () => {
    const territory = toTerritory(row, new Map([[owner.id, owner]]));
    expect(territory).toEqual({
      id: row.id,
      name: 'North Phoenix',
      market_id: 1,
      boundary: row.boundary,
      color: TERRITORY_COLORS[0],
      owner_user_id: owner.id,
      owner_name: 'Taylor',
      owner_role: 'setter',
      archived_at: null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  });

  it('keeps a missing/deleted owner readable as null display data', () => {
    expect(toTerritory(row, new Map())).toMatchObject({
      owner_user_id: owner.id,
      owner_name: null,
      owner_role: null,
    });
  });
});
