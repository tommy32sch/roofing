'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Users, TrendingUp, Flame, CalendarDays, ArrowRight, RefreshCw, DollarSign, CalendarClock, AlertCircle } from 'lucide-react';
import { formatDistanceToNow, format, isPast, isToday } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { DuplicateReviewPanel } from '@/components/leads/DuplicateReviewPanel';
import type { DashboardStats, LeadStatus, LeadWithSource, UserRole } from '@/types';

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
  const [followUps, setFollowUps] = useState<LeadWithSource[]>([]);

  const fetchStats = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [statsRes, followUpRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch(`/api/admin/leads?follow_up_before=${today}&limit=20&sort=follow_up_date&order=asc`),
      ]);
      const [statsData, followUpData] = await Promise.all([statsRes.json(), followUpRes.json()]);
      if (statsData.success) {
        setStats(statsData.stats);
        setLastUpdated(new Date());
      }
      if (followUpData.success) {
        setFollowUps(followUpData.leads);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <Skeleton className="h-4 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => fetchStats(true)} disabled={refreshing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Users className="h-4 w-4" />
              Total Leads
            </div>
            <p className="text-2xl font-bold mt-1">{stats?.totalLeads ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <CalendarDays className="h-4 w-4" />
              This Week
            </div>
            <p className="text-2xl font-bold mt-1">{stats?.leadsThisWeek ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <TrendingUp className="h-4 w-4" />
              Conversion
            </div>
            <p className="text-2xl font-bold mt-1">{stats?.conversionRate ?? 0}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Flame className="h-4 w-4" />
              Hot Leads
            </div>
            <p className="text-2xl font-bold mt-1">{stats?.hotLeads ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue cards (only shown when values exist) */}
      {((stats?.totalPipelineValue ?? 0) > 0 ||
        (stats?.totalWonValue ?? 0) > 0 ||
        (stats?.totalEstimatedRoofValue ?? 0) > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(stats?.totalWonValue ?? 0) > 0 && (
            <Card className="border-green-200 dark:border-green-900">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <DollarSign className="h-4 w-4 text-green-600" />
                  Won Revenue
                </div>
                <p className="text-2xl font-bold mt-1 text-green-600">
                  ${(stats?.totalWonValue ?? 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          )}
          {(stats?.totalPipelineValue ?? 0) > 0 && (
            <Card className="border-blue-200 dark:border-blue-900">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <DollarSign className="h-4 w-4 text-blue-600" />
                  Pipeline Value
                </div>
                <p className="text-2xl font-bold mt-1 text-blue-600">
                  ${(stats?.totalPipelineValue ?? 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          )}
          {(stats?.totalEstimatedRoofValue ?? 0) > 0 && (
            <Card className="border-amber-200 dark:border-amber-900">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <DollarSign className="h-4 w-4 text-amber-600" />
                  Est. Roof Value
                </div>
                <p className="text-2xl font-bold mt-1 text-amber-600">
                  ${(stats?.totalEstimatedRoofValue ?? 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          )}
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

      {/* Follow-up reminders */}
      {followUps.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-amber-500" />
                Follow-ups Due
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
                  {followUps.length}
                </span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {followUps.map((lead) => {
                const date = new Date(lead.follow_up_date + 'T00:00:00');
                const overdue = isPast(date) && !isToday(date);
                return (
                  <Link
                    key={lead.id}
                    href={`/admin/leads/${lead.id}`}
                    className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {overdue && <AlertCircle className="h-4 w-4 text-destructive shrink-0" />}
                      <div>
                        <p className="font-medium text-sm">
                          {lead.first_name} {lead.last_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[lead.address_city, lead.address_state].filter(Boolean).join(', ') || 'No address'}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs font-medium ${overdue ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`}>
                      {isToday(date) ? 'Today' : overdue ? `${format(date, 'MMM d')} (overdue)` : format(date, 'MMM d')}
                    </span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
                      {[lead.address_city, lead.address_state].filter(Boolean).join(', ') || 'No address'}
                    </p>
                  </div>
                  <Badge className={STATUS_COLORS[lead.status]}>
                    {STATUS_LABELS[lead.status]}
                  </Badge>
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
