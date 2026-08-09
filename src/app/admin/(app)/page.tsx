'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Users,
  TrendingUp,
  Flame,
  CalendarDays,
  ArrowRight,
  RefreshCw,
  DollarSign,
  DoorOpen,
  PhoneCall,
  AlertCircle,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { formatAddress } from '@/lib/utils/format';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/layout/metric-card';
import { TrendChart } from '@/components/layout/trend-chart';
import { metricDelta } from '@/lib/leads/metric-delta';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DuplicateReviewPanel } from '@/components/leads/DuplicateReviewPanel';
import type {
  ContactActivitySummary,
  DashboardStats,
  LeadStatus,
} from '@/types';
import { PageHeader } from '@/components/layout/page-header';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import {
  defaultContactActivityScope,
  localContactActivityBounds,
  type ContactActivityPeriod,
} from '@/lib/leads/contact-activity';
import { knockLabel } from '@/lib/leads/knocks';
import { callLabel } from '@/lib/leads/calls';
import { useAppShell } from '@/components/providers/app-shell-provider';
import { DataErrorState } from '@/components/layout/data-error-state';

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'bg-pipeline-new text-white',
  contacted: 'bg-pipeline-contacted text-white',
  appointment_set: 'bg-pipeline-appointment text-white',
  inspected: 'bg-pipeline-inspected text-white',
  proposal_sent: 'bg-pipeline-proposal text-white',
  sold: 'bg-pipeline-sold text-white',
  lost: 'bg-pipeline-lost text-white',
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  appointment_set: 'Appt Set',
  inspected: 'Inspected',
  proposal_sent: 'Proposal',
  sold: 'Sold',
  lost: 'Lost',
};

