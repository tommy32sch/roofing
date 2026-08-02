import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { acquireStormCronLock } from '@/lib/storm/cron-lock';
import { refreshRecentStormReports } from '@/lib/storm/ingest-recent';
import { deliverStormAlertEmails, processStormAlerts } from '@/lib/storm/alert-service';
import { executeScheduledJob } from '@/lib/cron/run-ledger';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = db();
    const result = await executeScheduledJob({
      supabase,
      jobName: 'storm-alerts',
      acquireLock: acquireStormCronLock,
      work: async () => {
        const ingestion = await refreshRecentStormReports(supabase);
        const alerts = await processStormAlerts(supabase);
        const delivery = await deliverStormAlertEmails(supabase);
        return { ingestion, alerts, delivery };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[storm-alert-cron]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Storm alert cron failed' },
      { status: 500 }
    );
  }
}
