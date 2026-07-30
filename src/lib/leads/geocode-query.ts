/**
 * Which address components to send to the geocoder.
 *
 * Nominatim ANDs its structured fields, so every component you add is a
 * constraint the result must satisfy. That makes a *guessed* component actively
 * harmful: the market's default city exists to rescue a street with no location
 * at all, but bolting it onto a lead that already has a ZIP produces a query
 * like "5719 E Flowing Spg, in Phoenix, ZIP 85132" — and 85132 is Pinal County,
 * not Phoenix. The two constraints cannot both hold, so nothing matches and the
 * lead silently stays unmapped.
 *
 * Precedence, most specific first:
 *   1. the lead's own city — it knows better than any default
 *   2. otherwise its ZIP alone, with NO substituted city
 *   3. otherwise the default region, which is the street-only case the default
 *      was added for
 *
 * State is kept throughout: it never contradicts a ZIP (a ZIP lies within one
 * state) and it stops a same-named street in another state from matching.
 */

export interface GeocodeLeadAddress {
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

export interface GeocodeRegion {
  city: string | null;
  state: string | null;
}

export interface GeocodeQuery {
  street: string;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/**
 * Build the query, or null when the lead is not geocodable.
 *
 * Not geocodable means: no street, or a street with nothing to place it in —
 * no city, no ZIP, and no default region. Geocoding those would match a
 * same-named street somewhere else in the country, which is worse than leaving
 * the lead unmapped because a wrong pin looks correct.
 */
export function buildGeocodeQuery(
  lead: GeocodeLeadAddress,
  region: GeocodeRegion
): GeocodeQuery | null {
  const street = clean(lead.address_street);
  if (!street) return null;

  const ownCity = clean(lead.address_city);
  const zip = clean(lead.address_zip);
  const state = clean(lead.address_state) || clean(region.state);

  if (ownCity) return { street, city: ownCity, state, zip };

  // A ZIP is more specific than a default city and may well disagree with it.
  // Trust the ZIP and send no city at all.
  if (zip) return { street, city: null, state, zip };

  const fallbackCity = clean(region.city);
  if (fallbackCity) return { street, city: fallbackCity, state, zip: null };

  return null;
}

/** Whether this lead can be geocoded at all, given the region available. */
export function isGeocodable(lead: GeocodeLeadAddress, region: GeocodeRegion): boolean {
  return buildGeocodeQuery(lead, region) !== null;
}
