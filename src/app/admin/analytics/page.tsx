'use client';

import { useEffect, useState } from 'react';
import { Target, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';

const RANGE_LABELS: Record<string, string> = {
  all: 'All Time',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '365d': 'Last 12 months',
};

interface Breakdown {
  value: string;
  count: number;
  pct: number;
}

interface AnalyticsData {
  total: number;
  recommendation: string;
  breakdowns: {
    careers: Breakdown[];
    familySizes: Breakdown[];
    maritalStatuses: Breakdown[];
    ageRanges: Breakdown[];
    incomes: Breakdown[];
    education: Breakdown[];
    decisionMakers: Breakdown[];
    insurance: Breakdown[];
    referrals: Breakdown[];
  };
  topCombos: { combo: string; count: number }[];
}

function BreakdownCard({ title, items }: { title: string; items: Breakdown[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">No data yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {items.slice(0, 6).map((item, i) => (
          <div key={item.value} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {i === 0 && <Badge className="shrink-0 h-4 px-1 text-xs bg-primary/10 text-primary border-0">#1</Badge>}
              <span className="text-sm truncate">{item.value}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">{item.count}</span>
              <div className="w-16 bg-muted rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full"
                  style={{ width: `${item.pct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-7 text-right">{item.pct}%</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('all');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analytics?range=${range}`)
      .then(r => r.json())
      .then(d => { if (d.success) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" />
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description={`Based on ${data?.total ?? 0} won lead${data?.total !== 1 ? 's' : ''} with demographic profiles`}
        actions={
            <Select value={range} onValueChange={v => { setRange(v ?? 'all'); setLoading(true); }}>
              <SelectTrigger className="w-[140px]"><SelectValue>{RANGE_LABELS[range] ?? 'All Time'}</SelectValue></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="365d">Last 12 months</SelectItem>
              </SelectContent>
            </Select>
        }
      />

      {/* FB Targeting Recommendation */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            FB Ads Targeting Recommendation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed">{data?.recommendation}</p>
        </CardContent>
      </Card>

      {/* Top Combos */}
      {data && data.topCombos.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Top Demographic Combos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.topCombos.map((combo, i) => (
                <div key={combo.combo} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">#{i + 1}</Badge>
                    <span className="text-sm">{combo.combo}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{combo.count} won</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Demographic breakdowns — hidden until there's something to break down;
          nine "No data yet" cards said nothing the empty state doesn't. */}
      {data && data.total > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <BreakdownCard title="Career / Occupation" items={data.breakdowns.careers} />
          <BreakdownCard title="Age Range" items={data.breakdowns.ageRanges} />
          <BreakdownCard title="Household Income" items={data.breakdowns.incomes} />
          <BreakdownCard title="Marital Status" items={data.breakdowns.maritalStatuses} />
          <BreakdownCard title="Family Size" items={data.breakdowns.familySizes} />
          <BreakdownCard title="Education Level" items={data.breakdowns.education} />
          <BreakdownCard title="Decision Maker" items={data.breakdowns.decisionMakers} />
          <BreakdownCard title="Insurance Carrier" items={data.breakdowns.insurance} />
          <BreakdownCard title="Referral Source" items={data.breakdowns.referrals} />
        </div>
      )}

      {data && data.total === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No won leads with demographic profiles yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Once closers mark leads as won and complete the demographic form, insights will appear here.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
