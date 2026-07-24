'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { MapContainer, TileLayer, CircleMarker, Popup, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatDistanceToNow } from 'date-fns';
import { KNOCK_DISPOSITIONS, knockLabel, knockRecency, type KnockDisposition } from '@/lib/leads/knocks';
import { Button } from '@/components/ui/button';
import { LEAD_STATUS_OPTIONS } from '@/types';
import { STATUS_COLORS, DNC_RING_COLOR, DO_NOT_KNOCK_RING_COLOR, stormColor, stormRadius, stormLabel, type GeoLead, type StormReport, type StormType } from './map-constants';

// Phoenix metro — sensible default for an empty map until leads load
const DEFAULT_CENTER: [number, number] = [33.4, -111.9];
const DEFAULT_ZOOM = 10;

const STATUS_LABELS = Object.fromEntries(LEAD_STATUS_OPTIONS.map((o) => [o.value, o.label]));

function FitBounds({ leads }: { leads: GeoLead[] }) {
  const map = useMap();
  // Refit when the result set changes identity (filter change / first load)
  const key = leads.length > 0 ? `${leads.length}:${leads[0].id}` : '';
  useEffect(() => {
    if (leads.length === 0) return;
    // Defer to the next frame so the container has its final size, then
    // re-measure before fitting — otherwise it over-zooms to fit the bounds
    // into a stale (small) viewport.
    const id = requestAnimationFrame(() => {
      map.invalidateSize();
      map.fitBounds(
        leads.map((l) => [l.latitude, l.longitude] as [number, number]),
        { padding: [40, 40], maxZoom: 16 }
      );
      // Re-measure once more after the view settles so the tile layer requests
      // tiles for the full container (not a stale smaller area).
      requestAnimationFrame(() => map.invalidateSize());
    });
    return () => cancelAnimationFrame(id);
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
    // Wait for the new market's leads to land before deciding there are none.
    // Mid-fetch, `leads` still holds the PREVIOUS market's pins, so acting
    // early would fly to the centre and then FitBounds would immediately refit
    // to the leads — two animations for one click.
    if (loading || hasLeads || !center) return;
    map.flyTo([center.lat, center.lng], center.zoom ?? DEFAULT_ZOOM, { duration: 0.8 });
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
  /** NOAA storm reports to overlay beneath the lead pins */
  stormReports?: StormReport[];
  stormType?: StormType;
  /** Log a knock straight from the pin popup. */
  onLogKnock?: (lead: GeoLead, disposition: KnockDisposition) => void;
  /** Lead id currently being written, so its buttons can disable. */
  loggingKnockFor?: string | null;
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
  stormType = 'hail',
  onLogKnock,
  loggingKnockFor,
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
      {/* NOAA storm reports — drawn first so lead pins sit on top */}
      {stormReports.map((r, i) => {
        const color = stormColor(stormType, r.value);
        return (
          <CircleMarker
            key={`storm-${i}`}
            center={[r.lat, r.lon]}
            radius={stormRadius(stormType, r.value)}
            pathOptions={{ fillColor: color, fillOpacity: 0.3, color, weight: 1 }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-medium">{stormLabel(stormType, r.value)}</p>
                <p className="text-xs">
                  {r.date}
                  {r.location ? ` · ${r.location}` : ''}
                  {r.state ? `, ${r.state}` : ''}
                </p>
                <p className="text-[11px] text-muted-foreground">NOAA storm report</p>
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