const CONTACT_PERIODS: { value: ContactActivityPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

export default function DashboardPage() {
  const { user } = useAppShell();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [contactPeriod, setContactPeriod] = useState<ContactActivityPeriod>('today');
  const [contactUser, setContactUser] = useState(() => defaultContactActivityScope(user.role));
  const [contactUsers, setContactUsers] = useState<{ id: string; name: string }[]>([]);
  const [contactActivity, setContactActivity] = useState<ContactActivitySummary | null>(null);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState('');

  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();
  const [market, setMarket] = useState('');
  const marketValue = market || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);

  const fetchStats = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setStatsError('');
    try {
      const statsRes = await fetch(`/api/admin/stats${market ? `?market_id=${market}` : ''}`);
      const statsData = await statsRes.json().catch(() => null);
      if (!statsRes.ok || !statsData?.success) {
        throw new Error(statsData?.error || 'Could not load dashboard data');
      }
      setStats(statsData.stats);
      setLastUpdated(new Date());
    } catch (error) {
      setStatsError(error instanceof Error ? error.message : 'Could not load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [market]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (user.role !== 'admin') return;
    fetch('/api/admin/users')
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setContactUsers(
            (d.users ?? []).map((user: { id: string; name: string }) => ({
              id: user.id,
              name: user.name,
            }))
          );
        }
      })
      .catch(() => {});
  }, [user.role]);

  const fetchContactActivity = useCallback(async () => {
    setContactLoading(true);
    setContactError('');
    try {
      const bounds = localContactActivityBounds(contactPeriod);
      const params = new URLSearchParams({
        period: contactPeriod,
        start: bounds.start,
        end: bounds.end,
        user_id: user.role === 'admin' ? contactUser : 'me',
      });
      if (market) params.set('market_id', market);

      const res = await fetch(`/api/admin/contact-activity?${params}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to load contact activity');
      }
      setContactActivity(data.activity);
    } catch (error) {
      setContactActivity(null);
      setContactError(
        error instanceof Error ? error.message : 'Failed to load contact activity'
      );
    } finally {
      setContactLoading(false);
    }
  }, [contactPeriod, contactUser, market, user.role]);

  useEffect(() => {
    fetchContactActivity();
  }, [fetchContactActivity]);

  useEffect(() => {
    function onFocus() {
      fetchStats(true);
      fetchContactActivity();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchContactActivity, fetchStats]);

  if (loading) {
    // Mirrors the real layout — same header, four stat cards, pipeline strip and
    // recent-leads list — so the page doesn't reflow when data lands.
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="mb-3 h-3 w-24" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader className="pb-3"><Skeleton className="h-5 w-24" /></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {[...Array(7)].map((_, i) => <Skeleton key={i} className="h-9 w-32 rounded-full" />)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (statsError && !stats) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" />
        <DataErrorState title="Dashboard data did not load" description={statsError} onRetry={fetchStats} />
      </div>
    );
  }

  const contactUserLabel =
    contactUser === 'all'
      ? 'All Team'
      : contactUser === 'me'
        ? user.name || 'My Activity'
        : contactUsers.find((user) => user.id === contactUser)?.name || 'Account';
  const contactPeriodLabel =
    CONTACT_PERIODS.find((period) => period.value === contactPeriod)?.label ?? 'Today';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={lastUpdated ? `Updated ${formatDistanceToNow(lastUpdated, { addSuffix: true })}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            {!marketsLoading && (
              <MarketFilter markets={markets} value={marketValue} onChange={setMarket} className="w-[150px]" />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchStats(true);
                fetchContactActivity();
              }}
              disabled={refreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {statsError && (
        <DataErrorState
          compact
          title="Dashboard data could not be refreshed"
          description={`${statsError} The last loaded values remain visible.`}
          onRetry={() => fetchStats(true)}
        />
      )}

      {/* Stat cards — label small and quiet, number large and tabular so the
          figures line up and read as data rather than as body copy. */}
      {/* Every number carries what it did and what it is compared with. A
          count on its own cannot be read as good or bad. `higherIsBetter` is
          set per metric because direction and goodness differ: more hot leads
          is good, and the same arrow on a backlog would not be. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {(() => {
          const p = stats?.period;
          const d = (cur: number, prev: number) => (p ? metricDelta(cur, prev) : null);
          return [
            {
              icon: Users,
              label: `New leads · ${p?.days ?? 30}d`,
              value: (p?.current.newLeads ?? stats?.totalLeads ?? 0).toLocaleString(),
              delta: d(p?.current.newLeads ?? 0, p?.previous.newLeads ?? 0),
              higherIsBetter: true,
            },
            {
              icon: Flame,
              label: 'Hot leads',
              value: (p?.current.hot ?? stats?.hotLeads ?? 0).toLocaleString(),
              delta: d(p?.current.hot ?? 0, p?.previous.hot ?? 0),
              higherIsBetter: true,
            },
            {
              icon: TrendingUp,
              label: 'Won from these leads',
              value: (p?.current.won ?? 0).toLocaleString(),
              delta: d(p?.current.won ?? 0, p?.previous.won ?? 0),
              higherIsBetter: true,
            },
            {
              icon: CalendarDays,
              label: 'Overdue follow-ups',
              value: (stats?.overdueFollowUps ?? 0).toLocaleString(),
              // No previous figure exists for this one, so it shows the count
              // alone rather than an empty delta slot.
              delta: null,
              higherIsBetter: false,
            },
          ].map((m) => (
            <MetricCard
              key={m.label}
              icon={m.icon}
              label={m.label}
              value={m.value}
              delta={m.delta}
              higherIsBetter={m.higherIsBetter}
            />
          ));
        })()}
      </div>

      {/* Leads over time. Shown only with real data, so an empty account gets
          a clean dashboard rather than a flat line at zero. */}
      {stats?.leadTrend && stats.leadTrend.some((pt) => pt.value > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Leads over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              points={stats.leadTrend}
              label="New leads per day"
            />
          </CardContent>
        </Card>
      )}

      {/* Revenue cards — same treatment as the stat cards above, and coloured
          from the pipeline tokens rather than raw greens/blues so they follow
          the theme. Only rendered once there is money to show. */}
      {((stats?.totalPipelineValue ?? 0) > 0 ||
        (stats?.totalWonValue ?? 0) > 0 ||
        (stats?.totalEstimatedRoofValue ?? 0) > 0) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {[
            { show: (stats?.totalWonValue ?? 0) > 0, label: 'Won Revenue', value: stats?.totalWonValue ?? 0, tone: 'text-pipeline-sold' },
            { show: (stats?.totalPipelineValue ?? 0) > 0, label: 'Pipeline Value', value: stats?.totalPipelineValue ?? 0, tone: 'text-primary' },
            { show: (stats?.totalEstimatedRoofValue ?? 0) > 0, label: 'Est. Roof Value', value: stats?.totalEstimatedRoofValue ?? 0, tone: 'text-muted-foreground' },
          ].filter(c => c.show).map(({ label, value, tone }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <DollarSign className={`h-3.5 w-3.5 ${tone}`} />
                  {label}
                </div>
                <p className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${tone}`}>
                  ${value.toLocaleString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Real canvassing production, separate from generic CRM activity. */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-lg">Contact Activity</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {contactUserLabel} · {contactPeriodLabel}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex rounded-md border bg-muted/30 p-0.5"
                aria-label="Contact activity period"
              >
                {CONTACT_PERIODS.map((period) => (
                  <Button
                    key={period.value}
                    type="button"
                    size="sm"
                    variant={contactPeriod === period.value ? 'secondary' : 'ghost'}
                    className="h-8 px-3 text-xs"
                    aria-pressed={contactPeriod === period.value}
                    onClick={() => setContactPeriod(period.value)}
                  >
                    {period.label}
                  </Button>
                ))}
              </div>
              {user.role === 'admin' && (
                <Select value={contactUser} onValueChange={(value) => value && setContactUser(value)}>
                  <SelectTrigger className="h-9 w-[170px]" aria-label="Contact activity account">
                    <SelectValue>{contactUserLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Team</SelectItem>
                    {contactUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {contactLoading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[0, 1].map((item) => (
                  <Skeleton key={item} className="h-24 rounded-lg" />
                ))}
              </div>
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : contactError ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertCircle className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{contactError}</p>
              <Button variant="outline" size="sm" onClick={fetchContactActivity}>
                Try Again
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    icon: DoorOpen,
                    label: 'Door Knocks',
                    value: contactActivity?.knockCount ?? 0,
                  },
                  {
                    icon: PhoneCall,
                    label: 'Cold Calls',
                    value: contactActivity?.callCount ?? 0,
                  },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-lg border p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </div>
                    <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                      {value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>

              {(contactActivity?.events.length ?? 0) > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Recent Results
                  </p>
                  <div className="divide-y">
                    {contactActivity!.events.map((event) => {
                      const Icon = event.channel === 'knock' ? DoorOpen : PhoneCall;
                      const result =
                        event.channel === 'knock'
                          ? knockLabel(event.disposition)
                          : callLabel(event.disposition);
                      const leadName = event.lead
                        ? [event.lead.first_name, event.lead.last_name].filter(Boolean).join(' ') ||
                          'Unnamed lead'
                        : 'Deleted lead';
                      const address = event.lead ? formatAddress(event.lead) : '';

                      return (
                        <Link
                          key={`${event.channel}-${event.id}`}
                          href={event.lead ? `/admin/leads/${event.lead.id}` : '/admin/leads'}
                          className="flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-muted/50"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <p className="truncate text-sm font-medium">{leadName}</p>
                              <span className="text-xs text-muted-foreground">{result}</span>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {address || 'No address'}
                            </p>
                          </div>
                          <div className="shrink-0 text-right text-xs text-muted-foreground">
                            {user.role === 'admin' && event.accountName && (
                              <p>{event.accountName}</p>
                            )}
                            <p className="tabular-nums">
                              {contactPeriod === 'today'
                                ? format(new Date(event.occurredAt), 'h:mm a')
                                : format(new Date(event.occurredAt), 'MMM d · h:mm a')}
                            </p>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No door knocks or cold calls in this period.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {stats?.pipelineCounts?.map((p) => (
              <Link key={p.status} href={`/admin/leads?status=${p.status}`}>
                <div className="flex items-center gap-2 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <Badge className={STATUS_COLORS[p.status]}>{p.count}</Badge>
                  <span className="text-sm">{STATUS_LABELS[p.status]}</span>
                </div>
              </Link>
            ))}
            {(!stats?.pipelineCounts || stats.pipelineCounts.length === 0) && (
              <p className="text-sm text-muted-foreground">No leads yet. Add your first lead to get started.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Duplicate review (admin only) */}
      {user.role === 'admin' && <DuplicateReviewPanel />}

      {/* Recent leads */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Recent Leads</CardTitle>
            <Link href="/admin/leads">
              <Button variant="ghost" size="sm" className="text-xs">
                View All <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {stats?.recentLeads && stats.recentLeads.length > 0 ? (
            <div className="space-y-2">
              {stats.recentLeads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/admin/leads/${lead.id}`}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm">
                      {lead.first_name} {lead.last_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatAddress(lead) || 'No address'}
                    </p>
                  </div>
                  <LeadStatusBadge status={lead.status} />
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No leads yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
