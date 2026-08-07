'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import {
  findConflicts,
  conflictWindow,
  conflictSummary,
  type AppointmentConflict,
} from '@/lib/leads/appointment-conflicts';

interface Props {
  /** Proposed local time, "YYYY-MM-DDTHH:mm", or '' while incomplete. */
  value: string;
  /** Appointment being rescheduled, so it can't clash with itself. */
  excludeAppointmentId?: string | null;
  /** Reported upward so the submit button can demand a second press. */
  onConflictsChange?: (conflicts: AppointmentConflict[]) => void;
}

/**
 * Warns about a double-booking as soon as a time is chosen.
 *
 * The server refuses a clashing booking regardless, but discovering that only
 * after pressing Save is a poor way to find out. Checking as the time is picked
 * means the rep can simply choose a different slot.
 */
export function AppointmentConflictWarning({ value, excludeAppointmentId, onConflictsChange }: Props) {
  const [conflicts, setConflicts] = useState<AppointmentConflict[]>([]);

  useEffect(() => {
    // An incomplete date/time isn't a proposal yet.
    if (!value) {
      setConflicts([]);
      onConflictsChange?.([]);
      return;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return;
    const proposedIso = parsed.toISOString();
    const window = conflictWindow(proposedIso);
    if (!window) return;

    let cancelled = false;
    const params = new URLSearchParams({ start: window.start, end: window.end });
    fetch(`/api/admin/appointments?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d.success) return;
        const found = findConflicts(proposedIso, d.appointments ?? [], {
          excludeId: excludeAppointmentId ?? null,
        });
        setConflicts(found);
        onConflictsChange?.(found);
      })
      .catch(() => {
        // A failed check must not block booking — the server still enforces it.
      });
    return () => {
      cancelled = true;
    };
    // onConflictsChange is a fresh closure each render; depending on it would
    // refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, excludeAppointmentId]);

  if (conflicts.length === 0) return null;

  return (
    <div className="flex gap-2 rounded-md border border-status-offline/40 bg-status-offline/10 p-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-stale" />
      <div className="space-y-1 text-xs">
        <p className="font-medium text-foreground">
          {conflictSummary(conflicts, (iso) => format(new Date(iso), 'h:mm a'))}
        </p>
        <p className="text-muted-foreground">Pick another time, or save again to book it anyway.</p>
      </div>
    </div>
  );
}
