'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MapContainer, TileLayer, CircleMarker, Pane, Popup, Polygon, Polyline, Tooltip, useMap } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatDistanceToNow } from 'date-fns';
import { KNOCK_DISPOSITIONS, knockLabel, knockRecency, type KnockDisposition } from '@/lib/leads/knocks';
import { Button } from '@/components/ui/button';
import { FollowUpMenu } from '@/components/leads/FollowUpMenu';
import { LEAD_STATUS_OPTIONS } from '@/types';
import { shouldRecenterMap } from '@/lib/leads/markets';
import { classifyDrawGestureEnd, isDrag, shouldCapture, simplifyPath } from '@/lib/leads/draw';
import { STATUS_COLORS, DNC_RING_COLOR, DO_NOT_KNOCK_RING_COLOR, isLeadAddressDetailZoom, leadMarkerAppearance, stormColor, stormRadius, stormLabel, sortStormsForDrawing, stormAgeBucket, stormZoneStyle, stormAgeShort, type GeoLead, type StormReport } from './map-constants';
import { buildStormZones } from '@/lib/storm/zones';
import type { Territory } from '@/types';

// Phoenix metro — sensible default for an empty map until leads load
const DEFAULT_CENTER: [number, number] = [33.4, -111.9];
const DEFAULT_ZOOM = 10;

/** Freehand smoothing, in screen pixels — converted to degrees at draw time. */
const SIMPLIFY_TOLERANCE_PX = 4;

const STATUS_LABELS = Object.fromEntries(LEAD_STATUS_OPTIONS.map((o) => [o.value, o.label]));

/**
 * Run a view change once the map container actually has a size.
 *
 * A freshly mounted map has a 0x0 container until layout settles, and Leaflet's
 * flyTo divides by the container size — at zero it yields Invalid LatLng
 * (NaN, NaN) and throws, taking the page down. fitBounds doesn't throw but
 * lands on the wrong view.
 *
 * Measures the container element directly rather than map.getSize(), which
 * returns a value Leaflet cached at init and only refreshes on invalidateSize —
 * polling it would spin forever on a map that was born zero-sized.
 *
 * Runs synchronously when the container is already laid out, which is both the
 * common case and the only path that works in a BACKGROUND TAB, where
 * requestAnimationFrame never fires. Frame polling is just the fallback for a
 * container that hasn't been measured yet, and gives up after ~1s rather than
 * spinning on one that is legitimately hidden.
 */
