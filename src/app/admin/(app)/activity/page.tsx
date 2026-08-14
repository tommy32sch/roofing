'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  format,
  formatDistanceToNow,
  isToday,
  isYesterday,
} from 'date-fns';
import {
  ArrowRightLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Edit2,
  Eye,
  FileText,
  Mail,
  MessageSquare,
  PhoneCall,
  Search,
  SlidersHorizontal,
  ScrollText,
  UsersRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatAddressShort } from '@/lib/utils/format';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import { DeletedLeadsPanel } from '@/components/leads/DeletedLeadsPanel';
import { DataErrorState } from '@/components/layout/data-error-state';
import { useAppShell } from '@/components/providers/app-shell-provider';
import { cn } from '@/lib/utils';
import { ReportScopeBar } from '@/components/reporting/report-scope-bar';
import type {
  ReportActorScope,
  ReportMemberOption,
  ReportPeriod,
  ReportScopeSelection,
} from '@/lib/reporting/contracts';
import {
  actorScopeFromParam,
  actorScopeToParam,
  defaultReportActor,
  localReportPeriodBounds,
  parseReportScopeUrl,
  reportScopeForDevice,
  reportScopeKey,
  serializeReportScope,
} from '@/lib/reporting/scope';

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  note: MessageSquare,
  call: PhoneCall,
  email: Mail,
  visit: Eye,
  status_change: ArrowRightLeft,
  created: FileText,
  updated: Edit2,
  bulk_assignment: UsersRound,
};

const ACTIVITY_LABELS: Record<string, string> = {
  note: 'Note',
  call: 'Call logged',
  email: 'Email logged',
  visit: 'Visit logged',
  status_change: 'Status changed',
  created: 'Lead created',
  updated: 'Lead updated',
  bulk_assignment: 'Bulk assignment',
};

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  appointment_set: 'Appt Set',
  inspected: 'Inspected',
  proposal_sent: 'Proposal',
  sold: 'Sold',
  lost: 'Lost',
};

interface AuditLead {
  id: string;
  first_name: string;
  last_name: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  market_id?: number | null;
}

interface AuditOperation {
  id: string;
  operation_type: string;
  affected_count: number;
  market_id: number | null;
  metadata: {
    assignment_role?: string;
    mode?: string;
  };
}

interface AuditItem {
  item_kind: 'activity' | 'operation';
  item_id: string;
  activity_type: string;
  content: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string;
  actor_name: string | null;
  lead: AuditLead | null;
  operation: AuditOperation | null;
}

interface OperationDetail {
  activity_id: string;
  content: string | null;
  lead: AuditLead;
}

interface MobileFilters {
  market: string;
  type: string;
  actor: string;
  period: ReportPeriod;
  from: string;
  to: string;
}

const AUDIT_DEFAULT_PERIOD: Exclude<ReportPeriod, 'custom'> = 'year';
const CUSTOM_RANGE_MAX_MS = 366 * 24 * 3_600_000;

function dateInputToInstant(value: string, endExclusive = false): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null;
  }
  if (endExclusive) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function customRangeFromDates(
  fromDate: string,
  toDate: string
): Pick<ReportScopeSelection, 'period' | 'from' | 'to'> | null {
  let from = dateInputToInstant(fromDate);
  let to = dateInputToInstant(toDate, true);
  if (!from || !to) return null;
  if (Date.parse(to) <= Date.parse(from)) {
    from = dateInputToInstant(toDate);
    to = dateInputToInstant(fromDate, true);
  }
  if (!from || !to || Date.parse(to) <= Date.parse(from)) return null;
  if (Date.parse(to) - Date.parse(from) > CUSTOM_RANGE_MAX_MS) {
    to = new Date(Date.parse(from) + CUSTOM_RANGE_MAX_MS).toISOString();
  }
  return { period: 'custom', from, to };
}

function actorFromFilterParam(value: string): ReportActorScope | null {
  if (!value) return null;
  if (value === 'all' || value === 'mine' || value.startsWith('member:')) {
    return actorScopeFromParam(value);
  }
  return actorScopeFromParam(`member:${value}`);
}

