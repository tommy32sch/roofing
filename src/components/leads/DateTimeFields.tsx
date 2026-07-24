'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { combineDateTime, DEFAULT_TIME } from './datetime';

/**
 * Separate date and time inputs that emit a combined "YYYY-MM-DDTHH:mm".
 *
 * Why this exists — and why the naive version is a trap:
 *
 * A single <input type="datetime-local"> reports an EMPTY value until every
 * segment is filled. Splitting it out does NOT escape that on its own: in an
 * AM/PM locale (US) <input type="time"> renders as "hh : mm AM/PM" and its
 * value is likewise '' until ALL THREE segments — including the meridiem — are
 * valid. So the moment a rep picks a date (button enables) and then edits the
 * time to their real appointment hour, the half-typed time reads '' and, if the
 * combined value went all-or-nothing on it, the submit button would grey out
 * mid-entry with no way back. That is the exact bug this component must not have.
 *
 * The rule here: the DATE is the only thing that can block the value. A missing
 * time defaults to a sensible hour; a *partially typed* time (the browser's
 * validity.badInput) is reported as "finish the time", never as a silent
 * disable. The button can only be off while the date is missing or the user is
 * mid-keystroke on the time — both states the user can see and resolve.
 *
 * The value logic lives in ./datetime (combineDateTime) so it can be unit-tested
 * without the DOM — jsdom doesn't implement time-input sanitization, which is
 * exactly the browser behaviour this component has to survive.
 */

interface Props {
  idPrefix: string;
  /** "YYYY-MM-DDTHH:mm", or '' when incomplete. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Earliest selectable date, e.g. today. */
  min?: string;
}

export function DateTimeFields({ idPrefix, value, onChange, disabled, min }: Props) {
  const split = (v: string) => {
    if (!v.includes('T')) return { date: '', time: '' };
    const [d, rest = ''] = v.split('T');
    return { date: d, time: rest.slice(0, 5) }; // tolerate seconds/offset in a seeded value
  };
  const [date, setDate] = useState(() => split(value).date);
  const [time, setTime] = useState(() => split(value).time);
  // True while the time control holds a partial entry (hour typed, AM/PM not).
  const [timeInProgress, setTimeInProgress] = useState(false);

  // The parent only ever sees a complete value or ''. `lastEmitted` lets us tell
  // a value WE just sent up (which must not re-sync — the '' we emit while a time
  // is half-typed would otherwise echo back and wipe the date) from one the
  // parent set on its own (e.g. seeding the edit-appointment dialog), which we
  // DO adopt. Kept as state, and adjusted during render — React's blessed
  // "adjust state when a prop changes" pattern, not an effect, so there's no
  // extra commit and no ref-mutation-in-render.
  const [lastEmitted, setLastEmitted] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value !== lastEmitted) {
      const s = split(value);
      setDate(s.date);
      setTime(s.time);
      setTimeInProgress(false);
      setLastEmitted(value);
    }
  }

  function emit(d: string, t: string, inProgress: boolean) {
    const next = combineDateTime(d, t, inProgress);
    setLastEmitted(next);
    onChange(next);
  }

  const incomplete = (date && timeInProgress) || (!date && (time || timeInProgress));

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}_date`} className="block text-xs font-medium text-muted-foreground">
            Date<span className="ml-0.5 text-destructive">*</span>
          </label>
          <Input
            id={`${idPrefix}_date`}
            type="date"
            value={date}
            min={min}
            disabled={disabled}
            onChange={(e) => {
              const d = e.target.value;
              // Picking a date is the common path — show a sensible default hour
              // so the field and the saved value agree and the form is instantly
              // submittable. Leave a time the user already entered (or is still
              // typing) untouched.
              const t = time || (d && !timeInProgress ? DEFAULT_TIME : '');
              setDate(d);
              if (t !== time) setTime(t);
              emit(d, t, timeInProgress);
            }}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}_time`} className="block text-xs font-medium text-muted-foreground">
            Time<span className="ml-0.5 text-destructive">*</span>
          </label>
          <Input
            id={`${idPrefix}_time`}
            type="time"
            value={time}
            disabled={disabled}
            onChange={(e) => {
              const t = e.target.value;
              // validity.badInput distinguishes "mid-entry, AM/PM not chosen"
              // (value === '' but badInput === true) from a genuinely empty field.
              const inProgress = t === '' && e.target.validity.badInput;
              setTime(t);
              setTimeInProgress(inProgress);
              emit(date, t, inProgress);
            }}
            onBlur={(e) => {
              // Left the field fully blank (not mid-entry) — snap to the default
              // so what's saved always matches what's shown. A valid date should
              // never sit next to a blank time the user can't reason about.
              if (date && e.target.value === '' && !e.target.validity.badInput) {
                setTime(DEFAULT_TIME);
                setTimeInProgress(false);
                emit(date, DEFAULT_TIME, false);
              }
            }}
          />
        </div>
      </div>
      {incomplete && (
        <p className="text-xs text-muted-foreground">
          {!date ? 'Add a date to continue.' : 'Pick AM or PM to finish the time.'}
        </p>
      )}
    </div>
  );
}
