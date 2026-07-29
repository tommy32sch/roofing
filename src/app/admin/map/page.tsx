'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { BoxSelect, UserCheck, LocateFixed, CloudHail, Wind, Pencil, ChevronDown, Check, Hexagon, MapPinned } from 'lucide-react';
import { toast } from 'sonner';
import { knockLabel, type KnockDisposition } from '@/lib/leads/knocks';
import { applyQueuedKnocks } from '@/lib/leads/knock-sync';
import { useKnockOutbox } from '@/lib/offline/useKnockOutbox';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BulkAssignDialog } from '@/components/leads/BulkAssignDialog';
import {
  STATUS_COLORS, DNC_RING_COLOR, STORM_TYPES, toggleStormType, countStormsByType,
  stormLegendEntries, stormAgeLegendEntries, stormZoneLegendEntries, STORM_WINDOWS, stormWindowLabel, STORM_MIN_VALUES, stormMinLabel,
  type GeoLead, type StormReport, type StormType,
} from '@/components/leads/map-constants';
import { LEAD_STATUS_OPTIONS, LEAD_PRIORITY_OPTIONS } from '@/types';
import type { Territory, UserRole } from '@/types';
import { LIMITS } from '@/lib/utils/validation';
import { pointInPolygon } from '@/lib/leads/geo-polygon';
import { mapDrawAvailability, type MapDrawPurpose } from '@/lib/leads/map-drawing';
import { PageHeader } from '@/components/layout/page-header';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import { TerritoryDialog } from '@/components/territories/TerritoryDialog';
import { TerritorySheet } from '@/components/territories/TerritorySheet';

// Leaflet touches `window` at import time — client-only
const LeadMap = dynamic(() => import('@/components/leads/LeadMap'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-md" />,
});

