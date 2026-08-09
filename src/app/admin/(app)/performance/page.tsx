'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, DollarSign, Users, ChevronRight, DoorOpen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RoleBadge } from '@/components/users/role-badge';
import type { RepMetrics } from '@/app/api/admin/performance/route';
import type { TrendPoint } from '@/lib/leads/rep-metrics';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import {
  localContactActivityBounds,
  type ContactActivityPeriod,
} from '@/lib/leads/contact-activity';
import { useAppShell } from '@/components/providers/app-shell-provider';
import { DataErrorState } from '@/components/layout/data-error-state';

const PERIODS: { value: ContactActivityPeriod | 'all'; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
];

/** A rate that has no denominator yet renders as an em dash, never as 0%. */
function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

function hours(value: number | null): string {
  if (value === null) return '—';
  if (value < 1) return `${Math.round(value * 60)}m`;
  if (value < 48) return `${value.toFixed(1)}h`;
  return `${Math.round(value / 24)}d`;
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground truncate" title={hint ?? label}>
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Bar sparkline for one metric across the trend weeks.
 *
 * Deliberately not a line chart: with a dozen weeks and frequent zeros, bars
 * make an empty week unmistakably empty, where a line would slope through it and
 * imply work that never happened.
 */
function Spark({ points, pick, label }: { points: TrendPoint[]; pick: (p: TrendPoint) => number; label: string }) {
  const values = points.map(pick);
  const max = Math.max(...values, 1);
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex h-12 items-end gap-0.5">
        {points.map((p, i) => (
          <div
            key={p.weekStart}
            className="flex-1 rounded-sm bg-primary/70 min-h-[2px]"
            style={{ height: `${(values[i] / max) * 100}%` }}
            title={`Week of ${p.weekStart}: ${values[i]}`}
          />
        ))}
      </div>
    </div>
  );
}