function dateGroupLabel(value: string): string {
  const date = new Date(value);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, MMMM d');
}

function ActivityPageFallback() {
  return (
    <div className="space-y-4">
      <PageHeader title="Audit Log" description="Loading company activity…" />
      <div className="space-y-2">
        {[...Array(8)].map((_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={<ActivityPageFallback />}>
      <ActivityPageContent />
    </Suspense>
  );
}

function ActivityPageContent() {
  const { permissions, user } = useAppShell();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const { markets, homeMarketId } = useMarkets();
  const fetchControllerRef = useRef<AbortController | null>(null);
  const [deviceAnchor] = useState(() => new Date());

  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [activityUsers, setActivityUsers] = useState<ReportMemberOption[]>([]);
  const [searchDraft, setSearchDraft] = useState(searchParams.get('q') || '');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [mobileFilters, setMobileFilters] = useState<MobileFilters>({
    market: '',
    type: '',
    actor: 'all',
    period: AUDIT_DEFAULT_PERIOD,
    from: '',
    to: '',
  });
  const [expandedOperation, setExpandedOperation] = useState<string | null>(null);
  const [operationDetails, setOperationDetails] = useState<Record<string, OperationDetail[]>>({});
  const [operationErrors, setOperationErrors] = useState<Record<string, string>>({});
  const [operationLoading, setOperationLoading] = useState<string | null>(null);

  const requestedPage = Number(searchParams.get('page') || '1');
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const typeFilter = searchParams.get('type') || '';
  const query = searchParams.get('q') || '';
  const scope = useMemo(
    () => reportScopeForDevice(
      parseReportScopeUrl(new URLSearchParams(searchParamsString)),
      {
        role: user.role,
        homeMarketId: null,
        now: deviceAnchor,
        defaultPeriod: AUDIT_DEFAULT_PERIOD,
      }
    ),
    [deviceAnchor, searchParamsString, user.role]
  );
  const scopeKey = reportScopeKey(scope);
  const actorFilter = actorScopeToParam(scope.actor);
  const marketValue = scope.marketId == null ? ALL_MARKETS : String(scope.marketId);
  const fromDate = format(new Date(scope.from), 'yyyy-MM-dd');
  const toDate = format(new Date(Date.parse(scope.to) - 1), 'yyyy-MM-dd');
  const limit = 50;

  const replaceParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParamsString);
    Object.entries(patch).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    if (!Object.prototype.hasOwnProperty.call(patch, 'page')) next.delete('page');
    const nextQuery = next.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, router, searchParamsString]);

  const navigateScope = useCallback((nextScope: ReportScopeSelection) => {
    const next = new URLSearchParams(searchParamsString);
    for (const [key, value] of serializeReportScope(nextScope)) next.set(key, value);
    next.delete('user_id');
    next.delete('page');
    router.push(`${pathname}?${next}`, { scroll: false });
  }, [pathname, router, searchParamsString]);

  useEffect(() => {
    const canonical = new URLSearchParams(searchParamsString);
    for (const [key, value] of serializeReportScope(scope)) canonical.set(key, value);
    canonical.delete('user_id');
    const canonicalString = canonical.toString();
    if (canonicalString !== searchParamsString) {
      router.replace(`${pathname}?${canonicalString}`, { scroll: false });
    }
  }, [pathname, router, scope, scopeKey, searchParamsString]);

  useEffect(() => {
    setSearchDraft(query);
  }, [query]);

  useEffect(() => {
    setExpandedOperation(null);
    setOperationDetails({});
    setOperationErrors({});
  }, [scope.marketId]);

  useEffect(() => {
    if (!permissions.canViewTeamData) return;
    fetch('/api/admin/users')
      .then((response) => response.json())
      .then((data) => {
        if (data.success) setActivityUsers(data.users);
      })
      .catch(() => {});
  }, [permissions.canViewTeamData]);

  const fetchItems = useCallback(async () => {
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams(scopeKey);
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (typeFilter) params.set('type', typeFilter);
      if (query) params.set('q', query);

      const response = await fetch(`/api/admin/activity?${params}`, {
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Could not load the audit log');
      }
      setItems(data.items);
      setTotal(data.total);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Could not load the audit log');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [page, query, scopeKey, typeFilter]);

  useEffect(() => {
    fetchItems();
    return () => fetchControllerRef.current?.abort();
  }, [fetchItems]);

  const groupedItems = useMemo(() => {
    const groups: { label: string; items: AuditItem[] }[] = [];
    for (const item of items) {
      const label = dateGroupLabel(item.created_at);
      const current = groups.at(-1);
      if (current?.label === label) current.items.push(item);
      else groups.push({ label, items: [item] });
    }
    return groups;
  }, [items]);

  const totalPages = Math.ceil(total / limit);
  const defaultActor = actorScopeToParam(defaultReportActor(user.role));
  const narrowedPeriod = scope.period !== AUDIT_DEFAULT_PERIOD && scope.period !== 'custom'
    ? scope.period
    : '';
  const activeFilterCount = [
    typeFilter,
    scope.period === 'custom' ? 'custom' : narrowedPeriod,
    scope.marketId != null ? marketValue : '',
    actorFilter !== defaultActor ? actorFilter : '',
  ].filter(Boolean).length;

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    replaceParams({ q: searchDraft.trim() || null });
  }

  function openMobileFilters() {
    setMobileFilters({
      market: marketValue,
      type: typeFilter,
      actor: actorFilter,
      period: scope.period,
      from: fromDate,
      to: toDate,
    });
    setMobileFiltersOpen(true);
  }

  function applyDateRange(nextFromDate: string, nextToDate: string) {
    const range = customRangeFromDates(nextFromDate, nextToDate);
    if (!range) return;
    navigateScope({
      ...scope,
      ...range,
    });
  }

  function applyMobileFilters() {
    const marketId = !mobileFilters.market || mobileFilters.market === ALL_MARKETS
      ? null
      : Number(mobileFilters.market);
    const actor = actorFromFilterParam(mobileFilters.actor) ?? defaultReportActor(user.role);
    const namedPeriod = mobileFilters.period === 'custom'
      ? AUDIT_DEFAULT_PERIOD
      : mobileFilters.period;
    const named = localReportPeriodBounds(namedPeriod, deviceAnchor);
    const namedFrom = format(new Date(named.from), 'yyyy-MM-dd');
    const namedTo = format(new Date(Date.parse(named.to) - 1), 'yyyy-MM-dd');
    const datesChanged = Boolean(
      mobileFilters.from &&
      mobileFilters.to &&
      (mobileFilters.from !== namedFrom || mobileFilters.to !== namedTo)
    );
    const periodPart = datesChanged
      ? {
          ...(customRangeFromDates(mobileFilters.from, mobileFilters.to) ?? named),
          localDate: scope.localDate,
        }
      : named;
    navigateScope({
      ...periodPart,
      marketId: Number.isInteger(marketId) && marketId! > 0 ? marketId : null,
      actor,
    });
    replaceParams({ type: mobileFilters.type || null });
    setMobileFiltersOpen(false);
  }

  function clearFilters() {
    const defaults = localReportPeriodBounds(AUDIT_DEFAULT_PERIOD, deviceAnchor);
    navigateScope({
      ...defaults,
      marketId: null,
      actor: defaultReportActor(user.role),
    });
    replaceParams({ type: null, q: null, page: null });
    setSearchDraft('');
    setMobileFilters({
      market: '',
      type: '',
      actor: 'all',
      period: AUDIT_DEFAULT_PERIOD,
      from: '',
      to: '',
    });
  }

  async function toggleOperation(operationId: string, reload = false) {
    if (expandedOperation === operationId && !reload) {
      setExpandedOperation(null);
      return;
    }
    setExpandedOperation(operationId);
    if (!reload && (operationDetails[operationId] || operationLoading === operationId)) return;

    setOperationLoading(operationId);
    setOperationErrors((current) => ({ ...current, [operationId]: '' }));
    try {
      const params = new URLSearchParams();
      if (scope.marketId != null) params.set('market_id', String(scope.marketId));
      const suffix = params.size ? `?${params}` : '';
      const response = await fetch(`/api/admin/activity/${operationId}${suffix}`);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Could not load operation details');
      }
      setOperationDetails((current) => ({ ...current, [operationId]: data.items }));
    } catch (cause) {
      setOperationErrors((current) => ({
        ...current,
        [operationId]: cause instanceof Error ? cause.message : 'Could not load operation details',
      }));
    } finally {
      setOperationLoading(null);
    }
  }

  const selectedMarketName = marketValue === ALL_MARKETS
    ? 'all offices'
    : markets.find((market) => String(market.id) === marketValue)?.name || 'this office';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Log"
        description={
          loading
            ? 'Loading company activity…'
            : `${total.toLocaleString()} recorded ${total === 1 ? 'event' : 'events'} in ${selectedMarketName}`
        }
      />

      {permissions.canDeleteLeads && <DeletedLeadsPanel />}

      <ReportScopeBar
        scope={scope}
        role={user.role}
        userName={user.name}
        markets={markets}
        members={activityUsers}
        onPeriodChange={(period) => navigateScope({
          ...scope,
          ...localReportPeriodBounds(period, deviceAnchor),
        })}
        onMarketChange={(marketId) => navigateScope({ ...scope, marketId })}
        onActorChange={(actor) => navigateScope({ ...scope, actor })}
      />

      <div className="border-y border-border/70 py-3">
        <div className="flex items-center gap-2 md:hidden">
          <form onSubmit={submitSearch} className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search people, leads, or notes"
              className="h-11 pl-9 pr-3"
              aria-label="Search audit log"
            />
          </form>
          <Button
            variant="outline"
            className="relative h-11 shrink-0 px-3"
            onClick={openMobileFilters}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[11px] text-background">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <form onSubmit={submitSearch} className="relative w-[min(24rem,32vw)]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search people, leads, or notes"
              className="h-9 pl-8"
              aria-label="Search audit log"
            />
          </form>
          <Select
            value={typeFilter || 'all'}
            onValueChange={(value) => replaceParams({
              type: value === 'all' ? null : value,
            })}
          >
            <SelectTrigger className="w-[155px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {permissions.canViewTeamData && (
                <SelectItem value="bulk_assignment">Bulk assignment</SelectItem>
              )}
              <SelectItem value="note">Note</SelectItem>
              <SelectItem value="call">Call</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="visit">Visit</SelectItem>
              <SelectItem value="status_change">Status change</SelectItem>
              <SelectItem value="created">Created</SelectItem>
              <SelectItem value="updated">Updated</SelectItem>
            </SelectContent>
          </Select>
          {permissions.canViewTeamData && activityUsers.length > 0 && (
            <Select
              value={scope.actor.kind === 'member' ? scope.actor.memberId : actorFilter}
              onValueChange={(value) => navigateScope({
                ...scope,
                actor: !value || value === 'all'
                  ? { kind: 'all' }
                  : value === 'mine'
                    ? { kind: 'mine' }
                    : { kind: 'member', memberId: value },
              })}
            >
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accounts</SelectItem>
                {activityUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              value={fromDate}
              onChange={(event) => {
                if (event.target.value) applyDateRange(event.target.value, toDate);
              }}
              className="w-[140px]"
              aria-label="Start date"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={toDate}
              onChange={(event) => {
                if (event.target.value) applyDateRange(fromDate, event.target.value);
              }}
              className="w-[140px]"
              aria-label="End date"
            />
          </div>
          {(activeFilterCount > 0 || query) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(9)].map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <DataErrorState
          title="Audit Log did not load"
          description={error}
          onRetry={fetchItems}
        />
      ) : items.length === 0 ? (
        <div className="border-y">
          <EmptyState
            icon={ScrollText}
            title={
              activeFilterCount > 0 || query
                ? 'No events match these filters'
                : 'No events in this range'
            }
            description={
              activeFilterCount > 0 || query
                ? `Nothing matches from ${format(new Date(scope.from), 'MMM d, yyyy')} to ${format(new Date(Date.parse(scope.to) - 1), 'MMM d, yyyy')}. Clear a filter or search for a different lead, person, or note.`
                : `Nothing is recorded from ${format(new Date(scope.from), 'MMM d, yyyy')} to ${format(new Date(Date.parse(scope.to) - 1), 'MMM d, yyyy')}. Calls, notes, visits, assignments, and status changes will appear here.`
            }
            action={
              <Button variant="outline" onClick={clearFilters}>
                {scope.period === AUDIT_DEFAULT_PERIOD && !query && !typeFilter
                  ? 'Reset range'
                  : 'Show this year'}
              </Button>
            }
          />
        </div>
      ) : (
        <div>
          {groupedItems.map((group) => (
            <section key={group.label} aria-labelledby={`date-${group.label}`}>
              <div className="sticky top-0 z-10 border-b bg-background/95 py-2 backdrop-blur">
                <h2
                  id={`date-${group.label}`}
                  className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {group.label}
                </h2>
              </div>
              <div>
                {group.items.map((item) => {
                  const Icon = ACTIVITY_ICONS[item.activity_type] || FileText;
                  const lead = item.lead;
                  const leadName = lead
                    ? `${lead.first_name} ${lead.last_name}`.trim()
                    : '';
                  const location = lead ? formatAddressShort(lead) : '';
                  const operation = item.operation;
                  const expanded = expandedOperation === item.item_id;
                  const detailItems = operationDetails[item.item_id];
                  const assignmentRole = operation?.metadata.assignment_role;
                  const operationLabel = assignmentRole
                    ? `Bulk ${assignmentRole} assignment`
                    : ACTIVITY_LABELS[item.activity_type] || item.activity_type;

                  return (
                    <div
                      key={item.item_id}
                      className="border-b border-border/65 py-3 last:border-b-0"
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                          operation ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                        )}>
                          <Icon className="h-4 w-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-sm font-medium">
                                {operation
                                  ? operationLabel
                                  : ACTIVITY_LABELS[item.activity_type] || item.activity_type}
                              </span>
                              {operation && (
                                <span className="text-xs font-medium text-primary">
                                  {operation.affected_count.toLocaleString()} lead{
                                    operation.affected_count === 1 ? '' : 's'
                                  }
                                </span>
                              )}
                              {item.activity_type === 'status_change' &&
                                item.old_status &&
                                item.new_status && (
                                  <span className="text-xs text-muted-foreground">
                                    {STATUS_LABEL[item.old_status] ?? item.old_status}
                                    {' → '}
                                    {STATUS_LABEL[item.new_status] ?? item.new_status}
                                  </span>
                                )}
                              {lead && (
                                <Link
                                  href={`/admin/leads/${lead.id}`}
                                  className="max-w-full truncate text-xs text-primary hover:underline"
                                >
                                  {leadName}{location ? ` · ${location}` : ''}
                                </Link>
                              )}
                            </div>
                            <time
                              dateTime={item.created_at}
                              title={format(new Date(item.created_at), 'PPPP p')}
                              className="shrink-0 text-xs tabular-nums text-muted-foreground"
                            >
                              {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                              <span className="ml-1.5 text-muted-foreground/70">
                                {format(new Date(item.created_at), 'MMM d, yyyy · h:mm a')}
                              </span>
                            </time>
                          </div>

                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            {item.actor_name && (
                              <span className="text-xs text-muted-foreground">
                                by {item.actor_name}
                              </span>
                            )}
                            {!operation && item.content && (
                              <span className="min-w-0 truncate text-sm text-muted-foreground">
                                {item.content}
                              </span>
                            )}
                            {operation && (
                              <button
                                type="button"
                                onClick={() => toggleOperation(item.item_id)}
                                className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-primary hover:underline"
                                aria-expanded={expanded}
                              >
                                {expanded ? 'Hide receipt' : 'View receipt'}
                                {expanded
                                  ? <ChevronUp className="h-3.5 w-3.5" />
                                  : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            )}
                          </div>

                          {operation && expanded && (
                            <div className="mt-3 border-l-2 border-primary/20 pl-3">
                              {operationLoading === item.item_id ? (
                                <div className="space-y-2 py-1">
                                  <Skeleton className="h-5 w-full" />
                                  <Skeleton className="h-5 w-4/5" />
                                </div>
                              ) : operationErrors[item.item_id] ? (
                                <div className="flex items-center justify-between gap-3 py-1">
                                  <p className="text-xs text-destructive">
                                    {operationErrors[item.item_id]}
                                  </p>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void toggleOperation(item.item_id, true)}
                                  >
                                    Retry
                                  </Button>
                                </div>
                              ) : detailItems?.length ? (
                                <div className="divide-y">
                                  {detailItems.map((detail) => {
                                    const detailName = `${detail.lead.first_name} ${detail.lead.last_name}`.trim();
                                    const detailAddress = formatAddressShort(detail.lead);
                                    return (
                                      <div
                                        key={detail.activity_id}
                                        className="flex items-center justify-between gap-3 py-2"
                                      >
                                        <div className="min-w-0">
                                          <Link
                                            href={`/admin/leads/${detail.lead.id}`}
                                            className="block truncate text-sm font-medium hover:underline"
                                          >
                                            {detailName || 'Unnamed lead'}
                                          </Link>
                                          <p className="truncate text-xs text-muted-foreground">
                                            {detailAddress || detail.content}
                                          </p>
                                        </div>
                                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="py-1 text-xs text-muted-foreground">
                                  No leads in the selected office are attached to this receipt.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => replaceParams({ page: String(page - 1) })}
              disabled={page === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => replaceParams({ page: String(page + 1) })}
              disabled={page === totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filter Audit Log</SheetTitle>
            <SheetDescription>
              Apply all filters together.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Office</label>
              <MarketFilter
                markets={markets}
                value={mobileFilters.market || (
                  homeMarketId != null ? String(homeMarketId) : ALL_MARKETS
                )}
                onChange={(value) => setMobileFilters((current) => ({
                  ...current,
                  market: value === (
                    homeMarketId != null ? String(homeMarketId) : ALL_MARKETS
                  ) ? '' : value,
                }))}
                className="h-11 w-full"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Event</label>
              <Select
                value={mobileFilters.type || 'all'}
                onValueChange={(value) => setMobileFilters((current) => ({
                  ...current,
                  type: !value || value === 'all' ? '' : value,
                }))}
              >
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All events</SelectItem>
                  {permissions.canViewTeamData && (
                    <SelectItem value="bulk_assignment">Bulk assignment</SelectItem>
                  )}
                  <SelectItem value="note">Note</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="visit">Visit</SelectItem>
                  <SelectItem value="status_change">Status change</SelectItem>
                  <SelectItem value="created">Created</SelectItem>
                  <SelectItem value="updated">Updated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {permissions.canViewTeamData && activityUsers.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Account</label>
                <Select
                  value={mobileFilters.actor || 'all'}
                  onValueChange={(value) => setMobileFilters((current) => ({
                    ...current,
                    actor: !value || value === 'all' ? 'all' : value,
                  }))}
                >
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All accounts</SelectItem>
                    {activityUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Start date</label>
                <Input
                  type="date"
                  value={mobileFilters.from}
                  onChange={(event) => setMobileFilters((current) => ({
                    ...current,
                    from: event.target.value,
                  }))}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">End date</label>
                <Input
                  type="date"
                  value={mobileFilters.to}
                  onChange={(event) => setMobileFilters((current) => ({
                    ...current,
                    to: event.target.value,
                  }))}
                  className="h-11"
                />
              </div>
            </div>
          </div>
          <SheetFooter className="sticky bottom-0 border-t bg-background">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-11"
                onClick={() => setMobileFilters({
                  market: '',
                  type: '',
                  actor: 'all',
                  period: AUDIT_DEFAULT_PERIOD,
                  from: '',
                  to: '',
                })}
              >
                Clear
              </Button>
              <Button className="h-11" onClick={applyMobileFilters}>
                Apply filters
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
