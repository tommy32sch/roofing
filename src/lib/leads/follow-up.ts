/**
 * Relative follow-up scheduling.
 *
 * Setting a follow-up used to mean opening a lead and operating a date picker,
 * which nobody does while standing at a door — the result was that not one lead
 * in the database had a follow-up date, and the Today screen's follow-up section
 * could never fill. These presets turn it into one tap.
 */

/** The offsets a rep actually uses. "Next week" is the long tail; beyond that, pick a date. */
export const FOLLOW_UP_PRESETS = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 2 days', days: 2 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
] as const;

/**
 * A calendar date `days` from now, as "YYYY-MM-DD" in the caller's LOCAL time.
 *
 * leads.follow_up_date is a plain DATE, so this must produce the date the rep
 * means. Deriving it from toISOString() would use UTC and land a full day early
 * for anyone in the Americas during the evening. Uses setDate rather than
 * adding milliseconds so DST transitions (23- and 25-hour days) can't shift it.
 */
export function relativeFollowUpDate(now: Date, days: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Short human label for a stored follow-up date, relative to today.
 *
 * "Tomorrow" reads faster than a date a rep has to subtract in their head, but
 * anything beyond a week is clearer as an actual date.
 */
export function describeFollowUp(followUpDate: string, today: string): string {
  if (followUpDate === today) return 'Today';
  const diff = daysBetween(today, followUpDate);
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  if (diff <= 7) return `In ${diff} days`;
  return followUpDate;
}

/**
 * Whole days from `from` to `to`, both "YYYY-MM-DD".
 *
 * Parsed as UTC noon on both sides: the dates are calendar values with no time
 * of day, and anchoring mid-day means a DST shift can't round the difference to
 * the wrong integer.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
