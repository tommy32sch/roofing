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
  market_id: number | null;
  first_name: string;
  last_name: string;
  latitude: number;
  longitude: number;
  status: LeadStatus;
  priority: LeadPriority;
  estimated_roof_value: number | null;
  /** Present on the live browse payload; older offline execution packages omit it. */
  phone?: string | null;
  address_street: string | null;
  address_city: string | null;
  /** Present on the live browse payload; older offline execution packages omit it. */
  address_state?: string | null;
  /** Present on the live browse payload; older offline execution packages omit it. */
  address_zip?: string | null;
  is_dnc: boolean;
  hail_date: string | null;
  hail_size_inches: number | null;
  last_knock_at: string | null;
  last_disposition: string | null;
  knock_count: number;
  do_not_knock: boolean;
  last_call_at: string | null;
  last_call_disposition: string | null;
  call_count: number;
  follow_up_date: string | null;
}

const KNOCK_FOLLOW_UP_RESULTS = new Set(['callback', 'call_back']);

/**
 * Show the follow-up shortcut only when the newest recorded interaction asks
 * for one. An older Call Back should not keep prompting after a newer
 * Not Interested result on the other channel.
 */
export function shouldPromptForFollowUp(
  lead: Pick<
    GeoLead,
    | 'follow_up_date'
    | 'last_knock_at'
    | 'last_disposition'
    | 'last_call_at'
    | 'last_call_disposition'
  >
): boolean {
  if (lead.follow_up_date) return true;

  const knockAt = lead.last_knock_at ? Date.parse(lead.last_knock_at) : Number.NEGATIVE_INFINITY;
  const callAt = lead.last_call_at ? Date.parse(lead.last_call_at) : Number.NEGATIVE_INFINITY;
  const validKnockAt = Number.isNaN(knockAt) ? Number.NEGATIVE_INFINITY : knockAt;
  const validCallAt = Number.isNaN(callAt) ? Number.NEGATIVE_INFINITY : callAt;

  if (validKnockAt === Number.NEGATIVE_INFINITY && validCallAt === Number.NEGATIVE_INFINITY) {
    return false;
  }
  if (validKnockAt > validCallAt) {
    return !!lead.last_disposition && KNOCK_FOLLOW_UP_RESULTS.has(lead.last_disposition);
  }
  if (validCallAt > validKnockAt) {
    return lead.last_call_disposition === 'call_back';
  }
  return (
    (!!lead.last_disposition && KNOCK_FOLLOW_UP_RESULTS.has(lead.last_disposition)) ||
    lead.last_call_disposition === 'call_back'
  );
}

/** Stroke color used to ring Do Not Call pins (knock-only). */
export const DNC_RING_COLOR = 'oklch(0.55 0.22 25)';

/** Ring for houses the homeowner asked us not to return to. */
export const DO_NOT_KNOCK_RING_COLOR = 'oklch(0.45 0.02 45)';

/** OSM starts showing individual house numbers around this zoom. */
export const LEAD_ADDRESS_DETAIL_ZOOM = 17;

export function isLeadAddressDetailZoom(zoom: number): boolean {
  return zoom >= LEAD_ADDRESS_DETAIL_ZOOM;
}

export interface LeadMarkerAppearanceInput {
  addressDetail: boolean;
  statusColor: string;
  selected: boolean;
  recentlyKnocked: boolean;
  doNotKnock: boolean;
  isDnc: boolean;
}

export interface LeadMarkerAppearance {
  radius: number;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWeight: number;
}

/**
 * Lead marker treatment at overview and address-detail scales.
 *
 * At house-level zoom, a mostly hollow status-coloured ring keeps the lead
 * visible and clickable without painting over the house number on the basemap.
 * Selection and safety restrictions retain their stronger ring precedence.
 */
export function leadMarkerAppearance({
  addressDetail,
  statusColor,
  selected,
  recentlyKnocked,
  doNotKnock,
  isDnc,
}: LeadMarkerAppearanceInput): LeadMarkerAppearance {
  const emphasized = selected || doNotKnock || isDnc;
  const strokeColor = selected
    ? '#111111'
    : doNotKnock
      ? DO_NOT_KNOCK_RING_COLOR
      : isDnc
        ? DNC_RING_COLOR
        : addressDetail
          ? statusColor
          : '#ffffff';

  return {
    radius: addressDetail ? (selected ? 10 : 7) : selected ? 11 : 8,
    fillColor: statusColor,
    fillOpacity: addressDetail
      ? recentlyKnocked
        ? 0.04
        : 0.1
      : recentlyKnocked
        ? 0.35
        : 0.85,
    strokeColor,
    strokeWeight: emphasized ? 3 : addressDetail ? 2 : 1.5,
  };
}

export type StormType = 'hail' | 'wind';

/**
 * Age buckets for a storm report.
 *
 * With two years of history on the map, age matters more than severity for
 * deciding where to knock: a 2" hailstorm from last spring is worth far less
 * than 1" from last month. The boundaries are the ones the business actually
 * turns on — most carriers give roughly a year from the date of loss to file, so
 * crossing 365 days is the point a lead stops being a claim and starts being a
 * conversation.
 *
 * Encoded as OPACITY because colour and radius are already carrying severity,
 * and fading is the intuitive reading of "older". Ordered newest first.
 */
