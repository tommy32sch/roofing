import { describe, expect, it } from 'vitest';
import {
  LEAD_QUEUE_FILTER_KEYS,
  LEAD_PAGE_SIZE,
  buildLeadQueueSearchParams,
  clearLeadQueueFilters,
  hasLeadQueueFilters,
  leadListRangeLabel,
  leadListRequestLimit,
  leadListViewFromSearchParams,
  leadQueueHref,
  leadQueueParamsFromDefinition,
  leadQueueParamsFromSearchParams,
  leadQueueSignature,
  leadQueueSort,
  leadViewDefinitionFromQueue,
  nextLeadSort,
  normalizeLeadQueueParams,
  parseLeadViewDefinition,
  patchLeadQueueParams,
  type LeadQueueParams,
} from './work-queue';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';

const COMPLETE: LeadQueueParams = {
  status: 'appointment_set',
  priority: 'hot',
  search: '  Lopez  ',
  street_number: '12A34',
  street_dir: 'sw',
  street_name: ' Desert Spoon ',
  streets: 'Main St|Oak Ave',
  is_dnc: 'true',
  market_id: '2',
  created_by: USER_A,
  assigned_setter: 'unassigned',
  assigned_closer: USER_B,
  sort: 'follow_up_date',
  order: 'asc',
};

describe('lead work queue URL state', () => {
  it('normalizes every supported filter and sort field', () => {
    expect(normalizeLeadQueueParams(COMPLETE)).toEqual({
      ...COMPLETE,
      search: 'Lopez',
      street_number: '1234',
      street_dir: 'SW',
      street_name: 'Desert Spoon',
    });
  });

  it('drops unknown fields and falls back from invalid sort state', () => {
    expect(normalizeLeadQueueParams({
      status: 'archived',
      sort: 'password_hash',
      order: 'asc',
      page: '9',
      selection: ['lead-1'],
    })).toEqual({});
    expect(leadQueueSort({ sort: 'password_hash', order: 'asc' })).toEqual({
      sort: 'created_at',
      order: 'desc',
    });
  });

  it('patches one field without losing concurrent queue state', () => {
    expect(patchLeadQueueParams(COMPLETE, {
      street_number: '777',
      search: undefined,
    })).toMatchObject({
      status: 'appointment_set',
      priority: 'hot',
      street_number: '777',
      street_name: 'Desert Spoon',
      assigned_closer: USER_B,
      sort: 'follow_up_date',
      order: 'asc',
    });
  });

  it('clears all filters in one operation while keeping the sort', () => {
    const cleared = clearLeadQueueFilters(COMPLETE);
    expect(cleared).toEqual({ sort: 'follow_up_date', order: 'asc' });
    expect(hasLeadQueueFilters(cleared)).toBe(false);
    expect(new Set(LEAD_QUEUE_FILTER_KEYS)).not.toContain('sort');
  });

  it('starts a new sort in its useful direction and then toggles it', () => {
    expect(nextLeadSort({}, 'priority', 'desc')).toEqual({ sort: 'priority', order: 'desc' });
    expect(nextLeadSort({ sort: 'priority', order: 'desc' }, 'priority', 'desc'))
      .toEqual({ sort: 'priority', order: 'asc' });
    expect(nextLeadSort({}, 'password_hash')).toEqual({ sort: 'created_at', order: 'desc' });
  });

  it('serializes stable URLs without page 1 or an invalid view id', () => {
    const params = buildLeadQueueSearchParams(COMPLETE, { viewId: 'not-a-view', page: 1 });
    expect(params.has('page')).toBe(false);
    expect(params.has('view')).toBe(false);
    expect(params.has('limit')).toBe(false);
    expect(leadQueueHref(params)).toContain('/admin/leads?');

    const paged = buildLeadQueueSearchParams(COMPLETE, { viewId: USER_C, page: 3 });
    expect(paged.get('page')).toBe('3');
    expect(paged.get('view')).toBe(USER_C);
    expect(paged.has('limit')).toBe(false);
    expect(leadQueueParamsFromSearchParams(paged)).toEqual(normalizeLeadQueueParams(COMPLETE));
  });

  it('writes the all-leads view without a page and keeps the default 50-lead page implicit', () => {
    expect(leadListViewFromSearchParams(new URLSearchParams())).toBe('page');
    expect(leadListViewFromSearchParams(new URLSearchParams('limit=all'))).toBe('all');
    expect(leadListRequestLimit(null)).toBe(LEAD_PAGE_SIZE);
    expect(leadListRequestLimit('all')).toBe(LEAD_PAGE_SIZE);
    expect(leadListRequestLimit('2000')).toBe(1000);

    const all = buildLeadQueueSearchParams(COMPLETE, { page: 4, listView: 'all' });
    expect(all.get('limit')).toBe('all');
    expect(all.has('page')).toBe(false);
    expect(leadQueueParamsFromSearchParams(all)).toEqual(normalizeLeadQueueParams(COMPLETE));

    expect(leadListRangeLabel(0, 0, 1, 'page')).toBe('0');
    expect(leadListRangeLabel(967, 50, 1, 'page')).toBe('1–50');
    expect(leadListRangeLabel(967, 50, 2, 'page')).toBe('51–100');
    expect(leadListRangeLabel(1967, 1000, 1, 'all')).toBe('1–1,000');
  });
});

describe('saved lead view definition', () => {
  it('round-trips every filter and sort while keeping streets structured', () => {
    const normalized = normalizeLeadQueueParams(COMPLETE);
    const definition = leadViewDefinitionFromQueue(normalized);
    expect(definition.filters.streets).toEqual(['Main St', 'Oak Ave']);
    expect(definition.sort).toEqual({ key: 'follow_up_date', order: 'asc' });
    expect(leadQueueSignature(leadQueueParamsFromDefinition(definition)))
      .toBe(leadQueueSignature(normalized));
  });

  it('never persists pagination, selection, view ids, or unknown fields', () => {
    const params = leadQueueParamsFromSearchParams(new URLSearchParams({
      ...COMPLETE,
      page: '8',
      view: USER_C,
      selection: 'lead-1',
      unexpected: 'value',
    }));
    const definition = leadViewDefinitionFromQueue(params);
    expect(JSON.stringify(definition)).not.toMatch(/page|selection|unexpected|view|limit/);
  });

  it('rejects malformed or future definitions instead of widening them', () => {
    expect(parseLeadViewDefinition({ filters: {}, sort: { key: 'password_hash', order: 'asc' } }))
      .toBeNull();
    expect(parseLeadViewDefinition({ filters: {}, sort: { key: 'created_at', order: 'desc' }, extra: true }))
      .toBeNull();
  });
});
