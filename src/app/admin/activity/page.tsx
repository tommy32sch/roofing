'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, PhoneCall, Mail, Eye, ArrowRightLeft, FileText, Edit2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatAddressShort } from '@/lib/utils/format';

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  note: MessageSquare,
  call: PhoneCall,
  email: Mail,
  visit: Eye,
  status_change: ArrowRightLeft,
  created: FileText,
  updated: Edit2,
};

const ACTIVITY_LABELS: Record<string, string> = {
  note: 'Note',
  call: 'Call logged',
  email: 'Email logged',
  visit: 'Visit logged',
  status_change: 'Status changed',
  created: 'Lead created',
  updated: 'Lead updated',
};

interface Activity {
  id: string;
  activity_type: string;
  content: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
  leads: { id: string; first_name: string; last_name: string; address_street: string | null; address_city: string | null; address_state: string | null } | null;
  admin_users: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', appointment_set: 'Appt Set',
  inspected: 'Inspected', proposal_sent: 'Proposal', sold: 'Sold', lost: 'Lost',
};

export default function ActivityPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [activityUsers, setActivityUsers] = useState<{id: string, name: string}[]>([]);
  const limit = 50;

  useEffect(() => {
    fetch('/api/admin/users')
      .then(r => r.json())
      .then(d => { if (d.success) setActivityUsers(d.users); })
      .catch(() => {});
  }, []);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      if (typeFilter) params.set('type', typeFilter);
      if (userFilter) params.set('user_id', userFilter);
      const res = await fetch(`/api/admin/activity?${params}`);
      const data = await res.json();
      if (data.success) {
        setActivities(data.activities);
        setTotal(data.total);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, userFilter]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Activity Log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total} total events across all leads
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={typeFilter} onValueChange={v => { setTypeFilter(v === 'all' ? '' : (v ?? '')); setPage(1); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="note">Note</SelectItem>
            <SelectItem value="call">Call</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="visit">Visit</SelectItem>
            <SelectItem value="status_change">Status Change</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="updated">Updated</SelectItem>
          </SelectContent>
        </Select>
        {activityUsers.length > 0 && (
          <Select value={userFilter} onValueChange={v => { setUserFilter(v === 'all' ? '' : (v ?? '')); setPage(1); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {activityUsers.map(u => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(10)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : activities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No activity yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {activities.map((activity) => {
            const Icon = ACTIVITY_ICONS[activity.activity_type] || FileText;
            const lead = activity.leads;
            const leadName = lead ? `${lead.first_name} ${lead.last_name}` : 'Unknown Lead';
            const location = lead ? formatAddressShort(lead) : '';

            return (
              <Card key={activity.id} className="border-0 shadow-none border-b rounded-none last:border-b-0">
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    {/* Actor + time sit on the same line as the event so each entry
                        is two lines instead of three — a log should be scannable. */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="text-sm font-medium">
                            {ACTIVITY_LABELS[activity.activity_type] || activity.activity_type}
                          </span>
                          {activity.activity_type === 'status_change' && activity.old_status && activity.new_status && (
                            <span className="text-xs text-muted-foreground">
                              {STATUS_LABEL[activity.old_status] ?? activity.old_status}
                              {' → '}
                              {STATUS_LABEL[activity.new_status] ?? activity.new_status}
                            </span>
                          )}
                          {lead && (
                            <Link
                              href={`/admin/leads/${lead.id}`}
                              className="text-xs text-primary hover:underline truncate"
                              onClick={e => e.stopPropagation()}
                            >
                              {leadName}{location ? ` · ${location}` : ''}
                            </Link>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                          {activity.admin_users?.name && <span>{activity.admin_users.name}</span>}
                          <span className="tabular-nums">
                            {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                      {activity.content && (
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{activity.content}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
