'use client';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  KNOCK_DISPOSITIONS,
  type KnockDisposition,
} from '@/lib/leads/knocks';
import {
  COLD_CALL_DISPOSITIONS,
  type ColdCallDisposition,
} from '@/lib/leads/calls';
import type { GeoLead } from './map-constants';

export type LeadResultChannel = 'knock' | 'cold_call';

export type LeadResultSelection =
  | { channel: 'knock'; disposition: KnockDisposition }
  | { channel: 'cold_call'; disposition: ColdCallDisposition };

interface LeadResultSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: GeoLead | null;
  channel: LeadResultChannel;
  onChannelChange: (channel: LeadResultChannel) => void;
  onSelect: (result: LeadResultSelection) => void;
  saving?: boolean;
}

/**
 * A phone-sized result picker that lives outside Leaflet.
 *
 * The map popup stays useful for identifying the house; the larger sheet owns
 * the field action, where every result needs a real touch target instead of a
 * cluster of tiny chips inside Leaflet's constrained popup.
 */
export function LeadResultSheet({
  open,
  onOpenChange,
  lead,
  channel,
  onChannelChange,
  onSelect,
  saving = false,
}: LeadResultSheetProps) {
  if (!lead) return null;

  const leadName = `${lead.first_name} ${lead.last_name}`.trim() || 'Lead';
  const address =
    [lead.address_street, lead.address_city].filter(Boolean).join(', ') || 'No address';
  const blocked = channel === 'knock' ? lead.do_not_knock : lead.is_dnc;
  const results = channel === 'knock' ? KNOCK_DISPOSITIONS : COLD_CALL_DISPOSITIONS;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:bottom-4 sm:max-w-lg sm:rounded-2xl sm:border"
      >
        <SheetHeader className="p-0 pr-10">
          <SheetTitle>Record result for {leadName}</SheetTitle>
          <SheetDescription>{address}</SheetDescription>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Result type">
          <Button
            type="button"
            variant={channel === 'knock' ? 'default' : 'outline'}
            className="min-h-11"
            onClick={() => onChannelChange('knock')}
            disabled={saving}
          >
            Knocked
          </Button>
          <Button
            type="button"
            variant={channel === 'cold_call' ? 'default' : 'outline'}
            className="min-h-11"
            onClick={() => onChannelChange('cold_call')}
            disabled={saving}
          >
            Cold called
          </Button>
        </div>

        {blocked ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">
              {channel === 'knock' ? 'Do not knock this house' : 'Do not call this lead'}
            </p>
            <p className="mt-1 text-muted-foreground">
              Choose the other activity above if it is still allowed.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 pb-1">
            {results.map((result) => (
              <Button
                key={result.value}
                type="button"
                variant="outline"
                className="min-h-11 h-auto whitespace-normal px-3 py-2 text-left"
                disabled={saving}
                onClick={() => {
                  if (channel === 'knock') {
                    onSelect({
                      channel: 'knock',
                      disposition: result.value as KnockDisposition,
                    });
                  } else {
                    onSelect({
                      channel: 'cold_call',
                      disposition: result.value as ColdCallDisposition,
                    });
                  }
                }}
              >
                {result.label}
              </Button>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
