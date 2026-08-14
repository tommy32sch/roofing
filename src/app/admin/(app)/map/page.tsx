'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BoxSelect,
  Filter,
  HousePlus,
  Layers3,
  ListFilter,
  LocateFixed,
  Map as MapIcon,
  MapPinned,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Undo2,
  UserCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { knockLabel } from '@/lib/leads/knocks';
import { callLabel } from '@/lib/leads/calls';
import { applyQueuedKnocks } from '@/lib/leads/knock-sync';
import { applyQueuedCalls } from '@/lib/leads/call-sync';
import { localDayBounds } from '@/lib/leads/today';
import {
  isColdCallResultEntry,
  isKnockResultEntry,
  useLeadResultOutbox,
} from '@/lib/offline/useLeadResultOutbox';
import type { Map as LeafletMap } from 'leaflet';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { BulkAssignDialog } from '@/components/leads/BulkAssignDialog';
import {
  toggleStormType, countStormsByType,
  type GeoLead, type StormReport, type StormType,
} from '@/components/leads/map-constants';
import type { Territory } from '@/types';
import { LIMITS } from '@/lib/utils/validation';
import { leadsAfterRemovingArea, totalLeadsInAreas, newLeadsFromArea, type LassoArea } from '@/lib/leads/lasso-areas';
import { pointInPolygon } from '@/lib/leads/geo-polygon';
import { mapDrawAvailability, type MapDrawPurpose } from '@/lib/leads/map-drawing';
import { AddHouseSheet } from '@/components/leads/AddHouseSheet';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import {
  MapFiltersPanel,
  MapLayersPanel,
  MapLegendPanel,
} from '@/components/leads/MapWorkspaceControls';
import { TerritoryDialog } from '@/components/territories/TerritoryDialog';
import { TerritoryExecutionPanel } from '@/components/territories/TerritoryExecutionPanel';
import { TerritorySheet } from '@/components/territories/TerritorySheet';
import {
  canExecuteTerritories,
  type TerritoryExecutionSummary,
} from '@/lib/territories/execution';
import { useTerritoryExecution } from '@/lib/territories/use-territory-execution';
import {
  LeadResultSheet,
  type LeadResultChannel,
  type LeadResultSelection,
} from '@/components/leads/LeadResultSheet';
import { AppointmentModal } from '@/components/leads/AppointmentModal';
import { WonLeadModal } from '@/components/leads/WonLeadModal';
import { useAppShell } from '@/components/providers/app-shell-provider';

// Leaflet touches `window` at import time — client-only
const LeadMap = dynamic(() => import('@/components/leads/LeadMap'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-md" />,
});

