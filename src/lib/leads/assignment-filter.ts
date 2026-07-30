import { isValidUUID } from '@/lib/utils/validation';

/**
 * "Who owns this lead?" as a filter.
 *
 * Three distinct questions, and the third is the one that matters operationally:
 *   - any: don't filter
 *   - a specific person: "show me everything Chris owns"
 *   - UNASSIGNED: "show me what nobody owns"
 *
 * Unassigned is not a user id, so it cannot be expressed as an equality — it
 * needs `IS NULL`. Conflating the two is how leads quietly fall through: a
 * filter that only supports "equals a person" can never surface the ones with
 * no owner at all.
 *
 * A malformed value resolves to `invalid`, and callers must narrow to nothing
 * rather than widen to everything. Silently ignoring a bad filter is worse than
 * an empty list, because the operator then acts on a set they did not ask for —
 * the same class of mistake that let bulk assign write to hidden rows.
 */

export const UNASSIGNED = 'unassigned';

export type AssigneeFilter =
  | { kind: 'any' }
  | { kind: 'unassigned' }
  | { kind: 'user'; userId: string }
  | { kind: 'invalid' };

export function parseAssigneeFilter(raw: string | null | undefined): AssigneeFilter {
  if (raw === null || raw === undefined) return { kind: 'any' };
  const value = raw.trim();
  if (value === '') return { kind: 'any' };
  if (value.toLowerCase() === UNASSIGNED) return { kind: 'unassigned' };
  if (isValidUUID(value)) return { kind: 'user', userId: value };
  return { kind: 'invalid' };
}

/** The column each role's assignment lives in. */
export const ASSIGNEE_COLUMN = {
  setter: 'assigned_setter_id',
  closer: 'assigned_closer_id',
} as const;

export type AssignableRole = keyof typeof ASSIGNEE_COLUMN;

/**
 * Apply the filter to a PostgREST query builder.
 *
 * Deliberately generic and unconstrained: the concrete supabase-js builder type
 * is recursive, and naming it here makes TypeScript blow its instantiation depth
 * the same way applyMarketFilter did.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyAssigneeFilter<T = any>(
  query: T,
  role: AssignableRole,
  filter: AssigneeFilter
): T {
  const column = ASSIGNEE_COLUMN[role];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;

  switch (filter.kind) {
    case 'any':
      return query;
    case 'unassigned':
      return q.is(column, null);
    case 'user':
      return q.eq(column, filter.userId);
    case 'invalid':
      // Narrow to nothing. `is not null AND is null` is unsatisfiable, which is
      // the honest answer to a filter we could not understand.
      return q.is(column, null).not(column, 'is', null);
  }
}

/** Display label for an assignment cell. */
export function assigneeLabel(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : '—';
}
