'use client';

import { Suspense, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, Search, Upload, Sparkles, Download, CalendarClock, MapPin, UserCheck, UserMinus, PhoneOff, CopyCheck, Navigation, Phone, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { formatPhone, formatAddress, mapsUrl } from '@/lib/utils/format';
import { PageHeader } from '@/components/layout/page-header';
import { useMarkets } from '@/components/markets/use-markets';
import { isMachineAttribution } from '@/lib/leads/attribution';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
import type { LeadWithSource } from '@/types';
import { LIMITS } from '@/lib/utils/validation';
import { leadFilterKey, selectionSurvivesFilterChange } from '@/lib/leads/selection';
import { assigneeLabel } from '@/lib/leads/assignment-filter';
import { formatDistanceToNow, isPast, isToday } from 'date-fns';
import { EmptyState } from '@/components/layout/empty-state';
import { useAppShell } from '@/components/providers/app-shell-provider';
import { DataErrorState } from '@/components/layout/data-error-state';
import { LeadQueueToolbar } from '@/components/leads/LeadQueueToolbar';
import {
  buildLeadQueueSearchParams,
  hasLeadQueueFilters,
  leadQueueHref,
  leadQueueParamsFromSearchParams,
  leadQueueSort,
  nextLeadSort,
  patchLeadQueueParams,
  type LeadQueueParamKey,
  type LeadQueueParams,
  type LeadSortOrder,
} from '@/lib/leads/work-queue';

export default function LeadsListPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><PageHeader title="Leads" /></div>}>
      <LeadsListContent />
    </Suspense>
  );
}

function SortableTableHead({
  label,
  column,
  initialOrder,
  activeSort,
  activeOrder,
  className,
  onSort,
}: {
  label: string;
  column: string;
  initialOrder: LeadSortOrder;
  activeSort: string;
  activeOrder: LeadSortOrder;
  className?: string;
  onSort: (column: string, initialOrder: LeadSortOrder) => void;
}) {
  const active = activeSort === column;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (activeOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="-ml-2 inline-flex h-11 items-center gap-1 px-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => onSort(column, initialOrder)}
      >
        {label}
        {active
          ? activeOrder === 'asc'
            ? <ArrowUp className="h-3.5 w-3.5" />
            : <ArrowDown className="h-3.5 w-3.5" />
          : <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />}
      </button>
    </TableHead>
  );
}

const leadActionClass = 'inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50';
const leadLedgerHeadClass = 'font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';

