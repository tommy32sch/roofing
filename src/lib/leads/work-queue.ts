import { z } from 'zod';
import { LEAD_PRIORITY_OPTIONS, LEAD_STATUS_OPTIONS } from '@/types';
import { LEAD_SORT_COLUMNS, sanitizeStreetNumber, STREET_DIRECTIONS } from '@/lib/utils/lead-query';
import { isValidUUID, LIMITS } from '@/lib/utils/validation';
import { UNASSIGNED } from '@/lib/leads/assignment-filter';

export const LEAD_VIEW_NAME_MAX_LENGTH = 80;
export const DEFAULT_LEAD_SORT = 'created_at';
export const DEFAULT_LEAD_ORDER = 'desc';

export const LEAD_QUEUE_PARAM_KEYS = [
  'status',
  'priority',
  'search',
  'street_number',
  'street_dir',
  'street_name',
  'streets',
  'is_dnc',
  'market_id',
  'created_by',
  'assigned_setter',
  'assigned_closer',
  'sort',
  'order',
] as const;

export const LEAD_QUEUE_FILTER_KEYS = [
  'status',
  'priority',
  'search',
  'street_number',
  'street_dir',
  'street_name',
  'streets',
  'is_dnc',
  'market_id',
  'created_by',
  'assigned_setter',
  'assigned_closer',
] as const satisfies readonly LeadQueueParamKey[];

export type LeadQueueParamKey = (typeof LEAD_QUEUE_PARAM_KEYS)[number];
export type LeadQueueParams = Partial<Record<LeadQueueParamKey, string>>;
export type LeadSortOrder = 'asc' | 'desc';

export interface LeadSavedView {
  id: string;
  name: string;
  definitionVersion: 1;
  definition: LeadViewDefinitionV1;
  createdAt: string;
  updatedAt: string;
}

export const LEAD_SORT_OPTIONS: {
  value: string;
  label: string;
  sort: string;
  order: LeadSortOrder;
}[] = [
  { value: 'created_at:desc', label: 'Newest added', sort: 'created_at', order: 'desc' },
  { value: 'created_at:asc', label: 'Oldest added', sort: 'created_at', order: 'asc' },
  { value: 'last_name:asc', label: 'Name A–Z', sort: 'last_name', order: 'asc' },
  { value: 'last_name:desc', label: 'Name Z–A', sort: 'last_name', order: 'desc' },
  { value: 'priority:desc', label: 'Highest priority', sort: 'priority', order: 'desc' },
  { value: 'priority:asc', label: 'Lowest priority', sort: 'priority', order: 'asc' },
  { value: 'status:asc', label: 'Status: early to late', sort: 'status', order: 'asc' },
  { value: 'status:desc', label: 'Status: late to early', sort: 'status', order: 'desc' },
  { value: 'follow_up_date:asc', label: 'Next follow-up', sort: 'follow_up_date', order: 'asc' },
  { value: 'estimated_roof_value:desc', label: 'Highest estimate', sort: 'estimated_roof_value', order: 'desc' },
  { value: 'estimated_roof_value:asc', label: 'Lowest estimate', sort: 'estimated_roof_value', order: 'asc' },
  { value: 'deal_value:desc', label: 'Highest deal value', sort: 'deal_value', order: 'desc' },
  { value: 'deal_value:asc', label: 'Lowest deal value', sort: 'deal_value', order: 'asc' },
  { value: 'updated_at:desc', label: 'Recently updated', sort: 'updated_at', order: 'desc' },
];

const STATUS_VALUES = new Set<string>(LEAD_STATUS_OPTIONS.map((option) => option.value));
const PRIORITY_VALUES = new Set<string>(LEAD_PRIORITY_OPTIONS.map((option) => option.value));
const DIRECTION_VALUES = new Set(STREET_DIRECTIONS);

