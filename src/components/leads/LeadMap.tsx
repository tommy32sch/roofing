'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { MapContainer, TileLayer, CircleMarker, Popup, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/button';
import { LEAD_STATUS_OPTIONS } from '@/types';
import { STATUS_COLORS, DNC_RING_COLOR, stormColor, stormRadius, stormLabel, type GeoLead, type StormReport, type StormType } from './map-constants';

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
  drawing = false,
  drawPoints = [],
  onDrawPoint,
}: LeadMapProps) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      preferCanvas
      className="h-full w-full z-0 rounded-md"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <FitBounds leads={leads} />
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
              fillOpacity: 0.85,
              // Selected wins the ring; otherwise a red ring marks Do Not Call (knock-only)
              color: selected ? '#111111' : lead.is_dnc ? DNC_RING_COLOR : '#ffffff',
              weight: selected || lead.is_dnc ? 3 : 1.5,
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