function LeadQuickActions({ lead }: { lead: LeadWithSource }) {
  const directions = mapsUrl(lead);
  const leadName = `${lead.first_name} ${lead.last_name}`.trim();

  return (
    <div className="flex shrink-0 items-center justify-end gap-0.5" onClick={(event) => event.stopPropagation()}>
      {!lead.is_dnc && lead.phone && (
        <>
          <a href={`tel:${lead.phone}`} aria-label={`Call ${leadName}`} className={leadActionClass}>
            <Phone className="h-4 w-4" />
          </a>
          <a href={`sms:${lead.phone}`} aria-label={`Text ${leadName}`} className={leadActionClass}>
            <MessageSquare className="h-4 w-4" />
          </a>
        </>
      )}
      {directions && (
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Directions to ${leadName}`}
          className={leadActionClass}
        >
          <Navigation className="h-4 w-4" />
        </a>
      )}
      <Link href={`/admin/leads/${lead.id}`} aria-label={`Open ${leadName}`} className={leadActionClass}>
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function LeadsListContent() {
  const { user } = useAppShell();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<LeadWithSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [assignOpen, setAssignOpen] = useState(false);
  // Which intent the dialog was opened with. Used as its key so it remounts
  // with fresh state per mode — cheaper and less error-prone than syncing a
  // prop into state that only initialises on mount.
  const [assignMode, setAssignMode] = useState<'assign' | 'unassign'>('assign');
  const [streetsOpen, setStreetsOpen] = useState(false);
  const [dncCount, setDncCount] = useState(0);
  const [dncScrubOpen, setDncScrubOpen] = useState(false);
  const [dncScrubbing, setDncScrubbing] = useState(false);
  const [recheckOpen, setRecheckOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const isAdmin = user.role === 'admin';

  const searchParamsString = searchParams.toString();
  const queueParams = useMemo(
    () => leadQueueParamsFromSearchParams(new URLSearchParams(searchParamsString)),
    [searchParamsString]
  );
  const status = queueParams.status || '';
  const priority = queueParams.priority || '';
  const search = queueParams.search || '';
  const streetNumber = queueParams.street_number || '';
  const streetDir = queueParams.street_dir || '';
  const streetName = queueParams.street_name || '';
  const streetsParam = queueParams.streets || '';
  const selectedStreets = streetsParam ? streetsParam.split('|').filter(Boolean) : [];
  const dncOnly = queueParams.is_dnc === 'true';
  const { markets, homeMarketId } = useMarkets();
  // Absent param means "my office" — the server resolves it the same way, so the
  // URL stays clean until the rep actually switches markets.
  const marketParam = queueParams.market_id || '';
  // "Show me what this person uploaded." Admin-only because /api/admin/users is.
  const createdBy = queueParams.created_by || '';
  // Ownership filters. The COLUMNS are visible to every role, but the
  // person-pickers need the user list from /api/admin/users, which is
  // admin-only — so reps can see who owns a lead without being able to
  // enumerate the roster.
  const assignedSetter = queueParams.assigned_setter || '';
  const assignedCloser = queueParams.assigned_closer || '';
  // Receipt-only scope. Keep it separate from saved queue definitions, but
  // preserve it while the user sorts, pages, or adjusts another filter.
  const importBatchId = searchParams.get('import_batch_id') || '';
  const [uploaders, setUploaders] = useState<{ id: string; name: string }[]>([]);
  const requestedPage = parseInt(searchParams.get('page') || '1', 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const selectedViewId = searchParams.get('view') || '';
  const { sort, order } = leadQueueSort(queueParams);
  const hasFilters = hasLeadQueueFilters(queueParams) || Boolean(importBatchId);

  // Only show optional columns that actually carry data. Freshly imported lists
  // have no source or values yet, and three columns of "—" on every row is noise
  // that pushes the fields a rep needs off to the side.
  const showSource = leads.some((l) => l.lead_sources?.display_name);
  const showAddedBy = leads.some((l) => l.created_by_name);
  const showEstValue = sort === 'estimated_roof_value' || leads.some((l) => l.estimated_roof_value != null);
  const showDealValue = sort === 'deal_value' || leads.some((l) => l.deal_value != null);
  // +1 for the quick-action column. Optional data stays quiet until this page
  // has something useful to show in it.
  const columnCount =
    (isAdmin ? 1 : 0) + 9 + [showSource, showAddedBy, showEstValue, showDealValue].filter(Boolean).length;

  const applyQueue = useCallback((params: LeadQueueParams, viewId?: string | null) => {
    const next = buildLeadQueueSearchParams(params, { viewId });
    if (importBatchId) next.set('import_batch_id', importBatchId);
    router.replace(leadQueueHref(next), { scroll: false });
  }, [importBatchId, router]);

  const patchQueue = useCallback((
    patch: Partial<Record<LeadQueueParamKey, string | undefined>>
  ) => {
    applyQueue(patchLeadQueueParams(queueParams, patch), selectedViewId || null);
  }, [applyQueue, queueParams, selectedViewId]);

  function toggleStreetFilter(name: string, selected: boolean) {
    const next = selected
      ? [...selectedStreets, name]
      : selectedStreets.filter((s) => s !== name);
    patchQueue({ streets: next.join('|') || undefined });
  }

  function handleExport() {
    const params = buildLeadQueueSearchParams(queueParams);
    if (importBatchId) params.set('import_batch_id', importBatchId);
    const query = params.toString();
    window.location.href = query ? `/api/admin/leads/export?${query}` : '/api/admin/leads/export';
  }

  const fetchLeads = useCallback(async () => {
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    setLoading(true);
    setError('');
    const params = buildLeadQueueSearchParams(queueParams);
    params.set('page', page.toString());
    params.set('limit', '25');
    if (importBatchId) params.set('import_batch_id', importBatchId);

    try {
      const res = await fetch(`/api/admin/leads?${params}`, { signal: controller.signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Could not load leads');
      }
      if (fetchControllerRef.current !== controller) return;
      setLeads(data.leads);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      if (fetchControllerRef.current !== controller) return;
      setError(cause instanceof Error ? cause.message : 'Could not load leads');
    } finally {
      if (fetchControllerRef.current === controller) setLoading(false);
    }
  }, [queueParams, page, importBatchId]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((d) => { if (d.success) setUploaders(d.users.map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))); })
      .catch(() => {});
  }, [isAdmin]);

  const fetchDncCount = useCallback(async () => {
    try {
      const params = new URLSearchParams({ is_dnc: 'true', limit: '1' });
      if (marketParam) params.set('market_id', marketParam);
      const res = await fetch(`/api/admin/leads?${params}`);
      const data = await res.json();
      if (data.success) setDncCount(data.total);
    } catch {
      // ignore
    }
  }, [marketParam]);

  async function handleScrubDnc() {
    setDncScrubbing(true);
    try {
      const res = await fetch('/api/admin/leads/scrub-dnc', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(`Removed phone numbers from ${data.scrubbed} Do Not Call lead${data.scrubbed !== 1 ? 's' : ''}`);
        setDncScrubOpen(false);
        fetchLeads();
      } else {
        toast.error(data.error || 'Failed to remove numbers');
      }
    } catch {
      toast.error('Failed to remove numbers');
    } finally {
      setDncScrubbing(false);
    }
  }

  async function handleRecheckDuplicates() {
    setRechecking(true);
    try {
      const res = await fetch('/api/admin/leads/recheck-duplicates', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const parts = [];
        if (data.flagged > 0) parts.push(`${data.flagged} newly flagged`);
        if (data.unflagged > 0) parts.push(`${data.unflagged} unflagged`);
        toast.success(
          parts.length > 0
            ? `Checked ${data.checked} leads — ${parts.join(', ')}`
            : `Checked ${data.checked} leads — no changes`
        );
        setRecheckOpen(false);
        fetchLeads();
      } else {
        toast.error(data.error || 'Failed to re-check duplicates');
      }
    } catch {
      toast.error('Failed to re-check duplicates');
    } finally {
      setRechecking(false);
    }
  }

  useEffect(() => {
    fetchLeads();
    return () => fetchControllerRef.current?.abort();
  }, [fetchLeads]);

  useEffect(() => {
    if (isAdmin) fetchDncCount();
  }, [fetchDncCount, isAdmin]);

  // A selection means "these rows, from the list I am looking at". Changing a
  // filter breaks that premise: rows picked before the change stay in the Map
  // but stop being rendered, so the assign bar would offer to reassign leads the
  // operator cannot see — the whole database, if they had selected broadly
  // first. Bulk assign has no undo, so the selection is dropped instead.
  //
  // Paging is deliberately excluded from the key: accumulating a selection while
  // walking pages of ONE filter is a real workflow.
  //
  // Reset during render rather than in an effect. An effect would let one paint
  // happen with a stale selection still armed, and it trips
  // react-hooks/set-state-in-effect.
  const filterKey = `${leadFilterKey({
    status,
    priority,
    search,
    streetNumber,
    streetDir,
    streetName,
    streets: streetsParam,
    dncOnly,
    marketId: marketParam,
    createdBy,
    assignedSetter,
    assignedCloser,
  })}|import_batch_id:${importBatchId}`;
  const [selectionScope, setSelectionScope] = useState(filterKey);
  if (!selectionSurvivesFilterChange(selectionScope, filterKey)) {
    setSelectionScope(filterKey);
    if (selection.size > 0) setSelection(new Map());
  }

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

  function handleSort(column: string, initialOrder: LeadSortOrder) {
    const next = nextLeadSort(queueParams, column, initialOrder);
    patchQueue({ sort: next.sort, order: next.order });
  }

  function goToPage(nextPage: number) {
    const params = buildLeadQueueSearchParams(queueParams, {
      viewId: selectedViewId || null,
      page: nextPage,
    });
    if (importBatchId) params.set('import_batch_id', importBatchId);
    router.replace(leadQueueHref(params));
  }

  return (
    <div className="space-y-8">
      <header className="border-b pb-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              Lead book
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Leads</h1>
              {!loading && (
                <p className="text-sm text-muted-foreground">
                  {total.toLocaleString()} record{total !== 1 ? 's' : ''}
                  {selectedStreets.length > 0
                    ? ` · ${selectedStreets.length} street${selectedStreets.length !== 1 ? 's' : ''}`
                    : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
            {isAdmin && (
              <Button
                variant={selectedStreets.length > 0 ? 'default' : 'outline'}
                className="h-11"
                onClick={() => setStreetsOpen(true)}
                aria-label="Choose leads by street"
              >
                <MapPin className="h-4 w-4" />
                <span className="hidden sm:inline">
                  By street{selectedStreets.length > 0 ? ` (${selectedStreets.length})` : ''}
                </span>
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" className="hidden h-11 sm:inline-flex" onClick={() => setRecheckOpen(true)}>
                <CopyCheck className="h-4 w-4" />
                Re-check duplicates
              </Button>
            )}
            {/* Admin-only: the CSV carries names, phones, emails and addresses
                for every matching lead. The route enforces this too. */}
            {isAdmin && (
              <Button variant="outline" className="hidden h-11 sm:inline-flex" onClick={handleExport}>
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            <Button
              render={<Link href="/admin/leads/import" />}
              nativeButton={false}
              variant="outline"
              className="h-11"
            >
              <Upload className="h-4 w-4" />
              Import
            </Button>
          </div>
        </div>
      </header>

      <LeadQueueToolbar
        params={queueParams}
        selectedViewId={selectedViewId}
        markets={markets}
        homeMarketId={homeMarketId}
        uploaders={uploaders}
        isAdmin={isAdmin}
        onApply={applyQueue}
        onPatch={patchQueue}
      />

      {/* Do Not Call banner */}
      {isAdmin && dncCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-destructive/30 py-3 text-sm">
          <span className="flex items-center gap-2">
            <PhoneOff className="h-4 w-4 text-destructive" />
            <span>
              <strong>{dncCount}</strong> Do Not Call record{dncCount !== 1 ? 's need' : ' needs'} safe handling
            </span>
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" onClick={() => patchQueue({ is_dnc: dncOnly ? undefined : 'true' })}>
              {dncOnly ? 'Show all leads' : 'Show only DNC'}
            </Button>
            <Button variant="destructive" className="h-11" onClick={() => setDncScrubOpen(true)}>
              <PhoneOff className="h-4 w-4" />
              Remove phone numbers
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {error && leads.length > 0 && (
        <DataErrorState
          compact
          title="Leads could not be refreshed"
          description={`${error} The last loaded results remain visible.`}
          onRetry={fetchLeads}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {loading ? 'Updating lead results' : `${total.toLocaleString()} lead results`}
      </p>
      <section
        id="lead-results"
        className={`space-y-4 transition-opacity ${loading && leads.length > 0 ? 'opacity-70' : ''}`}
        aria-labelledby="lead-results-heading"
      >
        <header className="flex items-start justify-between gap-4 border-t-2 border-foreground/80 pt-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
              Current queue
            </p>
            <h2 id="lead-results-heading" className="mt-1 text-lg font-semibold tracking-tight">
              Lead results
            </h2>
            {!loading && total > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Showing {((page - 1) * 25 + 1).toLocaleString()}–{Math.min(page * 25, total).toLocaleString()}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold leading-none tabular-nums">{loading && leads.length === 0 ? '—' : total.toLocaleString()}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Results</p>
          </div>
        </header>

        {/* Phone rows are work cards, not a squeezed desktop table. */}
        <div className="border-y md:hidden" aria-busy={loading} aria-label="Lead results">
          {isAdmin && leads.length > 0 && (
            <div className="flex min-h-11 items-center gap-2 border-b px-1 text-xs text-muted-foreground">
              <Checkbox
                checked={pageAllSelected}
                indeterminate={pageSomeSelected}
                onCheckedChange={(checked) =>
                  setSelected(leads.map((lead) => ({ id: lead.id, value: lead.estimated_roof_value })), checked === true)
                }
                className="after:-inset-3.5 data-indeterminate:border-primary data-indeterminate:bg-primary/30"
                aria-label="Select all on page"
              />
              Select this page
            </div>
          )}

          {loading && leads.length === 0 ? (
            [...Array(5)].map((_, index) => (
              <div key={index} className="space-y-3 py-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))
          ) : error && leads.length === 0 ? (
            <div className="py-4">
              <DataErrorState title="Leads did not load" description={error} onRetry={fetchLeads} />
            </div>
          ) : leads.length === 0 ? (
            hasFilters ? (
              <EmptyState
                icon={Search}
                title="No leads match your filters"
                description="Try a different search, or clear the filters to see everything."
              />
            ) : (
              <EmptyState
                icon={Upload}
                title={isAdmin ? 'No leads yet' : 'No leads assigned to you yet'}
                description={isAdmin
                  ? 'Import a list to get started — CSV and Excel both work, and Do Not Call numbers are handled automatically.'
                  : 'An admin can assign existing leads to you, or you can import a new list for your role.'}
                action={
                  <Button
                    render={<Link href="/admin/leads/import" />}
                    nativeButton={false}
                    className="h-11"
                  >
                    <Upload className="h-4 w-4" />
                    Import leads
                  </Button>
                }
              />
            )
          ) : (
            <div className="divide-y">
              {leads.map((lead) => (
                <article
                  key={lead.id}
                  className={`py-4 ${selection.has(lead.id) ? 'bg-primary/[0.04]' : ''}`}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    {isAdmin && (
                      <div className="flex h-11 w-8 shrink-0 items-center justify-start">
                        <Checkbox
                          checked={selection.has(lead.id)}
                          className="after:-inset-3.5"
                          onCheckedChange={(checked) =>
                            setSelected([{ id: lead.id, value: lead.estimated_roof_value }], checked === true)
                          }
                          aria-label={`Select ${lead.first_name} ${lead.last_name}`}
                        />
                      </div>
                    )}
                    <Link href={`/admin/leads/${lead.id}`} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {lead.first_name} {lead.last_name}
                        </h3>
                        <span className="shrink-0"><LeadStatusBadge status={lead.status} /></span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {formatAddress(lead) || 'No property address'}
                      </p>
                    </Link>
                  </div>

                  <div className={`mt-3 min-w-0 text-xs text-muted-foreground ${isAdmin ? 'pl-10' : ''}`}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <LeadPriorityBadge priority={lead.priority} />
                        {lead.is_dnc && (
                          <span className="font-semibold text-destructive">DNC · knock only</span>
                        )}
                        {lead.enriched_at && (
                          <span className="inline-flex items-center gap-1">
                            <Sparkles className="h-3 w-3 text-status-stale" /> Enriched
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate">
                        Setter {lead.assigned_setter?.name ? assigneeLabel(lead.assigned_setter.name) : 'unassigned'}
                        {' · '}Closer {lead.assigned_closer?.name ? assigneeLabel(lead.assigned_closer.name) : 'unassigned'}
                      </p>
                      {lead.follow_up_date && (() => {
                        const followUp = new Date(`${lead.follow_up_date}T00:00:00`);
                        const overdue = isPast(followUp) && !isToday(followUp);
                        return (
                          <p className={`mt-1 inline-flex items-center gap-1 ${overdue ? 'font-medium text-destructive' : ''}`}>
                            <CalendarClock className="h-3 w-3" />
                            Follow-up {lead.follow_up_date}{overdue ? ' · overdue' : ''}
                          </p>
                        );
                      })()}
                  </div>
                  <div className={`mt-1 flex justify-end ${isAdmin ? 'pl-10' : ''}`}>
                    <LeadQuickActions lead={lead} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="hidden border-y md:block [&_[data-slot=table-container]]:max-h-[calc(100dvh-13rem)] [&_[data-slot=table-container]]:overflow-auto">
          <Table aria-busy={loading} aria-label="Lead results" className="min-w-[1180px]">
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {isAdmin && (
                <TableHead className={`w-12 ${leadLedgerHeadClass}`}>
                  <Checkbox
                    checked={pageAllSelected}
                    indeterminate={pageSomeSelected}
                    onCheckedChange={(checked) =>
                      setSelected(leads.map((l) => ({ id: l.id, value: l.estimated_roof_value })), checked === true)
                    }
                    className="after:-inset-3.5 data-indeterminate:border-primary data-indeterminate:bg-primary/30"
                    aria-label="Select all on page"
                  />
                </TableHead>
              )}
              <SortableTableHead
                label="Name"
                column="last_name"
                initialOrder="asc"
                activeSort={sort}
                activeOrder={order}
                onSort={handleSort}
              />
              <TableHead className={leadLedgerHeadClass}>Property</TableHead>
              <TableHead className={leadLedgerHeadClass}>Phone</TableHead>
              <SortableTableHead
                label="Status"
                column="status"
                initialOrder="asc"
                activeSort={sort}
                activeOrder={order}
                onSort={handleSort}
              />
              <SortableTableHead
                label="Priority"
                column="priority"
                initialOrder="desc"
                activeSort={sort}
                activeOrder={order}
                className="hidden sm:table-cell"
                onSort={handleSort}
              />
              {showSource && <TableHead className={leadLedgerHeadClass}>Source</TableHead>}
              {showAddedBy && <TableHead className={leadLedgerHeadClass}>Added by</TableHead>}
              {showEstValue && (
                <SortableTableHead
                  label="Est. Value"
                  column="estimated_roof_value"
                  initialOrder="desc"
                  activeSort={sort}
                  activeOrder={order}
                  onSort={handleSort}
                />
              )}
              {showDealValue && (
                <SortableTableHead
                  label="Deal Value"
                  column="deal_value"
                  initialOrder="desc"
                  activeSort={sort}
                  activeOrder={order}
                  onSort={handleSort}
                />
              )}
              {/* Always shown, unlike the columns above, which appear only when
                  some row has data. An empty assignment column is the point:
                  "nobody owns this" is the state worth seeing. */}
              <TableHead className={leadLedgerHeadClass}>Setter</TableHead>
              <TableHead className={leadLedgerHeadClass}>Closer</TableHead>
              <SortableTableHead
                label="Added"
                column="created_at"
                initialOrder="desc"
                activeSort={sort}
                activeOrder={order}
                className="hidden md:table-cell"
                onSort={handleSort}
              />
              <TableHead className={`w-48 text-right ${leadLedgerHeadClass}`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && leads.length === 0 ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {isAdmin && <TableCell className="w-12"><Skeleton className="h-4 w-4" /></TableCell>}
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-14" /></TableCell>
                  {showSource && <TableCell><Skeleton className="h-4 w-20" /></TableCell>}
                  {showAddedBy && <TableCell><Skeleton className="h-4 w-20" /></TableCell>}
                  {showEstValue && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                  {showDealValue && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-11 w-44" /></TableCell>
                </TableRow>
              ))
            ) : error && leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="p-4">
                  <DataErrorState title="Leads did not load" description={error} onRetry={fetchLeads} />
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="p-0">
                  {hasFilters ? (
                    <EmptyState
                      icon={Search}
                      title="No leads match your filters"
                      description="Try a different search, or clear the filters to see everything."
                    />
                  ) : (
                    <EmptyState
                      icon={Upload}
                      title={isAdmin ? 'No leads yet' : 'No leads assigned to you yet'}
                      description={isAdmin
                        ? 'Import a list to get started — CSV and Excel both work, and Do Not Call numbers are handled automatically.'
                        : 'An admin can assign existing leads to you, or you can import a new list for your role.'}
                      action={
                        <Button
                          render={<Link href="/admin/leads/import" />}
                          nativeButton={false}
                          size="sm"
                        >
                          <Upload className="h-4 w-4 mr-1" />
                          Import leads
                        </Button>
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              leads.map((lead) => (
                <TableRow
                  key={lead.id}
                  className={`group cursor-pointer border-border/70 hover:bg-muted/40 ${selection.has(lead.id) ? 'bg-primary/[0.04]' : ''}`}
                  onClick={() => router.push(`/admin/leads/${lead.id}`)}
                >
                  {isAdmin && (
                    <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selection.has(lead.id)}
                        className="after:-inset-3.5"
                        onCheckedChange={(checked) =>
                          setSelected([{ id: lead.id, value: lead.estimated_roof_value }], checked === true)
                        }
                        aria-label={`Select ${lead.first_name} ${lead.last_name}`}
                      />
                    </TableCell>
                  )}
                  <TableCell className="py-3.5">
                    <div className="min-w-[11rem]">
                      <p className="flex items-center gap-1 text-sm font-semibold">
                        <Link
                          href={`/admin/leads/${lead.id}`}
                          className="rounded-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {lead.first_name} {lead.last_name}
                        </Link>
                        {lead.is_dnc && (
                          <span
                            title="Do Not Call"
                            className="inline-flex items-center rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive leading-none"
                          >
                            DNC
                          </span>
                        )}
                        {lead.follow_up_date && (() => {
                          const d = new Date(lead.follow_up_date + 'T00:00:00');
                          const overdue = isPast(d) && !isToday(d);
                          return (
                            <span title={`Follow-up: ${lead.follow_up_date}`}>
                              <CalendarClock className={`h-3 w-3 ${overdue ? 'text-destructive' : 'text-status-stale'}`} />
                            </span>
                          );
                        })()}
                      </p>
                      {lead.enriched_at && (
                        <p className="mt-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                          <Sparkles className="h-3 w-3 text-status-stale" /> Enriched record
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden max-w-[20rem] py-3.5 text-sm md:table-cell">
                    <p className="truncate text-foreground/90">{lead.address_street || 'No street address'}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[lead.address_city, lead.address_state].filter(Boolean).join(', ') || 'Location unavailable'}
                    </p>
                  </TableCell>
                  <TableCell className="hidden py-3.5 text-sm md:table-cell" onClick={(e) => e.stopPropagation()}>
                    {lead.is_dnc ? (
                      <span className="text-xs text-destructive/80">Do not call</span>
                    ) : lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="tabular-nums hover:text-primary hover:underline">
                        {formatPhone(lead.phone)}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3.5">
                    <LeadStatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell className="hidden py-3.5 sm:table-cell">
                    <LeadPriorityBadge priority={lead.priority} />
                  </TableCell>
                  {showSource && (
                    <TableCell className="py-3.5 text-sm text-muted-foreground">
                      {(lead.lead_sources as { display_name: string } | undefined)?.display_name || '—'}
                    </TableCell>
                  )}
                  {showAddedBy && (
                    <TableCell className="py-3.5 text-sm text-muted-foreground">
                      {lead.created_by_name ? (
                        <span
                          className={
                            // A feed is not a person; italics keep the two
                            // readable apart when scanning the column.
                            isMachineAttribution(lead.created_by_name) ? 'italic opacity-80' : ''
                          }
                        >
                          {lead.created_by_name}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  )}
                  {showEstValue && (
                    <TableCell className="py-3.5 text-sm text-muted-foreground tabular-nums">
                      {lead.estimated_roof_value != null
                        ? `$${Number(lead.estimated_roof_value).toLocaleString()}`
                        : '—'}
                    </TableCell>
                  )}
                  {showDealValue && (
                    <TableCell className="py-3.5 text-sm font-medium tabular-nums">
                      {lead.deal_value != null ? `$${Number(lead.deal_value).toLocaleString()}` : '—'}
                    </TableCell>
                  )}
                  {/* Unowned is styled as absence, not as a value: a muted dash
                      scans as a gap so a column of them reads as a problem. */}
                  <TableCell className="py-3.5 text-sm">
                    {lead.assigned_setter?.name ? (
                      <span className="text-foreground">{assigneeLabel(lead.assigned_setter.name)}</span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3.5 text-sm">
                    {lead.assigned_closer?.name ? (
                      <span className="text-foreground">{assigneeLabel(lead.assigned_closer.name)}</span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden py-3.5 text-sm text-muted-foreground md:table-cell">
                    <p>{formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}</p>
                    {lead.follow_up_date && (() => {
                      const followUp = new Date(`${lead.follow_up_date}T00:00:00`);
                      const overdue = isPast(followUp) && !isToday(followUp);
                      return (
                        <p className={`mt-1 flex items-center gap-1 text-xs ${overdue ? 'font-medium text-destructive' : ''}`}>
                          <CalendarClock className="h-3 w-3" />
                          {lead.follow_up_date}{overdue ? ' · overdue' : ''}
                        </p>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="py-2">
                    <LeadQuickActions lead={lead} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          </Table>
        </div>
      </section>

      {/* Pagination */}
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {total === 0 ? 0 : (page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total} lead{total !== 1 ? 's' : ''}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-11"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              Previous
            </Button>
            <span className="flex items-center text-sm text-muted-foreground px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              className="h-11"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Bulk selection action bar */}
      {isAdmin && selection.size > 0 && (
        <div className="fixed bottom-[calc(3.75rem+env(safe-area-inset-bottom))] left-2 right-2 z-40 flex items-center gap-3 overflow-x-auto border border-white/10 bg-[#121722] px-4 py-3 text-white shadow-xl md:bottom-4 md:left-1/2 md:right-auto md:-translate-x-1/2">
          <p className="text-sm whitespace-nowrap">
            <span className="font-medium">{selection.size}</span> selected
            {selectionTotal > 0 && (
              <span className="text-white/60"> · ${selectionTotal.toLocaleString()} est.</span>
            )}
          </p>
          {selection.size > LIMITS.BULK_ASSIGN_MAX && (
            <p className="text-xs text-destructive whitespace-nowrap">
              Max {LIMITS.BULK_ASSIGN_MAX} per assignment
            </p>
          )}
          <Button
            className="h-11"
            onClick={() => { setAssignMode('assign'); setAssignOpen(true); }}
            disabled={selection.size > LIMITS.BULK_ASSIGN_MAX}
          >
            <UserCheck className="h-4 w-4 mr-1" />
            Assign
          </Button>
          {/* Its own button rather than a checkbox buried in the dialog:
              clearing a bad assignment is a distinct job from making one, and
              the operator should not have to pick a person to discard. */}
          <Button
            variant="outline"
            className="h-11 border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white dark:border-white/20 dark:bg-white/5 dark:hover:bg-white/10"
            onClick={() => { setAssignMode('unassign'); setAssignOpen(true); }}
            disabled={selection.size > LIMITS.BULK_ASSIGN_MAX}
          >
            <UserMinus className="h-4 w-4 mr-1" />
            Unassign
          </Button>
          <Button className="h-11 text-white hover:bg-white/10 hover:text-white dark:hover:bg-white/10" variant="ghost" onClick={() => setSelection(new Map())}>
            Clear
          </Button>
        </div>
      )}

      {isAdmin && (
        <>
          <BulkAssignDialog
            key={assignMode}
            defaultUnassign={assignMode === 'unassign'}
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
            filters={queueParams}
            selectedStreets={selectedStreets}
            onToggleStreet={toggleStreetFilter}
            onClear={() => patchQueue({ streets: undefined })}
          />
          <Dialog open={dncScrubOpen} onOpenChange={setDncScrubOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Remove phone numbers from DNC leads?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Clears every phone number from the {dncCount} lead{dncCount !== 1 ? 's' : ''} flagged Do Not Call.
                The leads stay on your list and map so you can still door-knock them — only the callable numbers
                are removed. This can&apos;t be undone.
              </p>
              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={() => setDncScrubOpen(false)} disabled={dncScrubbing}>
                  Cancel
                </Button>
                <Button variant="destructive" className="h-11" onClick={handleScrubDnc} disabled={dncScrubbing}>
                  {dncScrubbing ? 'Removing...' : 'Remove numbers'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={recheckOpen} onOpenChange={setRecheckOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Re-check duplicates?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Re-runs duplicate detection over every lead using the current rule — the same
                property address (or parcel number), ignoring phone numbers. It clears leads that
                were flagged by mistake and flags any real duplicates that were missed. The oldest
                lead at an address is always kept as the original. No leads are deleted.
              </p>
              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={() => setRecheckOpen(false)} disabled={rechecking}>
                  Cancel
                </Button>
                <Button className="h-11" onClick={handleRecheckDuplicates} disabled={rechecking}>
                  {rechecking ? 'Checking...' : 'Re-check duplicates'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
