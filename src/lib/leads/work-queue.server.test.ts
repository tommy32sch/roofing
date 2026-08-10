import { describe, expect, it } from 'vitest';
import {
  applyLeadQueueFilters,
  leadQueueRequestParamsFromSearchParams,
} from './work-queue.server';

class QueryRecorder {
  calls: unknown[][] = [];
  eq(...args: unknown[]) { this.calls.push(['eq', ...args]); return this; }
  is(...args: unknown[]) { this.calls.push(['is', ...args]); return this; }
  not(...args: unknown[]) { this.calls.push(['not', ...args]); return this; }
  or(...args: unknown[]) { this.calls.push(['or', ...args]); return this; }
  ilike(...args: unknown[]) { this.calls.push(['ilike', ...args]); return this; }
  filter(...args: unknown[]) { this.calls.push(['filter', ...args]); return this; }
}

describe('applyLeadQueueFilters', () => {
  it('applies the complete visible queue contract', () => {
    const query = applyLeadQueueFilters(new QueryRecorder(), {
      status: 'new',
      priority: 'hot',
      search: 'Lopez',
      street_number: '123',
      street_dir: 'E',
      street_name: 'Main',
      streets: 'Main St|Oak Ave',
      is_dnc: 'true',
      created_by: '11111111-1111-4111-8111-111111111111',
      assigned_setter: 'unassigned',
      assigned_closer: '22222222-2222-4222-8222-222222222222',
    });

    expect(query.calls).toEqual(expect.arrayContaining([
      ['eq', 'status', 'new'],
      ['eq', 'priority', 'hot'],
      ['eq', 'is_dnc', true],
      ['eq', 'created_by', '11111111-1111-4111-8111-111111111111'],
      ['is', 'assigned_setter_id', null],
      ['eq', 'assigned_closer_id', '22222222-2222-4222-8222-222222222222'],
      ['ilike', 'address_street', '123%'],
      ['ilike', 'address_street', '%Main%'],
    ]));
    expect(query.calls.filter(([method]) => method === 'or')).toHaveLength(2);
  });

  it('omits the current street selection only for the street picker', () => {
    const query = applyLeadQueueFilters(
      new QueryRecorder(),
      { status: 'new', streets: 'Main St|Oak Ave' },
      { includeSelectedStreets: false }
    );
    expect(query.calls).toContainEqual(['eq', 'status', 'new']);
    expect(query.calls.some(([method]) => method === 'or')).toBe(false);
  });

  it('keeps malformed assignee filters so the query fails closed', () => {
    const params = leadQueueRequestParamsFromSearchParams(new URLSearchParams({
      assigned_setter: 'not-a-user',
      assigned_closer: 'also-not-a-user',
    }));
    const query = applyLeadQueueFilters(new QueryRecorder(), params);

    expect(query.calls).toEqual(expect.arrayContaining([
      ['is', 'assigned_setter_id', null],
      ['not', 'assigned_setter_id', 'is', null],
      ['is', 'assigned_closer_id', null],
      ['not', 'assigned_closer_id', 'is', null],
    ]));
  });
});
