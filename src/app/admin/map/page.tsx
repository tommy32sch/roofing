'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { BoxSelect, UserCheck, LocateFixed, CloudHail, Wind, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { knockLabel, type KnockDisposition } from '@/lib/leads/knocks';
import type { Map as LeafletMap } from 'leaflet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BulkAssignDialog } from '@/components/leads/BulkAssignDialog';
import { STATUS_COLORS, DNC_RING_COLOR, stormColor, type GeoLead, type StormReport, type StormType } from '@/components/leads/map-constants';
import { LEAD_STATUS_OPTIONS, LEAD_PRIORITY_OPTIONS } from '@/types';
import type { UserRole } from '@/types';
import { LIMITS } from '@/lib/utils/validation';
import { pointInPolygon } from '@/lib/leads/geo-polygon';
import { PageHeader } from '@/components/layout/page-header';

// Leaflet touches `window` at import time — client-only
const LeadMap = dynamic(() => import('@/components/leads/LeadMap'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-md" />,
});

export default function MapPage() {
  const [leads, setLeads] = useState<GeoLead[]>([]);
  const [missingCoords, setMissingCoords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [userRole, setUserRole] = useState<UserRole>('setter');
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeStatus, setGeocodeStatus] = useState('');
  const [stormOn, setStormOn] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [stormType, setStormType] = useState<StormType>('wind');
  const [stormDays, setStormDays] = useState(30);
  const [stormReports, setStormReports] = useState<StormReport[]>([]);
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
    }
  }, [status, priority]);

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
    const b = map.getBounds();
    setStormLoading(true);
    try {
      const params = new URLSearchParams({
        days: String(stormDays),
        n: String(b.getNorth()),
        s: String(b.getSouth()),
        e: String(b.getEast()),
        w: String(b.getWest()),
      });
      const res = await fetch(`/api/admin/storm/${stormType}?${params}`);
      const data = await res.json();
      if (data.success) setStormReports(data.reports);
      else toast.error(data.error || 'Failed to load storm data');
    } catch {
      toast.error('Failed to load storm data');
    } finally {
      setStormLoading(false);
    }
  }, [stormDays, stormType]);

  // Fetch when storm mode turns on or the type/window changes; clear when off.
  useEffect(() => {
    if (stormOn) fetchStorm();
    else setStormReports([]);
  }, [stormOn, fetchStorm]);

  // Keep the storm layer in sync with the map as it pans/zooms (debounced).
  useEffect(() => {
    if (!mapInstance || !stormOn) return;
    let t: ReturnType<typeof setTimeout>;
    const onMove = () => { clearTimeout(t); t = setTimeout(() => fetchStorm(), 500); };
    mapInstance.on('moveend', onMove);
    return () => { clearTimeout(t); mapInstance.off('moveend', onMove); };
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
            <Button
              variant={stormOn ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStormOn((v) => !v)}
            >
              {stormType === 'wind' ? (
                <Wind className={`h-4 w-4 mr-1 ${stormLoading ? 'animate-pulse' : ''}`} />
              ) : (
                <CloudHail className={`h-4 w-4 mr-1 ${stormLoading ? 'animate-pulse' : ''}`} />
              )}
              Storm{stormOn && stormReports.length > 0 ? ` (${stormReports.length})` : ''}
            </Button>
            {stormOn && (
              <>
                <Select value={stormType} onValueChange={(v) => v && setStormType(v as StormType)}>
                  <SelectTrigger className="w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wind">Wind</SelectItem>
                    <SelectItem value="hail">Hail</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={String(stormDays)} onValueChange={(v) => v && setStormDays(parseInt(v, 10))}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="60">Last 60 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                  </SelectContent>
                </Select>
              </>
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
            {(stormType === 'hail'
              ? [{ label: 'Hail 1"+', v: 1 }, { label: '1.5"+', v: 1.5 }, { label: '2"+', v: 2 }]
              : [{ label: 'Wind 58+', v: 58 }, { label: '74+', v: 74 }, { label: '90+ mph', v: 90 }]
            ).map((h) => (
              <span key={h.label} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: stormColor(stormType, h.v), opacity: 0.6 }}
                />
                {h.label}
              </span>
            ))}
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 isolate">
        {loading && leads.length === 0 ? (
          <Skeleton className="h-full w-full rounded-md" />
        ) : (
          <LeadMap
            leads={leads}
            selectedIds={new Set(selection.keys())}
            onToggleSelect={isAdmin ? toggleSelect : undefined}
            stormReports={stormReports}
            stormType={stormType}
            drawing={drawing}
            drawPoints={drawPoints}
            onDrawPoint={isAdmin ? (lat, lng) => setDrawPoints((p) => [...p, [lat, lng]]) : undefined}
            onMapReady={(map) => { mapRef.current = map; setMapInstance(map); }}
            onLogKnock={logKnock}
            loggingKnockFor={loggingKnockFor}
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
