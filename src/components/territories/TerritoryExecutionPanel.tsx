'use client';

import { AlertCircle, Crosshair, DoorOpen, LogOut, MapPin, WifiOff } from 'lucide-react';
import { FollowUpMenu } from '@/components/leads/FollowUpMenu';
import { shouldPromptForFollowUp } from '@/components/leads/map-constants';
import { Button } from '@/components/ui/button';
import {
  Progress,
  ProgressLabel,
} from '@/components/ui/progress';
import { KNOCK_DISPOSITIONS, type KnockDisposition } from '@/lib/leads/knocks';
import type {
  TerritoryExecutionLead,
  TerritoryExecutionSummary,
} from '@/lib/territories/execution';
import { formatAge } from '@/lib/offline/territory-package';
import { cn } from '@/lib/utils';

const STATE_LABELS: Record<TerritoryExecutionSummary['state'], string> = {
  empty: 'No mapped doors',
  not_started: 'Not started',
  active: 'Active',
  stalled: 'Stalled',
  complete: 'Complete',
};

interface TerritoryExecutionPanelProps {
  territoryName: string;
  summary: TerritoryExecutionSummary;
  currentLead: TerritoryExecutionLead | null;
  /** Due revisits plus the deterministic manual fallback list. */
  queue?: TerritoryExecutionLead[];
  pendingOfflineCount?: number;
  /**
   * Age of the cached package when the screen is showing one rather than live
   * data, or null when live. A rep deciding whether to knock a door needs to
   * know the list might not include one a colleague worked this morning.
   *
   * Passed as an age rather than a timestamp so the panel never has to read the
   * clock during render.
   */
  offlineAgeMs?: number | null;
  locationError?: string | null;
  locating?: boolean;
  recording?: boolean;
  onFindNearest: () => void;
  onSelectLead: (lead: TerritoryExecutionLead) => void;
  onRecordKnock: (
    lead: TerritoryExecutionLead,
    disposition: KnockDisposition
  ) => void | Promise<void>;
  onFollowUpChange?: () => void;
  onExit: () => void;
  className?: string;
}

const COUNT_ITEMS = [
  ['unworked', 'Unworked'],
  ['knocked', 'Knocked'],
  ['contacted', 'Contacted'],
  ['follow_up', 'Follow up'],
  ['appointment', 'Appts'],
] as const;

/**
 * Field controls for one active territory.
 *
 * This is intentionally a regular panel rather than a modal Sheet: a rep must
 * keep the map visible while choosing a nearby door. Its parent decides where
 * to dock it on mobile and desktop.
 */
