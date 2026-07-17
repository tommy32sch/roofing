'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, format, isSameDay, isToday, startOfWeek } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { LeadAppointment, LeadStatus } from '@/types';

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

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    const start = weekStart.toISOString();
    const end = addDays(weekStart, 7).toISOString();
    try {
      const res = await fetch(`/api/admin/appointments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
      const data = await res.json();
      if (data.success) setAppointments(data.appointments);
    } catch {
      // Failed to fetch
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(addDays(weekStart, 6), 'MMM d, yyyy')}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{weekLabel}</span>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
          >
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

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
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {[...Array(7)].map((_, i) => (
            <Skeleton key={i} className="h-24 md:h-64 rounded-md" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {days.map((day) => {
            const dayAppts = appointments.filter((a) => isSameDay(new Date(a.scheduled_at), day));
            const today = isToday(day);
            return (
              <div
                key={day.toISOString()}
                className={`rounded-md border p-2 md:min-h-64 ${today ? 'border-primary bg-primary/5' : ''}`}
              >
                <p className={`text-xs font-medium mb-2 ${today ? 'text-primary' : 'text-muted-foreground'}`}>
                  {format(day, 'EEE d')}
                  {today && <span className="ml-1">· Today</span>}
                </p>
                {dayAppts.length === 0 ? (
                  <p className="text-xs text-muted-foreground/50 hidden md:block">—</p>
                ) : (
                  <div className="space-y-1.5">
                    {dayAppts.map((appt) => (
                      <Link
                        key={appt.id}
                        href={appt.leads ? `/admin/leads/${appt.leads.id}` : '#'}
                        className="block rounded border-l-4 bg-muted/50 hover:bg-muted px-2 py-1.5 transition-colors"
                        style={{ borderLeftColor: TYPE_COLORS[appt.appointment_type] ?? TYPE_COLORS.inspection }}
                      >
                        <p className="text-xs font-medium">{format(new Date(appt.scheduled_at), 'h:mm a')}</p>
                        <p className="text-xs truncate">
                          {appt.leads ? `${appt.leads.first_name} ${appt.leads.last_name}` : 'Unknown lead'}
                        </p>
                        {appt.leads?.address_city && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {[appt.leads.address_street, appt.leads.address_city].filter(Boolean).join(', ')}
                          </p>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && appointments.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No appointments this week.</p>
      )}
    </div>
  );
}
