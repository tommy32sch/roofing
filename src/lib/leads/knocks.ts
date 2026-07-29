import type { LeadStatus } from '@/types';

/**
 * Door-knock dispositions — the outcome a rep records while standing at a door.
 *
 * This is the selectable product list, in the order shown to a rep. The
 * historical database value `callback` now means "Go Back"; retaining that
 * value keeps old rows and knocks already queued offline valid across deploys.
 */
export const KNOCK_DISPOSITIONS = [
  { value: 'not_home', label: 'Not Home', hint: 'Nobody answered' },
  { value: 'callback', label: 'Go Back', hint: 'Return to the house later' },
  { value: 'call_back', label: 'Call Back', hint: 'Follow up by phone' },
  { value: 'referral', label: 'Referral', hint: 'The conversation produced a referral' },
  { value: 'appointment_set', label: 'Appointment', hint: 'Schedule the appointment details next' },
  { value: 'contract_signed', label: 'Contract Signed', hint: 'Complete the won-lead workflow next' },
  { value: 'not_interested', label: 'Not Interested', hint: 'The homeowner declined' },
  { value: 'renter', label: 'Renter', hint: 'The person at the property is not the owner' },
  { value: 'do_not_knock', label: 'Do Not Knock', hint: 'The household asked us not to return' },
] as const;

/**
 * Accepted for compatibility but intentionally omitted from the selectable
 * list. Existing history and offline entries may still contain this value.
 */
const LEGACY_KNOCK_DISPOSITIONS = [
  { value: 'no_damage', label: 'No Damage' },
] as const;

export type SelectableKnockDisposition = (typeof KNOCK_DISPOSITIONS)[number]['value'];
export type KnockDisposition =
  | SelectableKnockDisposition
  | (typeof LEGACY_KNOCK_DISPOSITIONS)[number]['value'];

export const KNOCK_DISPOSITION_VALUES = new Set<string>([
  ...KNOCK_DISPOSITIONS.map((d) => d.value),
  ...LEGACY_KNOCK_DISPOSITIONS.map((d) => d.value),
]);

export function knockLabel(value: string): string {
  return (
    KNOCK_DISPOSITIONS.find((d) => d.value === value)?.label ??
    LEGACY_KNOCK_DISPOSITIONS.find((d) => d.value === value)?.label ??
    value
  );
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
    case 'callback':
    case 'call_back':
    case 'referral':
    case 'appointment_set':
    case 'contract_signed':
    case 'not_interested':
    case 'renter':
    case 'no_damage':
      // Appointment and contract results deliberately stop at Contacted. The
      // required scheduling and won-lead forms own later pipeline transitions.
      return 'contacted';
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