export function TerritoryExecutionPanel({
  territoryName,
  summary,
  currentLead,
  queue = [],
  pendingOfflineCount = 0,
  offlineAgeMs = null,
  locationError = null,
  locating = false,
  recording = false,
  onFindNearest,
  onSelectLead,
  onRecordKnock,
  onFollowUpChange,
  onExit,
  className,
}: TerritoryExecutionPanelProps) {
  const coverage = Math.min(100, Math.max(0, summary.coverage_percent));
  const hasUnworkedDoor = queue.some((lead) => lead.progress_state === 'unworked');

  return (
    <section
      aria-label={`Working ${territoryName}`}
      className={cn(
        'rounded-xl border bg-background/95 p-3 text-sm shadow-xl backdrop-blur sm:max-w-md',
        className
      )}
    >
      {/* Offline is stated, never implied. A rep who cannot tell cached data from
          live data will re-knock a door a colleague worked this morning, so the
          banner carries the download time rather than just the word "offline". */}
      {offlineAgeMs !== null && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-status-offline/40 bg-status-offline/10 px-2 py-1.5 text-xs text-status-offline">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            Offline — showing the copy you downloaded{' '}
            {formatAge(offlineAgeMs)}. Results are saved and will sync.
          </span>
        </div>
      )}

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate font-semibold">{territoryName}</p>
            <span
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                summary.state === 'stalled'
                  ? 'bg-destructive/10 text-destructive'
                  : summary.state === 'complete'
                    ? 'bg-status-complete/10 text-status-complete'
                    : 'bg-primary/10 text-primary'
              )}
            >
              {STATE_LABELS[summary.state]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {summary.total_leads} mapped door{summary.total_leads === 1 ? '' : 's'}
            {summary.blocked_leads > 0 && ` · ${summary.blocked_leads} not actionable`}
            {summary.revisits.due > 0 && ` · ${summary.revisits.due} revisit due`}
            {summary.revisits.needs_schedule > 0 &&
              ` · ${summary.revisits.needs_schedule} need scheduling`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onExit}>
          <LogOut className="h-3.5 w-3.5" />
          Exit
        </Button>
      </div>

      <Progress value={coverage} className="mt-3 gap-1.5" aria-label="Territory coverage">
        <ProgressLabel className="text-xs">Coverage</ProgressLabel>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {Math.round(coverage)}%
        </span>
      </Progress>

      <dl className="mt-3 grid grid-cols-5 gap-1 rounded-lg bg-muted/45 p-2 text-center">
        {COUNT_ITEMS.map(([key, label]) => (
          <div key={key} className="min-w-0">
            <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
            <dd className="font-semibold tabular-nums">{summary.progress[key]}</dd>
          </div>
        ))}
      </dl>

      {(pendingOfflineCount > 0 || locationError) && (
        <div className="mt-2 space-y-1" aria-live="polite">
          {pendingOfflineCount > 0 && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-status-offline">
              <WifiOff className="h-3.5 w-3.5" />
              {pendingOfflineCount} result{pendingOfflineCount === 1 ? '' : 's'} waiting to sync
            </p>
          )}
          {locationError && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {locationError}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 rounded-lg border p-2.5">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Current door
            </p>
            {currentLead ? (
              <>
                <p className="truncate font-medium">
                  {[currentLead.first_name, currentLead.last_name].filter(Boolean).join(' ') ||
                    'Lead'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[currentLead.address_street, currentLead.address_city]
                    .filter(Boolean)
                    .join(', ') || 'No address'}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Choose a door or find the nearest one.</p>
            )}
          </div>
          <Button
            type="button"
            variant={currentLead ? 'outline' : 'default'}
            size="sm"
            onClick={onFindNearest}
            disabled={locating || !hasUnworkedDoor}
          >
            <Crosshair className={cn('h-3.5 w-3.5', locating && 'animate-pulse')} />
            {locating ? 'Finding' : 'Nearest'}
          </Button>
        </div>

        {currentLead?.do_not_knock ? (
          <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs font-medium text-destructive">
            Do not knock this house. Choose another door.
          </p>
        ) : currentLead ? (
          <div className="mt-2 grid grid-cols-3 gap-1.5" aria-label="Record knock result">
            {KNOCK_DISPOSITIONS.map((result) => (
              <Button
                key={result.value}
                type="button"
                variant="outline"
                className="min-h-11 h-auto whitespace-normal px-1.5 py-1.5 text-[11px] leading-tight"
                disabled={recording}
                title={result.hint}
                onClick={() => void onRecordKnock(currentLead, result.value)}
              >
                {result.label}
              </Button>
            ))}
          </div>
        ) : null}

        {currentLead && shouldPromptForFollowUp(currentLead) && (
          <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
            <p className="text-xs font-medium text-muted-foreground">
              {currentLead.follow_up_date ? 'Following up' : 'Follow up when?'}
            </p>
            <FollowUpMenu
              leadId={currentLead.id}
              followUpDate={currentLead.follow_up_date}
              onChange={onFollowUpChange}
            />
          </div>
        )}
      </div>

      {queue.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <DoorOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Work queue ({queue.length})
            </p>
          </div>
          <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
            {queue.map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => onSelectLead(lead)}
                aria-current={currentLead?.id === lead.id ? 'true' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-muted',
                  currentLead?.id === lead.id && 'border-primary bg-primary/5'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Lead'}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[lead.address_street, lead.address_city].filter(Boolean).join(', ') ||
                      'No address'}
                  </span>
                </span>
                {lead.do_not_knock && (
                  <span className="shrink-0 text-[10px] font-semibold text-destructive">DNK</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export type { TerritoryExecutionPanelProps };
