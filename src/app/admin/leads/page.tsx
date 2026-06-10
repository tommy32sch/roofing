'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, PlusCircle, Upload, Sparkles, Download, CalendarClock, MapPin, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { LeadPriorityBadge } from '@/components/leads/lead-priority-badge';
import { BulkAssignDialog } from '@/components/leads/BulkAssignDialog';
import { StreetSelectSheet } from '@/components/leads/StreetSelectSheet';
import { LEAD_STATUS_OPTIONS, LEAD_PRIORITY_OPTIONS } from '@/types';
import type { LeadWithSource, UserRole } from '@/types';
import { LIMITS } from '@/lib/utils/validation';
import { formatDistanceToNow, isPast, isToday } from 'date-fns';

export default function LeadsListPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><h1 className="text-2xl font-bold">Leads</h1><p className="text-muted-foreground">Loading...</p></div>}>
      <LeadsListContent />
    </Suspense>
  );
}

function LeadsListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<LeadWithSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  // Default to least-privileged so admin-only selection UI never flashes for reps
  const [userRole, setUserRole] = useState<UserRole>('setter');
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [assignOpen, setAssignOpen] = useState(false);
  const [streetsOpen, setStreetsOpen] = useState(false);
  const isAdmin = userRole === 'admin';

  const status = searchParams.get('status') || '';
  const priority = searchParams.get('priority') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  function handleExport() {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    if (search) params.set('search', search);
    window.location.href = `/api/admin/leads/export?${params}`;
  }

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    if (search) params.set('search', search);
    params.set('page', page.toString());
    params.set('limit', '25');

    try {
      const res = await fetch(`/api/admin/leads?${params}`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      // Failed to fetch
    } finally {
      setLoading(false);
    }
  }, [status, priority, search, page]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetch('/api/admin/auth/me')
      .then((r) => r.json())
      .then((d) => { if (d.success) setUserRole(d.admin.role); })
      .catch(() => {});
  }, []);

  function setSelected(entries: { id: string; value: number | null }[], selected: boolean) {
    setSelection((prev) => {
      const next = new Map(prev);
      for (const e of entries) {
        if (selected) next.set(e.id, Number(e.value) || 0);
        else next.delete(e.id);
      }
      return next;
    });
  }

  const pageAllSelected = leads.length > 0 && leads.every((l) => selection.has(l.id));
  const pageSomeSelected = !pageAllSelected && leads.some((l) => selection.has(l.id));
  const selectionTotal = [...selection.values()].reduce((sum, v) => sum + v, 0);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set('page', '1');
    router.push(`/admin/leads?${params}`);
  }

  function handleSearch(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set('search', value);
    } else {
      params.delete('search');
    }
    params.set('page', '1');
    router.push(`/admin/leads?${params}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Leads</h1>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setStreetsOpen(true)}>
              <MapPin className="h-4 w-4 mr-1" />
              By Street
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
          <Link href="/admin/leads/import">
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
          </Link>
          <Link href="/admin/leads/new">
            <Button size="sm">
              <PlusCircle className="h-4 w-4 mr-1" />
              Add Lead
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, address, phone, email..."
            defaultValue={search}
            onChange={(e) => {
              const timeout = setTimeout(() => handleSearch(e.target.value), 300);
              return () => clearTimeout(timeout);
            }}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => updateFilter('status', v === 'all' ? '' : v ?? '')}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {LEAD_STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={(v) => updateFilter('priority', v === 'all' ? '' : v ?? '')}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All Priorities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            {LEAD_PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={pageAllSelected}
                    indeterminate={pageSomeSelected}
                    onCheckedChange={(checked) =>
                      setSelected(leads.map((l) => ({ id: l.id, value: l.estimated_roof_value })), checked === true)
                    }
                    className="data-indeterminate:border-primary data-indeterminate:bg-primary/30"
                    aria-label="Select all on page"
                  />
                </TableHead>
              )}
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Priority</TableHead>
              <TableHead className="hidden lg:table-cell">Source</TableHead>
              <TableHead className="hidden lg:table-cell">Est. Value</TableHead>
              <TableHead className="hidden lg:table-cell">Deal Value</TableHead>
              <TableHead className="hidden md:table-cell">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {isAdmin && <TableCell className="w-10"><Skeleton className="h-4 w-4" /></TableCell>}
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-14" /></TableCell>
                  <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                </TableRow>
              ))
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 9 : 8} className="text-center py-8 text-muted-foreground">
                  {search || status || priority ? 'No leads match your filters.' : 'No leads yet. Add your first lead to get started.'}
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/admin/leads/${lead.id}`)}
                >
                  {isAdmin && (
                    <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selection.has(lead.id)}
                        onCheckedChange={(checked) =>
                          setSelected([{ id: lead.id, value: lead.estimated_roof_value }], checked === true)
                        }
                        aria-label={`Select ${lead.first_name} ${lead.last_name}`}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm flex items-center gap-1">
                        {lead.first_name} {lead.last_name}
                        {lead.enriched_at && <span title="Enriched"><Sparkles className="h-3 w-3 text-amber-500" /></span>}
                        {lead.follow_up_date && (() => {
                          const d = new Date(lead.follow_up_date + 'T00:00:00');
                          const overdue = isPast(d) && !isToday(d);
                          return (
                            <span title={`Follow-up: ${lead.follow_up_date}`}>
                              <CalendarClock className={`h-3 w-3 ${overdue ? 'text-destructive' : 'text-amber-500'}`} />
                            </span>
                          );
                        })()}
                      </p>
                      <p className="text-xs text-muted-foreground md:hidden">
                        {[lead.address_street, lead.address_city, lead.address_state].filter(Boolean).join(', ')}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {[lead.address_city, lead.address_state].filter(Boolean).join(', ') || '-'}
                  </TableCell>
                  <TableCell>
                    <LeadStatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <LeadPriorityBadge priority={lead.priority} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {(lead.lead_sources as { display_name: string } | undefined)?.display_name || '-'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {lead.estimated_roof_value != null ? `$${Number(lead.estimated_roof_value).toLocaleString()}` : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm font-medium">
                    {lead.deal_value != null ? `$${Number(lead.deal_value).toLocaleString()}` : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {total === 0 ? 0 : (page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total} lead{total !== 1 ? 's' : ''}
        </p>
        {totalPages > 1 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.set('page', (page - 1).toString());
                router.push(`/admin/leads?${params}`);
              }}
            >
              Previous
            </Button>
            <span className="flex items-center text-sm text-muted-foreground px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.set('page', (page + 1).toString());
                router.push(`/admin/leads?${params}`);
              }}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Bulk selection action bar */}
      {isAdmin && selection.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-lg border bg-background px-4 py-2.5 shadow-lg">
          <p className="text-sm whitespace-nowrap">
            <span className="font-medium">{selection.size}</span> selected
            {selectionTotal > 0 && (
              <span className="text-muted-foreground"> · ${selectionTotal.toLocaleString()} est.</span>
            )}
          </p>
          {selection.size > LIMITS.BULK_ASSIGN_MAX && (
            <p className="text-xs text-destructive whitespace-nowrap">
              Max {LIMITS.BULK_ASSIGN_MAX} per assignment
            </p>
          )}
          <Button
            size="sm"
            onClick={() => setAssignOpen(true)}
            disabled={selection.size > LIMITS.BULK_ASSIGN_MAX}
          >
            <UserCheck className="h-4 w-4 mr-1" />
            Assign
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelection(new Map())}>
            Clear
          </Button>
        </div>
      )}

      {isAdmin && (
        <>
          <BulkAssignDialog
            open={assignOpen}
            onOpenChange={setAssignOpen}
            leadIds={[...selection.keys()]}
            onAssigned={() => {
              setSelection(new Map());
              setAssignOpen(false);
              fetchLeads();
            }}
          />
          <StreetSelectSheet
            open={streetsOpen}
            onOpenChange={setStreetsOpen}
            filters={{ status, priority, search }}
            selection={selection}
            onToggleStreet={setSelected}
          />
        </>
      )}
    </div>
  );
}
