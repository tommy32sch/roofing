import type { LeadStatus, LeadPriority } from '@/types';

/**
 * Pin colors per pipeline status — literal oklch values mirroring the
 * --pipeline-* tokens in globals.css (light theme). Leaflet's canvas renderer
 * needs concrete color strings; CSS variables don't resolve there. Kept in
 * this leaflet-free module so the map page can render a legend without
 * importing Leaflet (which touches `window` and breaks SSR).
 */
export const STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'oklch(0.60 0.17 250)',
  contacted: 'oklch(0.75 0.15 80)',
  appointment_set: 'oklch(0.60 0.17 300)',
  inspected: 'oklch(0.65 0.15 50)',
  proposal_sent: 'oklch(0.55 0.17 265)',
  sold: 'oklch(0.55 0.16 155)',
  lost: 'oklch(0.577 0.245 27)',
};

export interface GeoLead {
  id: string;
  first_name: string;
  last_name: string;
  latitude: number;
  longitude: number;
  status: LeadStatus;
  priority: LeadPriority;
  estimated_roof_value: number | null;
  address_street: string | null;
  address_city: string | null;
  is_dnc: boolean;
  hail_date: string | null;
  hail_size_inches: number | null;
}

/** Stroke color used to ring Do Not Call pins (knock-only). */
export const DNC_RING_COLOR = '#dc2626';

export interface HailReport {
  lat: number;
  lon: number;
  size: number; // inches
  date: string;
  location: string;
  state: string;
}

/** Marker fill for NOAA hail reports, scaled by hail size (inches). */
export function hailColor(sizeInches: number): string {
  if (sizeInches >= 2) return '#6d28d9'; // 2"+ violet — significant
  if (sizeInches >= 1.5) return '#2563eb'; // 1.5"+ blue
  if (sizeInches >= 1) return '#0891b2'; // 1"+ cyan
  return '#67e8f9'; // sub-severe light cyan
}
