'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, PlusCircle, Upload, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { LEAD_STATUS_OPTIONS, LEAD_PRIORITY_OPTIONS } from '@/types';
import type { LeadWithSource } from '@/types';
import { formatDistanceToNow } from 'date-fns';

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

  const status = searchParams.get('status') || '';
  const priority = searchParams.get('priority') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

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
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Priority</TableHead>
              <TableHead className="hidden lg:table-cell">Source</TableHead>
              <TableHead className="hidden md:table-cell">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-14" /></TableCell>
                  <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                </TableRow>
              ))
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
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
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm flex items-center gap-1">
                        {lead.first_name} {lead.last_name}
                        {lead.enriched_at && <span title="Enriched"><Sparkles className="h-3 w-3 text-amber-500" /></span>}
                      </p>
                      <p className="text-xs text-muted-foreground md:hidden">
                        {[lead.address_city, lead.address_state].filter(Boolean).join(', ')}
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {total} lead{total !== 1 ? 's' : ''} total
          </p>
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
        </div>
      )}
    </div>
  );
}
