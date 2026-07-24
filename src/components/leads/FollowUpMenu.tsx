'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FOLLOW_UP_PRESETS, relativeFollowUpDate, describeFollowUp } from '@/lib/leads/follow-up';
import { localDayBounds } from '@/lib/leads/today';

interface Props {
  leadId: string;
  /** Current stored value, "YYYY-MM-DD" or null. */
  followUpDate: string | null;
  /** Called after a successful write so the caller can refresh. */
  onChange?: (next: string | null) => void;
  /** Compact icon-only trigger for dense rows. */
  compact?: boolean;
}

/**
 * One-tap follow-up scheduling.
 *
 * Deliberately relative ("In 2 days") rather than a date picker: a rep setting
 * this is standing at a door or between calls, and "two days from now" is what
 * they actually mean. The absolute date is still shown once set, so nothing is
 * ambiguous after the fact.
 */
export function FollowUpMenu({ leadId, followUpDate, onChange, compact }: Props) {
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(followUpDate);
  const today = localDayBounds(new Date()).date;

  async function set(next: string | null) {
    setSaving(true);
    // Optimistic: the menu closes on tap, so waiting on the round trip would
    // leave the row showing a stale date with no sign anything happened.
    const previous = value;
    setValue(next);
    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ follow_up_date: next }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save');
      toast.success(next ? `Follow up ${describeFollowUp(next, today).toLowerCase()}` : 'Follow-up cleared');
      onChange?.(next);
    } catch {
      setValue(previous);
      toast.error('Could not save the follow-up');
    } finally {
      setSaving(false);
    }
  }

  const label = value ? describeFollowUp(value, today) : 'Follow up';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={value ? 'secondary' : 'outline'}
            size="sm"
            disabled={saving}
            className={compact ? 'h-8 px-2 text-xs' : 'h-8 text-xs'}
            aria-label={value ? `Follow-up ${label}. Change it.` : 'Set a follow-up'}
          >
            <CalendarClock className="h-3.5 w-3.5" />
            <span className={compact ? 'sr-only sm:not-sr-only sm:ml-1' : 'ml-1'}>{label}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        {FOLLOW_UP_PRESETS.map((p) => {
          const date = relativeFollowUpDate(new Date(), p.days);
          return (
            <DropdownMenuItem key={p.days} onClick={() => set(date)}>
              <span className="flex-1">{p.label}</span>
              {value === date && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          );
        })}
        {value && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => set(null)}>
              <X className="mr-1 h-3.5 w-3.5" />
              Clear follow-up
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
