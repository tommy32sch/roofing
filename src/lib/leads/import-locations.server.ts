import { geocodeAddressesCass } from '@/lib/integrations/geocode-batch';
import { getCassKey, getGeoDefaults } from '@/lib/integrations/geocode';
import { buildGeocodeQuery, type GeocodeLeadAddress } from './geocode-query';

interface ImportAddress extends GeocodeLeadAddress {
  id: string;
  is_flagged_duplicate: boolean;
}

/** Find locations before insert. Import retries never replace existing rows. */
export async function locateImportAddresses(
  leads: readonly ImportAddress[],
  marketId: number | null
) {
  const region = await getGeoDefaults(marketId);
  const entries = leads.flatMap((lead) => {
    if (lead.is_flagged_duplicate) return [];
    const query = buildGeocodeQuery(lead, region);
    return query ? [{ id: lead.id, query }] : [];
  });
  return geocodeAddressesCass(entries, await getCassKey() ?? '');
}