function RepRow({
  rep,
  isOwn,
  expanded,
  trend,
  trendLoading,
  onToggle,
}: {
  rep: RepMetrics;
  isOwn: boolean;
  expanded: boolean;
  trend: TrendPoint[] | null;
  trendLoading: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className={isOwn ? 'border-primary' : undefined}>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/40"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{rep.name}</span>
              {isOwn && <span className="text-xs text-muted-foreground">(you)</span>}
              <RoleBadge role={rep.role} />
            </div>
          </div>
          <div className="hidden shrink-0 gap-6 sm:flex">
            <Metric label="Knocks" value={rep.knocks} />
            <Metric label="Calls" value={rep.calls} />
            <Metric label="Appts" value={rep.appointmentsSet} />
            <Metric label="Set rate" value={pct(rep.setRate)} hint="Appointments set / leads assigned as setter" />
            <Metric label="Close" value={pct(rep.closeRate)} hint="Deals won / appointments actually run" />
            <Metric label="Revenue" value={money(rep.revenue)} />
          </div>
        </button>

        {/* Narrow screens get the same numbers stacked rather than hidden. */}
        <div className="grid grid-cols-3 gap-3 border-t px-4 py-3 sm:hidden">
          <Metric label="Knocks" value={rep.knocks} />
          <Metric label="Calls" value={rep.calls} />
          <Metric label="Appts" value={rep.appointmentsSet} />
          <Metric label="Set rate" value={pct(rep.setRate)} />
          <Metric label="Close" value={pct(rep.closeRate)} />
          <Metric label="Revenue" value={money(rep.revenue)} />
        </div>

        {expanded && (
          <div className="space-y-4 border-t bg-muted/20 p-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Leads (setter)" value={rep.setterLeads} />
              <Metric label="Leads (closer)" value={rep.closerLeads} />
              <Metric label="Inspected" value={rep.inspected} />
              <Metric label="Proposals" value={rep.proposals} />
              <Metric label="Sold" value={rep.sold} />
              <Metric label="Avg deal" value={rep.avgDealSize === null ? '—' : money(rep.avgDealSize)} />
              <Metric
                label="Rev / appt"
                value={rep.revenuePerAppointment === null ? '—' : money(rep.revenuePerAppointment)}
              />
              <Metric
                label="Lead → 1st knock"
                value={hours(rep.medianHoursToFirstKnock)}
                hint="Median time from a lead arriving to its first knock"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Appts booked" value={rep.appointmentsBooked} />
              <Metric label="Completed" value={rep.completed} />
              <Metric label="No-shows" value={rep.noShow} />
              <Metric
                label="No-show rate"
                value={pct(rep.noShowRate)}
                hint="No-shows / (completed + no-shows). Cancellations excluded."
              />
            </div>

            {trendLoading && <Skeleton className="h-12 w-full" />}
            {!trendLoading && trend && trend.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Spark points={trend} pick={(p) => p.knocks} label="Knocks / week" />
                <Spark points={trend} pick={(p) => p.appointmentsSet} label="Appts set / week" />
                <Spark points={trend} pick={(p) => p.revenue} label="Revenue / week" />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PerformancePage() {
  const { user } = useAppShell();
  const [reps, setReps] = useState<RepMetrics[]>([]);
  // Loading is DERIVED from "have we loaded the window currently being asked
  // for", rather than a flag set inside the effect — setting state synchronously
  // in an effect body triggers cascading renders and the lint rule that guards
  // against it.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const [period, setPeriod] = useState<ContactActivityPeriod | 'all'>('month');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [trend, setTrend] = useState<{ userId: string; points: TrendPoint[] } | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();
  const [market, setMarket] = useState('');
  const marketValue = market || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);

  // The browser owns the window: a Phoenix rep's "today" is not a Minnesota
  // rep's, and the server runs in UTC.
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (market) params.set('market_id', market);
    if (period !== 'all') {
      const bounds = localContactActivityBounds(period);
      params.set('from', bounds.start);
      params.set('to', bounds.end);
    }
    return params;
  }, [market, period]);

  const paramsKey = buildParams().toString();
  const loading = loadedKey !== paramsKey;
  const error = failure?.key === paramsKey ? failure.message : '';

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/performance?${paramsKey}`)
      .then(async (response) => {
        const perf = await response.json().catch(() => null);
        if (!response.ok || !perf?.success) {
          throw new Error(perf?.error || 'Could not load performance data');
        }
        return perf;
      })
      .then((perf) => {
        if (cancelled) return;
        setReps(perf.reps);
        setFailure(null);
      })
      .catch((cause) => {
        if (!cancelled) {
          setFailure({
            key: paramsKey,
            message: cause instanceof Error ? cause.message : 'Could not load performance data',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(paramsKey);
      });
    return () => {
      cancelled = true;
    };
  }, [paramsKey, reload]);

  const toggle = useCallback(
    (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (trend?.userId === id) return;
      setTrendLoading(true);
      const params = buildParams();
      params.set('trend_user_id', id);
      fetch(`/api/admin/performance?${params}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.success && d.trend) setTrend(d.trend);
        })
        .catch(() => {})
        .finally(() => setTrendLoading(false));
    },
    [expandedId, trend, buildParams]
  );

  const totalRevenue = reps.reduce((s, r) => s + r.revenue, 0);
  const totalSold = reps.reduce((s, r) => s + r.sold, 0);
  const totalKnocks = reps.reduce((s, r) => s + r.knocks, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={user.role === 'admin' ? 'Team Performance' : 'My Performance'}
        description={
          user.role === 'admin'
            ? 'Activity, conversion, revenue and follow-through per rep'
            : 'Your activity, conversion and follow-through'
        }
        actions={
          !marketsLoading ? (
            <MarketFilter
              markets={markets}
              value={marketValue}
              onChange={(v) => setMarket(v)}
              className="w-[150px]"
            />
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPeriod(p.value)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              period === p.value ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {user.role === 'admin' && reps.length > 1 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {[
            { icon: Users, label: 'Reps', value: reps.length.toLocaleString() },
            { icon: DoorOpen, label: 'Knocks', value: totalKnocks.toLocaleString() },
            { icon: TrendingUp, label: 'Sold', value: totalSold.toLocaleString() },
            { icon: DollarSign, label: 'Revenue', value: money(totalRevenue) },
          ].map(({ icon: Icon, label, value }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </div>
                <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-6 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <DataErrorState
          title="Performance data did not load"
          description={error}
          onRetry={() => {
            setLoadedKey(null);
            setReload((value) => value + 1);
          }}
        />
      ) : reps.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={TrendingUp}
              title="Nothing to measure yet"
              description="Assign leads to setters and closers, and their activity, conversion and close rates will show up here."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reps.map((rep) => (
            <RepRow
              key={rep.id}
              rep={rep}
              isOwn={rep.id === user.id}
              expanded={expandedId === rep.id}
              trend={trend?.userId === rep.id ? trend.points : null}
              trendLoading={trendLoading && expandedId === rep.id}
              onToggle={() => toggle(rep.id)}
            />
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        A dash means there is nothing to divide by yet — not zero.
        {user.role !== 'admin' && ' Conversion is based on leads assigned to you.'}
      </p>
    </div>
  );
}
