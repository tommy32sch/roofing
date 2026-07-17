/**
 * Helpers for building lead list/search queries safely.
 *
 * All lead queries use the Supabase service-role client, and the search term is
 * interpolated into a PostgREST `.or(...)` filter string. That string is a
 * grammar where `, ( ) : % * " \` are structural — so a raw value like
 * "O'Brien, Inc." would break the filter, and a crafted value could inject
 * extra predicates. Sanitizing the term keeps it a plain ILIKE substring.
 */
export function sanitizeSearch(raw: string): string {
  return raw
    .replace(/[,()%*\\":]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Columns a client is allowed to sort the leads list by. */
export const LEAD_SORT_COLUMNS = new Set<string>([
  'created_at',
  'updated_at',
  'first_name',
  'last_name',
  'status',
  'priority',
  'deal_value',
  'estimated_roof_value',
  'follow_up_date',
]);

/** Return a validated sort column, falling back to created_at for anything unknown. */
export function safeSortColumn(sort: string | null | undefined): string {
  return sort && LEAD_SORT_COLUMNS.has(sort) ? sort : 'created_at';
}

/**
 * Build the shared ILIKE search filter across the lead columns the list, export,
 * and street-grouping endpoints all search. Returns null when there's nothing to
 * search so callers can skip applying it.
 */
export function buildLeadSearchFilter(rawSearch: string | null | undefined): string | null {
  if (!rawSearch) return null;
  const term = sanitizeSearch(rawSearch);
  if (!term) return null;
  return [
    `first_name.ilike.%${term}%`,
    `last_name.ilike.%${term}%`,
    `email.ilike.%${term}%`,
    `phone.ilike.%${term}%`,
    `address_street.ilike.%${term}%`,
    `address_city.ilike.%${term}%`,
  ].join(',');
}
