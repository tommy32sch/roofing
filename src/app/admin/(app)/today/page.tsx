'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Phone, MessageSquare, Navigation, Sun, DoorOpen,
  PhoneCall, AlertCircle, ChevronRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import { FollowUpMenu } from '@/components/leads/FollowUpMenu';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import { formatPhone, formatAddressShort, mapsUrl } from '@/lib/utils/format';
import {
  buildTodayCommandCenter,
  localDayBounds,
  followUpUrgency,
  defaultScope,
  type DayBounds,
  type TodayAppointment,
  type TodayData,
  type TodayLead,
  type TodayScope,
} from '@/lib/leads/today';
import type { AppointmentOutcome } from '@/types';
import { useAppShell } from '@/components/providers/app-shell-provider';
import { DataErrorState } from '@/components/layout/data-error-state';
import { TodayAppointmentCommand } from '@/components/today/TodayAppointmentCommand';
import type { RecordableAppointmentOutcome } from '@/components/leads/AppointmentOutcomeActions';
import { cn } from '@/lib/utils';
import { saveAppointmentOutcome } from '@/lib/leads/appointment-outcome-client';

/** The first phone we can actually dial. DNC leads have none stored by design. */
function firstPhone(lead: TodayLead): string | null {
  return lead.phone || lead.phone2 || lead.phone3 || null;
}

/**
 * One tappable row. The lead name and address open the lead; the actions are
 * separate targets so a mis-tap on a phone doesn't dial someone by accident.
 */
