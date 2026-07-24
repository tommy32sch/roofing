'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Users, TrendingUp, Flame, CalendarDays, ArrowRight, RefreshCw, DollarSign } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { formatAddress } from '@/lib/utils/format';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { DuplicateReviewPanel } from '@/components/leads/DuplicateReviewPanel';
import type { DashboardStats, LeadStatus, UserRole } from '@/types';
import { PageHeader } from '@/components/layout/page-header';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';

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

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<UserRole>('admin');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();
  const [market, setMarket] = useState('');
  const marketValue = market || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);

  const fetchStats = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const statsRes = await fetch(`/api/admin/stats${market ? `?market_id=${market}` : ''}`);
      const statsData = await statsRes.json();
      if (statsData.success) {
        setStats(statsData.stats);
        setLastUpdated(new Date());
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [market]);

  useEffect(() => {
    fetchStats();

    fetch('/api/admin/auth/me')
      .then(r => r.json())
      .then(d => { if (d.success) setUserRole(d.admin.role); })
      .catch(() => {});
  }, [fetchStats]);

  useEffect(() => {
    function onFocus() { fetchStats(true); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchStats]);

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
            <Button variant="outline" size="sm" onClick={() => fetchStats(true)} disabled={refreshing}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Stat cards — label small and quiet, number large and tabular so the
          figures line up and read as data rather than as body copy. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          { icon: Users, label: 'Total Leads', value: (stats?.totalLeads ?? 0).toLocaleString(), accent: 'text-muted-foreground' },
          { icon: CalendarDays, label: 'This Week', value: (stats?.leadsThisWeek ?? 0).toLocaleString(), accent: 'text-muted-foreground' },
          { icon: TrendingUp, label: 'Conversion', value: `${stats?.conversionRate ?? 0}%`, accent: 'text-muted-foreground' },
          {
            icon: Flame,
            label: 'Hot Leads',
            value: (stats?.hotLeads ?? 0).toLocaleString(),
            accent: (stats?.hotLeads ?? 0) > 0 ? 'text-red-500' : 'text-muted-foreground',
          },
        ].map(({ icon: Icon, label, value, accent }) => (
          <Card key={label} className="transition-colors hover:border-foreground/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Icon className={`h-3.5 w-3.5 ${accent}`} />
                {label}
              </div>
              <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

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
      {userRole === 'admin' && <DuplicateReviewPanel />}

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