const leadViewDefinitionV1Schema = z
  .object({
    filters: z
      .object({
        status: z.enum(['new', 'contacted', 'appointment_set', 'inspected', 'proposal_sent', 'sold', 'lost']).optional(),
        priority: z.enum(['low', 'medium', 'high', 'hot']).optional(),
        search: z.string().trim().min(1).max(LIMITS.SEARCH_QUERY).optional(),
        streetNumber: z.string().regex(/^\d{1,12}$/).optional(),
        streetDirection: z.enum(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']).optional(),
        streetName: z.string().trim().min(1).max(120).optional(),
        streets: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
        dncOnly: z.literal(true).optional(),
        marketId: z.union([z.literal('all'), z.number().int().positive()]).optional(),
        createdBy: z.string().uuid().optional(),
        assignedSetter: z.union([z.literal(UNASSIGNED), z.string().uuid()]).optional(),
        assignedCloser: z.union([z.literal(UNASSIGNED), z.string().uuid()]).optional(),
      })
      .strict(),
    sort: z
      .object({
        key: z.enum([
          'created_at',
          'updated_at',
          'first_name',
          'last_name',
          'status',
          'priority',
          'deal_value',
          'estimated_roof_value',
          'follow_up_date',
        ]),
        order: z.enum(['asc', 'desc']),
      })
      .strict(),
  })
  .strict();

export type LeadViewDefinitionV1 = z.infer<typeof leadViewDefinitionV1Schema>;

function trimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || null;
}

function userFilter(value: unknown, allowUnassigned: boolean): string | null {
  const candidate = trimmedString(value, 64);
  if (!candidate) return null;
  if (allowUnassigned && candidate === UNASSIGNED) return candidate;
  return isValidUUID(candidate) ? candidate : null;
}

/**
 * Keep saved and URL queue state within the exact contract the Leads screen
 * understands. Unknown keys and invalid values are dropped instead of being
 * persisted and later widening a result set.
 */
export function normalizeLeadQueueParams(value: unknown): LeadQueueParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const params: LeadQueueParams = {};

  if (typeof raw.status === 'string' && STATUS_VALUES.has(raw.status)) {
    params.status = raw.status;
  }
  if (typeof raw.priority === 'string' && PRIORITY_VALUES.has(raw.priority)) {
    params.priority = raw.priority;
  }

  const search = trimmedString(raw.search, LIMITS.SEARCH_QUERY);
  if (search) params.search = search;

  const streetNumber = sanitizeStreetNumber(
    typeof raw.street_number === 'string' ? raw.street_number : ''
  ).slice(0, 12);
  if (streetNumber) params.street_number = streetNumber;

  if (typeof raw.street_dir === 'string') {
    const direction = raw.street_dir.trim().toUpperCase();
    if (DIRECTION_VALUES.has(direction)) params.street_dir = direction;
  }

  const streetName = trimmedString(raw.street_name, 120);
  if (streetName) params.street_name = streetName;

  if (typeof raw.streets === 'string') {
    const streets = raw.streets
      .split('|')
      .map((name) => name.trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 100)
      .join('|');
    if (streets) params.streets = streets;
  }

  if (raw.is_dnc === 'true') params.is_dnc = 'true';

  if (typeof raw.market_id === 'string') {
    const marketId = raw.market_id.trim();
    if (marketId === 'all' || (/^\d+$/.test(marketId) && Number(marketId) > 0)) {
      params.market_id = marketId;
    }
  }

  const createdBy = userFilter(raw.created_by, false);
  if (createdBy) params.created_by = createdBy;
  const assignedSetter = userFilter(raw.assigned_setter, true);
  if (assignedSetter) params.assigned_setter = assignedSetter;
  const assignedCloser = userFilter(raw.assigned_closer, true);
  if (assignedCloser) params.assigned_closer = assignedCloser;

  if (typeof raw.sort === 'string' && LEAD_SORT_COLUMNS.has(raw.sort)) {
    const order: LeadSortOrder = raw.order === 'asc' ? 'asc' : 'desc';
    if (raw.sort !== DEFAULT_LEAD_SORT || order !== DEFAULT_LEAD_ORDER) {
      params.sort = raw.sort;
      params.order = order;
    }
  }

  return params;
}

export function leadQueueParamsFromSearchParams(searchParams: URLSearchParams): LeadQueueParams {
  const raw: Record<string, string> = {};
  for (const key of LEAD_QUEUE_PARAM_KEYS) {
    const value = searchParams.get(key);
    if (value) raw[key] = value;
  }
  return normalizeLeadQueueParams(raw);
}

export function leadQueueSignature(params: LeadQueueParams): string {
  const normalized = normalizeLeadQueueParams(params);
  return JSON.stringify(LEAD_QUEUE_PARAM_KEYS.map((key) => normalized[key] ?? ''));
}

export function patchLeadQueueParams(
  current: LeadQueueParams,
  patch: Partial<Record<LeadQueueParamKey, string | undefined>>
): LeadQueueParams {
  return normalizeLeadQueueParams({ ...current, ...patch });
}

