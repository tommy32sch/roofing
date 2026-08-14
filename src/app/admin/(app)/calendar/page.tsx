'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Navigation,
  Phone,
  UserRound,
} from 'lucide-react';
import { format, isSameDay, isSameMonth, isToday } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AppointmentOutcome, LeadAppointment, LeadStatus, UserRole } from '@/types';
import { PageHeader } from '@/components/layout/page-header';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import { DataErrorState } from '@/components/layout/data-error-state';
import { EmptyState } from '@/components/layout/empty-state';
import { LeadStatusBadge } from '@/components/leads/lead-status-badge';
import {
  AppointmentOutcomeActions,
  type RecordableAppointmentOutcome,
} from '@/components/leads/AppointmentOutcomeActions';
import {
  calendarDateFromParam,
  calendarDateParam,
  calendarDays,
  calendarLabel,
  calendarRange,
  calendarViewFromParam,
  normalizeAnchor,
  resolveCalendarScope,
  shiftAnchor,
  weekdayLabels,
  type CalendarScope,
  type CalendarView,
  type ScheduleExceptionCode,
} from '@/lib/leads/calendar';
import { appointmentOutcomeLabel } from '@/lib/leads/appointment-outcomes';
import { saveAppointmentOutcome } from '@/lib/leads/appointment-outcome-client';
import { formatAddress, mapsUrl } from '@/lib/utils/format';
import { cn } from '@/lib/utils';
import { useAppShell } from '@/components/providers/app-shell-provider';

interface ScheduleOwner {
  id: string;
  name: string;
}

interface ScheduleLead {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  phone2: string | null;
  phone3: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  latitude: number | null;
  longitude: number | null;
  status: LeadStatus;
  is_dnc: boolean;
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
  setter: ScheduleOwner | null;
  closer: ScheduleOwner | null;
}

interface CalendarAppointment extends LeadAppointment {
  leads: ScheduleLead;
  can_record_outcome: boolean;
  exceptions: ScheduleExceptionCode[];
}

interface ScheduleWorkLead extends ScheduleLead {
  follow_up_date: string;
}

interface TeamMember extends ScheduleOwner {
  role: UserRole;
}

const TYPE_COLORS: Record<string, string> = {
  inspection: 'oklch(0.60 0.17 300)',
  adjuster: 'oklch(0.75 0.15 80)',
};

const EXCEPTION_LABELS: Record<ScheduleExceptionCode, string> = {
  conflict: 'Time conflict',
  missing_setter: 'Missing setter',
  missing_closer: 'Missing closer',
  overdue_outcome: 'Outcome overdue',
};

const ACTION_CLASS =
  'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

function primaryPhone(lead: ScheduleLead): string | null {
  return lead.phone || lead.phone2 || lead.phone3;
}

function scopeLabel(scope: CalendarScope, members: TeamMember[]): string {
  if (scope === 'all') return 'All Team';
  if (scope === 'mine') return 'Mine';
  const accountId = scope.slice(scope.indexOf(':') + 1);
  return members.find((member) => member.id === accountId)?.name ?? 'Team member';
}