export const STORM_AGE_BUCKETS = [
  { key: 'fresh', maxDays: 30, label: 'Under 1 month', fillOpacity: 0.75, weight: 2 },
  { key: 'recent', maxDays: 180, label: '1–6 months', fillOpacity: 0.45, weight: 1 },
  { key: 'aging', maxDays: 365, label: '6–12 months', fillOpacity: 0.25, weight: 1 },
  // Past the usual filing deadline — kept visible for door-knock context, but
  // deliberately quiet so it never competes with a live opportunity.
  { key: 'stale', maxDays: Infinity, label: 'Over a year', fillOpacity: 0.12, weight: 1 },
] as const;

export type StormAgeBucket = (typeof STORM_AGE_BUCKETS)[number];

/**
 * Zone style by age — a SINGLE-hue ramp, deliberately.
 *
 * The first version used red -> orange -> amber for age, which failed twice
 * over: adjacent warm hues don't visibly order ("everything just looks orange
 * and red"), and the wind severity markers underneath already use
 * amber -> orange -> red, so the same hues meant two different things on the
 * same screen. Sequential data gets a sequential ramp: one hue, fading with
 * age. "How red is it" IS "how fresh is it" — nothing to decode, and no
 * collision with the severity colours because the translucent swath reads as
 * an area underlay while those colours remain discrete report dots.
 *
 * The fill is intentionally restrained because the zone now overlays with
 * severity-coloured report dots. Past a year — the usual claim-filing window —
 * a zone drops its fill and becomes a dashed grey outline: still there for
 * door-knock context, visually finished as an opportunity.
 */
export const STORM_ZONE_STYLES: Record<
  string,
  { stroke: string; fill: string; fillOpacity: number; weight: number; opacity: number; dashArray?: string }
> = {
  fresh: { stroke: '#b91c1c', fill: '#dc2626', fillOpacity: 0.18, weight: 3, opacity: 1 },
  recent: { stroke: '#dc2626', fill: '#ef4444', fillOpacity: 0.11, weight: 2, opacity: 0.85 },
  aging: { stroke: '#f87171', fill: '#f87171', fillOpacity: 0.06, weight: 1.5, opacity: 0.6 },
  stale: { stroke: '#94a3b8', fill: '#94a3b8', fillOpacity: 0, weight: 1.5, opacity: 0.6, dashArray: '6 5' },
};

export function stormZoneStyle(bucketKey: string) {
  return STORM_ZONE_STYLES[bucketKey] ?? STORM_ZONE_STYLES.stale;
}

/**
 * Compact age for the label written ON each zone: "6d", "3w", "8mo", "1y+".
 *
 * The label is the real fix for reading age at a distance — colour ramps need a
 * legend, text doesn't. Rendered in screen pixels so it stays legible at any
 * zoom.
 */
export function stormAgeShort(date: string, now: number = Date.now()): string {
  const days = stormAgeDays(date, now);
  if (days === 0) return 'today';
  if (days < 7) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30.44)}mo`;
  return `${Math.floor(days / 365)}y+`;
}

/** Legend swatches for the zone age ramp. Stale shows its outline grey. */
export function stormZoneLegendEntries(): { key: string; label: string; color: string; opacity: number }[] {
  return STORM_AGE_BUCKETS.map((b) => {
    const style = stormZoneStyle(b.key);
    return {
      key: `zone-${b.key}`,
      label: b.label,
      color: style.fillOpacity > 0 ? style.fill : style.stroke,
      opacity: style.fillOpacity > 0 ? Math.min(style.fillOpacity + 0.35, 1) : 0.7,
    };
  });
}


/** Whole days between a report's date and now. Negative dates clamp to 0. */
export function stormAgeDays(date: string, now: number = Date.now()): number {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** Which age bucket a report falls in. */
export function stormAgeBucket(date: string, now: number = Date.now()): StormAgeBucket {
  const days = stormAgeDays(date, now);
  return STORM_AGE_BUCKETS.find((b) => days <= b.maxDays) ?? STORM_AGE_BUCKETS[STORM_AGE_BUCKETS.length - 1];
}

/**
 * Draw order: oldest first, so recent storms sit on top and stay clickable.
 *
 * Within one age bucket, larger radius goes first for the same reason a wide
 * hail circle shouldn't bury the wind points inside it. Age wins over size
 * because a fresh small report outranks an old large one.
 */
export function sortStormsForDrawing(reports: StormReport[], now: number = Date.now()): StormReport[] {
  return [...reports].sort((a, b) => {
    const ageDiff = stormAgeDays(b.date, now) - stormAgeDays(a.date, now);
    if (ageDiff !== 0) return ageDiff;
    return stormRadius(b.type, b.value) - stormRadius(a.type, a.value);
  });
}

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
 * Legend swatches for the age ramp.
 *
 * Without this the fading reads as a rendering glitch rather than information.
 * Rendered in a neutral grey so it explains the OPACITY channel without implying
 * a severity colour.
 */
export function stormAgeLegendEntries(): { key: string; label: string; fillOpacity: number }[] {
  return STORM_AGE_BUCKETS.map((b) => ({
    key: `age-${b.key}`,
    label: b.label,
    fillOpacity: b.fillOpacity,
  }));
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
