import type { UserRole } from '@/types';
import type {
  ReportActorScope,
  ReportMemberOption,
  ReportScope,
} from './contracts';
import {
  actorScopeFromParam,
  isReportPeriod,
  type RawReportScope,
} from './scope';

const NAMED_PERIOD_HOURS = {
  today: { min: 22, max: 26 },
  week: { min: 166, max: 170 },
  month: { min: 670, max: 746 },
} as const;

export interface ReportingRequestActor {
  id: string;
  name: string;
  role: UserRole;
  homeMarketId: number | null;
}

export interface ResolvedReportScope {
  scope: ReportScope;
  scopeLabel: string;
  requestActor: { id: string; role: UserRole };
  leadActor: { id: string; role: UserRole };
  leadScope: 'all' | 'mine';
  activityUserId: string | null;
}

export type ReportScopeResolution =
  | { ok: true; value: ResolvedReportScope }
  | { ok: false; status: 400 | 403; error: string };

function validCalendarDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const canonical = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  return canonical === value;
}

function validWindow(period: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return false;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false;
  const hours = (end - start) / 3_600_000;
  if (period === 'custom') return hours <= 24 * 366;
  const limits = NAMED_PERIOD_HOURS[period as keyof typeof NAMED_PERIOD_HOURS];
  return !!limits && hours >= limits.min && hours <= limits.max;
}

function selectedMarket(
  raw: string | null,
  actor: ReportingRequestActor,
  marketIds: ReadonlySet<number>
): { ok: true; marketId: number | null } | { ok: false; status: 400 | 403; error: string } {
  if (raw === 'all') return { ok: true, marketId: null };

  let marketId: number | null = actor.homeMarketId;
  if (raw != null && raw !== '') {
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
      return { ok: false, status: 400, error: 'Invalid market scope' };
    }
    marketId = Number(raw);
  }

  if (marketId != null && !marketIds.has(marketId)) {
    return { ok: false, status: 403, error: 'Market is not available to this account' };
  }
  return { ok: true, marketId };
}

function selectedActor(
  raw: string | null,
  actor: ReportingRequestActor,
  members: ReportMemberOption[]
):
  | {
      ok: true;
      selection: ReportActorScope;
      leadActor: { id: string; role: UserRole };
      leadScope: 'all' | 'mine';
      activityUserId: string | null;
      label: string;
    }
  | { ok: false; status: 400 | 403; error: string } {
  const requested = raw == null
    ? actor.role === 'admin'
      ? { kind: 'all' as const }
      : { kind: 'mine' as const }
    : actorScopeFromParam(raw);

  if (!requested) return { ok: false, status: 400, error: 'Invalid team scope' };

  if (actor.role !== 'admin' && requested.kind !== 'mine') {
    return { ok: false, status: 403, error: 'Team data is limited to admins' };
  }

  if (requested.kind === 'all') {
    return {
      ok: true,
      selection: requested,
      leadActor: { id: actor.id, role: actor.role },
      leadScope: 'all',
      activityUserId: null,
      label: 'All team',
    };
  }

  if (requested.kind === 'mine') {
    return {
      ok: true,
      selection: requested,
      leadActor: { id: actor.id, role: actor.role },
      leadScope: 'mine',
      activityUserId: actor.id,
      label: actor.name || 'My work',
    };
  }

  const member = members.find((candidate) => candidate.id === requested.memberId);
  if (!member) {
    return { ok: false, status: 403, error: 'Team member is not available' };
  }
  return {
    ok: true,
    selection: requested,
    leadActor: { id: member.id, role: member.role },
    leadScope: 'mine',
    activityUserId: member.id,
    label: member.name,
  };
}

/** Validate every scope boundary before a service-role query can run. */
export function resolveReportScope(
  raw: RawReportScope,
  input: {
    actor: ReportingRequestActor;
    members: ReportMemberOption[];
    accessibleMarketIds: Iterable<number>;
    nowIso?: string;
  }
): ReportScopeResolution {
  if (!isReportPeriod(raw.period)) {
    return { ok: false, status: 400, error: 'A valid report period is required' };
  }
  if (!validWindow(raw.period, raw.from, raw.to)) {
    return { ok: false, status: 400, error: 'A valid report range is required' };
  }
  if (!validCalendarDate(raw.localDate)) {
    return { ok: false, status: 400, error: 'A valid local date is required' };
  }

  const market = selectedMarket(
    raw.marketId,
    input.actor,
    new Set(input.accessibleMarketIds)
  );
  if (!market.ok) return market;

  const team = selectedActor(raw.actor, input.actor, input.members);
  if (!team.ok) return team;

  const asOf = input.nowIso ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(asOf))) {
    return { ok: false, status: 400, error: 'Invalid report clock' };
  }

  return {
    ok: true,
    value: {
      scope: {
        period: raw.period,
        from: new Date(raw.from!).toISOString(),
        to: new Date(raw.to!).toISOString(),
        localDate: raw.localDate,
        marketId: market.marketId,
        actor: team.selection,
        asOf: new Date(asOf).toISOString(),
      },
      scopeLabel: team.label,
      requestActor: { id: input.actor.id, role: input.actor.role },
      leadActor: team.leadActor,
      leadScope: team.leadScope,
      activityUserId: team.activityUserId,
    },
  };
}