export function clearLeadQueueFilters(params: LeadQueueParams): LeadQueueParams {
  const normalized = normalizeLeadQueueParams(params);
  return normalizeLeadQueueParams({ sort: normalized.sort, order: normalized.order });
}

export function hasLeadQueueFilters(params: LeadQueueParams): boolean {
  const normalized = normalizeLeadQueueParams(params);
  return LEAD_QUEUE_FILTER_KEYS.some((key) => Boolean(normalized[key]));
}

export function leadQueueSort(params: LeadQueueParams): {
  sort: string;
  order: LeadSortOrder;
} {
  const normalized = normalizeLeadQueueParams(params);
  return {
    sort: normalized.sort ?? DEFAULT_LEAD_SORT,
    order: (normalized.order as LeadSortOrder | undefined) ?? DEFAULT_LEAD_ORDER,
  };
}

export function nextLeadSort(
  current: LeadQueueParams,
  key: string,
  initialOrder: LeadSortOrder = 'asc'
): { sort: string; order: LeadSortOrder } {
  const active = leadQueueSort(current);
  if (!LEAD_SORT_COLUMNS.has(key)) {
    return { sort: DEFAULT_LEAD_SORT, order: DEFAULT_LEAD_ORDER };
  }
  if (active.sort === key) {
    return { sort: key, order: active.order === 'asc' ? 'desc' : 'asc' };
  }
  return { sort: key, order: initialOrder };
}

export function buildLeadQueueSearchParams(
  params: LeadQueueParams,
  options: { viewId?: string | null; page?: number | null } = {}
): URLSearchParams {
  const result = new URLSearchParams();
  const normalized = normalizeLeadQueueParams(params);
  for (const key of LEAD_QUEUE_PARAM_KEYS) {
    const value = normalized[key];
    if (value) result.set(key, value);
  }
  if (options.viewId && isValidUUID(options.viewId)) result.set('view', options.viewId);
  if (options.page && Number.isInteger(options.page) && options.page > 1) {
    result.set('page', String(options.page));
  }
  return result;
}

export function leadQueueHref(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `/admin/leads?${query}` : '/admin/leads';
}

export function leadViewDefinitionFromQueue(params: LeadQueueParams): LeadViewDefinitionV1 {
  const normalized = normalizeLeadQueueParams(params);
  const { sort, order } = leadQueueSort(normalized);
  const filters: LeadViewDefinitionV1['filters'] = {};

  if (normalized.status) filters.status = normalized.status as LeadViewDefinitionV1['filters']['status'];
  if (normalized.priority) filters.priority = normalized.priority as LeadViewDefinitionV1['filters']['priority'];
  if (normalized.search) filters.search = normalized.search;
  if (normalized.street_number) filters.streetNumber = normalized.street_number;
  if (normalized.street_dir) filters.streetDirection = normalized.street_dir as LeadViewDefinitionV1['filters']['streetDirection'];
  if (normalized.street_name) filters.streetName = normalized.street_name;
  if (normalized.streets) filters.streets = normalized.streets.split('|');
  if (normalized.is_dnc === 'true') filters.dncOnly = true;
  if (normalized.market_id) {
    filters.marketId = normalized.market_id === 'all' ? 'all' : Number(normalized.market_id);
  }
  if (normalized.created_by) filters.createdBy = normalized.created_by;
  if (normalized.assigned_setter) filters.assignedSetter = normalized.assigned_setter;
  if (normalized.assigned_closer) filters.assignedCloser = normalized.assigned_closer;

  return {
    filters,
    sort: { key: sort as LeadViewDefinitionV1['sort']['key'], order },
  };
}

export function parseLeadViewDefinition(value: unknown): LeadViewDefinitionV1 | null {
  const result = leadViewDefinitionV1Schema.safeParse(value);
  return result.success ? result.data : null;
}

export function leadQueueParamsFromDefinition(definition: LeadViewDefinitionV1): LeadQueueParams {
  const filters = definition.filters;
  return normalizeLeadQueueParams({
    status: filters.status,
    priority: filters.priority,
    search: filters.search,
    street_number: filters.streetNumber,
    street_dir: filters.streetDirection,
    street_name: filters.streetName,
    streets: filters.streets?.join('|'),
    is_dnc: filters.dncOnly ? 'true' : undefined,
    market_id: filters.marketId === undefined ? undefined : String(filters.marketId),
    created_by: filters.createdBy,
    assigned_setter: filters.assignedSetter,
    assigned_closer: filters.assignedCloser,
    sort: definition.sort.key,
    order: definition.sort.order,
  });
}
