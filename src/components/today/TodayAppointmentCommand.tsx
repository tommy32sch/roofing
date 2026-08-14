'use client';

import Link from 'next/link';
import { format, formatDistance } from 'date-fns';
import {
  ArrowRight,
  CalendarClock,
  CalendarX2,
  Map as MapIcon,
  MessageSquare,
  Navigation,
  Phone,
  TimerReset,
} from 'lucide-react';
import { AppointmentOutcomeActions, type RecordableAppointmentOutcome } from '@/components/leads/AppointmentOutcomeActions';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatAddressShort, mapsUrl } from '@/lib/utils/format';
import type { AppointmentOutcome } from '@/types';
import type { TodayAppointment, TodayCommandCenter, TodayScope } from '@/lib/leads/today';

function leadName(appointment: TodayAppointment): string {
  const lead = appointment.leads;
  return lead ? `${lead.first_name} ${lead.last_name}`.trim() : 'Unknown lead';
}

function appointmentType(appointment: TodayAppointment): string {
  return appointment.appointment_type === 'adjuster' ? 'Adjuster meeting' : 'Inspection';
}

function firstPhone(appointment: TodayAppointment): string | null {
  const lead = appointment.leads;
  return lead ? lead.phone || lead.phone2 || lead.phone3 || null : null;
}

function ContactActions({
  appointment,
  hero = false,
  compact = false,
}: {
  appointment: TodayAppointment;
  hero?: boolean;
  compact?: boolean;
}) {
  const lead = appointment.leads;
  if (!lead) return null;
  const phone = firstPhone(appointment);
  const directions = mapsUrl(lead);
  const quietAction = hero
    ? 'border border-background/20 bg-background/5 text-background hover:bg-background/10 hover:text-background dark:border-border dark:bg-background/30 dark:text-foreground dark:hover:bg-background/50'
    : 'border border-border bg-transparent hover:bg-muted';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {directions && (
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            buttonVariants({ variant: hero ? 'default' : 'outline' }),
            'h-11',
            hero && 'min-w-32',
            compact && 'px-3'
          )}
        >
          <Navigation />
          Directions
        </a>
      )}
      {phone && (
        <>
          <a
            href={`tel:${phone}`}
            aria-label={`Call ${lead.first_name}`}
            className={cn(
              buttonVariants({ variant: 'ghost', size: compact ? 'icon' : 'default' }),
              'h-11',
              compact ? 'w-11' : quietAction,
              compact && !hero && 'border border-border bg-transparent hover:bg-muted',
              compact && hero && quietAction
            )}
          >
            <Phone />
            {!compact && <span>Call</span>}
          </a>
          <a
            href={`sms:${phone}`}
            aria-label={`Text ${lead.first_name}`}
            className={cn(
              buttonVariants({ variant: 'ghost', size: compact ? 'icon' : 'default' }),
              'h-11',
              compact ? 'w-11' : quietAction,
              compact && !hero && 'border border-border bg-transparent hover:bg-muted',
              compact && hero && quietAction
            )}
          >
            <MessageSquare />
            {!compact && <span>Text</span>}
          </a>
        </>
      )}
      <Link
        href={`/admin/leads/${lead.id}`}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'h-11 px-3',
          hero && quietAction,
          !hero && 'text-muted-foreground hover:text-foreground'
        )}
      >
        {compact ? 'View' : 'View lead'}
        <ArrowRight />
      </Link>
    </div>
  );
}

