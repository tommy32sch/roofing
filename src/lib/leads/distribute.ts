/**
 * Deterministic lead distribution among reps.
 *
 * Pure module (no imports) shared by the bulk-assign API and, later, the map
 * view. Greedy LPT: sort leads by weight descending, always hand the next lead
 * to the rep with the lowest running total. With `strategy: 'count'` every
 * weight is 1, which degenerates to an exact round-robin (counts differ by at
 * most 1). No randomness — the same inputs always produce the same split, so a
 * dry-run preview matches the committed result.
 */

export type DistributeStrategy = 'count' | 'value';

export interface DistributeLead {
  id: string;
  /** estimated_roof_value; null/unknown weighs 0 under the 'value' strategy */
  value: number | null;
}

export interface DistributeBucket {
  user_id: string;
  lead_ids: string[];
  count: number;
  total_value: number;
}

export function distributeLeads(
  leads: DistributeLead[],
  userIds: string[],
  strategy: DistributeStrategy
): DistributeBucket[] {
  const weight = (l: DistributeLead) => (strategy === 'value' ? Number(l.value) || 0 : 1);

  // Weight desc, id asc tiebreak — stable and deterministic.
  const sorted = [...leads].sort((a, b) => weight(b) - weight(a) || (a.id < b.id ? -1 : 1));

  const buckets = userIds.map((user_id) => ({
    user_id,
    lead_ids: [] as string[],
    count: 0,
    total_value: 0,
    sum: 0,
  }));

  for (const lead of sorted) {
    // Lowest running sum wins; ties broken by lowest count, then bucket order.
    let target = buckets[0];
    for (const b of buckets) {
      if (b.sum < target.sum || (b.sum === target.sum && b.count < target.count)) {
        target = b;
      }
    }
    target.lead_ids.push(lead.id);
    target.count += 1;
    target.sum += weight(lead);
    target.total_value += Number(lead.value) || 0;
  }

  return buckets.map(({ user_id, lead_ids, count, total_value }) => ({
    user_id,
    lead_ids,
    count,
    total_value,
  }));
}
