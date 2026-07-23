import type { LeadStatus } from '@/types';

/**
 * Door-knock dispositions — the outcome a rep records while standing at a door.
 *
 * Ordered by how often they're used, because on a phone the first option should
 * be the one tapped most. "Not home" dominates real canvassing.
 */
export const KNOCK_DISPOSITIONS = [
  { value: 'not_home', label: 'Not home', hint: 'Nobody answered — worth another pass' },
  { value: 'callback', label: 'Callback', hint: 'Interested, come back later' },
  { value: 'appointment_set', label: 'Appointment set', hint: 'Books an inspection' },
  { value: 'not_interested', label: 'Not interested', hint: 'Declined' },
  { value: 'no_damage', label: 'No damage', hint: 'Roof looked fine — stop spending time here' },
  { value: 'do_not_knock', label: 'Do not knock', hint: 'Homeowner asked us not to return' },
] as const;

export type KnockDisposition = (typeof KNOCK_DISPOSITIONS)[number]['value'];

export const KNOCK_DISPOSITION_VALUES = new Set<string>(KNOCK_DISPOSITIONS.map((d) => d.value));

export function knockLabel(value: string): string {
  return KNOCK_DISPOSITIONS.find((d) => d.value === value)?.label ?? value;
}

/**
 * Status a disposition should move the lead to, or null to leave it alone.
 *
 * Only outcomes that genuinely change where the lead sits in the pipeline move
 * it. "Not home" deliberately does not: knocking an empty house is not contact,
 * and treating it as such would inflate every rep's contact rate.
 */
export function statusForDisposition(d: KnockDisposition): LeadStatus | null {
  switch (d) {
    case 'appointment_set':
      return 'appointment_set';
    case 'callback':
    case 'not_interested':
    case 'no_damage':
      return 'contacted'; // someone answered the door
    case 'not_home':
    case 'do_not_knock':
      return null;
  }
}

/** Map pin colour for how recently a door was knocked. */
export function knockRecency(lastKnockAt: string | null | undefined, now = Date.now()):
  | 'never'
  | 'recent'
  | 'stale' {
  if (!lastKnockAt) return 'never';
  const days = (now - new Date(lastKnockAt).getTime()) / 86_400_000;
  return days <= 14 ? 'recent' : 'stale';
}
