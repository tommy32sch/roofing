import type { UserRole } from '@/types';
import {
  REPORT_PERIODS,
  type ReportActorScope,
  type ReportPeriod,
  type ReportScopeSelection,
} from './contracts';

export interface RawReportScope {
  period: string | null;
  from: string | null;
  to: string | null;
  localDate: string | null;
  marketId: string | null;
  actor: string | null;
}

const REPORT_PERIOD_SET = new Set<string>(REPORT_PERIODS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isReportPeriod(value: string | null | undefined): value is ReportPeriod {
  return !!value && REPORT_PERIOD_SET.has(value);
}

export function parseReportScopeUrl(searchParams: URLSearchParams): RawReportScope {
  return {
    period: searchParams.get('period'),
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    localDate: searchParams.get('local_date'),
    marketId: searchParams.get('market_id'),
    actor: searchParams.get('actor'),
  };
}

export function localCalendarDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Express a named device-local period as half-open instants.
 *
 * Calendar mutation is deliberate. Adding a fixed number of milliseconds
 * would make a local day wrong when daylight-saving time changes.
 */
export function localReportPeriodBounds(
  period: Exclude<ReportPeriod, 'custom'>,
  now = new Date()
): Pick<ReportScopeSelection, 'period' | 'from' | 'to' | 'localDate'> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === 'week') {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  } else if (period === 'month') {
    start.setDate(1);
  }

  const end = new Date(start);
  if (period === 'today') end.setDate(end.getDate() + 1);
  if (period === 'week') end.setDate(end.getDate() + 7);
  if (period === 'month') end.setMonth(end.getMonth() + 1);

  return {
    period,
    from: start.toISOString(),
    to: end.toISOString(),
    localDate: localCalendarDate(now),
  };
}

export function defaultReportActor(role: UserRole): ReportActorScope {
  return role === 'admin' ? { kind: 'all' } : { kind: 'mine' };
}

export function actorScopeFromParam(value: string | null): ReportActorScope | null {
  if (value === 'all') return { kind: 'all' };
  if (value === 'mine') return { kind: 'mine' };
  if (value?.startsWith('member:')) {
    const memberId = value.slice('member:'.length);
    return UUID_PATTERN.test(memberId) ? { kind: 'member', memberId } : null;
  }
  return null;
}

export function actorScopeToParam(actor: ReportActorScope): string {
  return actor.kind === 'member' ? `member:${actor.memberId}` : actor.kind;
}

function validInstant(value: string | null): value is string {
  return !!value && !Number.isNaN(Date.parse(value));
}

function validLocalDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function marketFromParam(value: string | null, fallback: number | null): number | null {
  if (value === 'all') return null;
  if (value && /^\d+$/.test(value) && Number(value) > 0) return Number(value);
  return fallback;
}

/**
 * Fill missing or malformed browser URL state with device-local defaults.
 * The API validates the serialized result again before it runs any query.
 */
export function reportScopeForDevice(
  raw: RawReportScope,
  input: {
    role: UserRole;
    homeMarketId: number | null;
    now?: Date;
    defaultPeriod?: Exclude<ReportPeriod, 'custom'>;
  }
): ReportScopeSelection {
  const now = input.now ?? new Date();
  const fallbackPeriod = input.defaultPeriod ?? 'week';
  const requestedPeriod = isReportPeriod(raw.period) ? raw.period : fallbackPeriod;
  const hasValidWindow =
    validInstant(raw.from) &&
    validInstant(raw.to) &&
    Date.parse(raw.to) > Date.parse(raw.from);
  const period = requestedPeriod === 'custom' && !hasValidWindow
    ? fallbackPeriod
    : requestedPeriod;
  const namedPeriod = period === 'custom' ? fallbackPeriod : period;
  const bounds = localReportPeriodBounds(namedPeriod, now);
  const requestedActor = actorScopeFromParam(raw.actor) ?? defaultReportActor(input.role);

  return {
    period,
    from: hasValidWindow ? raw.from! : bounds.from,
    to: hasValidWindow ? raw.to! : bounds.to,
    localDate: validLocalDate(raw.localDate) ? raw.localDate : localCalendarDate(now),
    marketId: marketFromParam(raw.marketId, input.homeMarketId),
    // The API is still the security boundary. This clamp only keeps a rep who
    // follows an admin bookmark on a usable Mine view instead of an avoidable
    // forbidden screen.
    actor: input.role === 'admin' ? requestedActor : { kind: 'mine' },
  };
}

export function serializeReportScope(scope: ReportScopeSelection): URLSearchParams {
  const params = new URLSearchParams();
  params.set('period', scope.period);
  params.set('from', scope.from);
  params.set('to', scope.to);
  params.set('local_date', scope.localDate);
  params.set('market_id', scope.marketId == null ? 'all' : String(scope.marketId));
  params.set('actor', actorScopeToParam(scope.actor));
  return params;
}

export function reportScopeKey(scope: ReportScopeSelection): string {
  return serializeReportScope(scope).toString();
}
