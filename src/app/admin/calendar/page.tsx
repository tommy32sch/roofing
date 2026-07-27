'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, isSameDay, isSameMonth, isToday } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { LeadAppointment, LeadStatus } from '@/types';
import { PageHeader } from '@/components/layout/page-header';
import { MarketFilter } from '@/components/markets/market-filter';
import { useMarkets, ALL_MARKETS } from '@/components/markets/use-markets';
import {
  calendarDays,
  calendarRange,
  calendarLabel,
  normalizeAnchor,
  shiftAnchor,
  weekdayLabels,
  type CalendarView,
} from '@/lib/leads/calendar';

interface CalendarAppointment extends LeadAppointment {
  leads: {
    id: string;
    first_name: string;
    last_name: string;
    address_street: string | null;
    address_city: string | null;
    status: LeadStatus;
    assigned_closer_id: string | null;
  } | null;
}

const TYPE_COLORS: Record<string, string> = {
  inspection: 'oklch(0.60 0.17 300)', // matches pipeline-appointment purple
  adjuster: 'oklch(0.75 0.15 80)', // amber
};

/** Appointments shown in a month cell before collapsing into "+N more". */
const MONTH_CELL_LIMIT = 3;

export default function CalendarPage() {
  const [view, setView] = useState<CalendarView>('week');
  const [anchor, setAnchor] = useState(() => normalizeAnchor('week', new Date()));
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();
  const [market, setMarket] = useState('');
  const marketValue = market || (homeMarketId != null ? String(homeMarketId) : ALL_MARKETS);

  const days = useMemo(() => calendarDays(view, anchor), [view, anchor]);
  const range = useMemo(() => calendarRange(view, anchor), [view, anchor]);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      });
      if (market) params.set('market_id', market);
      const res = await fetch(`/api/admin/appointments?${params}`);
      const data = await res.json();
      if (data.success) setAppointments(data.appointments);
    } catch {
      // Failed to fetch
    } finally {
      setLoading(false);
    }
  }, [range, market]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  /**
   * Switching views keeps you near the dates you were already looking at.
   *
   * `around` matters for the "+N more" affordance: without it the jump anchors
   * on the month start, so clicking it on the 24th would open the week of the
   * 1st — the one week guaranteed not to contain what you just clicked.
   */
  function changeView(next: CalendarView, around: Date = anchor) {
    setView(next);
    setAnchor(normalizeAnchor(next, around));
    setLoading(true);
  }

  const isMonth = view === 'month';
  const label = calendarLabel(view, anchor);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendar"
        description="Inspections and adjuster visits for your team"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!marketsLoading && (
              <MarketFilter markets={markets} value={marketValue} onChange={setMarket} className="w-[150px]" />
            )}
            {/* Segmented rather than a dropdown: two options, and which one is
                active changes what every cell on screen means. */}
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Calendar view">
              {(['week', 'month'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => changeView(v)}
                  className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    view === v
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <span className="text-sm text-muted-foreground tabular-nums">{label}</span>
            <Button
              variant="outline"
              size="sm"
              aria-label={isMonth ? 'Previous month' : 'Previous week'}
              onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(normalizeAnchor(view, new Date()))}>
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={isMonth ? 'Next month' : 'Next week'}
              onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* Legend */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS.inspection }} />
          Inspection
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS.adjuster }} />
          Adjuster
        </span>
      </div>

      {loading ? (
        <div className={`grid gap-2 ${isMonth ? 'grid-cols-7' : 'grid-cols-1 md:grid-cols-7'}`}>
          {[...Array(isMonth ? 35 : 7)].map((_, i) => (
            <Skeleton key={i} className={isMonth ? 'h-20 rounded-md' : 'h-24 md:h-64 rounded-md'} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Weekday headings only in month view — the week view already prints
              the weekday on every cell. */}
          {isMonth && (
            <div className="grid grid-cols-7 gap-2">
              {weekdayLabels().map((d) => (
                <p
                  key={d}
                  className="text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {d}
                </p>
              ))}
            </div>
          )}

          <div className={`grid gap-2 ${isMonth ? 'grid-cols-7' : 'grid-cols-1 md:grid-cols-7'}`}>
            {days.map((day) => {
              const dayAppts = appointments
                .filter((a) => isSameDay(new Date(a.scheduled_at), day))
                .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
              const today = isToday(day);
              // Leading/trailing days belong to the neighbouring months. They
              // carry real appointments, so they stay live — just dimmed, so the
              // month you asked for is the one that reads.
              const outside = isMonth && !isSameMonth(day, anchor);
              const shown = isMonth ? dayAppts.slice(0, MONTH_CELL_LIMIT) : dayAppts;
              const hidden = dayAppts.length - shown.length;

              return (
                <div
                  key={day.toISOString()}
                  className={`rounded-md border p-2 ${isMonth ? 'min-h-20' : 'md:min-h-64'} ${
                    today ? 'border-primary bg-primary/5' : ''
                  } ${outside ? 'bg-muted/20 opacity-60' : ''}`}
                >
                  <p className={`text-xs font-medium mb-2 ${today ? 'text-primary' : 'text-muted-foreground'}`}>
                    {isMonth ? format(day, 'd') : format(day, 'EEE d')}
                    {today && <span className="ml-1">· Today</span>}
                  </p>

                  {dayAppts.length === 0 ? (
                    !isMonth && <p className="text-xs text-muted-foreground/50 hidden md:block">—</p>
                  ) : (
                    <div className="space-y-1.5">
                      {shown.map((appt) => (
                        <Link
                          key={appt.id}
                          href={appt.leads ? `/admin/leads/${appt.leads.id}` : '#'}
                          className="block rounded border-l-4 bg-muted/50 hover:bg-muted px-2 py-1.5 transition-colors"
                          style={{ borderLeftColor: TYPE_COLORS[appt.appointment_type] ?? TYPE_COLORS.inspection }}
                          title={
                            appt.leads
                              ? `${format(new Date(appt.scheduled_at), 'h:mm a')} · ${appt.leads.first_name} ${appt.leads.last_name}`
                              : undefined
                          }
                        >
                          <p className="text-xs font-medium tabular-nums">
                            {format(new Date(appt.scheduled_at), isMonth ? 'h:mm' : 'h:mm a')}
                          </p>
                          <p className="text-xs truncate">
                            {appt.leads ? `${appt.leads.first_name} ${appt.leads.last_name}` : 'Unknown lead'}
                          </p>
                          {/* The address is useful planning context but there is
                              no room for it in a month cell. */}
                          {!isMonth && appt.leads?.address_city && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {[appt.leads.address_street, appt.leads.address_city].filter(Boolean).join(', ')}
                            </p>
                          )}
                        </Link>
                      ))}
                      {hidden > 0 && (
                        <button
                          type="button"
                          onClick={() => changeView('week', day)}
                          aria-label={`Show all ${dayAppts.length} appointments on ${format(day, 'MMMM d')}`}
                          className="w-full text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          +{hidden} more
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && appointments.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No appointments this {view}.</p>
      )}
    </div>
  );
}
