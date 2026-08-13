'use client';

import Link from 'next/link';
import { format, formatDistance } from 'date-fns';
import {
  ArrowRight,
  CalendarCheck2,
  CalendarClock,
  CalendarX2,
  Map as MapIcon,
  MessageSquare,
  Navigation,
  Phone,
  TimerReset,
} from 'lucide-react';
import { AppointmentOutcomeActions, type RecordableAppointmentOutcome } from '@/components/leads/AppointmentOutcomeActions';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatAddressShort, mapsUrl } from '@/lib/utils/format';
import type { AppointmentOutcome } from '@/types';
import type { TodayAppointment, TodayCommandCenter, TodayScope } from '@/lib/leads/today';

function leadName(appointment: TodayAppointment): string {
  const lead = appointment.leads;
  return lead ? `${lead.first_name} ${lead.last_name}`.trim() : 'Unknown lead';
}

function firstPhone(appointment: TodayAppointment): string | null {
  const lead = appointment.leads;
  return lead ? lead.phone || lead.phone2 || lead.phone3 || null : null;
}

function ContactActions({ appointment, primaryDirections = false }: {
  appointment: TodayAppointment;
  primaryDirections?: boolean;
}) {
  const lead = appointment.leads;
  if (!lead) return null;
  const phone = firstPhone(appointment);
  const directions = mapsUrl(lead);

  return (
    <div className="flex flex-wrap gap-2">
      {directions && (
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: primaryDirections ? 'default' : 'outline' }), 'h-11 flex-1 sm:flex-none')}
        >
          <Navigation />
          Directions
        </a>
      )}
      {phone && (
        <>
          <a href={`tel:${phone}`} className={cn(buttonVariants({ variant: 'outline' }), 'h-11')}>
            <Phone />
            Call
          </a>
          <a href={`sms:${phone}`} className={cn(buttonVariants({ variant: 'outline' }), 'h-11')}>
            <MessageSquare />
            Text
          </a>
        </>
      )}
      <Link
        href={`/admin/leads/${lead.id}`}
        className={cn(buttonVariants({ variant: directions ? 'ghost' : 'default' }), 'h-11')}
      >
        View lead
        <ArrowRight />
      </Link>
    </div>
  );
}