function NextStopPanel({
  appointment,
  nowIso,
  pending,
  onOutcome,
}: {
  appointment: TodayAppointment | null;
  nowIso: string;
  pending: AppointmentOutcome | null;
  onOutcome: (appointment: TodayAppointment, outcome: RecordableAppointmentOutcome) => void;
}) {
  if (!appointment) {
    return (
      <div className="flex min-h-64 flex-col justify-center px-5 py-8 sm:px-8 lg:min-h-80 lg:px-10">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
          Next stop
        </p>
        <h2 className="mt-4 max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">
          No more scheduled stops today
        </h2>
        <p className="mt-2 max-w-md text-sm text-background/65 dark:text-muted-foreground">
          Your appointment schedule is clear. Open the map to keep the day moving.
        </p>
        <div className="mt-6">
          <Link href="/admin/map" className={cn(buttonVariants(), 'h-11 px-4')}>
            <MapIcon />
            Open map
          </Link>
        </div>
      </div>
    );
  }

  const at = new Date(appointment.scheduled_at);
  const name = leadName(appointment);
  const address = appointment.leads ? formatAddressShort(appointment.leads) : '';

  return (
    <div className="relative overflow-hidden px-5 py-7 sm:px-8 sm:py-9 lg:px-10 lg:py-10">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
          Next stop
        </p>
        <p className="text-xs font-medium text-background/60 dark:text-muted-foreground">
          {appointmentType(appointment)}
        </p>
      </div>

      <div className="mt-5 grid gap-6 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start lg:mt-7 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <div>
          <p className="text-4xl font-semibold tracking-[-0.04em] tabular-nums sm:text-5xl">
            <time dateTime={appointment.scheduled_at}>{format(at, 'h:mm')}</time>
          </p>
          <p className="mt-0.5 text-lg font-medium uppercase tracking-wide text-background/55 dark:text-muted-foreground">
            {format(at, 'a')}
          </p>
          <p className="mt-2 text-sm font-semibold text-primary">
            {formatDistance(at, new Date(nowIso), { addSuffix: true })}
          </p>
        </div>

        <div className="min-w-0 border-t border-background/15 pt-5 dark:border-border sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          {appointment.leads ? (
            <Link
              href={`/admin/leads/${appointment.leads.id}`}
              className="text-xl font-semibold tracking-tight hover:text-primary sm:text-2xl"
            >
              {name}
            </Link>
          ) : (
            <p className="text-xl font-semibold tracking-tight sm:text-2xl">{name}</p>
          )}
          <p className="mt-1 text-sm text-background/65 dark:text-muted-foreground">
            {address || 'No address'}
          </p>
          {appointment.notes && (
            <p className="mt-4 line-clamp-2 border-l-2 border-primary/70 pl-3 text-sm text-background/70 dark:text-muted-foreground">
              {appointment.notes}
            </p>
          )}
        </div>
      </div>

      <div className="mt-7">
        <ContactActions appointment={appointment} hero />
      </div>
      {appointment.can_record_outcome && (
        <Button
          type="button"
          variant="ghost"
          className="mt-3 h-11 px-0 text-xs text-background/50 hover:bg-transparent hover:text-destructive dark:text-muted-foreground dark:hover:text-destructive"
          disabled={pending !== null}
          onClick={() => onOutcome(appointment, 'cancelled')}
        >
          <CalendarX2 />
          {pending === 'cancelled' ? 'Saving cancellation…' : 'Mark appointment cancelled'}
        </Button>
      )}
    </div>
  );
}

function ProgressPanel({ model, scope }: { model: TodayCommandCenter; scope: TodayScope }) {
  const { progress } = model;
  return (
    <aside className="border-t border-background/15 px-5 py-7 dark:border-border sm:px-8 lg:border-l lg:border-t-0 lg:px-7 lg:py-10">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-background/55 dark:text-muted-foreground">
        {scope === 'mine' ? 'Your day' : 'Team day'}
      </p>
      <div className="mt-5 flex items-end gap-2">
        <p className="text-5xl font-semibold tracking-[-0.05em] tabular-nums">{progress.closedOut}</p>
        <p className="pb-1.5 text-sm text-background/55 dark:text-muted-foreground">
          of {progress.total} closed
        </p>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">Daily progress</span>
          <span className="font-mono tabular-nums text-background/55 dark:text-muted-foreground">
            {progress.percent}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Appointment progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          className="mt-2 h-1.5 overflow-hidden bg-background/15 dark:bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      <dl className="mt-7 grid grid-cols-2 border-y border-background/15 dark:border-border">
        <div className="py-4 pr-3">
          <dd className="text-2xl font-semibold tabular-nums">{progress.awaiting}</dd>
          <dt className="mt-0.5 text-xs text-background/55 dark:text-muted-foreground">
            Awaiting result
          </dt>
        </div>
        <div className="border-l border-background/15 py-4 pl-4 dark:border-border">
          <dd className="text-2xl font-semibold tabular-nums">{progress.upcoming}</dd>
          <dt className="mt-0.5 text-xs text-background/55 dark:text-muted-foreground">
            Upcoming
          </dt>
        </div>
      </dl>

      {progress.closedOut > 0 && (
        <p className="mt-4 text-xs leading-5 text-background/55 dark:text-muted-foreground">
          {progress.completed} completed<br />
          {progress.noShow} no-show · {progress.cancelled} cancelled
        </p>
      )}
    </aside>
  );
}

