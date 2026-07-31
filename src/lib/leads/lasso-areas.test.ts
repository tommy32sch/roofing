import { describe, it, expect } from 'vitest';
import {
  leadsAfterRemovingArea,
  totalLeadsInAreas,
  newLeadsFromArea,
  areaLabel,
  type LassoArea,
} from './lasso-areas';

const area = (id: string, leadIds: string[]): LassoArea => ({
  id,
  path: [[33, -112], [33.1, -112], [33.1, -111.9]],
  leadIds,
});

describe('leadsAfterRemovingArea', () => {
  it('drops the leads that only that area covered', () => {
    const areas = [area('a', ['1', '2']), area('b', ['3'])];
    expect(leadsAfterRemovingArea(areas, 'a')).toEqual({
      remaining: [areas[1]],
      dropped: ['1', '2'],
    });
  });

  /**
   * The case undo exists to get right. A lead inside two overlapping loops must
   * survive removing one of them — otherwise undoing a mistake silently
   * deselects houses the operator never meant to lose.
   */
  it('keeps leads another area still claims', () => {
    const areas = [area('a', ['1', '2', '3']), area('b', ['2', '3', '4'])];
    const { remaining, dropped } = leadsAfterRemovingArea(areas, 'a');
    expect(dropped).toEqual(['1']);
    expect(remaining).toHaveLength(1);
  });

  it('drops everything when the last area goes', () => {
    expect(leadsAfterRemovingArea([area('a', ['1', '2'])], 'a')).toEqual({
      remaining: [],
      dropped: ['1', '2'],
    });
  });

  it('is a no-op for an id that is not there', () => {
    const areas = [area('a', ['1'])];
    expect(leadsAfterRemovingArea(areas, 'ghost')).toEqual({ remaining: areas, dropped: [] });
  });

  it('handles an empty area', () => {
    const areas = [area('a', []), area('b', ['1'])];
    expect(leadsAfterRemovingArea(areas, 'a').dropped).toEqual([]);
  });
});

describe('totalLeadsInAreas', () => {
  it('counts distinct leads', () => {
    expect(totalLeadsInAreas([area('a', ['1', '2']), area('b', ['3'])])).toBe(3);
  });

  // Summing would claim more leads than are actually selected.
  it('does not double-count an overlap', () => {
    expect(totalLeadsInAreas([area('a', ['1', '2']), area('b', ['2', '3'])])).toBe(3);
  });

  it('is zero with no areas', () => {
    expect(totalLeadsInAreas([])).toBe(0);
  });
});

describe('newLeadsFromArea', () => {
  it('reports only what is not already covered', () => {
    const areas = [area('a', ['1', '2'])];
    expect(newLeadsFromArea(areas, ['2', '3', '4'])).toEqual(['3', '4']);
  });

  // "12 selected" when nothing changed reads as a bug.
  it('is empty when a second loop covers the same ground', () => {
    const areas = [area('a', ['1', '2'])];
    expect(newLeadsFromArea(areas, ['1', '2'])).toEqual([]);
  });

  it('returns everything when there are no areas yet', () => {
    expect(newLeadsFromArea([], ['1', '2'])).toEqual(['1', '2']);
  });
});

describe('areaLabel', () => {
  it('numbers areas from one, as drawn', () => {
    expect(areaLabel(0)).toBe('Area 1');
    expect(areaLabel(2)).toBe('Area 3');
  });
});
