'use client';

import { CalendarRange, Users } from 'lucide-react';
import type { Market, UserRole } from '@/types';
import type {
  ReportActorScope,
  ReportMemberOption,
  ReportPeriod,
  ReportScopeSelection,
} from '@/lib/reporting/contracts';
import { actorScopeToParam } from '@/lib/reporting/scope';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PERIODS: { value: Exclude<ReportPeriod, 'custom'>; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

function periodRange(scope: ReportScopeSelection): string {
  const start = new Date(scope.from);
  const end = new Date(Date.parse(scope.to) - 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Invalid range';
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(end);
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

function actorLabel(actor: ReportActorScope, members: ReportMemberOption[], userName: string) {
  if (actor.kind === 'all') return 'All team';
  if (actor.kind === 'mine') return userName || 'My work';
  return members.find((member) => member.id === actor.memberId)?.name ?? 'Team member';
}

export function ReportScopeBar({
  scope,
  role,
  userName,
  markets,
  members,
  onPeriodChange,
  onMarketChange,
  onActorChange,
}: {
  scope: ReportScopeSelection;
  role: UserRole;
  userName: string;
  markets: Market[];
  members: ReportMemberOption[];
  onPeriodChange: (period: Exclude<ReportPeriod, 'custom'>) => void;
  onMarketChange: (marketId: number | null) => void;
  onActorChange: (actor: ReportActorScope) => void;
}) {
  const selectedActor = actorScopeToParam(scope.actor);
  const selectedMarket = scope.marketId == null ? 'all' : String(scope.marketId);
  return (
    <div className="flex flex-col gap-3 border-y bg-muted/15 px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="inline-flex min-h-11 items-center border bg-background p-1" aria-label="Report period">
          {PERIODS.map((period) => (
            <Button
              key={period.value}
              type="button"
              variant={scope.period === period.value ? 'secondary' : 'ghost'}
              className="h-9 px-3"
              aria-pressed={scope.period === period.value}
              onClick={() => onPeriodChange(period.value)}
            >
              {period.label}
            </Button>
          ))}
          {scope.period === 'custom' && (
            <span className="px-3 text-sm font-medium">Custom</span>
          )}
        </div>
        <div className="flex min-h-11 items-center gap-2 px-1 text-xs text-muted-foreground">
          <CalendarRange className="h-4 w-4" />
          <span className="tabular-nums">{periodRange(scope)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {markets.length > 1 && (
          <Select
            value={selectedMarket}
            onValueChange={(value) =>
              onMarketChange(value === 'all' || !value ? null : Number(value))
            }
          >
            <SelectTrigger className="h-11 min-w-36" aria-label="Report market">
              <SelectValue>
                {scope.marketId == null
                  ? 'All markets'
                  : markets.find((market) => market.id === scope.marketId)?.name ?? 'Market'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="min-h-11">All markets</SelectItem>
              {markets.map((market) => (
                <SelectItem key={market.id} value={String(market.id)} className="min-h-11">
                  {market.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {role === 'admin' ? (
          <Select
            value={selectedActor}
            onValueChange={(value) => {
              if (value === 'all') onActorChange({ kind: 'all' });
              else if (value === 'mine') onActorChange({ kind: 'mine' });
              else if (value?.startsWith('member:')) {
                onActorChange({ kind: 'member', memberId: value.slice('member:'.length) });
              }
            }}
          >
            <SelectTrigger className="h-11 min-w-44" aria-label="Report team scope">
              <Users className="h-4 w-4 text-muted-foreground" />
              <SelectValue>{actorLabel(scope.actor, members, userName)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="min-h-11">All team</SelectItem>
              <SelectItem value="mine" className="min-h-11">My work</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.id} value={`member:${member.id}`} className="min-h-11">
                  {member.name} · {member.role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="flex min-h-11 items-center gap-2 border bg-background px-3 text-sm">
            <Users className="h-4 w-4 text-muted-foreground" />
            {userName || 'My work'}
          </div>
        )}
      </div>
    </div>
  );
}
