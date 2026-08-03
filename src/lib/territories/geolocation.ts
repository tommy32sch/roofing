/**
 * Ephemeral device location used to choose and mark the nearest door.
 *
 * This adapter deliberately returns plain coordinates and has no storage or
 * network dependency. Callers own the value in memory and discard it when
 * territory execution ends.
 */
export interface TerritoryUserLocation {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

export type TerritoryGeolocationErrorCode =
  | 'unsupported'
  | 'permission_denied'
  | 'position_unavailable'
  | 'timeout'
  | 'unknown';

export class TerritoryGeolocationError extends Error {
  readonly code: TerritoryGeolocationErrorCode;
  /** Whether another in-app attempt can reasonably succeed. */
  readonly canRetry: boolean;

  constructor(code: TerritoryGeolocationErrorCode, message: string, canRetry: boolean) {
    super(message);
    this.name = 'TerritoryGeolocationError';
    this.code = code;
    this.canRetry = canRetry;
  }
}

/**
 * High accuracy matters at house scale, but the request must not leave a rep
 * waiting indefinitely. A recent fix is acceptable while walking between
 * adjacent doors and avoids waking the GPS for every Next action.
 */
export const TERRITORY_GEOLOCATION_OPTIONS: Readonly<PositionOptions> = {
  enableHighAccuracy: true,
  timeout: 12_000,
  maximumAge: 15_000,
};

type GeolocationAdapter = Pick<Geolocation, 'getCurrentPosition'>;

function browserGeolocation(): GeolocationAdapter | null {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return navigator.geolocation;
}

export function normalizeGeolocationError(
  error: Pick<GeolocationPositionError, 'code' | 'message'>
): TerritoryGeolocationError {
  switch (error.code) {
    case 1:
      return new TerritoryGeolocationError(
        'permission_denied',
        'Location access is blocked. Allow it in browser settings, then try again.',
        false
      );
    case 2:
      return new TerritoryGeolocationError(
        'position_unavailable',
        'Your location is unavailable right now. Move into clearer view and try again.',
        true
      );
    case 3:
      return new TerritoryGeolocationError(
        'timeout',
        'Finding your location took too long. Try again.',
        true
      );
    default:
      return new TerritoryGeolocationError(
        'unknown',
        error.message || 'Your location could not be determined.',
        true
      );
  }
}

/**
 * Request one current position after an explicit user action.
 *
 * The result stays in caller-owned memory. This module never transmits or
 * persists it, which keeps live rep location out of CRM history.
 */
export function requestTerritoryLocation(
  geolocation: GeolocationAdapter | null = browserGeolocation()
): Promise<TerritoryUserLocation> {
  if (!geolocation) {
    return Promise.reject(
      new TerritoryGeolocationError(
        'unsupported',
        'This browser does not support location access.',
        false
      )
    );
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
      },
      (error) => reject(normalizeGeolocationError(error)),
      TERRITORY_GEOLOCATION_OPTIONS
    );
  });
}
