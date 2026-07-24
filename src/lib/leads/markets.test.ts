import { describe, it, expect } from 'vitest';
import { resolveMarketFilter, applyMarketFilter, shouldRecenterMap, ALL_MARKETS } from './markets';

const AZ = 1;
const MN = 2;

describe('resolveMarketFilter', () => {
  it('defaults to the callers home market when no parameter is sent', () => {
    expect(resolveMarketFilter(null, AZ)).toBe(AZ);
    expect(resolveMarketFilter(undefined, MN)).toBe(MN);
    expect(resolveMarketFilter('', AZ)).toBe(AZ);
  });

  it('honours an explicit market', () => {
    expect(resolveMarketFilter(String(MN), AZ)).toBe(MN);
  });

  it('returns no filter for the "all markets" sentinel', () => {
    expect(resolveMarketFilter(ALL_MARKETS, AZ)).toBeNull();
  });

  // Rollout safety: every user has a null home market until offices are
  // assigned. That must mean "see everything", not "see nothing" — otherwise
  // shipping this migration would blank out everyone's leads list.
  it('does not filter for a user with no home market', () => {
    expect(resolveMarketFilter(null, null)).toBeNull();
    expect(resolveMarketFilter(undefined, undefined)).toBeNull();
  });

  // A junk id must not widen the query to every market; fall back to the
  // caller's own office instead.
  it('falls back to the home market on a malformed id', () => {
    for (const junk of ['abc', '-1', '0', '1.5', 'NaN', ' ']) {
      expect(resolveMarketFilter(junk, AZ)).toBe(AZ);
    }
  });

  it('still yields no filter for a malformed id when there is no home market', () => {
    expect(resolveMarketFilter('abc', null)).toBeNull();
  });
});

describe('applyMarketFilter', () => {
  function fakeQuery() {
    const calls: [string, number][] = [];
    const q = {
      calls,
      eq(column: string, value: number) {
        calls.push([column, value]);
        return q;
      },
    };
    return q;
  }

  it('constrains the query when a market is in effect', () => {
    const q = fakeQuery();
    applyMarketFilter(q, MN);
    expect(q.calls).toEqual([['market_id', MN]]);
  });

  it('leaves the query untouched when there is no market', () => {
    const q = fakeQuery();
    applyMarketFilter(q, null);
    expect(q.calls).toEqual([]);
  });
});

describe('shouldRecenterMap', () => {
  const base = { loading: false, hasLeads: false, hasCenter: true };

  // The reported bug: switching to Minnesota, which has no leads, left the map
  // sitting over Phoenix because the fit-to-leads path bails out on an empty set.
  it('recentres on an office that has no mapped leads', () => {
    expect(shouldRecenterMap(base)).toBe(true);
  });

  // Fitting the actual pins beats a fixed centre, so it must not take over.
  it('defers to the lead fit when the office has leads', () => {
    expect(shouldRecenterMap({ ...base, hasLeads: true })).toBe(false);
  });

  // Mid-switch `leads` still holds the PREVIOUS office's pins. Acting then would
  // fly to the centre and let the fit immediately override it.
  it('waits while the new market is still loading', () => {
    expect(shouldRecenterMap({ ...base, loading: true })).toBe(false);
    expect(shouldRecenterMap({ loading: true, hasLeads: true, hasCenter: true })).toBe(false);
  });

  // "All Markets", or an office whose centre never geocoded — hold the view
  // rather than jumping somewhere arbitrary.
  it('holds the current view when there is no centre to move to', () => {
    expect(shouldRecenterMap({ ...base, hasCenter: false })).toBe(false);
  });
});
