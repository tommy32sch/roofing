import { resolveUploaderFilter } from '@/lib/leads/attribution';
import { applyAssigneeFilter, parseAssigneeFilter } from '@/lib/leads/assignment-filter';
import {
  buildLeadSearchFilter,
  buildStreetNamesFilter,
  directionRegex,
  sanitizeSearch,
  sanitizeStreetNumber,
} from '@/lib/utils/lead-query';
import {
  leadQueueParamsFromSearchParams,
  type LeadQueueParams,
} from '@/lib/leads/work-queue';

interface QueueFilterBuilder {
  eq(column: string, value: unknown): QueueFilterBuilder;
  or(filters: string): QueueFilterBuilder;
  ilike(column: string, pattern: string): QueueFilterBuilder;
  filter(column: string, operator: string, value: string): QueueFilterBuilder;
}

/**
 * Parse queue state at the server boundary without losing malformed assignee
 * filters. The browser state stays canonical, while an invalid direct API
 * request still reaches parseAssigneeFilter and fails closed.
 */
export function leadQueueRequestParamsFromSearchParams(
  searchParams: URLSearchParams
): LeadQueueParams {
  const params = leadQueueParamsFromSearchParams(searchParams);

  for (const key of ['assigned_setter', 'assigned_closer'] as const) {
    const raw = searchParams.get(key)?.trim();
    if (raw && !params[key]) params[key] = raw.slice(0, 128);
  }

  return params;
}

/**
 * Apply the shared Leads work-queue filters to any compatible PostgREST query.
 * Market scoping remains outside because it needs the signed-in user's home
 * market. Street grouping can skip the selected-street clause so the picker
 * still offers other streets that match the rest of the queue.
 */
export function applyLeadQueueFilters<T>(
  query: T,
  params: LeadQueueParams,
  options: { includeSelectedStreets?: boolean } = {}
): T {
  let filtered = query as unknown as QueueFilterBuilder;

  if (params.status) filtered = filtered.eq('status', params.status);
  if (params.priority) filtered = filtered.eq('priority', params.priority);
  if (params.is_dnc === 'true') filtered = filtered.eq('is_dnc', true);

  const uploader = resolveUploaderFilter(params.created_by);
  if (uploader) filtered = filtered.eq('created_by', uploader);

  filtered = applyAssigneeFilter(filtered, 'setter', parseAssigneeFilter(params.assigned_setter));
  filtered = applyAssigneeFilter(filtered, 'closer', parseAssigneeFilter(params.assigned_closer));

  const searchFilter = buildLeadSearchFilter(params.search);
  if (searchFilter) filtered = filtered.or(searchFilter);

  const streetNumber = sanitizeStreetNumber(params.street_number);
  if (streetNumber) filtered = filtered.ilike('address_street', `${streetNumber}%`);
  const streetName = sanitizeSearch(params.street_name || '');
  if (streetName) filtered = filtered.ilike('address_street', `%${streetName}%`);
  const streetDirection = directionRegex(params.street_dir);
  if (streetDirection) filtered = filtered.filter('address_street', 'imatch', streetDirection);

  if (options.includeSelectedStreets !== false) {
    const selectedStreets = buildStreetNamesFilter(params.streets);
    if (selectedStreets) filtered = filtered.or(selectedStreets);
  }

  return filtered as unknown as T;
}
