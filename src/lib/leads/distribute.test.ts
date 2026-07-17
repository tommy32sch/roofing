import { describe, it, expect } from 'vitest';
import { distributeLeads, type DistributeLead } from './distribute';

const leads = (values: (number | null)[]): DistributeLead[] =>
  values.map((value, i) => ({ id: `lead-${String(i).padStart(2, '0')}`, value }));

function allIds(buckets: { lead_ids: string[] }[]): string[] {
  return buckets.flatMap((b) => b.lead_ids).sort();
}

describe('distributeLeads — count strategy', () => {
  it('splits 7 leads across 2 reps as 4/3', () => {
    const r = distributeLeads(leads([1, 2, 3, 4, 5, 6, 7].map((n) => n * 1000)), ['a', 'b'], 'count');
    const counts = r.map((b) => b.count).sort();
    expect(counts).toEqual([3, 4]);
    expect(r.reduce((s, b) => s + b.count, 0)).toBe(7);
  });

  it('keeps counts within 1 of each other for any N/reps', () => {
    const r = distributeLeads(leads(Array(10).fill(100)), ['a', 'b', 'c'], 'count');
    const counts = r.map((b) => b.count);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('assigns every lead exactly once, no duplicates or drops', () => {
    const input = leads(Array(13).fill(500));
    const r = distributeLeads(input, ['a', 'b', 'c'], 'count');
    expect(allIds(r)).toEqual(input.map((l) => l.id).sort());
  });
});

describe('distributeLeads — value strategy', () => {
  it('balances total value across reps (LPT greedy)', () => {
    const r = distributeLeads(leads([20000, 18000, 15000, 9000, 8000]), ['a', 'b'], 'value');
    const totals = r.map((b) => b.total_value);
    // sum preserved, and the two reps are close in dollar value
    expect(totals.reduce((a, b) => a + b, 0)).toBe(70000);
    expect(Math.abs(totals[0] - totals[1])).toBeLessThanOrEqual(4000);
  });

  it('treats null value as 0 but still spreads null-value leads evenly (count tiebreak)', () => {
    const r = distributeLeads(leads([null, null, null, null, null, null]), ['a', 'b', 'c'], 'value');
    expect(r.map((b) => b.count).sort()).toEqual([2, 2, 2]);
    expect(r.every((b) => b.total_value === 0)).toBe(true);
  });

  it('total_value always sums the real values regardless of strategy', () => {
    const input = leads([1000, null, 2500, 4000]);
    const byCount = distributeLeads(input, ['a', 'b'], 'count');
    const byValue = distributeLeads(input, ['a', 'b'], 'value');
    const sum = (bs: { total_value: number }[]) => bs.reduce((s, b) => s + b.total_value, 0);
    expect(sum(byCount)).toBe(7500);
    expect(sum(byValue)).toBe(7500);
  });
});

describe('distributeLeads — determinism & edges', () => {
  it('is deterministic: identical inputs produce identical output', () => {
    const input = leads([20000, 18000, 15000, 9000, 8000, null, null]);
    const a = distributeLeads(input, ['x', 'y'], 'value');
    const b = distributeLeads(input, ['x', 'y'], 'value');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('handles a single rep by giving them everything', () => {
    const input = leads([100, 200, 300]);
    const r = distributeLeads(input, ['solo'], 'count');
    expect(r).toHaveLength(1);
    expect(r[0].count).toBe(3);
    expect(r[0].total_value).toBe(600);
  });

  it('handles empty lead list', () => {
    const r = distributeLeads([], ['a', 'b'], 'value');
    expect(r.every((b) => b.count === 0 && b.lead_ids.length === 0)).toBe(true);
  });
});
