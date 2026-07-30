/**
 * Scope identity for a bulk lead selection.
 *
 * Bulk-assign sends whatever ids are in the selection, and the server cannot
 * know which filter was on screen when they were picked. So the client has to
 * guarantee that a selection only ever means "these rows, from the list I am
 * looking at".
 *
 * Without that guarantee the failure is silent and destructive: select rows with
 * no filter, then narrow to Do Not Call, and the earlier rows are still selected
 * but no longer rendered. The assign bar offers to assign them, the ids go up,
 * and leads the operator cannot see — potentially the whole database — are
 * reassigned. There is no undo.
 *
 * Paging is deliberately NOT part of the identity. Walking pages 1..n of one
 * filter and accumulating a selection is a real workflow; changing the filter is
 * what invalidates the premise.
 */

export interface LeadFilterScope {
  status: string;
  priority: string;
  search: string;
  streetNumber: string;
  streetDir: string;
  streetName: string;
  streets: string;
  dncOnly: boolean;
  marketId: string;
  createdBy: string;
}

/** Field order for the key. Exported so the test can assert full coverage. */
export const LEAD_FILTER_FIELDS: (keyof LeadFilterScope)[] = [
  'status',
  'priority',
  'search',
  'streetNumber',
  'streetDir',
  'streetName',
  'streets',
  'dncOnly',
  'marketId',
  'createdBy',
];

/**
 * A stable string identifying the current filter set.
 *
 * Every filter that changes WHICH leads are listed must appear here. The unit
 * test walks LEAD_FILTER_FIELDS and asserts each one moves the key, so adding a
 * filter without extending this fails the build rather than quietly
 * reintroducing cross-filter selection.
 *
 * JSON rather than a joined string, because concatenation makes distinct filter
 * sets collide — status "new" with no priority would produce the same key as no
 * status with priority "new" — and a colliding key means the selection is NOT
 * cleared, which is precisely the bug this exists to prevent. The `streets`
 * value already contains "|" internally, so no single-character separator is
 * safe either.
 */
export function leadFilterKey(scope: LeadFilterScope): string {
  return JSON.stringify(LEAD_FILTER_FIELDS.map((field) => scope[field]));
}

/** Whether a selection made under `previous` may carry over to `next`. */
export function selectionSurvivesFilterChange(previous: string, next: string): boolean {
  return previous === next;
}