function LeadRow({
  lead,
  trailing,
  followUp,
  onFollowUpChange,
}: {
  lead: TodayLead;
  trailing?: React.ReactNode;
  /** Show the one-tap follow-up control. */
  followUp?: boolean;
  onFollowUpChange?: () => void;
}) {
  const phone = firstPhone(lead);
  const directions = mapsUrl(lead);

  return (
    <article className="group flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center">
      <Link href={`/admin/leads/${lead.id}`} className="min-w-0 sm:flex-1">
        {/* The name must win the space fight: min-w-0 + flex-1 on the name and
            shrink-0 on the chips. Without it the badge took the full row on a
            phone and truncated the customer's name to nothing. */}
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold group-hover:text-primary">
            {lead.first_name} {lead.last_name}
          </p>
          <span className="shrink-0">
            <LeadStatusBadge status={lead.status} />
          </span>
          {lead.is_dnc && (
            <span className="shrink-0 rounded border border-destructive/25 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
              DNC
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {formatAddressShort(lead) || 'No address'}
          {phone ? ` · ${formatPhone(phone)}` : ''}
        </p>
        {trailing}
      </Link>

      {/* Big, separated tap targets — this is used one-handed in a truck. */}
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
        {followUp && (
          <FollowUpMenu
            leadId={lead.id}
            followUpDate={lead.follow_up_date}
            onChange={onFollowUpChange}
            compact
          />
        )}
        {phone && (
          <>
            <a
              href={`tel:${phone}`}
              aria-label={`Call ${lead.first_name}`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-11 w-11 border border-transparent hover:border-border')}
            >
              <Phone className="h-4 w-4" />
            </a>
            <a
              href={`sms:${phone}`}
              aria-label={`Text ${lead.first_name}`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-11 w-11 border border-transparent hover:border-border')}
            >
              <MessageSquare className="h-4 w-4" />
            </a>
          </>
        )}
        {directions && (
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Directions to ${lead.first_name}`}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'h-11 w-11 border border-transparent hover:border-border')}
          >
            <Navigation className="h-4 w-4" />
          </a>
        )}
      </div>
    </article>
  );
}

/**
 * Empty text for a single section.
 *
 * Deliberately not the full EmptyState: three stacked cards each with an icon
 * circle and two lines of prose turned "nothing due today" into three phone
 * screens of scrolling. One quiet line per section keeps the whole day readable
 * without swiping. The page-level empty state below still gets the full
 * treatment only when the Mine scope has no assigned work at all.
 */
function SectionEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-5 text-sm leading-6 text-muted-foreground">{children}</p>;
}

function WorkQueueSection({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ElementType;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t-2 border-foreground/80 pt-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold leading-none tabular-nums">{count ?? 0}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Open</p>
        </div>
      </header>
      <div className="mt-4 divide-y border-y">{children}</div>
    </section>
  );
}

function TodayHeader({
  day,
  actions,
}: {
  day: DayBounds | null;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-b pb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Field brief
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Today</h1>
            <p className="text-sm text-muted-foreground">
              {day ? (
                format(new Date(day.start), 'EEEE · MMMM d')
              ) : (
                <span aria-hidden="true" className="inline-block w-36">&nbsp;</span>
              )}
            </p>
          </div>
        </div>
        {actions && <div className="flex w-full flex-wrap items-end gap-4 sm:w-auto">{actions}</div>}
      </div>
    </header>
  );
}

export default function TodayPage() {
  const { user, permissions } = useAppShell();
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<TodayScope>(() => defaultScope(user.role));
  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();
  const [market, setMarket] = useState('');
  const [day, setDay] = useState<DayBounds | null>(null);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [pendingById, setPendingById] = useState<Record<string, AppointmentOutcome | undefined>>({});
  const [outcomeErrors, setOutcomeErrors] = useState<Record<string, string | undefined>>({});
  const marketValue = market || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);

  // The browser owns the field rep's local day. Vercel renders in UTC, so
  // reading the clock during SSR can produce different text and day bounds at
  // hydration time. Establish the device day only after the page mounts.
  useEffect(() => {
    const deviceNow = new Date();
    setDay(localDayBounds(deviceNow));
    setNowIso(deviceNow.toISOString());
  }, []);

  const fetchToday = useCallback(async (signal?: AbortSignal) => {
    if (!day) return;
    const params = new URLSearchParams({ start: day.start, end: day.end, date: day.date, scope });
    if (market) params.set('market_id', market);
    setError('');
    try {
      const res = await fetch(`/api/admin/today?${params}`, { signal });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Could not load today’s work');
      }
      setData(json);
      setNowIso(json.generatedAt);
      const serverTime = Date.parse(json.generatedAt);
      if (!Number.isNaN(serverTime)) setServerClockOffsetMs(serverTime - Date.now());
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Could not load today’s work');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [day, market, scope]);

  useEffect(() => {
    const controller = new AbortController();
    fetchToday(controller.signal);
    return () => controller.abort();
  }, [fetchToday]);

  // Keep the command center current while it stays open. The day rolls at the
  // device's local midnight; the minute clock moves a passed stop into the
  // result queue without requiring a reload.
  useEffect(() => {
    if (!day) return;

    const refreshClock = () => {
      const now = new Date(Date.now() + serverClockOffsetMs);
      const nextDay = localDayBounds(now);
      setNowIso(now.toISOString());
      if (nextDay.date !== day.date) {
        setDay(nextDay);
        setLoading(true);
      }
    };
    const interval = window.setInterval(refreshClock, 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshClock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [day, serverClockOffsetMs]);

  const commandCenter = useMemo(
    () =>
      buildTodayCommandCenter({
        appointments: data?.appointments ?? [],
        priorUnresolvedAppointments: data?.priorUnresolvedAppointments ?? [],
        priorUnresolvedTotal: data?.counts.priorUnresolved ?? 0,
        nowIso,
      }),
    [data, nowIso]
  );

  const recordOutcome = useCallback(async (
    appointment: TodayAppointment,
    outcome: RecordableAppointmentOutcome
  ) => {
    const lead = appointment.leads;
    if (!lead || !appointment.can_record_outcome) return;

    setPendingById((current) => ({ ...current, [appointment.id]: outcome }));
    setOutcomeErrors((current) => ({ ...current, [appointment.id]: undefined }));
    try {
      await saveAppointmentOutcome({ leadId: lead.id, appointmentId: appointment.id, outcome });

      const label = outcome === 'no_show' ? 'no-show' : outcome;
      toast.success(`${appointment.appointment_type === 'adjuster' ? 'Adjuster meeting' : 'Inspection'} for ${lead.first_name} ${lead.last_name} marked ${label}`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await saveAppointmentOutcome({
                leadId: lead.id,
                appointmentId: appointment.id,
                outcome: 'scheduled',
              });
              await fetchToday();
              toast.success('Appointment result restored');
            } catch {
              toast.error('Could not restore the appointment result');
            }
          },
        },
      });
      await fetchToday();
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-awaiting-result] button:not(:disabled)')?.focus();
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not record the appointment result';
      setOutcomeErrors((current) => ({ ...current, [appointment.id]: message }));
      toast.error(message);
    } finally {
      setPendingById((current) => ({ ...current, [appointment.id]: undefined }));
    }
  }, [fetchToday]);

  if (!day || loading) {
    return (
      <div className="space-y-8">
        <TodayHeader day={day} />
        <Skeleton className="h-80 w-full rounded-lg" />
        <div className="grid gap-8 xl:grid-cols-2">
          <Skeleton className="h-48 w-full rounded-none" />
          <Skeleton className="h-48 w-full rounded-none" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-8">
        <TodayHeader day={day} />
        <DataErrorState title="Today’s work did not load" description={error} onRetry={fetchToday} />
      </div>
    );
  }

  const followUps = data?.followUps ?? [];
  const callbacks = data?.callbacks ?? [];
  const counts = data?.counts;
  // "Nothing assigned to you" is a different problem from "nothing due today",
  // and saying so is the difference between a screen that looks broken and one
  // that tells you what to fix.
  const nothingAssigned = scope === 'mine' && (counts?.assignedToMe ?? 0) === 0;

  return (
    <div className="space-y-8">
      <TodayHeader
        day={day}
        actions={
          <>
            {!marketsLoading && markets.length >= 2 && (
              <div>
                <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Market
                </p>
                <MarketFilter
                  markets={markets}
                  value={marketValue}
                  onChange={setMarket}
                  className="h-11 w-[160px] rounded-none border-0 border-b bg-transparent px-0 shadow-none"
                />
              </div>
            )}
            {/* Segmented rather than a dropdown: two options, and which one is
                active is the single most important thing on the screen. */}
            {permissions.canViewTeamData && (
              <div>
                <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Scope
                </p>
                <div className="flex h-11 border-b" role="group" aria-label="Whose work">
                  {(['mine', 'all'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={scope === s}
                      onClick={() => { setScope(s); setLoading(true); }}
                      className={`relative h-11 px-3 text-xs font-semibold transition-colors after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 ${
                        scope === s
                          ? 'text-foreground after:bg-primary'
                          : 'text-muted-foreground after:bg-transparent hover:text-foreground'
                      }`}
                    >
                      {s === 'mine' ? 'Mine' : 'Everyone'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        }
      />

      {error && (
        <DataErrorState
          compact
          title="Today’s work could not be refreshed"
          description={`${error} The last loaded work remains visible.`}
          onRetry={fetchToday}
        />
      )}

      {nothingAssigned ? (
        <section className="border-y py-14 sm:py-20">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 text-primary">
              <Sun className="h-4 w-4" />
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">
                Assignment queue
              </p>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">
              Nothing is assigned to you yet
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {permissions.canViewTeamData
                ? 'No leads have you as their setter or closer. Assign leads from the Leads list or view the whole team.'
                : `No leads are assigned to you as a ${user.role}. An admin can assign leads from the Leads list.`}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {permissions.canViewTeamData && (
                <Button variant="outline" className="h-11" onClick={() => { setScope('all'); setLoading(true); }}>
                  View everyone&apos;s
                </Button>
              )}
              {permissions.canBulkAssignLeads && (
                <Link href="/admin/leads" className={cn(buttonVariants(), 'h-11 px-4')}>
                  Assign leads
                </Link>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          <TodayAppointmentCommand
            model={commandCenter}
            scope={scope}
            nowIso={nowIso}
            pendingById={pendingById}
            errorsById={outcomeErrors}
            onOutcome={recordOutcome}
          />

          {/* Follow-ups — promises with a date on them. Overdue first. */}
          <div className="grid items-start gap-10 xl:grid-cols-2">
            <WorkQueueSection icon={PhoneCall} title="Follow-ups due" count={counts?.followUps}>
              {followUps.length === 0 ? (
                <SectionEmpty>
                  Nothing due. Set a follow-up date on a lead and it appears here on the day
                  it&apos;s due, then stays until you clear it.
                </SectionEmpty>
              ) : (
                <>
                  {followUps.map((lead) => {
                    const urgency = lead.follow_up_date
                      ? followUpUrgency(lead.follow_up_date, day.date)
                      : 'today';
                    return (
                      <LeadRow
                        key={lead.id}
                        lead={lead}
                        followUp
                        onFollowUpChange={fetchToday}
                        trailing={
                          <p
                            className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${
                              urgency === 'overdue'
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                            }`}
                          >
                            {urgency === 'overdue' && <AlertCircle className="h-3 w-3" />}
                            {urgency === 'overdue'
                              ? `Due ${format(new Date(`${lead.follow_up_date}T00:00:00`), 'MMM d')} — overdue`
                              : 'Due today'}
                          </p>
                        }
                      />
                    );
                  })}
                  {counts && counts.followUps > followUps.length && (
                    <Link
                      href="/admin/leads?sort=follow_up_date&order=asc"
                      className="flex items-center justify-center gap-1 py-3 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {counts.followUps - followUps.length} more
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  )}
                </>
              )}
            </WorkQueueSection>

            {/* Callbacks — "come back later" logged at the door. Nothing else in the
                app surfaces these, so without this card they are simply lost. */}
            <WorkQueueSection icon={DoorOpen} title="Callbacks from the door" count={counts?.callbacks}>
              {callbacks.length === 0 ? (
                <SectionEmpty>
                  None waiting. Knocks logged as &quot;Callback&quot; collect here so an
                  interested homeowner doesn&apos;t get forgotten.
                </SectionEmpty>
              ) : (
                <>
                  {callbacks.map((lead) => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      followUp
                      onFollowUpChange={fetchToday}
                      trailing={
                        lead.last_knock_at ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Knocked {format(new Date(lead.last_knock_at), 'MMM d')}
                            {lead.knock_count > 1 ? ` · ${lead.knock_count}×` : ''}
                          </p>
                        ) : undefined
                      }
                    />
                  ))}
                </>
              )}
            </WorkQueueSection>
          </div>
        </>
      )}
    </div>
  );
}