function whenSized(map: LeafletMap, run: () => void): () => void {
  const el = map.getContainer();
  const sized = () => el.offsetWidth > 0 && el.offsetHeight > 0;
  if (sized()) {
    run();
    return () => {};
  }

  let cancelled = false;
  let frame = 0;
  let attempts = 0;
  const tick = () => {
    if (cancelled) return;
    if (sized()) {
      run();
      return;
    }
    if (attempts++ > 60) return;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}

function FitBounds({ leads, territories }: { leads: GeoLead[]; territories: Territory[] }) {
  const map = useMap();
  // Leads are the preferred fit. When filters or role visibility leave none,
  // saved territories still need to be discoverable—especially in All Markets,
  // which has no single office center to fall back to.
  const points = leads.length > 0
    ? leads.map((lead) => [lead.latitude, lead.longitude] as [number, number])
    : territories.flatMap((territory) => territory.boundary);
  const key = leads.length > 0
    ? `leads:${leads.length}:${leads[0].id}`
    : territories.length > 0
      ? `territories:${territories.length}:${territories[0].id}`
      : '';
  useEffect(() => {
    if (points.length === 0) return;
    // Defer to the next frame so the container has its final size, then
    // re-measure before fitting — otherwise it over-zooms to fit the bounds
    // into a stale (small) viewport.
    return whenSized(map, () => {
      map.invalidateSize();
      map.fitBounds(
        points,
        { padding: [40, 40], maxZoom: 16 }
      );
      // Re-measure once more after the view settles so the tile layer requests
      // tiles for the full container (not a stale smaller area).
      requestAnimationFrame(() => map.invalidateSize());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/**
 * Move the map to the selected office.
 *
 * FitBounds handles the case where the market has leads — fitting to them is
 * strictly better than a fixed center. This covers the case it can't: a market
 * with no mapped leads yet, where FitBounds bails out and the map would
 * otherwise sit over the previous office. Switching to Minnesota left you
 * looking at Phoenix.
 *
 * Keyed on the market id, so it fires on every switch but does NOT fight the
 * user's own panning and zooming while they stay in one market.
 */
function MarketView({
  marketId,
  center,
  hasLeads,
  loading,
}: {
  marketId: number | null;
  center: { lat: number; lng: number; zoom: number | null } | null;
  hasLeads: boolean;
  loading: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    if (!shouldRecenterMap({ loading, hasLeads, hasCenter: !!center }) || !center) return;
    // Must wait for a real container size — flyTo on a 0x0 map throws
    // Invalid LatLng (NaN, NaN), which crashes the page.
    return whenSized(map, () => {
      map.invalidateSize();
      const target: [number, number] = [center.lat, center.lng];
      const zoom = center.zoom ?? DEFAULT_ZOOM;
      // flyTo animates on requestAnimationFrame, which is suspended while the
      // page is in a background tab — the animation would never progress and
      // the map would sit on the previous office. Jump straight there instead;
      // nobody is watching the transition anyway.
      if (typeof document !== 'undefined' && document.hidden) {
        map.setView(target, zoom, { animate: false });
      } else {
        map.flyTo(target, zoom, { duration: 0.8 });
      }
    });
    // marketId is the trigger: re-centre on switch, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, hasLeads, loading, map]);
  return null;
}

function MapReady({ onMapReady }: { onMapReady?: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => {
    onMapReady?.(map);
    // The container often finishes laying out after the map inits, leaving
    // tiles sized for a stale (small) area — re-measure immediately, again once
    // layout settles, and whenever the container actually resizes.
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 300);
    const t2 = setTimeout(() => map.invalidateSize(), 800);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
    };
  }, [map, onMapReady]);
  return null;
}

/**
 * Report only whether the map crossed the house-number visibility threshold.
 *
 * Keeping a boolean instead of the raw zoom avoids rerendering thousands of
 * lead markers on every zoom step when their visual treatment is unchanged.
 */
function LeadAddressDetailObserver({
  onChange,
}: {
  onChange: (addressDetail: boolean) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const report = () => onChange(isLeadAddressDetailZoom(map.getZoom()));
    report();
    map.on('zoomend', report);
    return () => {
      map.off('zoomend', report);
    };
  }, [map, onChange]);
  return null;
}

function FocusView({
  focus,
}: {
  focus: { key: string; lat: number; lng: number; zoom?: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    return whenSized(map, () => {
      map.invalidateSize();
      map.setView([focus.lat, focus.lng], focus.zoom ?? 12, { animate: false });
    });
  }, [focus, map]);
  return null;
}

/**
 * Territory drawing: drag to lasso, or tap to place corners.
 *
 * One gesture covers both. A press that moves past DRAG_THRESHOLD_PX starts a
 * freehand trace and replaces whatever was there; a press that doesn't move
 * appends a single vertex, which is the old click-to-place behaviour and is
 * still the better tool for a straight boundary along a highway.
 *
 * Map panning is disabled for the duration, otherwise dragging on a map does
 * what dragging on a map normally does and no lasso is ever drawn.
 */
function DrawLayer({
  drawing,
  points,
  onPoint,
  onPath,
}: {
  drawing: boolean;
  points: [number, number][];
  onPoint: (lat: number, lng: number) => void;
  onPath: (path: [number, number][]) => void;
}) {
  const map = useMap();
  // Refs, not state: these change on every pointer event and must not each
  // trigger a render.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const pathRef = useRef<[number, number][]>([]);
  const freehandRef = useRef(false);
  const activePointerRef = useRef<number | null>(null);
  const originalPathRef = useRef<[number, number][]>([]);
  const latestRef = useRef({ points, onPoint, onPath });

  // The parent updates points on every captured move and currently supplies
  // inline callbacks. Keep the pointer listeners mounted for the whole gesture
  // while still calling the latest props after those rerenders.
  useEffect(() => {
    latestRef.current = { points, onPoint, onPath };
  }, [points, onPoint, onPath]);

  useEffect(() => {
    if (!drawing) return;
    const container = map.getContainer();

    // Leaflet owns drag-to-pan and pinch-to-zoom; both have to yield while the
    // lasso is active. Record their prior state so cleanup does not enable an
    // interaction that the map's caller had already disabled.
    const draggingWasEnabled = map.dragging.enabled();
    const touchZoomWasEnabled = map.touchZoom.enabled();
    const tapHoldWasEnabled = map.tapHold?.enabled() ?? false;
    if (draggingWasEnabled) map.dragging.disable();
    if (touchZoomWasEnabled) map.touchZoom.disable();
    if (tapHoldWasEnabled) map.tapHold?.disable();

    const previousCursor = container.style.cursor;
    const previousTouchAction = container.style.touchAction;
    container.style.cursor = 'crosshair';
    // Pointer Events decide whether a gesture belongs to page scrolling at
    // pointerdown time. preventDefault() in pointermove is too late once the
    // browser has claimed it and sent pointercancel. Leaflet normally supplies
    // this through leaflet-touch-drag, but dragging.disable() removes that
    // class, so drawing mode needs an explicit inline override.
    container.style.touchAction = 'none';

    const toPoint = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    // Capture keeps the trace alive when the pointer wanders off the map, but
    // holding it is never guaranteed — a pointercancel releases it implicitly,
    // and both calls throw NotFoundError when the pointer isn't active. Letting
    // that escape would abort the handler before the shape is committed.
    const capture = (id: number) => {
      try {
        container.setPointerCapture(id);
      } catch {
        /* no active pointer — the drag still works, it just isn't captured */
      }
    };
    const release = (id: number) => {
      try {
        container.releasePointerCapture(id);
      } catch {
        /* never held, or already released */
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (!e.isPrimary || activePointerRef.current !== null) return;
      activePointerRef.current = e.pointerId;
      startRef.current = toPoint(e);
      lastRef.current = null;
      pathRef.current = [];
      freehandRef.current = false;
      originalPathRef.current = [...latestRef.current.points];
      capture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerRef.current) return;
      const start = startRef.current;
      if (!start) return;
      const at = toPoint(e);

      if (!freehandRef.current) {
        if (!isDrag(start, at)) return;
        freehandRef.current = true;
      }
      // Stop the browser turning the drag into a scroll or text selection.
      e.preventDefault();

      if (!shouldCapture(lastRef.current, at, { capturedCount: pathRef.current.length })) return;
      lastRef.current = at;
      const ll = map.containerPointToLatLng([at.x, at.y]);
      pathRef.current = [...pathRef.current, [ll.lat, ll.lng]];
      latestRef.current.onPath(pathRef.current);
    };

    const finishGesture = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId !== activePointerRef.current) return;
      const start = startRef.current;
      const wasFreehand = freehandRef.current;
      const raw = pathRef.current;
      const originalPath = originalPathRef.current;

      activePointerRef.current = null;
      startRef.current = null;
      lastRef.current = null;
      pathRef.current = [];
      originalPathRef.current = [];
      freehandRef.current = false;
      release(e.pointerId);
      if (!start) return;

      const action = classifyDrawGestureEnd(wasFreehand, cancelled);
      if (action === 'cancel') {
        // onMove publishes a live preview. Roll it back so cancellation has no
        // net drawing effect; an existing hand-placed outline is preserved.
        if (wasFreehand) latestRef.current.onPath(originalPath);
        return;
      }

      if (action === 'point') {
        // Never really moved — treat it as placing one corner.
        const ll = map.containerPointToLatLng([start.x, start.y]);
        latestRef.current.onPoint(ll.lat, ll.lng);
        return;
      }

      // Collapse the trace to the handful of vertices that describe it. The
      // tolerance is derived from the current scale so it means the same number
      // of SCREEN pixels at every zoom — a fixed value in degrees would erase a
      // whole neighbourhood when zoomed out.
      if (raw.length < 3) return;
      const origin = map.containerPointToLatLng([0, 0]);
      const offset = map.containerPointToLatLng([SIMPLIFY_TOLERANCE_PX, 0]);
      const tolerance = Math.abs(offset.lng - origin.lng);
      latestRef.current.onPath(simplifyPath(raw, tolerance));
    };

    const onUp = (e: PointerEvent) => finishGesture(e, false);
    const onCancel = (e: PointerEvent) => finishGesture(e, true);

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove, { passive: false });
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onCancel);

    return () => {
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onCancel);
      if (activePointerRef.current !== null) release(activePointerRef.current);
      activePointerRef.current = null;
      startRef.current = null;
      lastRef.current = null;
      pathRef.current = [];
      originalPathRef.current = [];
      freehandRef.current = false;
      if (draggingWasEnabled) map.dragging.enable();
      if (touchZoomWasEnabled) map.touchZoom.enable();
      if (tapHoldWasEnabled) map.tapHold?.enable();
      container.style.cursor = previousCursor;
      container.style.touchAction = previousTouchAction;
    };
  }, [drawing, map]);

  if (!drawing || points.length === 0) return null;
  return (
    <>
      {points.length >= 3 ? (
        <Polygon positions={points} pathOptions={{ color: '#2563eb', weight: 2, fillOpacity: 0.1 }} />
      ) : (
        <Polyline positions={points} pathOptions={{ color: '#2563eb', weight: 2, dashArray: '5' }} />
      )}
      {/* Vertex handles only for a hand-placed shape. A freehand trace has
          dozens of vertices and dotting every one buries the outline. */}
      {points.length <= 12 &&
        points.map((p, i) => (
          <CircleMarker
            key={`draw-${i}`}
            center={p}
            radius={4}
            pathOptions={{ fillColor: '#2563eb', fillOpacity: 1, color: '#fff', weight: 1.5 }}
          />
        ))}
    </>
  );
}

