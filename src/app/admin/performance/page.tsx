'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, DollarSign, CalendarCheck, Target, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import type { RepStats } from '@/app/api/admin/performance/route';
import type { UserRole } from '@/types';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      {sub && <p className="text-xs font-medium text-primary mt-0.5">{sub}</p>}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200',
    setter: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200',
    closer: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[role] ?? ''}`}>
      {role}
    </span>
  );
}

function RepCard({ rep, isOwn }: { rep: RepStats; isOwn: boolean }) {
  const hasSetter = rep.setterLeadsAssigned > 0 || rep.role === 'setter' || rep.role === 'admin';
  const hasCloser = rep.closerLeadsAssigned > 0 || rep.role === 'closer' || rep.role === 'admin';

  return (
    <Card className={isOwn ? 'border-primary' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {rep.name}
            {isOwn && <span className="text-xs text-muted-foreground font-normal">(you)</span>}
          </CardTitle>
          <RoleBadge role={rep.role} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Setter stats */}
        {hasSetter && (
          <div>
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
              <CalendarCheck className="h-3.5 w-3.5" />
              Setter Performance
            </p>
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Assigned" value={rep.setterLeadsAssigned} />
              <StatCard label="Appts Set" value={rep.appointmentsSet} />
              <StatCard
                label="Appt Rate"
                value={`${rep.appointmentRate}%`}
                sub={rep.appointmentRate >= 50 ? '🔥' : rep.appointmentRate >= 25 ? '👍' : undefined}
              />
            </div>
          </div>
        )}

        {/* Closer stats */}
        {hasCloser && (
          <div>
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
              <Target className="h-3.5 w-3.5" />
              Closer Performance
            </p>
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Assigned" value={rep.closerLeadsAssigned} />
              <StatCard label="Won" value={rep.dealsWon} />
              <StatCard
                label="Close Rate"
                value={`${rep.closeRate}%`}
                sub={rep.closeRate >= 50 ? '🔥' : rep.closeRate >= 25 ? '👍' : undefined}
              />
            </div>
            {rep.totalRevenue > 0 && (
              <div className="mt-2 flex items-center gap-1.5 rounded-md bg-green-50 dark:bg-green-950 px-3 py-2">
                <DollarSign className="h-4 w-4 text-green-600" />
                <span className="text-sm font-semibold text-green-700 dark:text-green-300">
                  ${rep.totalRevenue.toLocaleString()} revenue
                </span>
              </div>
            )}
          </div>
        )}

        {rep.setterLeadsAssigned === 0 && rep.closerLeadsAssigned === 0 && (
          <p className="text-sm text-muted-foreground text-center py-2">No leads assigned yet</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function PerformancePage() {
  const [reps, setReps] = useState<RepStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<UserRole>('admin');
  const [userId, setUserId] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/performance').then(r => r.json()),
      fetch('/api/admin/auth/me').then(r => r.json()),
    ]).then(([perfData, meData]) => {
      if (perfData.success) setReps(perfData.reps);
      if (meData.success) {
        setUserRole(meData.admin.role);
        setUserId(meData.admin.id);
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Performance</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Team summary (admin only)
  const totalRevenue = reps.reduce((s, r) => s + r.totalRevenue, 0);
  const totalWon = reps.reduce((s, r) => s + r.dealsWon, 0);
  const totalAppts = reps.reduce((s, r) => s + r.appointmentsSet, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        {userRole === 'admin' ? 'Team Performance' : 'My Performance'}
      </h1>

      {/* Team summary (admin only) */}
      {userRole === 'admin' && reps.length > 1 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Users className="h-4 w-4" />
                Team Size
              </div>
              <p className="text-2xl font-bold mt-1">{reps.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <CalendarCheck className="h-4 w-4" />
                Total Appts
              </div>
              <p className="text-2xl font-bold mt-1">{totalAppts}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <TrendingUp className="h-4 w-4" />
                Total Won
              </div>
              <p className="text-2xl font-bold mt-1">{totalWon}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <DollarSign className="h-4 w-4" />
                Total Revenue
              </div>
              <p className="text-2xl font-bold mt-1">${totalRevenue.toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {reps.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>No data yet. Assign leads to reps to start tracking performance.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reps.map(rep => (
            <RepCard key={rep.id} rep={rep} isOwn={rep.id === userId} />
          ))}
        </div>
      )}

      {userRole !== 'admin' && (
        <p className="text-xs text-muted-foreground text-center">
          Stats are based on leads assigned to you. Contact your admin to update assignments.
        </p>
      )}
    </div>
  );
}