function NextStopCard({
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
      <Card className="border-primary/20 lg:col-span-2">
        <CardContent className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
            <CalendarCheck2 className="h-5 w-5 text-primary" />
          </div>
          <p className="font-medium">No more scheduled stops today</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Your appointment schedule is clear. Open the map to keep the day moving.
          </p>
          <Link href="/admin/map" className={cn(buttonVariants(), 'mt-4 h-11')}>
            <MapIcon />
            Open map
          </Link>
        </CardContent>
      </Card>
    );
  }

  const at = new Date(appointment.scheduled_at);
  const name = leadName(appointment);
  const address = appointment.leads ? formatAddressShort(appointment.leads) : '';

  return (
    <Card className="overflow-hidden border-primary/35 bg-gradient-to-br from-primary/[0.07] via-background to-background lg:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge className="mb-2">Next stop</Badge>
            <CardTitle className="text-xl sm:text-2xl">
              <time dateTime={appointment.scheduled_at}>{format(at, 'h:mm a')}</time>
            </CardTitle>
            <p className="mt-1 text-sm font-medium text-primary">
              {formatDistance(at, new Date(nowIso), { addSuffix: true })}
            </p>
          </div>
          <Badge variant="outline" className="capitalize">
            {appointment.appointment_type}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          {appointment.leads ? (
            <Link href={`/admin/leads/${appointment.leads.id}`} className="text-lg font-semibold hover:underline">
              {name}
            </Link>
          ) : (
            <p className="text-lg font-semibold">{name}</p>
          )}
          <p className="mt-0.5 text-sm text-muted-foreground">{address || 'No address'}</p>
          {appointment.notes && (
            <p className="mt-2 line-clamp-2 rounded-md bg-muted/65 px-3 py-2 text-sm">
              {appointment.notes}
            </p>
          )}
        </div>
        <ContactActions appointment={appointment} primaryDirections />
        {appointment.can_record_outcome && (
          <Button
            type="button"
            variant="ghost"
            className="h-11 px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-destructive"
            disabled={pending !== null}
            onClick={() => onOutcome(appointment, 'cancelled')}
          >
            <CalendarX2 />
            {pending === 'cancelled' ? 'Saving cancellation…' : 'Mark appointment cancelled'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ProgressCard({ model, scope }: { model: TodayCommandCenter; scope: TodayScope }) {
  const { progress } = model;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck2 className="h-4 w-4 text-muted-foreground" />
          {scope === 'mine' ? 'Your progress' : 'Team progress'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-3xl font-semibold tabular-nums">
            {progress.closedOut}
            <span className="text-lg font-normal text-muted-foreground"> / {progress.total}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">appointments closed out today</p>
        </div>
        <Progress value={progress.percent} aria-label="Appointment progress" className="gap-2">
          <ProgressLabel className="text-xs">Daily progress</ProgressLabel>
          <ProgressValue className="text-xs">
            {() => `${progress.percent}%`}
          </ProgressValue>
        </Progress>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-muted/60 p-2.5">
            <p className="font-semibold tabular-nums">{progress.awaiting}</p>
            <p className="text-xs text-muted-foreground">Awaiting result</p>
          </div>
          <div className="rounded-md bg-muted/60 p-2.5">
            <p className="font-semibold tabular-nums">{progress.upcoming}</p>
            <p className="text-xs text-muted-foreground">Upcoming</p>
          </div>
        </div>
        {progress.closedOut > 0 && (
          <p className="text-xs text-muted-foreground">
            {progress.completed} completed · {progress.noShow} no-show · {progress.cancelled} cancelled
          </p>
        )}
      </CardContent>
    </Card>
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
    <section aria-labelledby="awaiting-results-heading">
      <Card className="border-amber-500/30">
        <CardHeader className="pb-3">
          <CardTitle id="awaiting-results-heading" className="flex items-center gap-2 text-base">
            <TimerReset className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Awaiting results
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[11px] font-semibold tabular-nums text-amber-800 dark:text-amber-300">
              {model.awaitingTotal}
            </span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Close these out to keep reminders and performance reporting accurate.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 xl:grid-cols-2">
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
                  className="rounded-xl border bg-card p-4 shadow-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                        <time dateTime={appointment.scheduled_at}>
                          {format(at, 'EEE, MMM d · h:mm a')}
                        </time>
                        {' · '}{formatDistance(at, new Date(nowIso), { addSuffix: true })}
                      </p>
                      {appointment.leads ? (
                        <Link href={`/admin/leads/${appointment.leads.id}`} className="mt-1 block truncate font-semibold hover:underline">
                          {name}
                        </Link>
                      ) : (
                        <p className="mt-1 font-semibold">{name}</p>
                      )}
                      <p className="truncate text-sm text-muted-foreground">
                        {appointment.appointment_type === 'adjuster' ? 'Adjuster meeting' : 'Inspection'}
                        {appointment.leads ? ` · ${formatAddressShort(appointment.leads) || 'No address'}` : ''}
                      </p>
                    </div>
                    <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  {appointment.notes && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{appointment.notes}</p>
                  )}
                  {appointment.can_record_outcome ? (
                    <AppointmentOutcomeActions
                      label={`${name} at ${format(at, 'h:mm a')}`}
                      pending={pending}
                      onSelect={(outcome) => onOutcome(appointment, outcome)}
                      className="mt-4"
                    />
                  ) : (
                    <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                      Only the appointment owner or an admin can record this result.
                    </p>
                  )}
                  {error && (
                    <p role="alert" className="mt-2 text-xs font-medium text-destructive">
                      {error}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
          {model.awaitingTotal > model.awaitingResults.length && (
            <p className="pt-4 text-center text-xs text-muted-foreground">
              {model.awaitingTotal - model.awaitingResults.length} more will appear as these are closed out.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function LaterToday({ appointments }: { appointments: TodayAppointment[] }) {
  if (appointments.length === 0) return null;

  return (
    <section aria-labelledby="later-today-heading">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle id="later-today-heading" className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            Later today
            {appointments.length > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums">
                {appointments.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {appointments.map((appointment) => (
              <div
                key={appointment.id}
                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
              >
                <div className="w-20 shrink-0">
                  <p className="font-semibold tabular-nums">
                    <time dateTime={appointment.scheduled_at}>
                      {format(new Date(appointment.scheduled_at), 'h:mm a')}
                    </time>
                  </p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {appointment.appointment_type}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  {appointment.leads ? (
                    <Link
                      href={`/admin/leads/${appointment.leads.id}`}
                      className="font-medium hover:underline"
                    >
                      {leadName(appointment)}
                    </Link>
                  ) : (
                    <p className="font-medium">Unknown lead</p>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {appointment.leads
                      ? formatAddressShort(appointment.leads) || 'No address'
                      : 'No address'}
                  </p>
                </div>
                <ContactActions appointment={appointment} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
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
    <div className="space-y-6">
      <section aria-label="Today appointment command center" className="grid gap-4 lg:grid-cols-3">
        <NextStopCard
          appointment={model.nextStop}
          nowIso={nowIso}
          pending={model.nextStop ? pendingById[model.nextStop.id] ?? null : null}
          onOutcome={onOutcome}
        />
        <ProgressCard model={model} scope={scope} />
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