interface LeadMapProps {
  leads: GeoLead[];
  selectedIds: Set<string>;
  /** Present for admins only — enables the Select button in popups */
  onToggleSelect?: (lead: GeoLead) => void;
  onMapReady?: (map: LeafletMap) => void;
  /**
   * NOAA storm reports to overlay beneath the lead pins. May mix wind and hail —
   * each report carries its own `type`, so there is no ambient stormType prop.
   */
  stormReports?: StormReport[];
  /**
   * When the storm data was fetched, used to age each report.
   *
   * Supplied by the caller rather than read from the clock here: calling
   * Date.now() during render is impure, and ageing every marker against one
   * fetch-time instant also keeps reports from the same storm from landing in
   * different buckets mid-render.
   */
  stormNow?: number;
  /**
   * Overlay storm swaths beneath the individual report markers.
   *
   * Reports are clustered into the swath each storm cut and coloured by age,
   * while every touchdown remains visible for severity and exact details.
   */
  stormZones?: boolean;
  /** Log a knock straight from the pin popup. */
  onLogKnock?: (lead: GeoLead, disposition: KnockDisposition) => void;
  /** Lead id currently being written, so its buttons can disable. */
  loggingKnockFor?: string | null;
  /** Refetch after a follow-up is set from a popup. */
  onFollowUpChange?: () => void;
  /** Selected office, so the map can move to it when there's nothing to fit. */
  marketId?: number | null;
  marketCenter?: { lat: number; lng: number; zoom: number | null } | null;
  /** True while leads are being refetched, so the view waits for the result. */
  marketLoading?: boolean;
  /** Territory-drawing mode */
  drawing?: boolean;
  drawPoints?: [number, number][];
  onDrawPoint?: (lat: number, lng: number) => void;
  /** Replaces the whole outline — a freehand trace, not a single vertex. */
  onDrawPath?: (path: [number, number][]) => void;
  /** Persisted canvassing boundaries for the selected market. */
  territories?: Territory[];
  territoryLeadCounts?: Record<string, number>;
  currentUserId?: string | null;
  onSelectTerritoryLeads?: (territory: Territory) => void;
  onEditTerritory?: (territory: Territory) => void;
  /** One-time focus supplied by a storm-alert deep link. */
  focus?: { key: string; lat: number; lng: number; zoom?: number } | null;
}

