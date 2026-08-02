import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { acquireCronLock } from '@/lib/cron/lock';
import { executeScheduledJob } from '@/lib/cron/run-ledger';
import {
  planAppointmentReminders,
  deliverAppointmentReminders,
} from '@/lib/appointments/reminder-service';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Daily appointment reminders.
 *
 * One run covers both notices — appointments later today and appointments
 * tomorrow, each in its market's local calendar — because Vercel's Hobby plan
 * allows only daily schedules. At 14:00 UTC that lands at 07:00 in Phoenix and
 * 09:00 in Minneapolis.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = db();
    const result = await executeScheduledJob({
      supabase,
      jobName: 'appointment-reminders',
      acquireLock: () => acquireCronLock('appointment-reminder-cron'),
      work: async () => {
        const planned = await planAppointmentReminders(supabase);
        const delivery = await deliverAppointmentReminders(supabase);
        return { planned, delivery };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[appointment-reminder-cron]', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Appointment reminder cron failed',
      },
      { status: 500 }
    );
  }
}
