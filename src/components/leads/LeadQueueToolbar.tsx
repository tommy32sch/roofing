'use client';

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ArrowUpDown, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { MarketFilter } from '@/components/markets/market-filter';
import { ALL_MARKETS } from '@/components/markets/use-markets';
import { LeadSavedViews } from '@/components/leads/LeadSavedViews';
import { LEAD_PRIORITY_OPTIONS, LEAD_STATUS_OPTIONS, type Market } from '@/types';
import { STREET_DIRECTIONS } from '@/lib/utils/lead-query';
import { UNASSIGNED } from '@/lib/leads/assignment-filter';
import {
  LEAD_QUEUE_FILTER_KEYS,
  LEAD_SORT_OPTIONS,
  clearLeadQueueFilters,
  leadQueueSort,
  patchLeadQueueParams,
  type LeadQueueParamKey,
  type LeadQueueParams,
} from '@/lib/leads/work-queue';

interface LeadQueueToolbarProps {
  params: LeadQueueParams;
  selectedViewId: string;
  markets: Market[];
  homeMarketId: number | null;
  uploaders: { id: string; name: string }[];
  isAdmin: boolean;
  onApply: (params: LeadQueueParams, viewId?: string | null) => void;
  onPatch: (patch: Partial<Record<LeadQueueParamKey, string | undefined>>) => void;
}

function DebouncedQueueInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onChange'> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function commit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    onCommitRef.current(next);
  }

  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(next), 300);
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Enter') commit(draft);
        if (event.key === 'Escape' && draft) {
          setDraft('');
          commit('');
        }
      }}
    />
  );
}

function QueueTextInput({
  deferred,
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, 'value' | 'defaultValue' | 'onChange'> & {
  deferred: boolean;
  value: string;
  onCommit: (value: string) => void;
}) {
  if (deferred) {
    return <DebouncedQueueInput {...props} value={value} onCommit={onCommit} />;
  }

  return (
    <Input
      {...props}
      value={value}
      onChange={(event) => onCommit(event.target.value)}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === 'Escape' && value) onCommit('');
      }}
    />
  );
}