export default function LeadMap({
  leads,
  selectedIds,
  onToggleSelect,
  onMapReady,
  stormReports = [],
  stormNow = 0,
  stormZones = false,
  onLogKnock,
  loggingKnockFor,
  onFollowUpChange,
  marketId = null,
  marketCenter = null,
  marketLoading = false,
  drawing = false,
  drawPoints = [],
  onDrawPoint,
  onDrawPath,
  territories = [],
  territoryLeadCounts = {},
  currentUserId = null,
  onSelectTerritoryLeads,
  onEditTerritory,
  focus = null,
}: LeadMapProps) {
  const [addressDetail, setAddressDetail] = useState(false);
  // Zone construction uses quadratic clustering in the worst case. Keep it
  // tied to storm-data changes so selecting a lead or opening a popup cannot
  // rebuild thousands of report relationships.
  const visibleStormZones = useMemo(
    () => (stormZones ? buildStormZones(stormReports) : []),
    [stormReports, stormZones]
  );
  const visibleStormReports = useMemo(
    () => sortStormsForDrawing(stormReports, stormNow),
    [stormNow, stormReports]
  );

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      preferCanvas
      // Leaflet fades tiles in via a requestAnimationFrame loop that can stall
      // when the map is mounted/torn down twice (React StrictMode) or resized
      // mid-fade — tiles then sit permanently at partial opacity and the basemap
      // looks blank. We measured them stuck at 0.19. No fade = tiles paint at
      // full opacity immediately.
      fadeAnimation={false}
      className="h-full w-full z-0 rounded-md"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <FitBounds leads={focus ? [] : leads} territories={focus ? [] : territories} />
      <MarketView
        marketId={marketId}
        center={focus ? null : marketCenter}
        hasLeads={leads.length > 0}
        loading={marketLoading}
      />
      <FocusView focus={focus} />
      <MapReady onMapReady={onMapReady} />
      <LeadAddressDetailObserver onChange={setAddressDetail} />
      {/* All interactive vectors share one Canvas renderer. Separate
          preferCanvas panes each create a full-map canvas; a higher empty
          canvas still intercepts the pointer and makes every lower layer
          unclickable. Draw order inside this pane is also hit-test order:
          zones, territories, storm points, lead pins, then the active draft.
          Every Tooltip and Popup below names Leaflet's HTML overlay pane
          explicitly; otherwise nesting under this Pane makes it inherit
          map-data and lets the Canvas paint over the information. */}
      <Pane name="map-data" style={{ zIndex: 350 }}>
      {/* Storm swaths are an underlay, never a replacement for the report dots.
          The restrained red ramp answers "where and when"; the severity-coloured
          dots above answer "exactly where and how strong." */}
      {visibleStormZones.map((zone) => {
        const age = stormAgeBucket(zone.latestDate, stormNow);
        const style = stormZoneStyle(age.key);
        return (
          <Polygon
            key={`zone-${zone.key}`}
            positions={zone.hull}
            pathOptions={{
              color: style.stroke,
              fillColor: style.fill,
              fillOpacity: style.fillOpacity,
              weight: style.weight,
              opacity: style.opacity,
              dashArray: style.dashArray,
            }}
          >
            {/* The age, written on the zone. Screen-space text survives
                any zoom level, which no colour encoding does. */}
            <Tooltip
              permanent
              direction="center"
              className="storm-zone-label"
              pane="tooltipPane"
            >
              {zone.type === 'hail' ? 'Hail' : 'Wind'} · {stormAgeShort(zone.latestDate, stormNow)}
            </Tooltip>
            <Popup pane="popupPane">
              <div className="space-y-0.5 text-sm">
                <p className="font-medium capitalize">
                  {zone.type} zone · {zone.reportCount} reports
                </p>
                <p className="text-xs font-medium" style={{ color: style.stroke }}>
                  {formatDistanceToNow(new Date(`${zone.latestDate}T12:00:00Z`), { addSuffix: true })}
                  {' · '}
                  {age.label.toLowerCase()}
                </p>
                {zone.peakValue != null && (
                  <p className="text-xs">
                    Peak {zone.type === 'hail'
                      ? `${zone.peakValue.toFixed(2)}" hail`
                      : `${zone.peakValue} mph`}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {zone.earliestDate === zone.latestDate
                    ? zone.latestDate
                    : `${zone.earliestDate} – ${zone.latestDate}`}
                </p>
              </div>
            </Popup>
          </Polygon>
        );
      })}

      {/* Saved territories draw before storm points, so an area fill cannot
          steal a report's hover/click target. */}
      {/* Saved territory ownership lives between weather and lead pins.
          When storm zones are visible, outlines stay but fills drop away so
          the two area encodings never turn into an unreadable colour blend. */}
        {territories.map((territory) => {
          const ownedByCurrentUser =
            !!currentUserId && territory.owner_user_id === currentUserId;
          const shownLeadCount = territoryLeadCounts[territory.id] ?? 0;
          return (
            <Polygon
              key={territory.id}
              positions={territory.boundary}
              interactive={!drawing}
              pathOptions={{
                color: territory.color,
                fillColor: territory.color,
                fill: !stormZones,
                fillOpacity: stormZones ? 0 : ownedByCurrentUser ? 0.14 : 0.08,
                weight: ownedByCurrentUser ? 4 : 2,
                opacity: 0.95,
              }}
            >
              <Tooltip
                permanent
                direction="center"
                className="territory-label"
                pane="tooltipPane"
              >
                {territory.name}
              </Tooltip>
              <Popup pane="popupPane">
                <div className="min-w-[180px] space-y-1 text-sm">
                  <p className="font-medium">{territory.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {territory.owner_name ?? 'Unassigned'} · {shownLeadCount} shown lead
                    {shownLeadCount !== 1 ? 's' : ''}
                  </p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {onSelectTerritoryLeads && (
                      <Button
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onSelectTerritoryLeads(territory)}
                      >
                        Select leads
                      </Button>
                    )}
                    {onEditTerritory && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => onEditTerritory(territory)}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              </Popup>
            </Polygon>
          );
        })}

      {/* NOAA storm reports — after swaths and territory fills but beneath lead pins.
          They stay visible when Zones is on, so the combined view shows both
          the total footprint and every measured touchdown.
          Colour and radius carry SEVERITY; opacity carries AGE. With two years
          of history on the map, a fresh 1" hailstorm is worth more than a 2" one
          from last spring, so recent reports read solid and old ones fade back.
          Sorted oldest-first so the fresh ones land on top and stay clickable. */}
      {visibleStormReports.map((r, i) => {
        const color = stormColor(r.type, r.value);
        const age = stormAgeBucket(r.date, stormNow);
        const radius = stormRadius(r.type, r.value);
        return (
          <CircleMarker
            key={`storm-${r.type}-${i}`}
            center={[r.lat, r.lon]}
            radius={radius}
            pathOptions={{
              fillColor: color,
              fillOpacity: age.fillOpacity,
              color,
              weight: age.weight,
              // A crisp outline on the freshest reports so they pop out of a
              // field of faded old ones even at a glance.
              opacity: age.key === 'fresh' ? 1 : 0.5,
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -(radius + 2)]}
              opacity={1}
              pane="tooltipPane"
            >
              <div className="space-y-0.5 text-xs">
                <p className="font-medium">{stormLabel(r.type, r.value)}</p>
                <p>{r.date}</p>
                {(r.location || r.state) && (
                  <p>
                    {r.location}
                    {r.location && r.state ? ', ' : ''}
                    {r.state}
                  </p>
                )}
              </div>
            </Tooltip>
            <Popup pane="popupPane">
              <div className="text-sm">
                <p className="font-medium">{stormLabel(r.type, r.value)}</p>
                <p className="text-xs">
                  {/* Relative age first — "3 weeks ago" is the number a rep
                      acts on; the calendar date is the supporting detail. */}
                  <span className="font-medium">
                    {formatDistanceToNow(new Date(`${r.date}T12:00:00Z`), { addSuffix: true })}
                  </span>
                  {' · '}
                  {r.date}
                </p>
                {(r.location || r.state) && (
                  <p className="text-xs">
                    {r.location}
                    {r.location && r.state ? ', ' : ''}
                    {r.state}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  NOAA storm report · {age.label.toLowerCase()}
                </p>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {leads.map((lead) => {
        const selected = selectedIds.has(lead.id);
        const marker = leadMarkerAppearance({
          addressDetail,
          statusColor: STATUS_COLORS[lead.status] ?? STATUS_COLORS.new,
          selected,
          recentlyKnocked: knockRecency(lead.last_knock_at) === 'recent',
          doNotKnock: lead.do_not_knock,
          isDnc: lead.is_dnc,
        });
        return (
          <CircleMarker
            key={lead.id}
            center={[lead.latitude, lead.longitude]}
            radius={marker.radius}
            pathOptions={{
              fillColor: marker.fillColor,
              fillOpacity: marker.fillOpacity,
              color: marker.strokeColor,
              weight: marker.strokeWeight,
            }}
          >
            <Popup pane="popupPane">
              <div className="space-y-1 text-sm min-w-[180px]">
                <p className="font-medium">
                  {lead.first_name} {lead.last_name}
                </p>
                <p className="text-xs">
                  {[lead.address_street, lead.address_city].filter(Boolean).join(', ') || 'No address'}
                </p>
                <p className="text-xs">
                  {STATUS_LABELS[lead.status] ?? lead.status}
                  {lead.estimated_roof_value != null &&
                    ` · ~$${Number(lead.estimated_roof_value).toLocaleString()}`}
                </p>
                {lead.is_dnc && (
                  <p className="text-xs font-semibold" style={{ color: DNC_RING_COLOR }}>
                    Do Not Call — knock only
                  </p>
                )}
                {lead.hail_size_inches != null && (
                  <p className="text-xs font-medium text-blue-600">
                    {Number(lead.hail_size_inches).toFixed(2)}&quot; hail
                    {lead.hail_date ? ` · ${lead.hail_date}` : ''}
                  </p>
                )}
                {lead.do_not_knock && (
                  <p className="text-xs font-semibold" style={{ color: DO_NOT_KNOCK_RING_COLOR }}>
                    Do not knock — homeowner asked
                  </p>
                )}
                {lead.last_knock_at && (
                  <p className="text-xs text-muted-foreground">
                    Knocked {formatDistanceToNow(new Date(lead.last_knock_at), { addSuffix: true })}
                    {lead.last_disposition ? ` · ${knockLabel(lead.last_disposition)}` : ''}
                    {lead.knock_count > 1 ? ` · ${lead.knock_count}×` : ''}
                  </p>
                )}

                {/* The daily loop: standing at the door, one tap to record what
                    happened. Hidden for do-not-knock houses so the quickest
                    action can't be to knock one again. */}
                {onLogKnock && !lead.do_not_knock && (
                  <div className="border-t pt-1.5">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Log knock
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {KNOCK_DISPOSITIONS.map((d) => (
                        <button
                          key={d.value}
                          type="button"
                          title={d.hint}
                          disabled={loggingKnockFor === lead.id}
                          onClick={() => onLogKnock(lead, d.value)}
                          className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50"
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* A "Callback" knock is a promise to return. Without capturing
                    when, it was recorded and then lost — so the control is
                    promoted here rather than buried on the lead page. */}
                {onLogKnock && (lead.last_disposition === 'callback' || lead.follow_up_date) && (
                  <div className="border-t pt-1.5">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {lead.follow_up_date ? 'Following up' : 'Come back when?'}
                    </p>
                    <FollowUpMenu
                      leadId={lead.id}
                      followUpDate={lead.follow_up_date}
                      onChange={onFollowUpChange}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Link href={`/admin/leads/${lead.id}`} className="text-xs underline">
                    View lead →
                  </Link>
                  {onToggleSelect && (
                    <Button
                      size="sm"
                      variant={selected ? 'secondary' : 'default'}
                      className="h-6 px-2 text-xs"
                      onClick={() => onToggleSelect(lead)}
                    >
                      {selected ? 'Deselect' : 'Select'}
                    </Button>
                  )}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {/* The active draft is last so its handles stay visible. DrawLayer's
          carefully-tested pointer lifecycle remains untouched. */}
      {onDrawPoint && onDrawPath && (
        <DrawLayer drawing={drawing} points={drawPoints} onPoint={onDrawPoint} onPath={onDrawPath} />
      )}
      </Pane>
    </MapContainer>
  );
}
