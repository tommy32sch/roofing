'use client';

import { CalendarX2, Check, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AppointmentOutcome } from '@/types';

export type RecordableAppointmentOutcome = Exclude<AppointmentOutcome, 'scheduled'>;

const ACTIONS: {
  value: RecordableAppointmentOutcome;
  label: string;
  icon: React.ElementType;
  variant: 'default' | 'outline' | 'ghost';
}[] = [
  { value: 'completed', label: 'Completed', icon: Check, variant: 'default' },
  { value: 'no_show', label: 'No-show', icon: UserX, variant: 'outline' },
  { value: 'cancelled', label: 'Cancelled', icon: CalendarX2, variant: 'ghost' },
];

/**
 * Shared, network-free result controls.
 *
 * Keeping the request outside this component lets Today and Lead Detail use
 * the same labels and touch targets without hiding their refresh/error policy.
 */
export function AppointmentOutcomeActions({
  label,
  pending,
  disabled = false,
  onSelect,
  className,
}: {
  label: string;
  pending: AppointmentOutcome | null;
  disabled?: boolean;
  onSelect: (outcome: RecordableAppointmentOutcome) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={`Record result for ${label}`}
      aria-busy={pending !== null}
      className={cn('grid grid-cols-3 gap-2', className)}
    >
      {ACTIONS.map(({ value, label: actionLabel, icon: Icon, variant }) => (
        <Button
          key={value}
          type="button"
          variant={variant}
          className="h-11 min-w-0 px-2 text-xs sm:text-sm"
          disabled={disabled || pending !== null}
          onClick={() => onSelect(value)}
          aria-label={`${actionLabel}: ${label}`}
        >
          <Icon className={pending === value ? 'animate-pulse' : undefined} />
          <span className="truncate">{pending === value ? 'Saving…' : actionLabel}</span>
        </Button>
      ))}
    </div>
  );
}