function outcomeClass(outcome: AppointmentOutcome): string {
  if (outcome === 'completed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (outcome === 'no_show') return 'border-destructive/25 bg-destructive/10 text-destructive';
  if (outcome === 'cancelled') return 'border-border bg-muted text-muted-foreground';
  return 'border-primary/25 bg-primary/5 text-primary';
}

function AppointmentActions({
  appointment,
  expanded,
  pending,
  compact,
  onToggleOutcome,
  onOutcome,
}: {
  appointment: CalendarAppointment;
  expanded: boolean;
  pending: AppointmentOutcome | null;
  compact: boolean;
  onToggleOutcome: () => void;
  onOutcome: (outcome: RecordableAppointmentOutcome) => void;
}) {
  const lead = appointment.leads;
  const phone = primaryPhone(lead);
  const directions = mapsUrl(lead);
  const name = `${lead.first_name} ${lead.last_name}`.trim();
  const canRecord =
    appointment.can_record_outcome && appointment.exceptions.includes('overdue_outcome');
  const textClass = compact ? 'sr-only' : 'hidden sm:inline';

  return (
    <div className="mt-3 border-t pt-2">
      <div className="flex flex-wrap gap-1">
        {!lead.is_dnc && phone && (
          <a href={`tel:${phone}`} className={ACTION_CLASS} aria-label={`Call ${name}`}>
            <Phone />
            <span className={textClass}>Call</span>
          </a>
        )}
        {directions && (
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            className={ACTION_CLASS}
            aria-label={`Directions to ${name}`}
          >
            <Navigation />
            <span className={textClass}>Directions</span>
          </a>
        )}
        <Link
          href={`/admin/leads/${lead.id}`}
          className={ACTION_CLASS}
          aria-label={`Open lead for ${name}`}
        >
          <UserRound />
          <span className={textClass}>Open Lead</span>
        </Link>
        {canRecord && (
          <Button
            type="button"
            variant="outline"
            className="h-11 min-w-11 px-3 text-xs"
            aria-expanded={expanded}
            onClick={onToggleOutcome}
          >
            <ClipboardCheck />
            <span className={textClass}>Record Outcome</span>
          </Button>
        )}
      </div>

      {lead.is_dnc && phone && (
        <p className="mt-1.5 text-[11px] font-medium text-destructive">Do not call</p>
      )}
      {expanded && canRecord && (
        <AppointmentOutcomeActions
          label={`${name} ${appointment.appointment_type}`}
          pending={pending}
          onSelect={onOutcome}
          className="mt-2"
        />
      )}
    </div>
  );
}

function AppointmentCard({
  appointment,
  compact = false,
  expanded,
  pending,
  onToggleOutcome,
  onOutcome,
}: {
  appointment: CalendarAppointment;
  compact?: boolean;
  expanded: boolean;
  pending: AppointmentOutcome | null;
  onToggleOutcome: () => void;
  onOutcome: (outcome: RecordableAppointmentOutcome) => void;
}) {
  const lead = appointment.leads;
  const name = `${lead.first_name} ${lead.last_name}`.trim();
  const address = formatAddress(lead);
  const outcome = appointment.outcome ?? 'scheduled';

  return (
    <article
      className="min-w-0 border-l-4 bg-muted/25 px-3 py-3"
      style={{ borderLeftColor: TYPE_COLORS[appointment.appointment_type] ?? TYPE_COLORS.inspection }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs font-semibold tabular-nums">
          <time dateTime={appointment.scheduled_at}>
            {format(new Date(appointment.scheduled_at), 'h:mm a')}
          </time>
        </p>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {appointment.appointment_type === 'adjuster' ? 'Adjuster' : 'Inspection'}
        </span>
      </div>

      <p className="mt-2 truncate text-sm font-semibold" title={name}>{name || 'Unknown lead'}</p>
      {address && (
        <p className={cn('mt-0.5 text-xs leading-5 text-muted-foreground', compact ? 'line-clamp-2' : '')}>
          {address}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <LeadStatusBadge status={lead.status} />
        <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', outcomeClass(outcome))}>
          {appointmentOutcomeLabel(outcome)}
        </span>
      </div>

      <dl className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 gap-1">
          <dt className="shrink-0 font-medium text-foreground">Setter</dt>
          <dd className="truncate">{lead.setter?.name ?? 'Unassigned'}</dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt className="shrink-0 font-medium text-foreground">Closer</dt>
          <dd className="truncate">{lead.closer?.name ?? 'Unassigned'}</dd>
        </div>
      </dl>

      {appointment.exceptions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="Schedule exceptions">
          {appointment.exceptions.map((exception) => (
            <span
              key={exception}
              className="inline-flex items-center gap-1 border border-destructive/25 bg-destructive/5 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
            >
              <AlertTriangle className="h-3 w-3" />
              {EXCEPTION_LABELS[exception]}
            </span>
          ))}
        </div>
      )}

      <AppointmentActions
        appointment={appointment}
        expanded={expanded}
        pending={pending}
        compact={compact}
        onToggleOutcome={onToggleOutcome}
        onOutcome={onOutcome}
      />
    </article>
  );
}

function Agenda({
  days,
  appointments,
  expandedId,
  pendingById,
  onToggleOutcome,
  onOutcome,
}: {
  days: Date[];
  appointments: CalendarAppointment[];
  expandedId: string | null;
  pendingById: Record<string, AppointmentOutcome | undefined>;
  onToggleOutcome: (appointmentId: string) => void;
  onOutcome: (appointment: CalendarAppointment, outcome: RecordableAppointmentOutcome) => void;
}) {
  const occupiedDays = days.filter((day) => appointments.some((appointment) => (
    isSameDay(new Date(appointment.scheduled_at), day)
  )));

  if (occupiedDays.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No appointments in this range"
        description="Scheduled inspections and adjuster visits will appear here."
        className="border-y"
      />
    );
  }

  return (
    <div className="divide-y border-y">
      {occupiedDays.map((day) => {
        const dayAppointments = appointments.filter((appointment) => (
          isSameDay(new Date(appointment.scheduled_at), day)
        ));
        return (
          <section key={calendarDateParam(day)} className="py-4">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold">
                {format(day, 'EEEE, MMMM d')}{isToday(day) ? ' · Today' : ''}
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {dayAppointments.length} stop{dayAppointments.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="space-y-2">
              {dayAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  expanded={expandedId === appointment.id}
                  pending={pendingById[appointment.id] ?? null}
                  onToggleOutcome={() => onToggleOutcome(appointment.id)}
                  onOutcome={(outcome) => onOutcome(appointment, outcome)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function WeekSchedule({
  days,
  appointments,
  expandedId,
  pendingById,
  onToggleOutcome,
  onOutcome,
}: {
  days: Date[];
  appointments: CalendarAppointment[];
  expandedId: string | null;
  pendingById: Record<string, AppointmentOutcome | undefined>;
  onToggleOutcome: (appointmentId: string) => void;
  onOutcome: (appointment: CalendarAppointment, outcome: RecordableAppointmentOutcome) => void;
}) {
  return (
    <div className="hidden grid-cols-7 gap-px overflow-hidden border bg-border xl:grid">
      {days.map((day) => {
        const dayAppointments = appointments.filter((appointment) => (
          isSameDay(new Date(appointment.scheduled_at), day)
        ));
        return (
          <section key={calendarDateParam(day)} className="min-w-0 bg-background p-2">
            <div className={cn('mb-3 border-b pb-2', isToday(day) && 'border-primary')}>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {format(day, 'EEE')}
              </p>
              <p className={cn('text-lg font-semibold tabular-nums', isToday(day) && 'text-primary')}>
                {format(day, 'd')}
              </p>
            </div>
            <div className="space-y-2">
              {dayAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={appointment}
                  compact
                  expanded={expandedId === appointment.id}
                  pending={pendingById[appointment.id] ?? null}
                  onToggleOutcome={() => onToggleOutcome(appointment.id)}
                  onOutcome={(outcome) => onOutcome(appointment, outcome)}
                />
              ))}
              {dayAppointments.length === 0 && (
                <p className="py-8 text-center text-xs text-muted-foreground/60">Open</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MonthOverview({
  days,
  anchor,
  appointments,
  onOpenWeek,
}: {
  days: Date[];
  anchor: Date;
  appointments: CalendarAppointment[];
  onOpenWeek: (day: Date) => void;
}) {
  return (
    <div className="hidden lg:block">
      <div className="grid grid-cols-7 gap-px border-x border-t bg-border">
        {weekdayLabels().map((label) => (
          <p
            key={label}
            className="bg-muted/40 px-2 py-2 text-center font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {label}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden border bg-border">
        {days.map((day) => {
          const dayAppointments = appointments.filter((appointment) => (
            isSameDay(new Date(appointment.scheduled_at), day)
          ));
          const shown = dayAppointments.slice(0, 2);
          const outside = !isSameMonth(day, anchor);
          return (
            <section
              key={calendarDateParam(day)}
              className={cn('min-h-28 min-w-0 bg-background p-2', outside && 'bg-muted/20 text-muted-foreground')}
            >
              <p className={cn('text-xs font-semibold tabular-nums', isToday(day) && 'text-primary')}>
                {format(day, 'd')}{isToday(day) ? ' · Today' : ''}
              </p>
              <div className="mt-2 space-y-1">
                {shown.map((appointment) => (
                  <Link
                    key={appointment.id}
                    href={`/admin/leads/${appointment.leads.id}`}
                    className={cn(
                      'block truncate border-l-2 bg-muted/50 px-1.5 py-1 text-[11px] hover:bg-muted',
                      appointment.exceptions.length > 0 && 'bg-destructive/5 text-destructive'
                    )}
                    style={{ borderLeftColor: TYPE_COLORS[appointment.appointment_type] ?? TYPE_COLORS.inspection }}
                    title={`${format(new Date(appointment.scheduled_at), 'h:mm a')} · ${appointment.leads.first_name} ${appointment.leads.last_name}`}
                  >
                    <span className="font-medium tabular-nums">
                      {format(new Date(appointment.scheduled_at), 'h:mm')}
                    </span>{' '}
                    {appointment.leads.first_name} {appointment.leads.last_name}
                  </Link>
                ))}
                {dayAppointments.length > shown.length && (
                  <button
                    type="button"
                    className="h-7 w-full text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => onOpenWeek(day)}
                  >
                    +{dayAppointments.length - shown.length} more
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function UnscheduledRail({
  work,
  loading,
  error,
  hasMore,
  onRetry,
}: {
  work: ScheduleWorkLead[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  onRetry: () => void;
}) {
  return (
    <aside aria-labelledby="unscheduled-heading" className="border-t pt-4 2xl:border-l 2xl:border-t-0 2xl:pl-5 2xl:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
            Work rail
          </p>
          <h2 id="unscheduled-heading" className="mt-1 text-lg font-semibold tracking-tight">
            Needs a date
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Due follow-ups with no future appointment.
          </p>
        </div>
        {!loading && !error && (
          <span className="font-mono text-xs font-semibold tabular-nums">{work.length}</span>
        )}
      </div>

      {loading ? (
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-28" />)}
        </div>
      ) : error ? (
        <div className="mt-4">
          <DataErrorState compact title="Follow-ups did not load" description={error} onRetry={onRetry} />
        </div>
      ) : work.length === 0 ? (
        <div className="mt-4 border-y py-8 text-center">
          <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-600" />
          <p className="mt-2 text-sm font-medium">No unscheduled follow-ups</p>
          <p className="mt-1 text-xs text-muted-foreground">Every due follow-up has a future visit.</p>
        </div>
      ) : (
        <div className="mt-4 divide-y border-y">
          {work.map((lead) => {
            const name = `${lead.first_name} ${lead.last_name}`.trim();
            const address = formatAddress(lead);
            const phone = primaryPhone(lead);
            const directions = mapsUrl(lead);
            return (
              <article key={lead.id} className="py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{name}</p>
                    {address && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{address}</p>}
                  </div>
                  <span className="shrink-0 border border-destructive/25 bg-destructive/5 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                    Due {format(new Date(`${lead.follow_up_date}T00:00:00`), 'MMM d')}
                  </span>
                </div>
                <p className="mt-2 truncate text-[11px] text-muted-foreground">
                  {lead.setter?.name ? `Setter ${lead.setter.name}` : 'No setter'}
                  {' · '}
                  {lead.closer?.name ? `Closer ${lead.closer.name}` : 'No closer'}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {!lead.is_dnc && phone && (
                    <a href={`tel:${phone}`} className={ACTION_CLASS} aria-label={`Call ${name}`}>
                      <Phone />
                      <span className="sr-only">Call</span>
                    </a>
                  )}
                  {directions && (
                    <a
                      href={directions}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={ACTION_CLASS}
                      aria-label={`Directions to ${name}`}
                    >
                      <Navigation />
                      <span className="sr-only">Directions</span>
                    </a>
                  )}
                  <Link href={`/admin/leads/${lead.id}#appointments-heading`} className={ACTION_CLASS}>
                    <CalendarClock />
                    Schedule
                  </Link>
                </div>
                {lead.is_dnc && phone && (
                  <p className="mt-1.5 text-[11px] font-medium text-destructive">Do not call</p>
                )}
              </article>
            );
          })}
          {hasMore && (
            <p className="py-3 text-xs text-muted-foreground">
              More due follow-ups remain. Open the Lead Book for the full queue.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarLoading />}>
      <CalendarContent />
    </Suspense>
  );
}

function CalendarLoading() {
  return (
    <div className="space-y-4">
      <PageHeader title="Schedule Desk" description="Inspections and adjuster visits" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function CalendarContent() {
  const { user, permissions } = useAppShell();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const [deviceNow] = useState(() => new Date());
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [scheduleWork, setScheduleWork] = useState<ScheduleWorkLead[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [workLoading, setWorkLoading] = useState(true);
  const [error, setError] = useState('');
  const [workError, setWorkError] = useState('');
  const [workHasMore, setWorkHasMore] = useState(false);
  const [generatedAt, setGeneratedAt] = useState('');
  const [expandedOutcomeId, setExpandedOutcomeId] = useState<string | null>(null);
  const [pendingById, setPendingById] = useState<Record<string, AppointmentOutcome | undefined>>({});
  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();

  const view = calendarViewFromParam(searchParams.get('view'));
  const dateParam = searchParams.get('date');
  const anchor = useMemo(
    () => normalizeAnchor(view, calendarDateFromParam(dateParam, deviceNow)),
    [dateParam, deviceNow, view]
  );
  const scopeDecision = resolveCalendarScope(user.role, searchParams.get('scope'));
  const scope: CalendarScope = scopeDecision.ok
    ? scopeDecision.scope
    : user.role === 'admin'
      ? 'all'
      : 'mine';
  const marketParam = searchParams.get('market_id') || '';
  const marketValue = marketParam || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);
  const days = useMemo(() => calendarDays(view, anchor), [view, anchor]);
  const range = useMemo(() => calendarRange(view, anchor), [view, anchor]);

  const replaceParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParamsString);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParamsString]);

  const changeView = useCallback((nextView: CalendarView, around: Date = anchor) => {
    const nextAnchor = normalizeAnchor(nextView, around);
    replaceParams({ view: nextView, date: calendarDateParam(nextAnchor) });
  }, [anchor, replaceParams]);

  useEffect(() => {
    if (!permissions.canViewTeamData) return;
    const controller = new AbortController();
    fetch('/api/admin/users', { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (!data?.success) return;
        setTeamMembers((data.users as TeamMember[]).filter((member) => (
          member.role === 'setter' || member.role === 'closer'
        )));
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setTeamMembers([]);
      });
    return () => controller.abort();
  }, [permissions.canViewTeamData]);

  const fetchAppointments = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        scope,
      });
      if (marketParam) params.set('market_id', marketParam);
      const response = await fetch(`/api/admin/appointments?${params}`, { signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Could not load appointments');
      }
      setAppointments(data.appointments);
      setGeneratedAt(data.generatedAt);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Could not load appointments');
    } finally {
      if (!signal?.aborted && !quiet) setLoading(false);
    }
  }, [marketParam, range.end, range.start, scope]);

  const fetchScheduleWork = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) setWorkLoading(true);
    setWorkError('');
    try {
      const now = new Date();
      const params = new URLSearchParams({
        due_before: calendarDateParam(now),
        now: now.toISOString(),
        scope,
      });
      if (marketParam) params.set('market_id', marketParam);
      const response = await fetch(`/api/admin/schedule-work?${params}`, { signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Could not load unscheduled follow-ups');
      }
      setScheduleWork(data.work);
      setWorkHasMore(!!data.hasMore);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setWorkError(cause instanceof Error ? cause.message : 'Could not load unscheduled follow-ups');
    } finally {
      if (!signal?.aborted && !quiet) setWorkLoading(false);
    }
  }, [marketParam, scope]);

  useEffect(() => {
    const controller = new AbortController();
    fetchAppointments(controller.signal);
    return () => controller.abort();
  }, [fetchAppointments]);

  useEffect(() => {
    const controller = new AbortController();
    fetchScheduleWork(controller.signal);
    return () => controller.abort();
  }, [fetchScheduleWork]);

  const recordOutcome = useCallback(async (
    appointment: CalendarAppointment,
    outcome: RecordableAppointmentOutcome
  ) => {
    setPendingById((current) => ({ ...current, [appointment.id]: outcome }));
    try {
      await saveAppointmentOutcome({
        leadId: appointment.leads.id,
        appointmentId: appointment.id,
        outcome,
      });
      toast.success(
        `${appointment.leads.first_name} ${appointment.leads.last_name} marked ${appointmentOutcomeLabel(outcome).toLowerCase()}`
      );
      setExpandedOutcomeId(null);
      await Promise.all([fetchAppointments(undefined, true), fetchScheduleWork(undefined, true)]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not record the appointment result');
    } finally {
      setPendingById((current) => ({ ...current, [appointment.id]: undefined }));
    }
  }, [fetchAppointments, fetchScheduleWork]);

  const exceptionCount = appointments.filter((appointment) => appointment.exceptions.length > 0).length;
  const scheduledCount = appointments.filter((appointment) => appointment.outcome === 'scheduled').length;
  const isMonth = view === 'month';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Schedule Desk"
        description={permissions.canViewTeamData
          ? 'Inspections, adjuster visits, and schedule exceptions for your team'
          : 'Inspections and adjuster visits assigned to you'}
      />

      <div className="flex flex-wrap items-end gap-3 border-b pb-4">
        {!marketsLoading && markets.length >= 2 && (
          <div>
            <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Market
            </p>
            <MarketFilter
              markets={markets}
              value={marketValue}
              onChange={(value) => replaceParams({ market_id: value })}
              className="h-11 w-[160px]"
            />
          </div>
        )}

        {permissions.canViewTeamData && (
          <div>
            <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Team
            </p>
            <Select
              value={scope}
              onValueChange={(value) => value && replaceParams({ scope: value })}
            >
              <SelectTrigger className="h-11 w-[190px]" aria-label="Schedule owner">
                <SelectValue>{scopeLabel(scope, teamMembers)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Team</SelectItem>
                <SelectItem value="mine">Mine</SelectItem>
                {teamMembers.some((member) => member.role === 'setter') && (
                  <SelectGroup>
                    <SelectLabel>Setters</SelectLabel>
                    {teamMembers.filter((member) => member.role === 'setter').map((member) => (
                      <SelectItem key={member.id} value={`setter:${member.id}`}>{member.name}</SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {teamMembers.some((member) => member.role === 'closer') && (
                  <SelectGroup>
                    <SelectLabel>Closers</SelectLabel>
                    {teamMembers.filter((member) => member.role === 'closer').map((member) => (
                      <SelectItem key={member.id} value={`closer:${member.id}`}>{member.name}</SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            View
          </p>
          <div className="flex h-11 border-b" role="group" aria-label="Calendar view">
            {(['week', 'month'] as const).map((nextView) => (
              <button
                key={nextView}
                type="button"
                aria-pressed={view === nextView}
                onClick={() => changeView(nextView)}
                className={cn(
                  'relative h-11 px-3 text-xs font-semibold capitalize after:absolute after:inset-x-2 after:-bottom-px after:h-0.5',
                  view === nextView
                    ? 'text-foreground after:bg-primary'
                    : 'text-muted-foreground after:bg-transparent hover:text-foreground'
                )}
              >
                {nextView}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <span className="mr-2 text-sm font-medium tabular-nums">{calendarLabel(view, anchor)}</span>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-11 px-0"
            aria-label={isMonth ? 'Previous month' : 'Previous week'}
            onClick={() => replaceParams({ date: calendarDateParam(shiftAnchor(view, anchor, -1)) })}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => replaceParams({ date: calendarDateParam(normalizeAnchor(view, new Date())) })}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-11 px-0"
            aria-label={isMonth ? 'Next month' : 'Next week'}
            onClick={() => replaceParams({ date: calendarDateParam(shiftAnchor(view, anchor, 1)) })}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x border-y py-3 text-center">
        <div>
          <p className="font-mono text-lg font-semibold tabular-nums">{appointments.length}</p>
          <p className="text-[11px] text-muted-foreground">Appointments</p>
        </div>
        <div>
          <p className="font-mono text-lg font-semibold tabular-nums">{scheduledCount}</p>
          <p className="text-[11px] text-muted-foreground">Scheduled</p>
        </div>
        <div>
          <p className={cn('font-mono text-lg font-semibold tabular-nums', exceptionCount > 0 && 'text-destructive')}>
            {exceptionCount}
          </p>
          <p className="text-[11px] text-muted-foreground">Exceptions</p>
        </div>
      </div>

      {error && appointments.length > 0 && (
        <DataErrorState
          compact
          title="Schedule could not refresh"
          description={`${error} The last loaded schedule remains visible.`}
          onRetry={() => fetchAppointments()}
        />
      )}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_16rem]">
        <main className="min-w-0">
          {loading ? (
            <div className={cn(
              'grid grid-cols-1 gap-2',
              isMonth ? 'lg:grid-cols-7' : 'xl:grid-cols-7'
            )}>
              {[...Array(isMonth ? 35 : 7)].map((_, index) => (
                <Skeleton key={index} className={isMonth ? 'h-28' : 'h-72'} />
              ))}
            </div>
          ) : error && appointments.length === 0 ? (
            <DataErrorState title="Appointments did not load" description={error} onRetry={() => fetchAppointments()} />
          ) : isMonth ? (
            <>
              <MonthOverview
                days={days}
                anchor={anchor}
                appointments={appointments}
                onOpenWeek={(day) => changeView('week', day)}
              />
              <div className="lg:hidden">
                <Agenda
                  days={days}
                  appointments={appointments}
                  expandedId={expandedOutcomeId}
                  pendingById={pendingById}
                  onToggleOutcome={(id) => setExpandedOutcomeId((current) => current === id ? null : id)}
                  onOutcome={recordOutcome}
                />
              </div>
            </>
          ) : (
            <>
              <WeekSchedule
                days={days}
                appointments={appointments}
                expandedId={expandedOutcomeId}
                pendingById={pendingById}
                onToggleOutcome={(id) => setExpandedOutcomeId((current) => current === id ? null : id)}
                onOutcome={recordOutcome}
              />
              <div className="xl:hidden">
                <Agenda
                  days={days}
                  appointments={appointments}
                  expandedId={expandedOutcomeId}
                  pendingById={pendingById}
                  onToggleOutcome={(id) => setExpandedOutcomeId((current) => current === id ? null : id)}
                  onOutcome={recordOutcome}
                />
              </div>
            </>
          )}

          {generatedAt && !loading && (
            <p className="mt-3 text-right text-[11px] text-muted-foreground">
              Updated {format(new Date(generatedAt), 'h:mm a')}
            </p>
          )}
        </main>

        <UnscheduledRail
          work={scheduleWork}
          loading={workLoading}
          error={workError}
          hasMore={workHasMore}
          onRetry={() => fetchScheduleWork()}
        />
      </div>
    </div>
  );
}