function FilterFields({
  params,
  markets,
  homeMarketId,
  uploaders,
  isAdmin,
  labels,
  deferText,
  onPatch,
}: {
  params: LeadQueueParams;
  markets: Market[];
  homeMarketId: number | null;
  uploaders: { id: string; name: string }[];
  isAdmin: boolean;
  labels: boolean;
  deferText: boolean;
  onPatch: (patch: Partial<Record<LeadQueueParamKey, string | undefined>>) => void;
}) {
  const marketValue = params.market_id
    || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);
  const labelClass = labels ? 'text-xs font-medium text-muted-foreground' : 'sr-only';

  return (
    <>
      {markets.length > 1 && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Market</Label>
          <MarketFilter
            markets={markets}
            value={marketValue}
            className="w-full data-[size=default]:h-11"
            onChange={(value) => onPatch({ market_id: value })}
          />
        </div>
      )}

      {isAdmin && uploaders.length > 0 && (
        <>
          <div className="space-y-1.5">
            <Label className={labelClass}>Added by</Label>
            <Select
              value={params.created_by || 'all'}
              onValueChange={(value) => onPatch({ created_by: value === 'all' ? undefined : value ?? undefined })}
            >
              <SelectTrigger className="w-full data-[size=default]:h-11" aria-label="Added by">
                <SelectValue>
                  {params.created_by
                    ? uploaders.find((user) => user.id === params.created_by)?.name ?? 'Added by'
                    : 'Anyone'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="min-h-11">Anyone</SelectItem>
                {uploaders.map((user) => <SelectItem key={user.id} value={user.id} className="min-h-11">{user.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className={labelClass}>Setter</Label>
            <Select
              value={params.assigned_setter || 'all'}
              onValueChange={(value) => onPatch({ assigned_setter: value === 'all' ? undefined : value ?? undefined })}
            >
              <SelectTrigger className="w-full data-[size=default]:h-11" aria-label="Setter">
                <SelectValue>
                  {params.assigned_setter === UNASSIGNED
                    ? 'Setter: unassigned'
                    : params.assigned_setter
                      ? `Setter: ${uploaders.find((user) => user.id === params.assigned_setter)?.name ?? '—'}`
                      : 'Any setter'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="min-h-11">Any setter</SelectItem>
                <SelectItem value={UNASSIGNED} className="min-h-11">Unassigned</SelectItem>
                {uploaders.map((user) => <SelectItem key={user.id} value={user.id} className="min-h-11">{user.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className={labelClass}>Closer</Label>
            <Select
              value={params.assigned_closer || 'all'}
              onValueChange={(value) => onPatch({ assigned_closer: value === 'all' ? undefined : value ?? undefined })}
            >
              <SelectTrigger className="w-full data-[size=default]:h-11" aria-label="Closer">
                <SelectValue>
                  {params.assigned_closer === UNASSIGNED
                    ? 'Closer: unassigned'
                    : params.assigned_closer
                      ? `Closer: ${uploaders.find((user) => user.id === params.assigned_closer)?.name ?? '—'}`
                      : 'Any closer'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="min-h-11">Any closer</SelectItem>
                <SelectItem value={UNASSIGNED} className="min-h-11">Unassigned</SelectItem>
                {uploaders.map((user) => <SelectItem key={user.id} value={user.id} className="min-h-11">{user.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label className={labelClass}>Status</Label>
        <Select
          value={params.status || 'all'}
          onValueChange={(value) => onPatch({ status: value === 'all' ? undefined : value ?? undefined })}
        >
          <SelectTrigger className="w-full data-[size=default]:h-11" aria-label="Status">
            <SelectValue>
              {params.status
                ? LEAD_STATUS_OPTIONS.find((option) => option.value === params.status)?.label ?? params.status
                : 'All statuses'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="min-h-11">All statuses</SelectItem>
            {LEAD_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="min-h-11">{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className={labelClass}>Priority</Label>
        <Select
          value={params.priority || 'all'}
          onValueChange={(value) => onPatch({ priority: value === 'all' ? undefined : value ?? undefined })}
        >
          <SelectTrigger className="w-full data-[size=default]:h-11" aria-label="Priority">
            <SelectValue>
              {params.priority
                ? LEAD_PRIORITY_OPTIONS.find((option) => option.value === params.priority)?.label ?? params.priority
                : 'All priorities'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="min-h-11">All priorities</SelectItem>
            {LEAD_PRIORITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="min-h-11">{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className={labelClass} htmlFor={labels ? 'mobile-street-number' : 'desktop-street-number'}>Street number</Label>
        <QueueTextInput
          key={params.street_number ?? ''}
          deferred={deferText}
          id={labels ? 'mobile-street-number' : 'desktop-street-number'}
          value={params.street_number ?? ''}
          inputMode="numeric"
          placeholder="Street #"
          className="h-11"
          onCommit={(value) => onPatch({ street_number: value || undefined })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className={labelClass}>Direction</Label>
        <Select
          value={params.street_dir || 'any'}
          onValueChange={(value) => onPatch({ street_dir: value === 'any' ? undefined : value ?? undefined })}
        >
          <SelectTrigger className="w-full data-[size=default]:h-11" aria-label="Street direction">
            <SelectValue>{params.street_dir || 'Any direction'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any" className="min-h-11">Any direction</SelectItem>
            {STREET_DIRECTIONS.map((direction) => (
              <SelectItem key={direction} value={direction} className="min-h-11">{direction}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label className={labelClass} htmlFor={labels ? 'mobile-street-name' : 'desktop-street-name'}>Street name</Label>
        <QueueTextInput
          key={params.street_name ?? ''}
          deferred={deferText}
          id={labels ? 'mobile-street-name' : 'desktop-street-name'}
          value={params.street_name ?? ''}
          placeholder="Street name"
          className="h-11"
          onCommit={(value) => onPatch({ street_name: value || undefined })}
        />
      </div>
    </>
  );
}

function chipLabels(
  params: LeadQueueParams,
  markets: Market[],
  uploaders: { id: string; name: string }[]
): { key: LeadQueueParamKey; label: string }[] {
  const labels: Partial<Record<LeadQueueParamKey, string>> = {
    search: params.search ? `Search: ${params.search}` : undefined,
    market_id: params.market_id
      ? `Market: ${params.market_id === ALL_MARKETS
        ? 'All markets'
        : markets.find((market) => String(market.id) === params.market_id)?.name ?? 'Unavailable'}`
      : undefined,
    status: params.status
      ? `Status: ${LEAD_STATUS_OPTIONS.find((option) => option.value === params.status)?.label ?? params.status}`
      : undefined,
    priority: params.priority
      ? `Priority: ${LEAD_PRIORITY_OPTIONS.find((option) => option.value === params.priority)?.label ?? params.priority}`
      : undefined,
    created_by: params.created_by
      ? `Added by: ${uploaders.find((user) => user.id === params.created_by)?.name ?? 'Unavailable'}`
      : undefined,
    assigned_setter: params.assigned_setter
      ? `Setter: ${params.assigned_setter === UNASSIGNED
        ? 'Unassigned'
        : uploaders.find((user) => user.id === params.assigned_setter)?.name ?? 'Unavailable'}`
      : undefined,
    assigned_closer: params.assigned_closer
      ? `Closer: ${params.assigned_closer === UNASSIGNED
        ? 'Unassigned'
        : uploaders.find((user) => user.id === params.assigned_closer)?.name ?? 'Unavailable'}`
      : undefined,
    is_dnc: params.is_dnc === 'true' ? 'Do Not Call' : undefined,
    street_number: params.street_number ? `Street #: ${params.street_number}` : undefined,
    street_dir: params.street_dir ? `Direction: ${params.street_dir}` : undefined,
    street_name: params.street_name ? `Street: ${params.street_name}` : undefined,
    streets: params.streets
      ? `${params.streets.split('|').filter(Boolean).length} selected streets`
      : undefined,
  };

  return LEAD_QUEUE_FILTER_KEYS.flatMap((key) => labels[key] ? [{ key, label: labels[key]! }] : []);
}

export function LeadQueueToolbar({
  params,
  selectedViewId,
  markets,
  homeMarketId,
  uploaders,
  isAdmin,
  onApply,
  onPatch,
}: LeadQueueToolbarProps) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [desktopFiltersOpen, setDesktopFiltersOpen] = useState(false);
  const [mobileDraft, setMobileDraft] = useState<LeadQueueParams>(params);
  const activeChips = chipLabels(params, markets, uploaders);
  const sort = leadQueueSort(params);
  const sortValue = `${sort.sort}:${sort.order}`;
  const sortLabel = LEAD_SORT_OPTIONS.find((option) => option.value === sortValue)?.label ?? 'Custom sort';

  function openMobileFilters(open: boolean) {
    if (open) setMobileDraft(params);
    setMobileFiltersOpen(open);
  }

  const activePreset = params.is_dnc === 'true'
    ? 'dnc'
    : params.status === 'new'
      ? 'new'
      : params.status === 'appointment_set'
        ? 'appointments'
        : params.status === 'sold'
          ? 'sold'
          : sort.sort === 'follow_up_date' && sort.order === 'asc' && !params.status
            ? 'follow-ups'
            : !params.status
              ? 'all'
              : null;

  function selectPreset(preset: 'all' | 'new' | 'follow-ups' | 'appointments' | 'sold' | 'dnc') {
    if (preset === 'follow-ups') {
      onPatch({ status: undefined, is_dnc: undefined, sort: 'follow_up_date', order: 'asc' });
      return;
    }

    const status = preset === 'new'
      ? 'new'
      : preset === 'appointments'
        ? 'appointment_set'
        : preset === 'sold'
          ? 'sold'
          : undefined;
    const leavingFollowUpOrder = sort.sort === 'follow_up_date';
    const patch: Partial<Record<LeadQueueParamKey, string | undefined>> = {
      status,
      is_dnc: preset === 'dnc' ? 'true' : undefined,
    };
    if (leavingFollowUpOrder) {
      patch.sort = 'created_at';
      patch.order = 'desc';
    }
    onPatch(patch);
  }

  const presets = [
    { id: 'all', label: 'All leads' },
    { id: 'new', label: 'New' },
    { id: 'follow-ups', label: 'Follow-up order' },
    { id: 'appointments', label: 'Appointments' },
    { id: 'sold', label: 'Sold' },
    { id: 'dnc', label: 'DNC' },
  ] as const;

  return (
    <section className="space-y-4 border-y py-4" aria-label="Lead work queue controls">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-full sm:min-w-[18rem] sm:basis-auto">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <DebouncedQueueInput
            key={params.search ?? ''}
            value={params.search ?? ''}
            aria-label="Search leads"
            placeholder="Find a homeowner, address, phone, or email"
            className="h-11 rounded-none border-0 border-b bg-transparent pl-9 shadow-none focus-visible:ring-0"
            onCommit={(value) => onPatch({ search: value || undefined })}
          />
        </div>

        <LeadSavedViews
          currentParams={params}
          selectedViewId={selectedViewId}
          onApply={onApply}
        />

        <Select
          value={sortValue}
          onValueChange={(value) => {
            const option = LEAD_SORT_OPTIONS.find((item) => item.value === value);
            if (option) onPatch({ sort: option.sort, order: option.order });
          }}
        >
          <SelectTrigger className="w-[180px] rounded-none border-0 border-b bg-transparent px-0 shadow-none data-[size=default]:h-11" aria-label="Sort leads">
            <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue>{sortLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LEAD_SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="min-h-11">{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={activeChips.length > 0 ? 'secondary' : 'outline'}
          className="h-11 sm:hidden"
          aria-haspopup="dialog"
          onClick={() => openMobileFilters(true)}
        >
          <SlidersHorizontal />
          Filters{activeChips.length > 0 ? ` (${activeChips.length})` : ''}
        </Button>

        <Button
          variant={desktopFiltersOpen ? 'secondary' : 'outline'}
          className="hidden h-11 sm:inline-flex"
          aria-expanded={desktopFiltersOpen}
          aria-controls="desktop-lead-filters"
          onClick={() => setDesktopFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal />
          Filters{activeChips.length > 0 ? ` (${activeChips.length})` : ''}
          <ChevronDown className={`transition-transform ${desktopFiltersOpen ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      <div
        className="flex min-w-0 items-center gap-1 overflow-x-auto border-b"
        role="group"
        aria-label="Lead queue presets"
      >
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={activePreset === preset.id}
            onClick={() => selectPreset(preset.id)}
            className={`relative h-11 shrink-0 px-3 text-xs font-semibold transition-colors after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 ${
              activePreset === preset.id
                ? 'text-foreground after:bg-primary'
                : 'text-muted-foreground after:bg-transparent hover:text-foreground'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {desktopFiltersOpen && (
        <div
          id="desktop-lead-filters"
          className="hidden gap-3 border-t pt-4 sm:grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6"
        >
          <FilterFields
            params={params}
            markets={markets}
            homeMarketId={homeMarketId}
            uploaders={uploaders}
            isAdmin={isAdmin}
            labels
            deferText
            onPatch={onPatch}
          />
        </div>
      )}

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="inline-flex min-h-11 items-center gap-1 border border-border/80 bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label={`Remove ${chip.label} filter`}
              onClick={() => onPatch({ [chip.key]: undefined })}
            >
              {chip.label}
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
          <Button
            variant="ghost"
            className="h-11"
            onClick={() => onApply(clearLeadQueueFilters(params), null)}
          >
            Clear all
          </Button>
        </div>
      )}

      <Sheet open={mobileFiltersOpen} onOpenChange={openMobileFilters}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] overflow-y-auto rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>Filter leads</SheetTitle>
            <SheetDescription>Set all filters, then apply them together.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-3 px-4">
            <FilterFields
              params={mobileDraft}
              markets={markets}
              homeMarketId={homeMarketId}
              uploaders={uploaders}
              isAdmin={isAdmin}
              labels
              deferText={false}
              onPatch={(patch) => setMobileDraft((current) => patchLeadQueueParams(current, patch))}
            />
          </div>
          <SheetFooter className="sticky bottom-0 border-t bg-background">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setMobileDraft(clearLeadQueueFilters(mobileDraft))}
            >
              Clear filters
            </Button>
            <Button
              className="h-11"
              onClick={() => {
                onApply(mobileDraft, null);
                setMobileFiltersOpen(false);
              }}
            >
              Apply filters
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
