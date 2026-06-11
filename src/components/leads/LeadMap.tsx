'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/button';
import { LEAD_STATUS_OPTIONS } from '@/types';
import { STATUS_COLORS, type GeoLead } from './map-constants';

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
    map.fitBounds(
      leads.map((l) => [l.latitude, l.longitude] as [number, number]),
      { padding: [40, 40], maxZoom: 16 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function MapReady({ onMapReady }: { onMapReady?: (map: LeafletMap) => void }) {
  const map = useMap();
  useEffect(() => {
    onMapReady?.(map);
  }, [map, onMapReady]);
  return null;
}

interface LeadMapProps {
  leads: GeoLead[];
  selectedIds: Set<string>;
  /** Present for admins only — enables the Select button in popups */
  onToggleSelect?: (lead: GeoLead) => void;
  onMapReady?: (map: LeafletMap) => void;
}

export default function LeadMap({ leads, selectedIds, onToggleSelect, onMapReady }: LeadMapProps) {
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
              color: selected ? '#111111' : '#ffffff',
              weight: selected ? 3 : 1.5,
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