export default function MapPage() {
  const { user } = useAppShell();
  const [leads, setLeads] = useState<GeoLead[]>([]);
  const [missingCoords, setMissingCoords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [leadError, setLeadError] = useState('');
  // Only the FIRST load shows a skeleton. Keying it on "loading && no leads"
  // tore the map down whenever you came back from an empty market, remounting
  // Leaflet from scratch — which both flashed and re-ran the initial view logic
  // against a container that hadn't been laid out yet.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();
  // '' means "not chosen yet" — fall back to the rep's own office once loaded.
  const [market, setMarket] = useState('');
  const marketValue = market || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);
  // The office the map should sit over when there are no leads to fit to.
  // "All Markets" has no single home, so the view is left alone.
  const selectedMarket = marketValue === ALL_MARKETS
    ? null
    : markets.find((m) => String(m.id) === marketValue) ?? null;
  const marketCenter = selectedMarket?.center_lat != null && selectedMarket?.center_lng != null
    ? { lat: selectedMarket.center_lat, lng: selectedMarket.center_lng, zoom: selectedMarket.center_zoom }
    : null;
  const userRole = user.role;
  const currentUserId = user.id;
  const [resultTarget, setResultTarget] = useState<{
    lead: GeoLead;
    channel: LeadResultChannel;
  } | null>(null);
  const [savingResult, setSavingResult] = useState(false);
  const [appointmentLeadId, setAppointmentLeadId] = useState<string | null>(null);
  const [wonLeadId, setWonLeadId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  // Mirror of the selection for reading inside event handlers. A setState
  // updater runs AFTER the handler returns, so counting new leads inside the
  // updater and reporting the total afterwards always reported zero — and
  // StrictMode double-invokes updaters, which would double any count kept
  // there. Read from the ref, write through setState.
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeStatus, setGeocodeStatus] = useState('');

  const [desktopPanel, setDesktopPanel] = useState<'filters' | 'layers' | 'legend' | null>(null);
  // Wind and hail are independent overlays and can both be on: a roof with both
  // hail bruising and wind-lifted shingles is the strongest claim, and that only
  // shows up where the two layers overlap.
  const [stormTypes, setStormTypes] = useState<StormType[]>([]);
  const [stormDays, setStormDays] = useState(30);
  // Thresholds are per type because the units differ (inches vs mph); one shared
  // number could not mean both.
  const [hailMin, setHailMin] = useState(0);
  const [windMin, setWindMin] = useState(0);
  const [stormReports, setStormReports] = useState<StormReport[]>([]);
  const stormOn = stormTypes.length > 0;
  // Stamped when the reports land, so marker ages are relative to the data
  // rather than to an impure clock read during render.
  const [stormFetchedAt, setStormFetchedAt] = useState(0);
  // Swath view: the "where should we canvass" read, as opposed to the
  // per-report detail the markers give.
  const [stormZones, setStormZones] = useState(false);
  const stormCounts = countStormsByType(stormReports);
  const [stormLoading, setStormLoading] = useState(false);
  const [alertFocus, setAlertFocus] = useState<{
    key: string;
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  // Add-house mode. Exclusive with drawing: both want the next tap on the map,
  // and a rep who thinks they are lassoing while placing a pin gets neither.
  const [addingHouse, setAddingHouse] = useState(false);
  const [pendingHouse, setPendingHouse] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapToolsOpen, setMapToolsOpen] = useState(false);
  const [mobileToolPanel, setMobileToolPanel] = useState<'filters' | 'layers' | 'legend'>('filters');
  /**
   * Tracks the mobile workspace breakpoint, so only one set of Select controls
   * is mounted after hydration. This prevents duplicate Base UI control IDs and
   * uses the same breakpoint as the desktop command docks.
   */
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)');
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (isNarrow) {
      setDesktopPanel(null);
    } else {
      setMapToolsOpen(false);
    }
  }, [isNarrow]);
  const [drawing, setDrawing] = useState(false);
  const [drawPurpose, setDrawPurpose] = useState<MapDrawPurpose | null>(null);
  // Areas committed during this draw session. Kept so several loops are
  // reviewable on the map and any one of them can be undone.
  const [lassoAreas, setLassoAreas] = useState<LassoArea[]>([]);
  // Mirror for reading inside event handlers: a setState updater runs after the
  // handler returns, so counting against state there reports stale numbers.
  const areasRef = useRef<LassoArea[]>([]);
  useEffect(() => {
    areasRef.current = lassoAreas;
  }, [lassoAreas]);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [territoriesLoading, setTerritoriesLoading] = useState(false);
  const [territoryProgress, setTerritoryProgress] = useState<
    Record<string, TerritoryExecutionSummary>
  >({});
  const [territoryProgressLoading, setTerritoryProgressLoading] = useState(false);
  const [territorySheetOpen, setTerritorySheetOpen] = useState(false);
  const [territoryDialogOpen, setTerritoryDialogOpen] = useState(false);
  const [editingTerritory, setEditingTerritory] = useState<Territory | null>(null);
  const [editingBoundary, setEditingBoundary] = useState(false);
  const [showArchivedTerritories, setShowArchivedTerritories] = useState(false);
  const [territoryArchivePendingId, setTerritoryArchivePendingId] = useState<string | null>(null);
  const [restoreConflict, setRestoreConflict] = useState<{
    territory: Territory;
    conflicts: { id: string; name: string; owner_name: string | null }[];
  } | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const territoryFetchIdRef = useRef(0);
  const territoryProgressFetchIdRef = useRef(0);
  const territoryArchivePendingRef = useRef(false);
  const executionRefreshRef = useRef<() => void>(() => undefined);
  const territoryProgressRefreshRef = useRef<() => void>(() => undefined);
  const browseMapStateRef = useRef<{
    market: string;
    status: string;
    priority: string;
    stormTypes: StormType[];
  } | null>(null);
  const currentMapStateRef = useRef({ market, status, priority, stormTypes });
  currentMapStateRef.current = { market, status, priority, stormTypes };
  const isAdmin = userRole === 'admin';

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setLeadError('');
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    if (market) params.set('market_id', market);
    try {
      const res = await fetch(`/api/admin/leads/geo?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Could not load map leads');
      }
      setLeads(data.leads);
      setMissingCoords(data.missing_coords);
    } catch (cause) {
      setLeadError(cause instanceof Error ? cause.message : 'Could not load map leads');
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [status, priority, market]);

  const resultOutbox = useLeadResultOutbox({
    ownerId: currentUserId,
    onSettled: () => {
      void fetchLeads();
      executionRefreshRef.current();
      territoryProgressRefreshRef.current();
    },
  });
  const queuedKnocks = useMemo(
    () => resultOutbox.entries.filter(isKnockResultEntry),
    [resultOutbox.entries]
  );
  const queuedCalls = useMemo(
    () => resultOutbox.entries.filter(isColdCallResultEntry),
    [resultOutbox.entries]
  );
  const effectiveLeads = useMemo(
    () => applyQueuedCalls(applyQueuedKnocks(leads, queuedKnocks), queuedCalls),
    [leads, queuedCalls, queuedKnocks]
  );
  const territoryExecutionAllowed = canExecuteTerritories(userRole);
  const execution = useTerritoryExecution({
    enabled: territoryExecutionAllowed,
    queuedKnocks,
    queuedCalls,
    repId: currentUserId,
  });
  const refreshTerritoryExecution = execution.refresh;

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const alertMarket = params.get('market_id');
    const alertStorm = params.get('storm');
    const alertDays = Number(params.get('days'));
    const alertLatParam = params.get('lat');
    const alertLngParam = params.get('lng');
    const alertLat = Number(alertLatParam);
    const alertLng = Number(alertLngParam);
    if (alertMarket && (alertMarket === ALL_MARKETS || /^\d+$/.test(alertMarket))) {
      setMarket(alertMarket);
    }
    if (alertStorm === 'hail' || alertStorm === 'wind') {
      setStormTypes([alertStorm]);
    }
    if (Number.isInteger(alertDays) && alertDays > 0 && alertDays <= 730) {
      setStormDays(alertDays);
    }
    if (
      alertLatParam !== null &&
      alertLngParam !== null &&
      Number.isFinite(alertLat) &&
      alertLat >= -90 &&
      alertLat <= 90 &&
      Number.isFinite(alertLng) &&
      alertLng >= -180 &&
      alertLng <= 180
    ) {
      setAlertFocus({
        key: params.get('alert_id') ?? `${alertLat}:${alertLng}`,
        lat: alertLat,
        lng: alertLng,
        zoom: 12,
      });
    }
  }, []);

  const fetchTerritories = useCallback(async () => {
    if (marketsLoading) return;
    const requestId = ++territoryFetchIdRef.current;
    setTerritoriesLoading(true);
    setTerritories([]);
    const params = new URLSearchParams({
      market_id: marketValue,
      ...(isAdmin ? { include_archived: 'true' } : {}),
    });
    try {
      const res = await fetch(`/api/admin/territories?${params}`);
      const data = await res.json();
      if (requestId !== territoryFetchIdRef.current) return;
      if (data.success) {
        setTerritories(data.territories ?? []);
      } else {
        toast.error(data.error || 'Failed to load territories');
      }
    } catch {
      if (requestId === territoryFetchIdRef.current) {
        toast.error('Failed to load territories');
      }
    } finally {
      if (requestId === territoryFetchIdRef.current) {
        setTerritoriesLoading(false);
      }
    }
  }, [isAdmin, marketValue, marketsLoading]);

  useEffect(() => {
    fetchTerritories();
  }, [fetchTerritories]);

  const fetchTerritoryProgress = useCallback(async () => {
    const requestId = ++territoryProgressFetchIdRef.current;
    if (marketsLoading || !territoryExecutionAllowed) {
      setTerritoryProgress({});
      setTerritoryProgressLoading(false);
      return;
    }

    setTerritoryProgressLoading(true);
    setTerritoryProgress({});
    try {
      const summaries: TerritoryExecutionSummary[] = [];
      const date = localDayBounds(new Date()).date;
      let page = 1;
      let totalPages = 1;

      while (page <= totalPages) {
        const params = new URLSearchParams({
          date,
          market_id: marketValue,
          page: String(page),
          limit: '100',
        });
        const response = await fetch(`/api/admin/territories/progress?${params}`, {
          cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success || !Array.isArray(body.summaries)) {
          throw new Error(body?.error || 'Failed to load territory progress');
        }
        if (requestId !== territoryProgressFetchIdRef.current) return;

        summaries.push(...(body.summaries as TerritoryExecutionSummary[]));
        totalPages = Math.max(0, Number(body.total_pages) || 0);
        page += 1;
      }

      if (requestId === territoryProgressFetchIdRef.current) {
        setTerritoryProgress(
          Object.fromEntries(summaries.map((summary) => [summary.territory_id, summary]))
        );
      }
    } catch (cause) {
      if (requestId === territoryProgressFetchIdRef.current) {
        toast.error(
          cause instanceof Error ? cause.message : 'Failed to load territory progress'
        );
      }
    } finally {
      if (requestId === territoryProgressFetchIdRef.current) {
        setTerritoryProgressLoading(false);
      }
    }
  }, [marketValue, marketsLoading, territoryExecutionAllowed]);

  useEffect(() => {
    void fetchTerritoryProgress();
  }, [fetchTerritoryProgress]);

  useEffect(() => {
    executionRefreshRef.current = () => void refreshTerritoryExecution();
  }, [refreshTerritoryExecution]);

  useEffect(() => {
    territoryProgressRefreshRef.current = () => void fetchTerritoryProgress();
  }, [fetchTerritoryProgress]);

  useEffect(() => {
    const territory = execution.territory;
    if (!territory) return;

    if (!browseMapStateRef.current) {
      browseMapStateRef.current = currentMapStateRef.current;
    }
    setDrawing(false);
    setDrawPurpose(null);
    setDrawPoints([]);
    setLassoAreas([]);
    setEditingTerritory(null);
    setEditingBoundary(false);
    setTerritoryDialogOpen(false);
    setAddingHouse(false);
    setPendingHouse(null);
    setStatus('');
    setPriority('');
    setStormTypes([]);
    setMarket(String(territory.market_id));
  }, [execution.territory]);

  useEffect(() => {
    if (execution.error) toast.error(execution.error);
  }, [execution.error]);

  async function resumeTerritoryWork(territory: Territory) {
    const loaded = await execution.start(territory.id);
    if (!loaded) setTerritorySheetOpen(true);
  }

  function exitTerritoryWork() {
    const previous = browseMapStateRef.current;
    execution.exit();
    browseMapStateRef.current = null;
    if (!previous) return;
    setMarket(previous.market);
    setStatus(previous.status);
    setPriority(previous.priority);
    setStormTypes(previous.stormTypes);
  }

  const refreshLeadViews = useCallback(() => {
    void fetchLeads();
    void refreshTerritoryExecution();
    void fetchTerritoryProgress();
  }, [fetchLeads, fetchTerritoryProgress, refreshTerritoryExecution]);

  const toggleSelect = useCallback((lead: GeoLead) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.set(lead.id, Number(lead.estimated_roof_value) || 0);
      return next;
    });
  }, []);

  // Which leads are inside the current viewport. Tracked in state (not read on
  // click) so the button can say whether it will select or deselect.
  const recomputeVisible = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    const next = new Set<string>();
    for (const lead of effectiveLeads) {
      if (bounds.contains([lead.latitude, lead.longitude])) next.add(lead.id);
    }
    setVisibleIds(next);
  }, [effectiveLeads]);

  useEffect(() => {
    if (!mapInstance) return;
    recomputeVisible();
    let t: ReturnType<typeof setTimeout>;
    const onMove = () => { clearTimeout(t); t = setTimeout(recomputeVisible, 150); };
    // moveend alone isn't enough: resizing the container (or a zoom that keeps
    // the same centre) changes which leads are in view without firing it, which
    // would leave the button's count and select/deselect state stale.
    const events = 'moveend zoomend resize';
    mapInstance.on(events, onMove);
    return () => { clearTimeout(t); mapInstance.off(events, onMove); };
  }, [mapInstance, recomputeVisible]);

  const allVisibleSelected =
    visibleIds.size > 0 && [...visibleIds].every((id) => selection.has(id));

  /**
   * Toggle the leads currently in view. Deliberately scoped to the viewport:
   * panning elsewhere and deselecting shouldn't discard a selection you built
   * up somewhere else on the map.
   */
  function toggleVisibleSelection() {
    setSelection((prev) => {
      const next = new Map(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const lead of effectiveLeads) {
          if (visibleIds.has(lead.id)) next.set(lead.id, Number(lead.estimated_roof_value) || 0);
        }
      }
      return next;
    });
  }

  /**
   * Save a field result before doing anything that depends on it.
   *
   * Appointment and won-lead forms are follow-on workflows. The result first
   * commits to IndexedDB so cancelling a form or losing data cannot erase what
   * the rep already did.
   */
  async function logLeadResult(result: LeadResultSelection, leadOverride?: GeoLead) {
    const lead = leadOverride ?? resultTarget?.lead;
    if (!lead) return;

    setSavingResult(true);
    try {
      const payload = {
        leadId: lead.id,
        leadName: `${lead.first_name} ${lead.last_name}`.trim(),
      };
      if (result.channel === 'knock') {
        await resultOutbox.enqueueKnock({
          ...payload,
          disposition: result.disposition,
        });
      } else {
        await resultOutbox.enqueueCall({
          ...payload,
          disposition: result.disposition,
        });
      }

      const label = result.channel === 'knock'
        ? knockLabel(result.disposition)
        : callLabel(result.disposition);
      toast.success(
        `${payload.leadName || 'Lead'} — ${label}` +
          (resultOutbox.online ? '' : ' · saved, will sync')
      );

      setResultTarget(null);
      const disposition = result.disposition as string;
      if (
        disposition === 'appointment_set' &&
        (lead.status === 'new' || lead.status === 'contacted')
      ) {
        if (resultOutbox.online) {
          setAppointmentLeadId(lead.id);
        } else {
          toast.info('Schedule the appointment when this device is back online');
        }
      }

      if (disposition === 'contract_signed' && lead.status !== 'sold') {
        if (userRole === 'setter') {
          toast.info('An admin or closer can finish the won-lead details');
        } else if (resultOutbox.online) {
          setWonLeadId(lead.id);
        } else {
          toast.info('Finish the won-lead details when this device is back online');
        }
      }
    } catch {
      toast.error('Could not save this result to the device');
    } finally {
      setSavingResult(false);
    }
  }

  async function geocodeMissing() {
    setGeocoding(true);
    let cursor: string | null = null;
    let totalGeocoded = 0;
    const failedAddresses: string[] = [];
    try {
      // Loop batches until the endpoint reports it reached the end
      for (;;) {
        const res = await fetch('/api/admin/leads/geocode-missing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ after: cursor }),
        });
        const data: {
          success: boolean;
          geocoded: number;
          nextCursor: string | null;
          remaining: number;
          done: boolean;
          failed?: string[];
          error?: string;
        } = await res.json();
        if (!data.success) {
          toast.error(data.error || 'Geocoding failed');
          break;
        }
        totalGeocoded += data.geocoded;
        if (data.failed?.length) failedAddresses.push(...data.failed);
        cursor = data.nextCursor;
        setMissingCoords(data.remaining);
        setGeocodeStatus(`Geocoded ${totalGeocoded}... ${data.remaining} left`);
        if (data.done) break;
      }
      if (totalGeocoded > 0) {
        toast.success(`Placed ${totalGeocoded} lead${totalGeocoded !== 1 ? 's' : ''} on the map`);
        await fetchLeads();
      }
      // Name the streets that failed. These are nearly always addresses missing
      // from OpenStreetMap — typically one new-build street — and saying so is
      // the difference between an actionable answer and clicking a button that
      // appears to do nothing.
      if (failedAddresses.length > 0) {
        const streets = [
          ...new Set(
            failedAddresses.map((a) => a.replace(/^\s*\d+\s+/, '').replace(/\s+\d{5}(-\d{4})?$/, ''))
          ),
        ];
        const shown = streets.slice(0, 3).join(', ');
        const more = streets.length > 3 ? ` and ${streets.length - 3} more` : '';
        toast.error(
          `${failedAddresses.length} address${failedAddresses.length !== 1 ? 'es' : ''} not found by the map service — ${shown}${more}. These streets are missing from OpenStreetMap, so they cannot be placed automatically.`,
          { duration: 12000 }
        );
      } else if (totalGeocoded === 0) {
        toast.info('Nothing left to place on the map');
      }
    } catch {
      toast.error('Geocoding stopped unexpectedly');
    } finally {
      setGeocoding(false);
      setGeocodeStatus('');
    }
  }

  const fetchStorm = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    // A map whose container hasn't been laid out yet reports a ZERO-AREA bounds
    // (north === south), and querying that returns no reports — indistinguishable
    // from "this area had no storms". Wait for a real size; the resize listener
    // below re-runs this once the container settles.
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return;
    const b = map.getBounds();
    if (b.getNorth() === b.getSouth() || b.getEast() === b.getWest()) return;
    setStormLoading(true);
    try {
      const bounds = {
        days: String(stormDays),
        n: String(b.getNorth()),
        s: String(b.getSouth()),
        e: String(b.getEast()),
        w: String(b.getWest()),
      };
      // One request per active overlay, in parallel. The API is per-type and
      // caches per type, so this keeps its cache keys intact.
      const results = await Promise.all(
        stormTypes.map(async (type) => {
          const min = type === 'hail' ? hailMin : windMin;
          const params = new URLSearchParams(min > 0 ? { ...bounds, min: String(min) } : bounds);
          const res = await fetch(`/api/admin/storm/${type}?${params}`);
          const data = await res.json();
          if (!data.success) throw new Error(data.error || `Failed to load ${type} data`);
          // Tag each report with the overlay it came from — a merged list has no
          // ambient type, and colour/radius/label are read per report.
          return (data.reports as Omit<StormReport, 'type'>[]).map((r) => ({ ...r, type }));
        })
      );
      setStormReports(results.flat());
      setStormFetchedAt(Date.now());
    } catch (e) {
      // One overlay failing shouldn't blank the other, but the list is replaced
      // wholesale, so say what happened rather than showing a partial map.
      toast.error(e instanceof Error ? e.message : 'Failed to load storm data');
    } finally {
      setStormLoading(false);
    }
  }, [stormDays, stormTypes, hailMin, windMin]);

  // Fetch when an overlay turns on or the window changes; clear when all are off.
  //
  // Depends on mapInstance because fetchStorm needs the map's bounds and bails
  // out when the map isn't mounted yet. Without it, switching an overlay on
  // while the map was still initialising silently fetched nothing and never
  // retried — the layer stayed empty until the user happened to pan.
  useEffect(() => {
    if (!stormOn) {
      setStormReports([]);
      return;
    }
    if (!mapInstance) return;
    fetchStorm();
  }, [stormOn, mapInstance, fetchStorm]);

  // Keep the storm layer in sync with the map as it pans/zooms (debounced).
  //
  // Listens for 'resize' as well as 'moveend': the container is often 0x0 on
  // first paint, so the initial fetch is skipped, and only invalidateSize's
  // resize event signals that real bounds are finally available.
  useEffect(() => {
    if (!mapInstance || !stormOn) return;
    let t: ReturnType<typeof setTimeout>;
    const onMove = () => { clearTimeout(t); t = setTimeout(() => fetchStorm(), 500); };
    const events = 'moveend resize';
    mapInstance.on(events, onMove);
    return () => { clearTimeout(t); mapInstance.off(events, onMove); };
  }, [mapInstance, stormOn, fetchStorm]);

  const activeTerritories = territories.filter((territory) => !territory.archived_at);
  const mapTerritories = activeTerritories.filter(
    (territory) => !(editingBoundary && editingTerritory?.id === territory.id)
  );

  const territoryLeadCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const territory of territories) {
      counts[territory.id] = effectiveLeads.filter(
        (lead) =>
          lead.market_id === territory.market_id &&
          pointInPolygon([lead.latitude, lead.longitude], territory.boundary)
      ).length;
    }
    return counts;
  }, [effectiveLeads, territories]);

  const displayedLeads: GeoLead[] = execution.active
    ? execution.leads
    : effectiveLeads;
  const displayedTerritories = execution.territory
    ? [execution.territory]
    : mapTerritories;
  const displayedTerritoryLeadCounts = execution.summary
    ? { [execution.summary.territory_id]: execution.summary.total_leads }
    : territoryLeadCounts;
  const displayedFocus = execution.currentLead
    ? {
        key: `territory-door-${execution.currentLead.id}`,
        lat: execution.currentLead.latitude,
        lng: execution.currentLead.longitude,
        zoom: 18,
      }
    : execution.active
      ? null
      : alertFocus;

  function leadsInsideTerritory(territory: Pick<Territory, 'market_id' | 'boundary'>) {
    return effectiveLeads.filter(
      (lead) =>
        lead.market_id === territory.market_id &&
        pointInPolygon([lead.latitude, lead.longitude], territory.boundary)
    );
  }

  function addTerritoryLeadsToSelection(territory: Territory) {
    const inside = leadsInsideTerritory(territory);
    setSelection((prev) => {
      const next = new Map(prev);
      for (const lead of inside) {
        next.set(lead.id, Number(lead.estimated_roof_value) || 0);
      }
      return next;
    });
    if (inside.length === 0) {
      toast.info('No currently shown leads are inside this territory');
    } else {
      toast.success(
        `${inside.length} lead${inside.length !== 1 ? 's' : ''} selected from ${territory.name}`
      );
    }
  }

  function startSelectionArea() {
    setEditingTerritory(null);
    setEditingBoundary(false);
    setDrawPurpose('selection');
    setDrawPoints([]);
    setDrawing(true);
  }

  function startNewTerritory() {
    setEditingTerritory(null);
    setEditingBoundary(false);
    setDrawPurpose('territory');
    setDrawPoints([]);
    setDrawing(true);
  }

  /**
   * Commit one freehand lasso, then stay ready for the next.
   *
   * Called on pointer release rather than from a button: a polygon is implicitly
   * closed start-to-end, so lifting the finger already closes the loop and a
   * separate Finish step was pure ceremony.
   *
   * Additive on purpose — several loops build one selection, which is how you
   * pick two streets that are not adjacent. Draw mode stays on so the next area
   * needs no re-arming; Done exits.
   */
  const commitLassoSelection = useCallback(
    (path: [number, number][]) => {
      if (path.length < 3) return;
      const inside = effectiveLeads.filter((lead) =>
        pointInPolygon([lead.latitude, lead.longitude], path)
      );
      setDrawPoints([]);
      if (inside.length === 0) {
        toast.info('No leads inside that shape');
        return;
      }
      // Counted against the areas already drawn, not the whole selection, so
      // the number describes what THIS loop contributed.
      const insideIds = inside.map((lead) => lead.id);
      const added = newLeadsFromArea(areasRef.current, insideIds).length;
      const area: LassoArea = {
        id: `${areasRef.current.length + 1}-${insideIds.length}-${path.length}`,
        path,
        leadIds: insideIds,
      };
      setLassoAreas((prev) => [...prev, area]);
      setSelection((prev) => {
        const next = new Map(prev);
        for (const lead of inside) {
          next.set(lead.id, Number(lead.estimated_roof_value) || 0);
        }
        return next;
      });
      // Report what the shape ADDED, not what it enclosed. On a second
      // overlapping loop those differ, and "12 selected" when nothing changed
      // reads as a bug.
      toast.success(
        added === 0
          ? 'Those leads were already selected'
          : `${added} lead${added !== 1 ? 's' : ''} added — draw another or press Done`
      );
    },
    [effectiveLeads]
  );

  /**
   * Remove one area and the leads only it covered.
   *
   * Leads inside an overlapping area survive — dropping them would silently
   * deselect houses the operator never chose to lose.
   */
  const undoLassoArea = useCallback((areaId: string) => {
    const { remaining, dropped } = leadsAfterRemovingArea(areasRef.current, areaId);
    setLassoAreas(remaining);
    if (dropped.length > 0) {
      setSelection((prev) => {
        const next = new Map(prev);
        for (const id of dropped) next.delete(id);
        return next;
      });
    }
    toast.info(
      dropped.length > 0
        ? `Area removed — ${dropped.length} lead${dropped.length !== 1 ? 's' : ''} deselected`
        : 'Area removed — its leads are covered by another area'
    );
  }, []);

  function finishDraw() {
    if (drawPoints.length < 3) {
      toast.error('Add at least 3 points to make an area');
      return;
    }
    if (drawPurpose === 'selection') {
      const inside = effectiveLeads.filter((lead) =>
        pointInPolygon([lead.latitude, lead.longitude], drawPoints)
      );
      if (inside.length === 0) {
        toast.info('No leads inside that area');
      } else {
        setSelection((prev) => {
          const next = new Map(prev);
          for (const lead of inside) {
            next.set(lead.id, Number(lead.estimated_roof_value) || 0);
          }
          return next;
        });
        toast.success(
          `${inside.length} lead${inside.length !== 1 ? 's' : ''} selected in the area`
        );
      }
      setDrawing(false);
      setDrawPurpose(null);
      setDrawPoints([]);
      return;
    }
    setDrawing(false);
    setTerritoryDialogOpen(true);
  }

  function cancelDraw() {
    setDrawing(false);
    setLassoAreas([]);
    setDrawPurpose(null);
    setDrawPoints([]);
    setEditingTerritory(null);
    setEditingBoundary(false);
    setTerritoryDialogOpen(false);
  }

  function editTerritoryDetails(territory: Territory) {
    setEditingTerritory(territory);
    setEditingBoundary(false);
    setDrawPoints(territory.boundary);
    setTerritoryDialogOpen(true);
  }

  function editTerritoryBoundary(territory: Territory) {
    setEditingTerritory(territory);
    setEditingBoundary(true);
    setDrawPurpose('territory');
    setDrawPoints(territory.boundary);
    setDrawing(true);
  }

  function handleTerritoryDialogOpenChange(open: boolean) {
    setTerritoryDialogOpen(open);
    if (!open && (!editingTerritory || editingBoundary)) {
      // Closing the form is "back to drawing", not data loss. Clear/Cancel on
      // the toolbar remains the deliberate way to discard an outline.
      setDrawPurpose('territory');
      setDrawing(true);
    }
  }

  function handleTerritorySaved(saved: Territory) {
    setTerritories((prev) => {
      const index = prev.findIndex((territory) => territory.id === saved.id);
      if (index === -1) return [...prev, saved];
      return prev.map((territory) => (territory.id === saved.id ? saved : territory));
    });
    if (!editingTerritory) addTerritoryLeadsToSelection(saved);
    setTerritoryDialogOpen(false);
    setDrawing(false);
    setDrawPurpose(null);
    setDrawPoints([]);
    setEditingTerritory(null);
    setEditingBoundary(false);
    territoryProgressRefreshRef.current();
  }

  async function changeTerritoryArchived(
    territory: Territory,
    archived: boolean,
    allowOverlap = false
  ) {
    if (territoryArchivePendingRef.current) return;
    territoryArchivePendingRef.current = true;
    setTerritoryArchivePendingId(territory.id);
    try {
      const res = await fetch(`/api/admin/territories/${territory.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived, allow_overlap: allowOverlap }),
      });
      const data = await res.json();
      if (!data.success) {
        if (res.status === 409 && Array.isArray(data.conflicts)) {
          setRestoreConflict({ territory, conflicts: data.conflicts });
        } else {
          toast.error(data.error || `Failed to ${archived ? 'archive' : 'restore'} territory`);
        }
        return;
      }
      setTerritories((prev) =>
        prev.map((item) => (item.id === territory.id ? data.territory : item))
      );
      territoryProgressRefreshRef.current();
      setRestoreConflict(null);
      toast.success(archived ? 'Territory archived' : 'Territory restored');
    } catch {
      toast.error(`Failed to ${archived ? 'archive' : 'restore'} territory`);
    } finally {
      territoryArchivePendingRef.current = false;
      setTerritoryArchivePendingId(null);
    }
  }

  function clearSelectionAreas() {
    setSelection(new Map());
    setDrawPoints([]);
    setLassoAreas([]);
  }

  function clearActiveMapIntent() {
    setDrawing(false);
    setDrawPurpose(null);
    setEditingTerritory(null);
    setEditingBoundary(false);
    setTerritoryDialogOpen(false);
  }

  function handleMarketChange(nextMarket: string) {
    clearActiveMapIntent();
    clearSelectionAreas();
    setTerritorySheetOpen(false);
    setRestoreConflict(null);
    setAlertFocus(null);
    setMarket(nextMarket);
  }

  function handleStatusChange(nextStatus: string) {
    clearActiveMapIntent();
    clearSelectionAreas();
    setStatus(nextStatus === 'all' ? '' : nextStatus);
  }

  function handlePriorityChange(nextPriority: string) {
    clearActiveMapIntent();
    clearSelectionAreas();
    setPriority(nextPriority === 'all' ? '' : nextPriority);
  }

  const selectionTotal = [...selection.values()].reduce((sum, v) => sum + v, 0);
  const resultSyncNeedsAttention = resultOutbox.storageError || resultOutbox.failed > 0;
  const showResultSync =
    resultOutbox.pending > 0 || resultSyncNeedsAttention || !resultOutbox.online;
  const resultSyncTitle = resultOutbox.storageError
    ? 'This browser cannot access durable offline storage'
    : resultOutbox.failed > 0
      ? `${resultOutbox.lastError ?? 'Sync failed'} — tap to retry`
      : resultOutbox.online
        ? 'Tap to retry syncing now'
        : 'Offline — results are saved on this device and will sync automatically';
  const resultSyncLabel = resultOutbox.storageError
    ? 'Offline storage unavailable'
    : resultOutbox.failed > 0
      ? `${resultOutbox.failed} result${resultOutbox.failed === 1 ? '' : 's'} need retry`
      : resultOutbox.pending > 0
        ? `${resultOutbox.pending} result${resultOutbox.pending === 1 ? '' : 's'} to sync`
        : 'Offline';
  const drawAvailability = mapDrawAvailability({
    loading,
    shownLeadCount: effectiveLeads.length,
    selectedMarketId: selectedMarket?.id ?? null,
  });
  const dialogBoundary = editingTerritory && !editingBoundary
    ? editingTerritory.boundary
    : drawPoints;
  const dialogMarketId = editingTerritory?.market_id ?? selectedMarket?.id ?? null;
  const dialogShownLeadCount = dialogMarketId == null
    ? 0
    : effectiveLeads.filter(
        (lead) =>
          lead.market_id === dialogMarketId &&
          pointInPolygon([lead.latitude, lead.longitude], dialogBoundary)
      ).length;

  const mapMode:
    | 'browse'
    | 'select-area'
    | 'draw-territory'
    | 'add-house'
    | 'execute-territory' = execution.active
      ? 'execute-territory'
      : addingHouse
        ? 'add-house'
        : drawing && drawPurpose === 'selection'
          ? 'select-area'
          : drawing
            ? 'draw-territory'
            : 'browse';
  const mapModeLabel = {
    browse: 'Browse',
    'select-area': 'Select area',
    'draw-territory': 'Draw territory',
    'add-house': 'Add house',
    'execute-territory': 'Execute territory',
  }[mapMode];
  const mapModeDetail = {
    browse: loading ? 'Updating lead pins' : displayedLeads.length + ' mapped leads',
    'select-area': 'Trace one or more lead groups',
    'draw-territory': 'Trace and save one boundary',
    'add-house': 'Tap the house location',
    'execute-territory': execution.territory?.name ?? 'Active route',
  }[mapMode];
  const drawBlockedReasons = isAdmin
    ? [
        drawAvailability.territoryBlockedReason,
        drawAvailability.selectionBlockedReason,
      ]
    : [];

  return (
    <div
      className="field-map-workspace -mx-4 -my-5 flex h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] min-h-[26rem] flex-col overflow-hidden border-y bg-background md:-mx-8 md:-my-7 md:h-[calc(100dvh-4rem)] xl:-mx-10"
      aria-label="Field map workspace"
      data-map-mode={mapMode}
    >
      <header
        className="flex h-[3.75rem] shrink-0 items-center justify-between gap-4 border-b bg-background px-3 md:px-4"
        aria-label="Field Map header"
      >
        <div className="min-w-0">
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-primary">
            Field map
          </p>
          <h1 className="truncate text-lg font-semibold tracking-[-0.025em]">
            {execution.territory?.name ?? selectedMarket?.name ?? 'All markets'}
          </h1>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {execution.active && (
            <Button
              variant="ghost"
              className="h-11 px-2 sm:px-3"
              onClick={() => setTerritorySheetOpen(true)}
              disabled={territoriesLoading}
            >
              <MapPinned className="h-4 w-4" />
              <span className="hidden sm:inline">Territories</span>
            </Button>
          )}
          <div className="min-w-0 border-l pl-3 text-right">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Mode
            </p>
            <p className="truncate text-xs font-semibold">{mapModeLabel}</p>
            <p className="hidden truncate text-[10px] text-muted-foreground sm:block">{mapModeDetail}</p>
          </div>
        </div>
      </header>

      <div className="relative isolate min-h-0 flex-1 overflow-hidden" data-stable-map-canvas>
        <LeadMap
          addingHouse={!execution.active && addingHouse}
          pendingHouse={execution.active ? null : pendingHouse}
          onPlaceHouse={(latitude, longitude) => setPendingHouse({ latitude, longitude })}
          leads={displayedLeads}
          selectedIds={execution.active ? new Set<string>() : new Set(selection.keys())}
          activeLeadId={execution.currentLead?.id ?? null}
          revisitDueIds={execution.revisitDueIds}
          userLocation={execution.location}
          onToggleSelect={isAdmin && !execution.active ? toggleSelect : undefined}
          stormReports={execution.active ? [] : stormReports}
          stormNow={stormFetchedAt}
          stormZones={!execution.active && stormZones}
          territories={displayedTerritories}
          territoryLeadCounts={displayedTerritoryLeadCounts}
          currentUserId={currentUserId}
          onSelectTerritoryLeads={
            isAdmin && !execution.active ? addTerritoryLeadsToSelection : undefined
          }
          onEditTerritory={isAdmin && !execution.active ? editTerritoryDetails : undefined}
          drawing={!execution.active && drawing}
          drawPoints={drawPoints}
          onDrawPath={isAdmin && !execution.active ? (path) => setDrawPoints(path) : undefined}
          onDrawCommit={
            isAdmin && !execution.active && drawPurpose === 'selection'
              ? commitLassoSelection
              : undefined
          }
          lassoAreas={!execution.active && drawPurpose === 'selection' ? lassoAreas : undefined}
          onMapReady={(map) => { mapRef.current = map; setMapInstance(map); }}
          onOpenResult={(lead, channel) => setResultTarget({ lead, channel })}
          onQuickKnock={(lead, disposition) =>
            void logLeadResult({ channel: 'knock', disposition }, lead)
          }
          onFollowUpChange={refreshLeadViews}
          marketId={execution.territory?.market_id ?? selectedMarket?.id ?? null}
          marketCenter={marketCenter}
          marketLoading={loading}
          focus={displayedFocus}
        />

        {!hasLoadedOnce && (
          <div className="pointer-events-none absolute inset-0 z-[520] bg-background">
            <Skeleton className="h-full w-full rounded-none" />
          </div>
        )}

        {!execution.active && !drawing && !addingHouse && (
          <>
            <div
              className="pointer-events-none absolute left-3 top-3 z-[500] hidden items-center gap-1 border border-black/10 bg-background/95 p-1 shadow-md xl:flex"
              aria-label="Map command dock"
            >
              <Button
                variant="ghost"
                className="pointer-events-auto h-11"
                onClick={() => setTerritorySheetOpen(true)}
                disabled={territoriesLoading}
              >
                <MapPinned className="h-4 w-4" />
                Territories
                <span className="font-mono text-[10px] text-muted-foreground">{activeTerritories.length}</span>
              </Button>
              <span className="h-6 w-px bg-border" aria-hidden="true" />
              <Button
                variant="ghost"
                className="pointer-events-auto h-11"
                onClick={() => { setAddingHouse(true); setPendingHouse(null); }}
              >
                <HousePlus className="h-4 w-4" />
                Add house
              </Button>
              {isAdmin && (
                <>
                  <Button
                    variant={allVisibleSelected ? 'default' : 'ghost'}
                    className="pointer-events-auto h-11"
                    onClick={toggleVisibleSelection}
                    disabled={loading || visibleIds.size === 0}
                  >
                    <BoxSelect className="h-4 w-4" />
                    {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
                    {visibleIds.size > 0 && <span className="font-mono text-[10px]">{visibleIds.size}</span>}
                  </Button>
                  <Button
                    variant="ghost"
                    className="pointer-events-auto h-11"
                    onClick={startSelectionArea}
                    disabled={drawAvailability.selectionDisabled}
                    title={drawAvailability.selectionBlockedReason ?? undefined}
                  >
                    <Pencil className="h-4 w-4" />
                    Draw area
                  </Button>
                  <Button
                    variant="ghost"
                    className="pointer-events-auto h-11"
                    onClick={startNewTerritory}
                    disabled={drawAvailability.territoryDisabled}
                    title={drawAvailability.territoryBlockedReason ?? undefined}
                  >
                    <MapPinned className="h-4 w-4" />
                    New territory
                  </Button>
                </>
              )}
            </div>

            <div
              className="pointer-events-none absolute right-3 top-3 z-[500] hidden items-center gap-1 border border-black/10 bg-background/95 p-1 shadow-md xl:flex"
              aria-label="Desktop map panel dock"
            >
              {([
                ['filters', 'Filters', Filter],
                ['layers', 'Layers', Layers3],
                ['legend', 'Legend', MapIcon],
              ] as const).map(([panel, label, Icon]) => (
                <Button
                  key={panel}
                  variant={desktopPanel === panel ? 'default' : 'ghost'}
                  className="pointer-events-auto h-11"
                  aria-expanded={desktopPanel === panel}
                  onClick={() => setDesktopPanel((current) => current === panel ? null : panel)}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Button>
              ))}
            </div>

            {!isNarrow && desktopPanel && (
              <aside
                className="pointer-events-auto absolute right-3 top-[4.25rem] z-[510] max-h-[calc(100%-5rem)] w-72 overflow-y-auto border border-black/10 bg-background p-4 shadow-lg"
                aria-label={desktopPanel.charAt(0).toUpperCase() + desktopPanel.slice(1) + ' panel'}
              >
                <div className="mb-4 flex items-center justify-between border-b pb-3">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.15em]">
                    {desktopPanel}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11"
                    onClick={() => setDesktopPanel(null)}
                    aria-label={'Close ' + desktopPanel}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {desktopPanel === 'filters' && (
                  <MapFiltersPanel
                    markets={markets}
                    marketsLoading={marketsLoading}
                    marketValue={marketValue}
                    status={status}
                    priority={priority}
                    blockedReasons={drawBlockedReasons}
                    onMarketChange={handleMarketChange}
                    onStatusChange={handleStatusChange}
                    onPriorityChange={handlePriorityChange}
                  />
                )}
                {desktopPanel === 'layers' && (
                  <MapLayersPanel
                    stormTypes={stormTypes}
                    stormCounts={stormCounts}
                    stormLoading={stormLoading}
                    stormDays={stormDays}
                    stormZones={stormZones}
                    hailMin={hailMin}
                    windMin={windMin}
                    onToggleType={(type) => setStormTypes((current) => toggleStormType(current, type))}
                    onDaysChange={setStormDays}
                    onZonesChange={setStormZones}
                    onHailMinChange={setHailMin}
                    onWindMinChange={setWindMin}
                  />
                )}
                {desktopPanel === 'legend' && (
                  <MapLegendPanel stormTypes={stormTypes} stormZones={stormZones} />
                )}
              </aside>
            )}

            <div
              className="pointer-events-none absolute inset-x-2 top-2 z-[500] grid grid-cols-3 gap-1.5 border border-black/10 bg-background p-1 shadow-md xl:hidden"
              aria-label="Mobile map actions"
            >
              <Button
                variant="outline"
                className="pointer-events-auto h-11 min-w-0 px-2 text-xs shadow-none"
                onClick={() => setTerritorySheetOpen(true)}
                disabled={territoriesLoading}
              >
                <MapPinned className="h-4 w-4 shrink-0" />
                <span className="truncate">Territories</span>
              </Button>
              <Button
                variant="outline"
                className="pointer-events-auto h-11 min-w-0 px-2 text-xs shadow-none"
                onClick={() => { setAddingHouse(true); setPendingHouse(null); }}
              >
                <HousePlus className="h-4 w-4 shrink-0" />
                <span className="truncate">Add house</span>
              </Button>
              <Button
                variant="outline"
                className="pointer-events-auto h-11 min-w-0 px-2 text-xs shadow-none"
                onClick={() => setMapToolsOpen(true)}
                aria-expanded={mapToolsOpen}
              >
                <SlidersHorizontal className="h-4 w-4 shrink-0" />
                Tools
              </Button>
            </div>
          </>
        )}

        {!execution.active && (drawing || addingHouse) && (
          <>
            <div
              className="pointer-events-none absolute left-1/2 top-3 z-[520] hidden -translate-x-1/2 xl:block"
              aria-label="Desktop map mode controls"
            >
              <div className="pointer-events-auto flex min-h-11 items-center gap-2 border border-white/10 bg-[#121722] px-3 py-1.5 text-white shadow-xl">
                <div className="mr-1">
                  <p className="text-xs font-semibold">{mapModeLabel}</p>
                  <p className="text-[10px] text-white/60">{mapModeDetail}</p>
                </div>
                {drawPurpose === 'selection' && lassoAreas.length > 0 && (
                  <span className="whitespace-nowrap font-mono text-[10px] text-white/70">
                    {lassoAreas.length} area{lassoAreas.length === 1 ? '' : 's'} · {totalLeadsInAreas(lassoAreas)} leads
                  </span>
                )}
                {drawing && drawPurpose === 'selection' && lassoAreas.length > 0 && (
                  <Button
                    variant="ghost"
                    className="h-11 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => undoLassoArea(lassoAreas[lassoAreas.length - 1].id)}
                  >
                    <Undo2 className="h-4 w-4" />
                    Undo
                  </Button>
                )}
                {drawing && drawPurpose === 'selection' && (
                  <Button className="h-11" onClick={cancelDraw}>Done</Button>
                )}
                {drawing && drawPurpose === 'territory' && (
                  <>
                    <Button className="h-11" onClick={finishDraw} disabled={drawPoints.length < 3}>
                      Finish{drawPoints.length > 0 ? ' ' + drawPoints.length : ''}
                    </Button>
                    {drawPoints.length > 0 && (
                      <Button
                        variant="ghost"
                        className="h-11 text-white hover:bg-white/10 hover:text-white"
                        onClick={() => setDrawPoints([])}
                      >
                        Clear
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="h-11 text-white hover:bg-white/10 hover:text-white"
                      onClick={cancelDraw}
                    >
                      Cancel
                    </Button>
                  </>
                )}
                {addingHouse && (
                  <Button
                    variant="ghost"
                    className="h-11 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => { setAddingHouse(false); setPendingHouse(null); }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>

            <div
              className="pointer-events-none absolute inset-x-2 top-2 z-[520] xl:hidden"
              aria-label="Mobile map mode controls"
            >
              <div className="pointer-events-auto flex min-h-11 items-center gap-2 overflow-x-auto border border-white/10 bg-[#121722] px-2 py-1.5 text-white shadow-xl">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{mapModeLabel}</p>
                  <p className="truncate text-[10px] text-white/60">{mapModeDetail}</p>
                </div>
                {drawing && drawPurpose === 'selection' && lassoAreas.length > 0 && (
                  <Button
                    variant="ghost"
                    className="h-11 shrink-0 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => undoLassoArea(lassoAreas[lassoAreas.length - 1].id)}
                  >
                    <Undo2 className="h-4 w-4" />
                    Undo
                  </Button>
                )}
                {drawing && drawPurpose === 'selection' && (
                  <Button className="h-11 shrink-0" onClick={cancelDraw}>Done</Button>
                )}
                {drawing && drawPurpose === 'territory' && (
                  <Button className="h-11 shrink-0" onClick={finishDraw} disabled={drawPoints.length < 3}>
                    Finish
                  </Button>
                )}
                {drawing && drawPurpose === 'territory' && drawPoints.length > 0 && (
                  <Button
                    variant="ghost"
                    className="h-11 shrink-0 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => setDrawPoints([])}
                  >
                    Clear
                  </Button>
                )}
                {drawing && drawPurpose === 'territory' && (
                  <Button
                    variant="ghost"
                    className="h-11 shrink-0 text-white hover:bg-white/10 hover:text-white"
                    onClick={cancelDraw}
                  >
                    Cancel
                  </Button>
                )}
                {addingHouse && (
                  <Button
                    variant="ghost"
                    className="h-11 shrink-0 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => { setAddingHouse(false); setPendingHouse(null); }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {(showResultSync || leadError || (!execution.active && (missingCoords > 0 || geocoding))) && (
          <div
            className={
              'pointer-events-none absolute left-2 z-[500] flex max-w-[min(28rem,calc(100%-1rem))] flex-col gap-2 md:left-3 ' +
              (execution.active ? 'top-3' : selection.size > 0 ? 'bottom-16' : 'bottom-2 md:bottom-3')
            }
            aria-label="Map status"
          >
            {showResultSync && (
              <button
                type="button"
                className={
                  'pointer-events-auto flex min-h-11 items-center gap-2 border bg-background/95 px-3 py-2 text-left text-xs font-medium shadow-md ' +
                  (resultSyncNeedsAttention ? 'text-destructive' : 'text-muted-foreground')
                }
                onClick={() =>
                  void (resultOutbox.failed > 0
                    ? resultOutbox.retryFailed()
                    : resultOutbox.flush(true))
                }
                title={resultSyncTitle}
              >
                <span
                  className={
                    'h-2 w-2 shrink-0 rounded-full ' +
                    (resultSyncNeedsAttention
                      ? 'bg-destructive'
                      : resultOutbox.online
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground')
                  }
                />
                {resultSyncLabel}
              </button>
            )}

            {leadError && (
              <div className="pointer-events-auto flex min-h-11 items-center gap-3 border border-destructive/30 bg-background/95 px-3 py-2 text-xs shadow-md">
                <p className="min-w-0 flex-1">
                  <span className="font-semibold text-destructive">Map leads did not refresh.</span>{' '}
                  <span className="text-muted-foreground">
                    {leads.length > 0 ? 'The last loaded pins remain visible.' : leadError}
                  </span>
                </p>
                <Button variant="outline" className="h-11 shrink-0" onClick={() => void fetchLeads()}>
                  <RefreshCw className="h-4 w-4" />
                  Retry
                </Button>
              </div>
            )}

            {!execution.active && (missingCoords > 0 || geocoding) && (
              <div className="pointer-events-auto flex min-h-11 items-center gap-3 border bg-background/95 px-3 py-2 text-xs shadow-md">
                <p className="min-w-0 flex-1 text-muted-foreground">
                  {geocoding
                    ? geocodeStatus || 'Placing leads on the map'
                    : missingCoords + ' lead' + (missingCoords === 1 ? '' : 's') + ' need coordinates'}
                </p>
                {isAdmin && (
                  <Button variant="outline" className="h-11 shrink-0" onClick={geocodeMissing} disabled={geocoding}>
                    <LocateFixed className={'h-4 w-4 ' + (geocoding ? 'animate-pulse' : '')} />
                    {geocoding ? 'Placing' : 'Place'}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {execution.active && execution.summary && (
          <TerritoryExecutionPanel
            territoryName={execution.territory?.name ?? 'Territory'}
            summary={execution.summary}
            currentLead={execution.currentLead}
            queue={execution.manualQueue}
            pendingOfflineCount={resultOutbox.pending + resultOutbox.failed}
            offlineAgeMs={execution.offlineAgeMs}
            locationError={execution.locationError}
            locating={execution.locating}
            recording={savingResult}
            onFindNearest={() => void execution.findNearest()}
            onSelectLead={execution.selectLead}
            onRecordKnock={(lead, disposition) =>
              logLeadResult({ channel: 'knock', disposition }, lead)
            }
            onFollowUpChange={refreshLeadViews}
            onExit={exitTerritoryWork}
            className="absolute inset-x-2 bottom-2 z-[500] max-h-[min(48dvh,30rem)] overflow-y-auto sm:right-auto sm:w-full"
          />
        )}
      </div>

      <Sheet open={mapToolsOpen} onOpenChange={setMapToolsOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[78dvh] overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))] xl:hidden"
          aria-label="Mobile map tools sheet"
        >
          <SheetHeader className="border-b p-4 pr-12">
            <SheetTitle>Map tools</SheetTitle>
            <SheetDescription>
              Change the lead view or map layers. The map stays in place behind this panel.
            </SheetDescription>
          </SheetHeader>

          {isNarrow && (
            <div className="space-y-5 px-4 pb-2">
              {isAdmin && (
                <section aria-label="Area tools">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Area tools
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button
                      variant={allVisibleSelected ? 'default' : 'outline'}
                      className="h-11"
                      onClick={toggleVisibleSelection}
                      disabled={loading || visibleIds.size === 0}
                    >
                      <BoxSelect className="h-4 w-4" />
                      {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() => { setMapToolsOpen(false); startSelectionArea(); }}
                      disabled={drawAvailability.selectionDisabled}
                    >
                      <Pencil className="h-4 w-4" />
                      Draw area
                    </Button>
                    <Button
                      variant="outline"
                      className="col-span-2 h-11"
                      onClick={() => { setMapToolsOpen(false); startNewTerritory(); }}
                      disabled={drawAvailability.territoryDisabled}
                    >
                      <MapPinned className="h-4 w-4" />
                      New territory
                    </Button>
                  </div>
                </section>
              )}

              <div className="grid grid-cols-3 border" aria-label="Mobile map tool panels">
                {([
                  ['filters', 'Filters', ListFilter],
                  ['layers', 'Layers', Layers3],
                  ['legend', 'Legend', MapIcon],
                ] as const).map(([panel, label, Icon]) => (
                  <Button
                    key={panel}
                    variant={mobileToolPanel === panel ? 'default' : 'ghost'}
                    className="h-11 rounded-none"
                    aria-pressed={mobileToolPanel === panel}
                    onClick={() => setMobileToolPanel(panel)}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Button>
                ))}
              </div>

              <section aria-label={mobileToolPanel.charAt(0).toUpperCase() + mobileToolPanel.slice(1) + ' panel'}>
                {mobileToolPanel === 'filters' && (
                  <MapFiltersPanel
                    markets={markets}
                    marketsLoading={marketsLoading}
                    marketValue={marketValue}
                    status={status}
                    priority={priority}
                    blockedReasons={drawBlockedReasons}
                    onMarketChange={handleMarketChange}
                    onStatusChange={handleStatusChange}
                    onPriorityChange={handlePriorityChange}
                  />
                )}
                {mobileToolPanel === 'layers' && (
                  <MapLayersPanel
                    stormTypes={stormTypes}
                    stormCounts={stormCounts}
                    stormLoading={stormLoading}
                    stormDays={stormDays}
                    stormZones={stormZones}
                    hailMin={hailMin}
                    windMin={windMin}
                    onToggleType={(type) => setStormTypes((current) => toggleStormType(current, type))}
                    onDaysChange={setStormDays}
                    onZonesChange={setStormZones}
                    onHailMinChange={setHailMin}
                    onWindMinChange={setWindMin}
                  />
                )}
                {mobileToolPanel === 'legend' && (
                  <MapLegendPanel stormTypes={stormTypes} stormZones={stormZones} />
                )}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <TerritorySheet
        open={territorySheetOpen}
        onOpenChange={setTerritorySheetOpen}
        territories={territories}
        leadCounts={territoryLeadCounts}
        progressByTerritory={territoryProgress}
        progressLoading={territoryProgressLoading}
        loading={territoriesLoading}
        isAdmin={isAdmin}
        canExecute={territoryExecutionAllowed}
        currentUserId={currentUserId}
        showArchived={showArchivedTerritories}
        onShowArchivedChange={setShowArchivedTerritories}
        onSelectLeads={isAdmin && !execution.active ? addTerritoryLeadsToSelection : undefined}
        onEdit={editTerritoryDetails}
        onEditBoundary={editTerritoryBoundary}
        onArchiveChange={changeTerritoryArchived}
        onResume={(territory) => void resumeTerritoryWork(territory)}
        pendingTerritoryId={territoryArchivePendingId}
      />

      <LeadResultSheet
        open={resultTarget !== null}
        onOpenChange={(open) => {
          if (!open && !savingResult) setResultTarget(null);
        }}
        lead={resultTarget?.lead ?? null}
        channel={resultTarget?.channel ?? 'knock'}
        onChannelChange={(channel) =>
          setResultTarget((current) => current ? { ...current, channel } : current)
        }
        onSelect={(result) => void logLeadResult(result)}
        saving={savingResult}
      />

      {appointmentLeadId && (
        <AppointmentModal
          leadId={appointmentLeadId}
          open
          onOpenChange={(open) => {
            if (!open) setAppointmentLeadId(null);
          }}
          onSuccess={() => {
            toast.success('Appointment set!');
            setAppointmentLeadId(null);
            refreshLeadViews();
          }}
        />
      )}

      {wonLeadId && (
        <WonLeadModal
          leadId={wonLeadId}
          open
          onOpenChange={(open) => {
            if (!open) setWonLeadId(null);
          }}
          onSuccess={() => {
            toast.success('Lead marked as won!');
            setWonLeadId(null);
            refreshLeadViews();
          }}
        />
      )}

      {dialogMarketId != null && dialogBoundary.length >= 3 && (
        <TerritoryDialog
          open={territoryDialogOpen}
          onOpenChange={handleTerritoryDialogOpenChange}
          marketId={dialogMarketId}
          boundary={dialogBoundary}
          shownLeadCount={dialogShownLeadCount}
          territory={editingTerritory}
          onSaved={handleTerritorySaved}
        />
      )}

      <Dialog
        open={!!restoreConflict}
        onOpenChange={(open) => {
          if (!open) setRestoreConflict(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore overlapping territory?</DialogTitle>
            <DialogDescription>
              {restoreConflict?.territory.name} overlaps{' '}
              {restoreConflict?.conflicts.map((conflict) => conflict.name).join(', ')}.
              Restore it only if that shared coverage is intentional.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreConflict(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (restoreConflict) {
                  changeTerritoryArchived(restoreConflict.territory, false, true);
                }
              }}
              disabled={territoryArchivePendingId != null}
            >
              {territoryArchivePendingId ? 'Restoring...' : 'Restore with overlap'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk selection action bar */}
      {isAdmin && !execution.active && selection.size > 0 && (
        <div
          aria-label="Map selection actions"
          className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-2 right-2 z-40 flex items-center gap-3 overflow-x-auto border border-white/10 bg-[#121722] px-4 py-3 text-white shadow-xl md:bottom-4 md:left-1/2 md:right-auto md:-translate-x-1/2"
        >
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
            onClick={() => setAssignOpen(true)}
            disabled={selection.size > LIMITS.BULK_ASSIGN_MAX}
          >
            <UserCheck className="h-4 w-4 mr-1" />
            Assign
          </Button>
          <Button
            className="h-11 text-white hover:bg-white/10 hover:text-white dark:hover:bg-white/10"
            variant="ghost"
            onClick={clearSelectionAreas}
          >
            Clear
          </Button>
        </div>
      )}

      {isAdmin && (
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
      )}

      <AddHouseSheet
        open={!!pendingHouse}
        onOpenChange={(o) => { if (!o) setPendingHouse(null); }}
        point={pendingHouse}
        marketId={selectedMarket?.id ?? null}
        onCreated={() => {
          // Leave add mode after a save: the rep placed the house they walked
          // up to, and staying armed makes the next map tap create another.
          setAddingHouse(false);
          setPendingHouse(null);
          fetchLeads();
        }}
      />
</div>
  );
}
