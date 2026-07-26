'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { BoxSelect, UserCheck, LocateFixed, CloudHail, Wind, Pencil, ChevronDown, Check } from 'lucide-react';
import { toast } from 'sonner';
import { knockLabel, type KnockDisposition } from '@/lib/leads/knocks';
import type { Map as LeafletMap } from 'leaflet';
import { Button } from '@/components/ui/button';
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
  stormLegendEntries, STORM_WINDOWS, stormWindowLabel, STORM_MIN_VALUES, stormMinLabel,
  type GeoLead, type StormReport, type StormType,
} from '@/components/leads/map-constants';
import { LEAD_STATUS_OPTIONS, LEAD_PRIORITY_OPTIONS } from '@/types';
import type { UserRole } from '@/types';
import { LIMITS } from '@/lib/utils/validation';
import { pointInPolygon } from '@/lib/leads/geo-polygon';
import { PageHeader } from '@/components/layout/page-header';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';

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
  const stormCounts = countStormsByType(stormReports);
  const [stormLoading, setStormLoading] = useState(false);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const mapRef = useRef<LeafletMap | null>(null);
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

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetch('/api/admin/auth/me')
      .then((r) => r.json())
      .then((d) => { if (d.success) setUserRole(d.admin.role); })
      .catch(() => {});
  }, []);

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
    for (const lead of leads) {
      if (bounds.contains([lead.latitude, lead.longitude])) next.add(lead.id);
    }
    setVisibleIds(next);
  }, [leads]);

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
        for (const lead of leads) {
          if (visibleIds.has(lead.id)) next.set(lead.id, Number(lead.estimated_roof_value) || 0);
        }
      }
      return next;
    });
  }

  const [loggingKnockFor, setLoggingKnockFor] = useState<string | null>(null);

  /**
   * Log a knock from the pin popup. Refetches so the pin immediately reflects
   * the new state — a rep needs to see at a glance that this door is done.
   */
  async function logKnock(lead: GeoLead, disposition: KnockDisposition) {
    setLoggingKnockFor(lead.id);
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}/knocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disposition }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          `${lead.first_name} ${lead.last_name} — ${knockLabel(disposition)}` +
            (data.statusChangedTo ? ` · moved to ${data.statusChangedTo.replace('_', ' ')}` : '')
        );
        fetchLeads();
      } else {
        toast.error(data.error || 'Failed to log knock');
      }
    } catch {
      toast.error('Failed to log knock');
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

  function finishDraw() {
    if (drawPoints.length < 3) {
      toast.error('Add at least 3 points to make an area');
      return;
    }
    const inside = leads.filter((l) => pointInPolygon([l.latitude, l.longitude], drawPoints));
    if (inside.length === 0) {
      toast.info('No leads inside that area');
    } else {
      setSelection((prev) => {
        const next = new Map(prev);
        for (const l of inside) next.set(l.id, Number(l.estimated_roof_value) || 0);
        return next;
      });
      toast.success(`${inside.length} lead${inside.length !== 1 ? 's' : ''} selected in the area`);
    }
    setDrawing(false);
    setDrawPoints([]);
  }

  function cancelDraw() {
    setDrawing(false);
    setDrawPoints([]);
  }

  const selectionTotal = [...selection.values()].reduce((sum, v) => sum + v, 0);

  // Map height budget, measured rather than guessed. Desktop: viewport minus the
  // app header (3.5rem) and main's vertical padding (4rem). Mobile reserves more
  // for the fixed bottom tab bar.
  return (
    <div className="flex min-h-[420px] flex-col gap-3 h-[calc(100dvh-13rem)] md:h-[calc(100dvh-7.5rem)]">
      <PageHeader
        title="Map"
        description="Lead locations, storm overlays and territory selection"
        actions={
          <>
  
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
              <Button variant="outline" size="sm" onClick={() => setDrawing(true)} disabled={loading || leads.length === 0}>
                <Pencil className="h-4 w-4 mr-1" />
                Draw area
              </Button>
            )}
            {isAdmin && drawing && (
              <>
                <Button variant="default" size="sm" onClick={finishDraw}>
                  Finish{drawPoints.length > 0 ? ` (${drawPoints.length})` : ''}
                </Button>
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
              <MarketFilter markets={markets} value={marketValue} onChange={setMarket} className="w-[150px]" />
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
          Click the map to drop corners around a neighborhood, then <strong>Finish</strong> to select every lead inside — the assign bar appears so you can hand the territory to a rep.
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
            {stormLegendEntries(stormTypes).map((entry) => (
              <span key={entry.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: entry.color, opacity: 0.6 }}
                />
                {entry.label}
              </span>
            ))}
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 isolate">
        {!hasLoadedOnce ? (
          <Skeleton className="h-full w-full rounded-md" />
        ) : (
          <LeadMap
            leads={leads}
            selectedIds={new Set(selection.keys())}
            onToggleSelect={isAdmin ? toggleSelect : undefined}
            stormReports={stormReports}
            drawing={drawing}
            drawPoints={drawPoints}
            onDrawPoint={isAdmin ? (lat, lng) => setDrawPoints((p) => [...p, [lat, lng]]) : undefined}
            onMapReady={(map) => { mapRef.current = map; setMapInstance(map); }}
            onLogKnock={logKnock}
            loggingKnockFor={loggingKnockFor}
            onFollowUpChange={fetchLeads}
            marketId={selectedMarket?.id ?? null}
            marketCenter={marketCenter}
            marketLoading={loading}
          />
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
