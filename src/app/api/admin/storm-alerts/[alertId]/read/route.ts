import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { db } from '@/lib/supabase/server';
import { isValidUUID } from '@/lib/utils/validation';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ alertId: string }> }
) {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  const { alertId } = await params;
  if (!isValidUUID(alertId)) {
    return NextResponse.json({ success: false, error: 'Invalid alert ID' }, { status: 400 });
  }

  try {
    const supabase = db();
    const { data: event, error: eventError } = await supabase
      .from('storm_alert_events')
      .select('id, market_id')
      .eq('id', alertId)
      .maybeSingle();
    if (eventError) throw new Error(eventError.message);
    if (!event) return NextResponse.json({ success: false, error: 'Alert not found' }, { status: 404 });

    const { data: subscription, error: subscriptionError } = await supabase
      .from('storm_alert_subscriptions')
      .select('market_id')
      .eq('market_id', event.market_id)
      .eq('user_id', admin.sub)
      .maybeSingle();
    if (subscriptionError) throw new Error(subscriptionError.message);
    // Do not reveal whether an event exists in a market the caller cannot see.
    if (!subscription) {
      return NextResponse.json({ success: false, error: 'Alert not found' }, { status: 404 });
    }

    const { error: readError } = await supabase
      .from('storm_alert_reads')
      .upsert({
        event_id: event.id,
        user_id: admin.sub,
        market_id: event.market_id,
        read_at: new Date().toISOString(),
      }, { onConflict: 'event_id,user_id' });
    if (readError) throw new Error(readError.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
