/**
 * Pure date/time combination logic for the appointment form, kept free of React
 * and the DOM so it can be unit-tested directly.
 *
 * The rule it encodes: the DATE is the only field that can block the combined
 * value. A missing time falls back to DEFAULT_TIME; a *partially typed* time
 * (the browser reports validity.badInput while a segment like AM/PM is still
 * unset) holds the value back but is surfaced as a "finish the time" hint, never
 * as a silent disable. This is what stops <input type="time"> from re-creating
 * the datetime-local trap where the submit button greys out mid-entry.
 */

/** Default appointment time when a date is chosen but no time is entered. */
export const DEFAULT_TIME = '10:00';

/**
 * @param timeInProgress the browser's validity.badInput — true when the time
 *   control holds a partial entry (e.g. hour typed, AM/PM not yet chosen).
 * @returns "YYYY-MM-DDTHH:mm", or '' when the value is not yet usable.
 */
export function combineDateTime(date: string, time: string, timeInProgress: boolean): string {
  if (!date) return '';
  if (timeInProgress) return '';
  return `${date}T${time || DEFAULT_TIME}`;
}
