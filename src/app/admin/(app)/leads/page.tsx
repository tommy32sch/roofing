'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Upload, Sparkles, Download, CalendarClock, MapPin, UserCheck, UserMinus, PhoneOff, CopyCheck, SlidersHorizontal, Navigation, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { formatPhone, formatAddress, mapsUrl } from '@/lib/utils/format';
import { PageHeader } from '@/components/layout/page-header';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import { isMachineAttribution } from '@/lib/leads/attribution';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
import type { LeadWithSource } from '@/types';
import { LIMITS } from '@/lib/utils/validation';
import { leadFilterKey, selectionSurvivesFilterChange } from '@/lib/leads/selection';
import { assigneeLabel, UNASSIGNED } from '@/lib/leads/assignment-filter';
import { STREET_DIRECTIONS } from '@/lib/utils/lead-query';
import { formatDistanceToNow, isPast, isToday } from 'date-fns';
import { EmptyState } from '@/components/layout/empty-state';
import { useAppShell } from '@/components/providers/app-shell-provider';
import { DataErrorState } from '@/components/layout/data-error-state';

export default function LeadsListPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><PageHeader title="Leads" /></div>}>
      <LeadsListContent />
    </Suspense>
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isAdmin = user.role === 'admin';

  const status = searchParams.get('status') || '';
  const priority = searchParams.get('priority') || '';
  const search = searchParams.get('search') || '';
  const streetNumber = searchParams.get('street_number') || '';
  const streetDir = searchParams.get('street_dir') || '';
  const streetName = searchParams.get('street_name') || '';
  const streetsParam = searchParams.get('streets') || '';
  const selectedStreets = streetsParam ? streetsParam.split('|').filter(Boolean) : [];
  const dncOnly = searchParams.get('is_dnc') === 'true';
  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();
  // Absent param means "my office" — the server resolves it the same way, so the
  // URL stays clean until the rep actually switches markets.
  const marketParam = searchParams.get('market_id') || '';
  const marketValue = marketParam || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);
  // "Show me what this person uploaded." Admin-only because /api/admin/users is.
  const createdBy = searchParams.get('created_by') || '';
  // Ownership filters. The COLUMNS are visible to every role, but the
  // person-pickers need the user list from /api/admin/users, which is
  // admin-only — so reps can see who owns a lead without being able to
  // enumerate the roster.
  const assignedSetter = searchParams.get('assigned_setter') || '';
  const assignedCloser = searchParams.get('assigned_closer') || '';
  const [uploaders, setUploaders] = useState<{ id: string; name: string }[]>([]);
  const page = parseInt(searchParams.get('page') || '1', 10);
  // Drives the mobile filter button's active state
  const activeFilterCount = [status, priority, streetNumber, streetDir, streetName, streetsParam, dncOnly ? 'dnc' : '', marketParam, createdBy, assignedSetter, assignedCloser].filter(Boolean).length;

  // Only show optional columns that actually carry data. Freshly imported lists
  // have no source or values yet, and three columns of "—" on every row is noise
  // that pushes the fields a rep needs off to the side.
  const showSource = leads.some((l) => l.lead_sources?.display_name);
  const showAddedBy = leads.some((l) => l.created_by_name);
  const showEstValue = leads.some((l) => l.estimated_roof_value != null);
  const showDealValue = leads.some((l) => l.deal_value != null);
  const columnCount =
    // +2 for the always-on Setter and Closer columns.
    (isAdmin ? 1 : 0) + 9 + [showSource, showAddedBy, showEstValue, showDealValue].filter(Boolean).length;

  function applyFilterParams(params: URLSearchParams) {
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    if (search) params.set('search', search);
    if (streetNumber) params.set('street_number', streetNumber);
    if (streetDir) params.set('street_dir', streetDir);
    if (streetName) params.set('street_name', streetName);
    if (streetsParam) params.set('streets', streetsParam);
    if (dncOnly) params.set('is_dnc', 'true');
    if (marketParam) params.set('market_id', marketParam);
    if (createdBy) params.set('created_by', createdBy);
    if (assignedSetter) params.set('assigned_setter', assignedSetter);
    if (assignedCloser) params.set('assigned_closer', assignedCloser);
  }

  function toggleStreetFilter(name: string, selected: boolean) {
    const next = selected
      ? [...selectedStreets, name]
      : selectedStreets.filter((s) => s !== name);
    updateFilter('streets', next.join('|'));
  }

  function handleExport() {
    const params = new URLSearchParams();
    applyFilterParams(params);
    window.location.href = `/api/admin/leads/export?${params}`;
  }

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    if (search) params.set('search', search);
    if (streetNumber) params.set('street_number', streetNumber);
    if (streetDir) params.set('street_dir', streetDir);
    if (streetName) params.set('street_name', streetName);
    if (streetsParam) params.set('streets', streetsParam);
    if (dncOnly) params.set('is_dnc', 'true');
    if (marketParam) params.set('market_id', marketParam);
    if (createdBy) params.set('created_by', createdBy);
    if (assignedSetter) params.set('assigned_setter', assignedSetter);
    if (assignedCloser) params.set('assigned_closer', assignedCloser);
    params.set('page', page.toString());
    params.set('limit', '25');

    try {
      const res = await fetch(`/api/admin/leads?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Could not load leads');
      }
      setLeads(data.leads);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load leads');
    } finally {
      setLoading(false);
    }
  }, [status, priority, search, streetNumber, streetDir, streetName, streetsParam, dncOnly, page, marketParam, createdBy, assignedSetter, assignedCloser]);

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
  const filterKey = leadFilterKey({
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
  });
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

  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function debouncedFilter(key: string, value: string) {
    clearTimeout(debounceRef.current[key]);
    debounceRef.current[key] = setTimeout(() => updateFilter(key, value), 350);
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
      <PageHeader
        title="Leads"
        description={loading ? undefined : `${total.toLocaleString()} lead${total !== 1 ? 's' : ''}${selectedStreets.length > 0 ? ` · ${selectedStreets.length} street${selectedStreets.length !== 1 ? 's' : ''}` : ''}`}
        actions={
          <>
            {isAdmin && (
              <Button
                variant={selectedStreets.length > 0 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStreetsOpen(true)}
              >
                <MapPin className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">
                  By Street{selectedStreets.length > 0 ? ` (${selectedStreets.length})` : ''}
                </span>
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => setRecheckOpen(true)}>
                <CopyCheck className="h-4 w-4 mr-1" />
                Re-check dupes
              </Button>
            )}
            {/* Admin-only: the CSV carries names, phones, emails and addresses
                for every matching lead. The route enforces this too. */}
            {isAdmin && (
              <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={handleExport}>
                <Download className="h-4 w-4 mr-1" />
                Export
              </Button>
            )}
            <Link href="/admin/leads/import" className="hidden sm:block">
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-1" />
                Import
              </Button>
            </Link>
          </>
        }
      />

      {/* Search is always visible; the rest collapses on mobile so leads are
          on screen immediately instead of below a full page of filter controls. */}
      <div className="flex gap-2">
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
        <Button
          variant={activeFilterCount > 0 ? 'default' : 'outline'}
          size="icon"
          className="sm:hidden shrink-0"
          aria-label="Filters"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <div className={`${filtersOpen ? 'flex' : 'hidden'} sm:flex flex-col sm:flex-row gap-3`}>
        {!marketsLoading && (
          <MarketFilter
            markets={markets}
            value={marketValue}
            onChange={(v) => updateFilter('market_id', v)}
          />
        )}
        {isAdmin && uploaders.length > 0 && (
          <Select
            value={createdBy || 'all'}
            onValueChange={(v) => updateFilter('created_by', v === 'all' ? '' : v ?? '')}
          >
            <SelectTrigger className="sm:w-[160px]" aria-label="Added by">
              <SelectValue>
                {createdBy
                  ? uploaders.find((u) => u.id === createdBy)?.name ?? 'Added by'
                  : 'Anyone'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Anyone</SelectItem>
              {uploaders.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* Ownership filters. Available to every role, not just admins: knowing
            who owns a door is how a crew avoids knocking it twice. "Unassigned"
            is the operationally important option — it is the only way to find
            leads nobody is working. */}
        {isAdmin && uploaders.length > 0 && (
          <>
            <Select
              value={assignedSetter || 'all'}
              onValueChange={(v) => updateFilter('assigned_setter', v === 'all' ? '' : v ?? '')}
            >
              <SelectTrigger className="sm:w-[170px]" aria-label="Setter">
                <SelectValue>
                  {assignedSetter === UNASSIGNED
                    ? 'Setter: unassigned'
                    : assignedSetter
                      ? `Setter: ${uploaders.find((u) => u.id === assignedSetter)?.name ?? '—'}`
                      : 'Any setter'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any setter</SelectItem>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {uploaders.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={assignedCloser || 'all'}
              onValueChange={(v) => updateFilter('assigned_closer', v === 'all' ? '' : v ?? '')}
            >
              <SelectTrigger className="sm:w-[170px]" aria-label="Closer">
                <SelectValue>
                  {assignedCloser === UNASSIGNED
                    ? 'Closer: unassigned'
                    : assignedCloser
                      ? `Closer: ${uploaders.find((u) => u.id === assignedCloser)?.name ?? '—'}`
                      : 'Any closer'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any closer</SelectItem>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {uploaders.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <Select value={status} onValueChange={(v) => updateFilter('status', v === 'all' ? '' : v ?? '')}>
          <SelectTrigger className="sm:w-[160px]">
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
          <SelectTrigger className="sm:w-[140px]">
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

      {/* Street filters */}
      <div className={`${filtersOpen ? 'flex' : 'hidden'} sm:flex flex-col sm:flex-row gap-3`}>
        <Input
          placeholder="Street #"
          inputMode="numeric"
          defaultValue={streetNumber}
          onChange={(e) => debouncedFilter('street_number', e.target.value)}
          className="sm:w-28"
        />
        <Select value={streetDir || 'any'} onValueChange={(v) => updateFilter('street_dir', v === 'any' ? '' : v ?? '')}>
          <SelectTrigger className="sm:w-[150px]">
            <SelectValue placeholder="Any direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any direction</SelectItem>
            {STREET_DIRECTIONS.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Street name (e.g. Crescent)"
          defaultValue={streetName}
          onChange={(e) => debouncedFilter('street_name', e.target.value)}
          className="flex-1"
        />
      </div>

      {/* Do Not Call banner */}
      {isAdmin && dncCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm flex-wrap">
          <span className="flex items-center gap-2">
            <PhoneOff className="h-4 w-4 text-destructive" />
            <span>
              <strong>{dncCount}</strong> lead{dncCount !== 1 ? 's' : ''} flagged{' '}
              <span className="font-medium">Do Not Call</span>
            </span>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => updateFilter('is_dnc', dncOnly ? '' : 'true')}>
              {dncOnly ? 'Show all leads' : 'Show only DNC'}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setDncScrubOpen(true)}>
              <PhoneOff className="h-4 w-4 mr-1" />
              Remove phone #s
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
              <TableHead className="hidden md:table-cell">Address</TableHead>
              <TableHead className="hidden md:table-cell">Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Priority</TableHead>
              {showSource && <TableHead className="hidden lg:table-cell">Source</TableHead>}
              {showAddedBy && <TableHead className="hidden lg:table-cell">Added by</TableHead>}
              {showEstValue && <TableHead className="hidden lg:table-cell">Est. Value</TableHead>}
              {showDealValue && <TableHead className="hidden lg:table-cell">Deal Value</TableHead>}
              {/* Always shown, unlike the columns above, which appear only when
                  some row has data. An empty assignment column is the point:
                  "nobody owns this" is the state worth seeing. */}
              <TableHead className="hidden lg:table-cell">Setter</TableHead>
              <TableHead className="hidden lg:table-cell">Closer</TableHead>
              <TableHead className="hidden md:table-cell">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {isAdmin && <TableCell className="w-10"><Skeleton className="h-4 w-4" /></TableCell>}
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell className="hidden sm:table-cell"><Skeleton className="h-5 w-14" /></TableCell>
                  {showSource && <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>}
                  {showAddedBy && <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>}
                  {showEstValue && <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-16" /></TableCell>}
                  {showDealValue && <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-16" /></TableCell>}
                  <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="p-4">
                  <DataErrorState title="Leads did not load" description={error} onRetry={fetchLeads} />
                </TableCell>
              </TableRow>
            ) : leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="p-0">
                  {activeFilterCount > 0 || search ? (
                    <EmptyState
                      icon={Search}
                      title="No leads match your filters"
                      description="Try a different search, or clear the filters to see everything."
                    />
                  ) : (
                    <EmptyState
                      icon={Upload}
                      title="No leads yet"
                      description="Import a list to get started — CSV and Excel both work, and Do Not Call numbers are handled automatically."
                      action={
                        <Link href="/admin/leads/import">
                          <Button size="sm">
                            <Upload className="h-4 w-4 mr-1" />
                            Import leads
                          </Button>
                        </Link>
                      }
                    />
                  )}
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
                        {lead.is_dnc && (
                          <span
                            title="Do Not Call"
                            className="inline-flex items-center rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive leading-none"
                          >
                            DNC
                          </span>
                        )}
                        {lead.enriched_at && <span title="Enriched"><Sparkles className="h-3 w-3 text-status-stale" /></span>}
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
                      {/* Mobile: the row carries everything a rep needs at the door */}
                      <div className="md:hidden mt-1 space-y-1.5">
                        <p className="text-xs text-muted-foreground">
                          {formatAddress(lead) || 'No address'}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {lead.is_dnc ? (
                            <span className="inline-flex h-7 items-center rounded-md border border-destructive/40 px-2 text-xs text-destructive">
                              <PhoneOff className="h-3 w-3 mr-1" />
                              Knock only
                            </span>
                          ) : lead.phone ? (
                            <a
                              href={`tel:${lead.phone}`}
                              className="inline-flex h-7 items-center rounded-md border px-2 text-xs tabular-nums active:bg-accent"
                            >
                              <Phone className="h-3 w-3 mr-1" />
                              {formatPhone(lead.phone)}
                            </a>
                          ) : null}
                          {mapsUrl(lead) && (
                            <a
                              href={mapsUrl(lead)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-7 items-center rounded-md border px-2 text-xs active:bg-accent"
                            >
                              <Navigation className="h-3 w-3 mr-1" />
                              Directions
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">
                    {lead.address_street ? (
                      <span className="text-foreground/90">{lead.address_street}</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {[lead.address_city, lead.address_state].filter(Boolean).join(', ') || '—'}
                      </span>
                    )}
                    {lead.address_street && (lead.address_city || lead.address_state) && (
                      <span className="text-muted-foreground">
                        {' · '}
                        {[lead.address_city, lead.address_state].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm" onClick={(e) => e.stopPropagation()}>
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
                  <TableCell>
                    <LeadStatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <LeadPriorityBadge priority={lead.priority} />
                  </TableCell>
                  {showSource && (
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {(lead.lead_sources as { display_name: string } | undefined)?.display_name || '—'}
                    </TableCell>
                  )}
                  {showAddedBy && (
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
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
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground tabular-nums">
                      {lead.estimated_roof_value != null
                        ? `$${Number(lead.estimated_roof_value).toLocaleString()}`
                        : '—'}
                    </TableCell>
                  )}
                  {showDealValue && (
                    <TableCell className="hidden lg:table-cell text-sm font-medium tabular-nums">
                      {lead.deal_value != null ? `$${Number(lead.deal_value).toLocaleString()}` : '—'}
                    </TableCell>
                  )}
                  {/* Unowned is styled as absence, not as a value: a muted dash
                      scans as a gap so a column of them reads as a problem. */}
                  <TableCell className="hidden lg:table-cell text-sm">
                    {lead.assigned_setter?.name ? (
                      <span className="text-foreground">{assigneeLabel(lead.assigned_setter.name)}</span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">
                    {lead.assigned_closer?.name ? (
                      <span className="text-foreground">{assigneeLabel(lead.assigned_closer.name)}</span>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
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
            size="sm"
            variant="outline"
            onClick={() => { setAssignMode('unassign'); setAssignOpen(true); }}
            disabled={selection.size > LIMITS.BULK_ASSIGN_MAX}
          >
            <UserMinus className="h-4 w-4 mr-1" />
            Unassign
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelection(new Map())}>
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
            filters={{ status, priority, search }}
            selectedStreets={selectedStreets}
            onToggleStreet={toggleStreetFilter}
            onClear={() => updateFilter('streets', '')}
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
                <Button variant="outline" onClick={() => setDncScrubOpen(false)} disabled={dncScrubbing}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleScrubDnc} disabled={dncScrubbing}>
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
                <Button variant="outline" onClick={() => setRecheckOpen(false)} disabled={rechecking}>
                  Cancel
                </Button>
                <Button onClick={handleRecheckDuplicates} disabled={rechecking}>
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
