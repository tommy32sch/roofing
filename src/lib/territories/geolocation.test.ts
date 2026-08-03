import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  TERRITORY_GEOLOCATION_OPTIONS,
  TerritoryGeolocationError,
  normalizeGeolocationError,
  requestTerritoryLocation,
} from './geolocation';

function position(latitude = 33.4484, longitude = -112.074): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 8,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: 1_722_000_000_000,
    toJSON: () => ({}),
  };
}

describe('territory geolocation', () => {
  it('has no persistence or network path', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/territories/geolocation.ts'), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('indexedDB');
  });

  it('requests a bounded, recent, high-accuracy position and returns plain coordinates', async () => {
    const getCurrentPosition = vi.fn(
      (
        success: PositionCallback,
        failure?: PositionErrorCallback | null,
        options?: PositionOptions
      ) => {
        void failure;
        void options;
        success(position());
      }
    );

    await expect(requestTerritoryLocation({ getCurrentPosition })).resolves.toEqual({
      lat: 33.4484,
      lng: -112.074,
      accuracy: 8,
      timestamp: 1_722_000_000_000,
    });

    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition.mock.calls[0][2]).toEqual(TERRITORY_GEOLOCATION_OPTIONS);
    expect(TERRITORY_GEOLOCATION_OPTIONS).toMatchObject({
      enableHighAccuracy: true,
      timeout: 12_000,
      maximumAge: 15_000,
    });
  });

  it('fails with a typed unsupported error when the browser has no location adapter', async () => {
    await expect(requestTerritoryLocation(null)).rejects.toMatchObject({
      code: 'unsupported',
      canRetry: false,
    });
  });

  it.each([
    [1, 'permission_denied', false],
    [2, 'position_unavailable', true],
    [3, 'timeout', true],
    [99, 'unknown', true],
  ] as const)('normalizes browser error %s as %s', (code, expectedCode, canRetry) => {
    const result = normalizeGeolocationError({ code, message: 'browser detail' });

    expect(result).toBeInstanceOf(TerritoryGeolocationError);
    expect(result).toMatchObject({ code: expectedCode, canRetry });
  });

  it('rejects with the normalized browser error', async () => {
    const getCurrentPosition = vi.fn(
      (
        success: PositionCallback,
        failure?: PositionErrorCallback | null,
        options?: PositionOptions
      ) => {
        void success;
        void options;
        failure?.({
          code: 3,
          message: 'timed out',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      }
    );

    await expect(requestTerritoryLocation({ getCurrentPosition })).rejects.toMatchObject({
      code: 'timeout',
      canRetry: true,
    });
  });
});
