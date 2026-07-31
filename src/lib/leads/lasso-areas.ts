/**
 * Multiple lasso areas held together as one selection.
 *
 * Drawing several areas already worked — draw mode stays active and each loop
 * adds to the selection — but the shape was discarded the moment it committed,
 * so after three loops you had a count and no idea which parts of the map they
 * covered. Keeping the areas makes the selection reviewable, and makes undo
 * possible at all.
 *
 * Undo is the reason each area remembers its own leads. A lead can sit inside
 * two overlapping loops, so removing one area must not deselect a lead the other
 * area still claims — otherwise undoing a mistake silently drops houses the
 * operator never meant to lose.
 */

export interface LassoArea {
  id: string;
  /** The drawn outline, for rendering. */
  path: [number, number][];
  /** Leads enclosed by THIS area, including ones other areas also enclose. */
  leadIds: string[];
}

/** Which leads survive when an area is removed: those still claimed elsewhere. */
export function leadsAfterRemovingArea(
  areas: LassoArea[],
  removeId: string
): { remaining: LassoArea[]; dropped: string[] } {
  const remaining = areas.filter((a) => a.id !== removeId);
  const target = areas.find((a) => a.id === removeId);
  if (!target) return { remaining, dropped: [] };

  const stillClaimed = new Set(remaining.flatMap((a) => a.leadIds));
  const dropped = target.leadIds.filter((id) => !stillClaimed.has(id));
  return { remaining, dropped };
}

/**
 * How many leads the areas cover in total.
 *
 * Deduplicated: two overlapping loops over the same street enclose the same
 * houses, and reporting the sum would claim more than are selected.
 */
export function totalLeadsInAreas(areas: LassoArea[]): number {
  return new Set(areas.flatMap((a) => a.leadIds)).size;
}

/**
 * Leads a new area adds that are not already covered.
 *
 * Drives the "12 added" message. Reporting what the shape ENCLOSED rather than
 * what it added reads as a bug when a second overlapping loop changes nothing.
 */
export function newLeadsFromArea(areas: LassoArea[], candidateIds: string[]): string[] {
  const already = new Set(areas.flatMap((a) => a.leadIds));
  return candidateIds.filter((id) => !already.has(id));
}

/** Stable, readable label for an area. Areas are numbered as drawn. */
export function areaLabel(index: number): string {
  return `Area ${index + 1}`;
}
