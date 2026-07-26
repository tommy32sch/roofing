import type { LeadStatus, LeadPriority } from '@/types';

/**
 * Pin colors per pipeline status — literal oklch values mirroring the
 * --pipeline-* tokens in globals.css (light theme). Leaflet's canvas renderer
 * needs concrete color strings; CSS variables don't resolve there. Kept in
 * this leaflet-free module so the map page can render a legend without
 * importing Leaflet (which touches `window` and breaks SSR).
 */
export const STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'oklch(0.58 0.16 250)',
  contacted: 'oklch(0.62 0.12 195)',
  appointment_set: 'oklch(0.58 0.17 300)',
  inspected: 'oklch(0.72 0.14 95)',
  proposal_sent: 'oklch(0.52 0.16 275)',
  sold: 'oklch(0.56 0.16 150)',
  lost: 'oklch(0.55 0.16 25)',
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
  last_knock_at: string | null;
  last_disposition: string | null;
  knock_count: number;
  do_not_knock: boolean;
  follow_up_date: string | null;
}

/** Stroke color used to ring Do Not Call pins (knock-only). */
export const DNC_RING_COLOR = 'oklch(0.55 0.22 25)';

/** Ring for houses the homeowner asked us not to return to. */
export const DO_NOT_KNOCK_RING_COLOR = 'oklch(0.45 0.02 45)';

export type StormType = 'hail' | 'wind';

/** Storm history windows. Two years is what the stored history covers. */
export const STORM_WINDOWS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 182, label: 'Last 6 months' },
  { days: 365, label: 'Last year' },
  { days: 730, label: 'Last 2 years' },
] as const;

export function stormWindowLabel(days: number): string {
  return STORM_WINDOWS.find((w) => w.days === days)?.label ?? `Last ${days} days`;
}

/**
 * Minimum-severity steps, per type.
 *
 * Over two years a wide view fills with marginal reports, and severity is what
 * actually qualifies a roof — 1" hail is the usual insurer threshold, 58 mph is
 * the severe-wind criterion. Values are in the stored units: inches and mph.
 */
export const STORM_MIN_VALUES: Record<StormType, { value: number; label: string }[]> = {
  hail: [
    { value: 0, label: 'Any hail' },
    { value: 1, label: '1"+' },
    { value: 1.5, label: '1.5"+' },
    { value: 2, label: '2"+' },
  ],
  wind: [
    { value: 0, label: 'Any wind' },
    { value: 58, label: '58+ mph' },
    { value: 74, label: '74+ mph' },
    { value: 90, label: '90+ mph' },
  ],
};

/**
 * Label for the shared minimum-severity control.
 *
 * With both overlays on, one threshold has to describe two different units, so
 * the control shows the pair rather than pretending it's one number.
 */
export function stormMinLabel(active: StormType[], hailMin: number, windMin: number): string {
  const parts: string[] = [];
  if (active.includes('hail')) parts.push(hailMin > 0 ? `${hailMin}"` : 'any');
  if (active.includes('wind')) parts.push(windMin > 0 ? `${windMin}mph` : 'any');
  return parts.length ? `Min ${parts.join(' / ')}` : 'Min severity';
}

/** Selectable overlays, in the order they appear in the toolbar. */
export const STORM_TYPES: StormType[] = ['wind', 'hail'];

export interface StormReport {
  lat: number;
  lon: number;
  value: number | null; // hail: inches; wind: mph (null = damage report, no measured speed)
  date: string;
  location: string;
  state: string;
  /**
   * Which overlay this report came from.
   *
   * Required because wind and hail can be shown together: a merged list has no
   * single ambient type, so colour, radius and label must come from the report
   * itself rather than from whatever the toolbar currently has selected.
   */
  type: StormType;
}

/** Add or remove a type from the active set, preserving STORM_TYPES order. */
export function toggleStormType(active: StormType[], type: StormType): StormType[] {
  const next = active.includes(type) ? active.filter((t) => t !== type) : [...active, type];
  return STORM_TYPES.filter((t) => next.includes(t));
}

/** How many reports of each type are currently loaded, for the toolbar counts. */
export function countStormsByType(reports: StormReport[]): Record<StormType, number> {
  const counts: Record<StormType, number> = { wind: 0, hail: 0 };
  for (const r of reports) {
    if (r.type === 'wind' || r.type === 'hail') counts[r.type]++;
  }
  return counts;
}

/**
 * Draw order for storm markers: largest first, so it ends up underneath.
 *
 * With both overlays on, a 2-inch hail circle is big enough to swallow several
 * wind points; drawing descending by radius keeps the small ones clickable.
 * Returns a new array — the caller's list is React state.
 */
export function sortStormsForDrawing(reports: StormReport[]): StormReport[] {
  return [...reports].sort(
    (a, b) => stormRadius(b.type, b.value) - stormRadius(a.type, a.value)
  );
}

/** Severity thresholds shown in the legend for each active overlay. */
export function stormLegendEntries(
  types: StormType[]
): { key: string; label: string; color: string }[] {
  const entries: { key: string; label: string; color: string }[] = [];
  for (const type of STORM_TYPES) {
    if (!types.includes(type)) continue;
    const steps =
      type === 'hail'
        ? [{ label: 'Hail 1"+', v: 1 }, { label: '1.5"+', v: 1.5 }, { label: '2"+', v: 2 }]
        : [{ label: 'Wind 58+', v: 58 }, { label: '74+', v: 74 }, { label: '90+ mph', v: 90 }];
    for (const s of steps) {
      entries.push({ key: `${type}-${s.label}`, label: s.label, color: stormColor(type, s.v) });
    }
  }
  return entries;
}

/** Marker fill for a NOAA storm report, scaled by severity. */
export function stormColor(type: StormType, value: number | null): string {
  if (type === 'hail') {
    const v = value ?? 0;
    if (v >= 2) return '#6d28d9'; // 2"+ violet
    if (v >= 1.5) return '#2563eb'; // 1.5"+ blue
    if (v >= 1) return '#0891b2'; // 1"+ cyan
    return '#67e8f9';
  }
  // wind (mph) — severe is 58+; null (UNK damage) treated as baseline severe
  const v = value ?? 58;
  if (v >= 90) return '#b91c1c'; // 90+ red
  if (v >= 74) return '#ea580c'; // 74+ orange
  if (v >= 58) return '#f59e0b'; // 58+ amber
  return '#fcd34d';
}

/** Marker radius for a storm report, scaled by severity. */
export function stormRadius(type: StormType, value: number | null): number {
  if (type === 'hail') return Math.min(6 + (value ?? 0) * 4, 22);
  return value != null ? Math.min(4 + value / 8, 20) : 7;
}

/** Popup label for a storm report. */
export function stormLabel(type: StormType, value: number | null): string {
  if (type === 'hail') return `${(value ?? 0).toFixed(2)}" hail`;
  return value != null ? `${value} mph wind` : 'Wind damage';
}
