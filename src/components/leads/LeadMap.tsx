'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { MapContainer, TileLayer, CircleMarker, Popup, Polygon, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatDistanceToNow } from 'date-fns';
import { KNOCK_DISPOSITIONS, knockLabel, knockRecency, type KnockDisposition } from '@/lib/leads/knocks';
import { Button } from '@/components/ui/button';
import { FollowUpMenu } from '@/components/leads/FollowUpMenu';
import { LEAD_STATUS_OPTIONS } from '@/types';
import { shouldRecenterMap } from '@/lib/leads/markets';
import { STATUS_COLORS, DNC_RING_COLOR, DO_NOT_KNOCK_RING_COLOR, stormColor, stormRadius, stormLabel, sortStormsForDrawing, stormAgeBucket, stormZoneStyle, stormAgeShort, type GeoLead, type StormReport } from './map-constants';
import { partitionStormReports } from '@/lib/storm/zones';

// Phoenix metro — sensible default for an empty map until leads load
const DEFAULT_CENTER: [number, number] = [33.4, -111.9];
const DEFAULT_ZOOM = 10;

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

function FitBounds({ leads }: { leads: GeoLead[] }) {
  const map = useMap();
  // Refit when the result set changes identity (filter change / first load)
  const key = leads.length > 0 ? `${leads.length}:${leads[0].id}` : '';
  useEffect(() => {
    if (leads.length === 0) return;
    // Defer to the next frame so the container has its final size, then
    // re-measure before fitting — otherwise it over-zooms to fit the bounds
    // into a stale (small) viewport.
    return whenSized(map, () => {
      map.invalidateSize();
      map.fitBounds(
        leads.map((l) => [l.latitude, l.longitude] as [number, number]),
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

function DrawLayer({
  drawing,
  points,
  onPoint,
}: {
  drawing: boolean;
  points: [number, number][];
  onPoint: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (drawing) onPoint(e.latlng.lat, e.latlng.lng);
    },
  });
  if (!drawing || points.length === 0) return null;
  return (
    <>
      {points.length >= 3 ? (
        <Polygon positions={points} pathOptions={{ color: '#2563eb', weight: 2, fillOpacity: 0.1 }} />
      ) : (
        <Polyline positions={points} pathOptions={{ color: '#2563eb', weight: 2, dashArray: '5' }} />
      )}
      {points.map((p, i) => (
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
   * Draw storm swaths instead of relying on individual markers.
   *
   * The "which neighbourhoods got hit recently" view: reports are clustered into
   * the swath each storm cut, and the swath is coloured by age.
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
}: LeadMapProps) {
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
      <FitBounds leads={leads} />
      <MarketView marketId={marketId} center={marketCenter} hasLeads={leads.length > 0} loading={marketLoading} />
      <MapReady onMapReady={onMapReady} />
      {onDrawPoint && <DrawLayer drawing={drawing} points={drawPoints} onPoint={onDrawPoint} />}
      {/* Storm ZONES — the swath each storm cut, coloured by age.
          The zoomed-out planning view. One red ramp, fading with age, and the
          age written straight onto each zone in screen pixels — a label needs no
          legend. The severity markers are hidden while this is on: age and
          severity sharing one screen was unreadable mush ("everything just
          looks orange and red"), and severity is the marker view's job. */}
      {stormZones && (() => {
        const { zones, strays } = partitionStormReports(stormReports);
        return (
          <>
            {/* Strays: hits that formed no swath. Quiet grey dots so the data
                is still on the map without shouting over the zones. */}
            {strays.map((r, i) => (
              <CircleMarker
                key={`stray-${r.type}-${i}`}
                center={[r.lat, r.lon]}
                radius={3}
                pathOptions={{ fillColor: '#94a3b8', fillOpacity: 0.5, weight: 0 }}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium">{stormLabel(r.type, r.value)}</p>
                    <p className="text-xs">
                      {formatDistanceToNow(new Date(`${r.date}T12:00:00Z`), { addSuffix: true })}
                      {' · '}
                      {r.date}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Isolated report — no zone</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
            {zones.map((zone) => {
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
                  <Tooltip permanent direction="center" className="storm-zone-label">
                    {zone.type === 'hail' ? 'Hail' : 'Wind'} · {stormAgeShort(zone.latestDate, stormNow)}
                  </Tooltip>
                  <Popup>
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
          </>
        );
      })()}

      {/* NOAA storm reports — drawn beneath the lead pins. Hidden while the
          zones view is on: that view answers "when/where", and layering
          severity colours under the age ramp was unreadable.
          Colour and radius carry SEVERITY; opacity carries AGE. With two years
          of history on the map, a fresh 1" hailstorm is worth more than a 2" one
          from last spring, so recent reports read solid and old ones fade back.
          Sorted oldest-first so the fresh ones land on top and stay clickable. */}
      {!stormZones && sortStormsForDrawing(stormReports, stormNow).map((r, i) => {
        const color = stormColor(r.type, r.value);
        const age = stormAgeBucket(r.date, stormNow);
        return (
          <CircleMarker
            key={`storm-${r.type}-${i}`}
            center={[r.lat, r.lon]}
            radius={stormRadius(r.type, r.value)}
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
            <Popup>
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
        return (
          <CircleMarker
            key={lead.id}
            center={[lead.latitude, lead.longitude]}
            radius={selected ? 11 : 8}
            pathOptions={{
              fillColor: STATUS_COLORS[lead.status] ?? STATUS_COLORS.new,
              // Recently knocked doors fade back so a rep's eye goes to the ones
              // still worth walking to.
              fillOpacity: knockRecency(lead.last_knock_at) === 'recent' ? 0.35 : 0.85,
              // Ring precedence: selection, then do-not-knock, then Do Not Call.
              color: selected
                ? '#111111'
                : lead.do_not_knock
                  ? DO_NOT_KNOCK_RING_COLOR
                  : lead.is_dnc
                    ? DNC_RING_COLOR
                    : '#ffffff',
              weight: selected || lead.do_not_knock || lead.is_dnc ? 3 : 1.5,
            }}
          >
            <Popup>
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
    </MapContainer>
  );
}
