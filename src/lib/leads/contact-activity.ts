import type { UserRole } from '@/types';
import { isValidUUID } from '@/lib/utils/validation';

export type ContactActivityPeriod = 'today' | 'week' | 'month';
export type ContactActivityScope = 'me' | 'all' | string;

const PERIODS = new Set<ContactActivityPeriod>(['today', 'week', 'month']);

export function isContactActivityPeriod(value: string | null): value is ContactActivityPeriod {
  return !!value && PERIODS.has(value as ContactActivityPeriod);
}

/**
 * Current local reporting window. The browser owns these boundaries because a
 * Phoenix rep's "today" is not the same pair of instants as a Minnesota rep's,
 * and Vercel itself runs in UTC.
 */
export function localContactActivityBounds(
  period: ContactActivityPeriod,
  now = new Date()
): { start: string; end: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === 'week') {
    // Monday is the first sales day of the reporting week.
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  } else if (period === 'month') {
    start.setDate(1);
  }

  const end = new Date(start);
  if (period === 'today') end.setDate(end.getDate() + 1);
  if (period === 'week') end.setDate(end.getDate() + 7);
  if (period === 'month') end.setMonth(end.getMonth() + 1);

  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * The client supplies local boundaries, so reject malformed or widened ranges
 * before they reach the database. The tolerance covers DST-short/long periods.
 */
export function isValidContactActivityWindow(
  period: ContactActivityPeriod,
  start: string | null,
  end: string | null
): boolean {
  if (!start || !end) return false;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return false;

  const hours = (endMs - startMs) / 3_600_000;
  if (period === 'today') return hours >= 22 && hours <= 26;
  if (period === 'week') return hours >= 166 && hours <= 170;
  return hours >= 670 && hours <= 746;
}

export function defaultContactActivityScope(role: UserRole): 'me' | 'all' {
  return role === 'admin' ? 'all' : 'me';
}

export type ContactActivityUserResolution =
  | { ok: true; userId: string | null }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Reps may only report their own work. Admins can review themselves, one valid
 * account, or the full team.
 */
export function resolveContactActivityUser(
  role: UserRole,
  currentUserId: string,
  requested: string | null
): ContactActivityUserResolution {
  const scope = requested || defaultContactActivityScope(role);
  if (scope === 'me') return { ok: true, userId: currentUserId };

  if (role !== 'admin') {
    return { ok: false, status: 403, error: 'Only admins can view another account' };
  }
  if (scope === 'all') return { ok: true, userId: null };
  if (!isValidUUID(scope)) {
    return { ok: false, status: 400, error: 'Invalid account ID' };
  }
  return { ok: true, userId: scope };
}