function AwaitingResults({
  model,
  nowIso,
  pendingById,
  errorsById,
  onOutcome,
}: {
  model: TodayCommandCenter;
  nowIso: string;
  pendingById: Record<string, AppointmentOutcome | undefined>;
  errorsById: Record<string, string | undefined>;
  onOutcome: (appointment: TodayAppointment, outcome: RecordableAppointmentOutcome) => void;
}) {
  if (model.awaitingTotal === 0) return null;

  return (
    <section aria-labelledby="awaiting-results-heading" className="border-t-2 border-status-attention pt-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <TimerReset className="h-4 w-4 text-status-attention" />
            <h2 id="awaiting-results-heading" className="text-lg font-semibold tracking-tight">
              Awaiting results
            </h2>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Close these out to keep reminders and performance reporting accurate.
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold leading-none tabular-nums text-status-attention">
            {model.awaitingTotal}
          </p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Open</p>
        </div>
      </header>

      <div className="mt-5 divide-y border-y">
        {model.awaitingResults.map((appointment) => {
          const at = new Date(appointment.scheduled_at);
          const name = leadName(appointment);
          const error = errorsById[appointment.id];
          const pending = pendingById[appointment.id] ?? null;
          return (
            <article
              key={appointment.id}
              data-awaiting-result
              aria-busy={pending !== null}
              className="grid gap-4 py-5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start xl:grid-cols-[8rem_minmax(0,1fr)_24rem] xl:items-center"
            >
              <div>
                <p className="font-semibold tabular-nums text-status-attention">
                  <time dateTime={appointment.scheduled_at}>{format(at, 'h:mm a')}</time>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {format(at, 'EEE, MMM d')}
                </p>
                <p className="mt-1 text-xs font-medium text-status-attention">
                  {formatDistance(at, new Date(nowIso), { addSuffix: true })}
                </p>
              </div>

              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {appointmentType(appointment)}
                </p>
                {appointment.leads ? (
                  <Link
                    href={`/admin/leads/${appointment.leads.id}`}
                    className="mt-1 block truncate text-base font-semibold hover:text-primary"
                  >
                    {name}
                  </Link>
                ) : (
                  <p className="mt-1 font-semibold">{name}</p>
                )}
                <p className="truncate text-sm text-muted-foreground">
                  {appointment.leads ? formatAddressShort(appointment.leads) || 'No address' : 'No address'}
                </p>
                {appointment.notes && (
                  <p className="mt-2 line-clamp-2 border-l-2 border-border pl-3 text-xs text-muted-foreground">
                    {appointment.notes}
                  </p>
                )}
              </div>

              <div className="sm:col-span-2 xl:col-span-1">
                {appointment.can_record_outcome ? (
                  <AppointmentOutcomeActions
                    label={`${name} at ${format(at, 'h:mm a')}`}
                    pending={pending}
                    onSelect={(outcome) => onOutcome(appointment, outcome)}
                  />
                ) : (
                  <p className="border-l-2 border-border pl-3 text-xs text-muted-foreground">
                    Only the appointment owner or an admin can record this result.
                  </p>
                )}
                {error && (
                  <p role="alert" className="mt-2 text-xs font-medium text-destructive">
                    {error}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {model.awaitingTotal > model.awaitingResults.length && (
        <p className="pt-3 text-center text-xs text-muted-foreground">
          {model.awaitingTotal - model.awaitingResults.length} more will appear as these are closed out.
        </p>
      )}
    </section>
  );
}

function LaterToday({ appointments }: { appointments: TodayAppointment[] }) {
  if (appointments.length === 0) return null;

  return (
    <section aria-labelledby="later-today-heading" className="border-t-2 border-foreground/80 pt-5">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <h2 id="later-today-heading" className="text-lg font-semibold tracking-tight">
            Later today
          </h2>
        </div>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {appointments.length} {appointments.length === 1 ? 'stop' : 'stops'}
        </p>
      </header>

      <div className="mt-4 divide-y border-y">
        {appointments.map((appointment) => (
          <article
            key={appointment.id}
            className="grid gap-3 py-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center lg:grid-cols-[7rem_minmax(0,1fr)_auto]"
          >
            <div>
              <p className="text-lg font-semibold tabular-nums">
                <time dateTime={appointment.scheduled_at}>
                  {format(new Date(appointment.scheduled_at), 'h:mm a')}
                </time>
              </p>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {appointmentType(appointment)}
              </p>
            </div>
            <div className="min-w-0">
              {appointment.leads ? (
                <Link
                  href={`/admin/leads/${appointment.leads.id}`}
                  className="font-semibold hover:text-primary"
                >
                  {leadName(appointment)}
                </Link>
              ) : (
                <p className="font-semibold">Unknown lead</p>
              )}
              <p className="truncate text-sm text-muted-foreground">
                {appointment.leads
                  ? formatAddressShort(appointment.leads) || 'No address'
                  : 'No address'}
              </p>
            </div>
            <div className="sm:col-start-2 lg:col-start-3">
              <ContactActions appointment={appointment} compact />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function TodayAppointmentCommand({
  model,
  scope,
  nowIso,
  pendingById,
  errorsById,
  onOutcome,
}: {
  model: TodayCommandCenter;
  scope: TodayScope;
  nowIso: string;
  pendingById: Record<string, AppointmentOutcome | undefined>;
  errorsById: Record<string, string | undefined>;
  onOutcome: (appointment: TodayAppointment, outcome: RecordableAppointmentOutcome) => void;
}) {
  return (
    <div className="space-y-10">
      <section
        aria-label="Today appointment command center"
        className="overflow-hidden rounded-lg bg-foreground text-background ring-1 ring-foreground/15 dark:bg-card dark:text-foreground dark:ring-border lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]"
      >
        <NextStopPanel
          appointment={model.nextStop}
          nowIso={nowIso}
          pending={model.nextStop ? pendingById[model.nextStop.id] ?? null : null}
          onOutcome={onOutcome}
        />
        <ProgressPanel model={model} scope={scope} />
      </section>
      <AwaitingResults
        model={model}
        nowIso={nowIso}
        pendingById={pendingById}
        errorsById={errorsById}
        onOutcome={onOutcome}
      />
      <LaterToday appointments={model.laterToday} />
    </div>
  );
}
