'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, TrendingUp, Flame, CalendarDays, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import type { DashboardStats, LeadStatus } from '@/types';

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

  useEffect(() => {
    fetch('/api/admin/stats')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setStats(data.stats);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/admin/leads/new">
          <Button size="sm">Add Lead</Button>
        </Link>
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
