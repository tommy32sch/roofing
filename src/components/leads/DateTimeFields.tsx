'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';

/**
 * Separate date and time inputs that emit a combined "YYYY-MM-DDTHH:mm".
 *
 * Replaces a single <input type="datetime-local">, which has a trap: the input
 * reports an EMPTY value until every segment is filled. A rep would pick the
 * date, leave the time as "--:-- --", see a field that looks complete, and the
 * submit button would sit greyed out with nothing explaining why.
 *
 * Two visibly separate fields make the missing half obvious, and picking a date
 * defaults the time to a sensible hour so the common case is one interaction.
 */

/** Default appointment time once a date is chosen. */
const DEFAULT_TIME = '10:00';

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
  const split = (v: string) => (v.includes('T') ? v.split('T') : ['', '']);
  const [date, setDate] = useState(() => split(value)[0]);
  const [time, setTime] = useState(() => split(value)[1] ?? '');

  // The parent only ever sees a complete value or ''. Without this guard, our
  // own '' (emitted while half-filled) would echo back and wipe what was typed.
  const lastEmitted = useRef(value);
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const [d, t] = split(value);
    setDate(d);
    setTime(t ?? '');
    lastEmitted.current = value;
  }, [value]);

  function emit(d: string, t: string) {
    const next = d && t ? `${d}T${t}` : '';
    lastEmitted.current = next;
    onChange(next);
  }

  const incomplete = (date && !time) || (!date && time);

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
              // Picking a date with no time yet is the common path — fill a
              // sensible hour so the form is immediately submittable.
              const t = time || (d ? DEFAULT_TIME : '');
              setDate(d);
              setTime(t);
              emit(d, t);
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
              setTime(t);
              emit(date, t);
            }}
          />
        </div>
      </div>
      {incomplete && (
        <p className="text-xs text-muted-foreground">
          {date ? 'Add a time to continue.' : 'Add a date to continue.'}
        </p>
      )}
    </div>
  );
}