export default function MapPage() {
  const [leads, setLeads] = useState<GeoLead[]>([]);
  const [missingCoords, setMissingCoords] = useState(0);
  const [loading, setLoading] = useState(true);
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
  const [userRole, setUserRole] = useState<UserRole>('setter');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeStatus, setGeocodeStatus] = useState('');

  const [legendOpen, setLegendOpen] = useState(false);
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
  const [drawing, setDrawing] = useState(false);
  const [drawPurpose, setDrawPurpose] = useState<MapDrawPurpose | null>(null);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [territoriesLoading, setTerritoriesLoading] = useState(false);
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
  const territoryArchivePendingRef = useRef(false);
  const isAdmin = userRole === 'admin';

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    if (market) params.set('market_id', market);
    try {
      const res = await fetch(`/api/admin/leads/geo?${params}`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads);
        setMissingCoords(data.missing_coords);
      }
    } catch {
      // Failed to fetch
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [status, priority, market]);

  const knockOutbox = useKnockOutbox({
    ownerId: identityLoaded ? currentUserId : null,
    onSettled: fetchLeads,
  });
  const effectiveLeads = useMemo(
    () => applyQueuedKnocks(leads, knockOutbox.entries),
    [knockOutbox.entries, leads]
  );

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetch('/api/admin/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setUserRole(d.admin.role);
          setCurrentUserId(d.admin.id);
        }
      })
      .catch(() => {})
      .finally(() => setIdentityLoaded(true));
  }, []);

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
    if (marketsLoading || !identityLoaded) return;
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
  }, [identityLoaded, isAdmin, marketValue, marketsLoading]);

  useEffect(() => {
    fetchTerritories();
  }, [fetchTerritories]);

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

  const [loggingKnockFor, setLoggingKnockFor] = useState<string | null>(null);

  /**
   * Log a knock from the pin popup.
   *
   * Goes through the offline outbox rather than straight to the network. A rep
   * is walking a street on a phone and cannot stand at a door waiting to learn
   * whether a POST succeeded — previously a failed request showed a toast and
   * discarded the knock, and the door then looked un-knocked to everyone.
   *
   * The knock is durable the moment it is accepted; the request happens when
   * the network allows, which may be seconds or streets later.
   */
  async function logKnock(lead: GeoLead, disposition: KnockDisposition) {
    setLoggingKnockFor(lead.id);
    try {
      await knockOutbox.enqueue({
        leadId: lead.id,
        disposition,
        leadName: `${lead.first_name} ${lead.last_name}`.trim(),
      });
      toast.success(
        `${lead.first_name} ${lead.last_name} — ${knockLabel(disposition)}` +
          (knockOutbox.online ? '' : ' · saved, will sync')
      );
    } catch {
      toast.error('Could not save knock to this device');
    } finally {
      setLoggingKnockFor(null);
    }
  }

  async function geocodeMissing() {
    setGeocoding(true);
    let cursor: string | null = null;
    let totalGeocoded = 0;
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
          error?: string;
        } = await res.json();
        if (!data.success) {
          toast.error(data.error || 'Geocoding failed');
          break;
        }
        totalGeocoded += data.geocoded;
        cursor = data.nextCursor;
        setMissingCoords(data.remaining);
        setGeocodeStatus(`Geocoded ${totalGeocoded}... ${data.remaining} left`);
        if (data.done) break;
      }
      if (totalGeocoded > 0) {
        toast.success(`Placed ${totalGeocoded} lead${totalGeocoded !== 1 ? 's' : ''} on the map`);
        await fetchLeads();
      } else {
        toast.info('No new leads could be geocoded (check their addresses)');
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
      setRestoreConflict(null);
      toast.success(archived ? 'Territory archived' : 'Territory restored');
    } catch {
      toast.error(`Failed to ${archived ? 'archive' : 'restore'} territory`);
    } finally {
      territoryArchivePendingRef.current = false;
      setTerritoryArchivePendingId(null);
    }
  }

  function handleMarketChange(nextMarket: string) {
    setDrawing(false);
    setDrawPurpose(null);
    setDrawPoints([]);
    setEditingTerritory(null);
    setEditingBoundary(false);
    setTerritoryDialogOpen(false);
    setTerritorySheetOpen(false);
    setRestoreConflict(null);
    setAlertFocus(null);
    setSelection(new Map());
    setMarket(nextMarket);
  }

  const selectionTotal = [...selection.values()].reduce((sum, v) => sum + v, 0);
  const knockSyncNeedsAttention = knockOutbox.storageError || knockOutbox.failed > 0;
  const showKnockSync =
    knockOutbox.pending > 0 || knockSyncNeedsAttention || !knockOutbox.online;
  const knockSyncTitle = knockOutbox.storageError
    ? 'This browser cannot access durable offline storage'
    : knockOutbox.failed > 0
      ? `${knockOutbox.lastError ?? 'Sync failed'} — tap to retry`
      : knockOutbox.online
        ? 'Tap to retry syncing now'
        : 'Offline — knocks are saved on this device and will sync automatically';
  const knockSyncLabel = knockOutbox.storageError
    ? 'Offline storage unavailable'
    : knockOutbox.failed > 0
      ? `${knockOutbox.failed} knock${knockOutbox.failed === 1 ? '' : 's'} need retry`
      : knockOutbox.pending > 0
        ? `${knockOutbox.pending} knock${knockOutbox.pending === 1 ? '' : 's'} to sync`
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

  // Map height budget, measured rather than guessed. Desktop: viewport minus the
  // app header (3.5rem) and main's vertical padding (4rem). Mobile reserves more
  // for the fixed bottom tab bar.
  return (
    <div className="flex min-h-[420px] flex-col gap-3 h-[calc(100dvh-13rem)] md:h-[calc(100dvh-7.5rem)]">
      <PageHeader
        title="Map"
        description="Lead locations, saved territories and storm overlays"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTerritorySheetOpen(true)}
              disabled={territoriesLoading || drawing}
              title={drawing ? 'Finish or cancel the current boundary first' : undefined}
            >
              <MapPinned className="h-4 w-4 mr-1" />
              Territories ({activeTerritories.length})
            </Button>

            {/* Unsynced work. Silence here would be the old bug wearing a new
                face: the rep needs to know their knocks are held, not lost. */}
            {showKnockSync && (
              <button
                type="button"
                onClick={() =>
                  void (knockOutbox.failed > 0
                    ? knockOutbox.retryFailed()
                    : knockOutbox.flush(true))
                }
                title={knockSyncTitle}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                  knockSyncNeedsAttention
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    knockSyncNeedsAttention
                      ? 'bg-destructive'
                      : knockOutbox.online
                        ? 'bg-amber-500'
                        : 'bg-muted-foreground'
                  }`}
                />
                {knockSyncLabel}
              </button>
            )}

            {isAdmin && (
              <Button
                variant={allVisibleSelected ? 'default' : 'outline'}
                size="sm"
                onClick={toggleVisibleSelection}
                disabled={loading || visibleIds.size === 0}
              >
                <BoxSelect className="h-4 w-4 mr-1" />
                {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
                {visibleIds.size > 0 && ` (${visibleIds.size})`}
              </Button>
            )}
            {isAdmin && !drawing && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startSelectionArea}
                  disabled={drawAvailability.selectionDisabled}
                  title={
                    effectiveLeads.length === 0
                      ? 'No mapped leads match the current filters'
                      : 'Draw an area to select leads for assignment'
                  }
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Draw area
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startNewTerritory}
                  disabled={drawAvailability.territoryDisabled}
                  title={!selectedMarket ? 'Choose one market to save a territory' : undefined}
                >
                  <MapPinned className="h-4 w-4 mr-1" />
                  New territory
                </Button>
              </>
            )}
            {isAdmin && drawing && (
              <>
                <Button variant="default" size="sm" onClick={finishDraw} disabled={drawPoints.length < 3}>
                  Finish{drawPoints.length > 0 ? ` (${drawPoints.length})` : ''}
                </Button>
                {drawPoints.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setDrawPoints([])}>
                    Clear
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={cancelDraw}>
                  Cancel
                </Button>
              </>
            )}
            {/* Two independent toggles rather than one button plus a type
                dropdown. A dropdown can only ever express one choice, and the
                overlap of wind and hail is exactly what a rep wants to see. Each
                carries its own count so the layers stay distinguishable. */}
            {STORM_TYPES.map((type) => {
              const active = stormTypes.includes(type);
              const Icon = type === 'wind' ? Wind : CloudHail;
              const count = stormCounts[type];
              return (
                <Button
                  key={type}
                  variant={active ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={active}
                  onClick={() => setStormTypes((prev) => toggleStormType(prev, type))}
                >
                  <Icon className={`h-4 w-4 mr-1 ${stormLoading && active ? 'animate-pulse' : ''}`} />
                  {type === 'wind' ? 'Wind' : 'Hail'}
                  {active && count > 0 ? ` (${count})` : ''}
                </Button>
              );
            })}
            {stormOn && (
              <>
                <Select value={String(stormDays)} onValueChange={(v) => v && setStormDays(parseInt(v, 10))}>
                  <SelectTrigger className="w-[140px]" aria-label="Storm window">
                    {/* Needs explicit children — this Select renders the raw
                        value otherwise, so the trigger read "30" instead of
                        "Last 30 days". */}
                    <SelectValue>{stormWindowLabel(stormDays)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STORM_WINDOWS.map((w) => (
                      <SelectItem key={w.days} value={String(w.days)}>{w.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant={stormZones ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={stormZones}
                  onClick={() => setStormZones((v) => !v)}
                  title="Overlay each storm swath beneath its individual report dots"
                >
                  <Hexagon className="h-4 w-4 mr-1" />
                  Zones
                </Button>
                {/* Minimum severity. Two years of reports includes a lot of
                    marginal ones, and severity is what qualifies a roof — 1"
                    hail is the usual insurer threshold, 58 mph the severe-wind
                    criterion. Rendered as one control listing whichever
                    overlays are on, since the units differ. */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" size="sm" className="min-w-[140px] justify-between">
                        {stormMinLabel(stormTypes, hailMin, windMin)}
                        <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="start" className="w-44">
                    {/* Each labelled section must be a real DropdownMenuGroup:
                        the label renders Base UI's GroupLabel, which THROWS
                        ("MenuGroupRootContext is missing") outside a Menu.Group
                        and takes the whole page down with it. A Fragment is not
                        a substitute. */}
                    {stormTypes.includes('hail') && (
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Hail size</DropdownMenuLabel>
                        {STORM_MIN_VALUES.hail.map((o) => (
                          <DropdownMenuItem key={`h${o.value}`} onClick={() => setHailMin(o.value)}>
                            <span className="flex-1">{o.label}</span>
                            {hailMin === o.value && <Check className="h-3.5 w-3.5" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    )}
                    {stormTypes.length === 2 && <DropdownMenuSeparator />}
                    {stormTypes.includes('wind') && (
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Wind speed</DropdownMenuLabel>
                        {STORM_MIN_VALUES.wind.map((o) => (
                          <DropdownMenuItem key={`w${o.value}`} onClick={() => setWindMin(o.value)}>
                            <span className="flex-1">{o.label}</span>
                            {windMin === o.value && <Check className="h-3.5 w-3.5" />}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {!marketsLoading && (
              <MarketFilter
                markets={markets}
                value={marketValue}
                onChange={handleMarketChange}
                className="w-[150px]"
              />
            )}
            <Select value={status} onValueChange={(v) => setStatus(v === 'all' ? '' : v ?? '')}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {LEAD_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={(v) => setPriority(v === 'all' ? '' : v ?? '')}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All Priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {LEAD_PRIORITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {drawing && (
        <div className="rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
          {drawPurpose === 'selection' ? (
            <>
              <strong>Drag</strong> to draw around leads, or <strong>tap</strong> to drop
              corners one at a time. Then <strong>Finish</strong> to select every lead inside
              for assignment.
            </>
          ) : (
            <>
              <strong>Drag</strong> to draw around a neighborhood, or <strong>tap</strong> to
              drop corners one at a time. Then <strong>Finish</strong> to name and save the
              territory. Leads inside stay available for explicit bulk assignment.
            </>
          )}
        </div>
      )}

      {(missingCoords > 0 || geocoding) && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs flex-wrap">
          <span className="text-muted-foreground">
            {geocoding
              ? geocodeStatus || 'Geocoding leads...'
              : `${missingCoords} lead${missingCoords !== 1 ? 's' : ''} not on the map yet (no coordinates).`}
          </span>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={geocodeMissing} disabled={geocoding}>
              <LocateFixed className={`h-4 w-4 mr-1 ${geocoding ? 'animate-pulse' : ''}`} />
              {geocoding ? 'Geocoding...' : 'Geocode missing'}
            </Button>
          )}
        </div>
      )}

      {/* Legend — collapsed by default on mobile, where it otherwise consumed
          ~130px of a 812px screen before the map even started. */}
      <button
        type="button"
        className="sm:hidden self-start text-xs text-muted-foreground underline underline-offset-2"
        onClick={() => setLegendOpen((o) => !o)}
        aria-expanded={legendOpen}
      >
        {legendOpen ? 'Hide legend' : 'Show legend'}
      </button>
      <div
        className={`${legendOpen ? 'flex' : 'hidden'} sm:flex gap-3 flex-wrap text-xs text-muted-foreground`}
      >
        {LEAD_STATUS_OPTIONS.map((opt) => (
          <span key={opt.value} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[opt.value] }}
            />
            {opt.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border-2 bg-transparent"
            style={{ borderColor: DNC_RING_COLOR }}
          />
          Do Not Call (knock only)
        </span>
        {stormOn && (
          <>
            <span className="text-muted-foreground/60">|</span>
            {/* Dots remain visible when swaths are on, so their severity key
                must remain visible too. */}
            <span className="text-muted-foreground">Report severity</span>
            {stormLegendEntries(stormTypes).map((entry) => (
              <span key={entry.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: entry.color, opacity: 0.6 }}
                />
                {entry.label}
              </span>
            ))}
            {/* Both layers use the same age buckets, but distinct encodings:
                dots fade their severity colour; swaths use a red ramp. */}
            <span className="text-muted-foreground/60">|</span>
            <span className="text-muted-foreground">Report age</span>
            {stormAgeLegendEntries().map((entry) => (
              <span key={entry.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full bg-foreground"
                  style={{ opacity: entry.fillOpacity }}
                />
                {entry.label}
              </span>
            ))}
            {stormZones && (
              <>
                <span className="text-muted-foreground/60">|</span>
                <span className="text-muted-foreground">Swath age</span>
                {stormZoneLegendEntries().map((entry) => (
                  <span key={entry.key} className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: entry.color, opacity: entry.opacity }}
                    />
                    {entry.label}
                  </span>
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 isolate">
        {!hasLoadedOnce ? (
          <Skeleton className="h-full w-full rounded-md" />
        ) : (
          <LeadMap
            leads={effectiveLeads}
            selectedIds={new Set(selection.keys())}
            onToggleSelect={isAdmin ? toggleSelect : undefined}
            stormReports={stormReports}
            stormNow={stormFetchedAt}
            stormZones={stormZones}
            territories={mapTerritories}
            territoryLeadCounts={territoryLeadCounts}
            currentUserId={currentUserId}
            onSelectTerritoryLeads={isAdmin ? addTerritoryLeadsToSelection : undefined}
            onEditTerritory={isAdmin ? editTerritoryDetails : undefined}
            drawing={drawing}
            drawPoints={drawPoints}
            onDrawPoint={isAdmin ? (lat, lng) => setDrawPoints((p) => [...p, [lat, lng]]) : undefined}
            // A freehand trace is one shape, so it replaces rather than appends.
            onDrawPath={isAdmin ? (path) => setDrawPoints(path) : undefined}
            onMapReady={(map) => { mapRef.current = map; setMapInstance(map); }}
            onLogKnock={identityLoaded && currentUserId ? logKnock : undefined}
            loggingKnockFor={loggingKnockFor}
            onFollowUpChange={fetchLeads}
            marketId={selectedMarket?.id ?? null}
            marketCenter={marketCenter}
            marketLoading={loading}
            focus={alertFocus}
          />
        )}
      </div>

      <TerritorySheet
        open={territorySheetOpen}
        onOpenChange={setTerritorySheetOpen}
        territories={territories}
        leadCounts={territoryLeadCounts}
        loading={territoriesLoading}
        isAdmin={isAdmin}
        currentUserId={currentUserId}
        showArchived={showArchivedTerritories}
        onShowArchivedChange={setShowArchivedTerritories}
        onSelectLeads={isAdmin ? addTerritoryLeadsToSelection : undefined}
        onEdit={editTerritoryDetails}
        onEditBoundary={editTerritoryBoundary}
        onArchiveChange={changeTerritoryArchived}
        pendingTerritoryId={territoryArchivePendingId}
      />

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
    </div>
  );
}
