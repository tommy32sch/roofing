import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { notifyAppointmentBooked } from '@/lib/notifications/notify-appointment';

const APPOINTMENT_TYPES = new Set(['inspection', 'adjuster']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { leadId } = await params;
    if (!isValidUUID(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
    }

    const body = await request.json();
    const appointmentType = body.appointment_type ?? 'inspection';
    if (!APPOINTMENT_TYPES.has(appointmentType)) {
      return NextResponse.json({ success: false, error: 'Invalid appointment type' }, { status: 400 });
    }
    if (typeof body.scheduled_at !== 'string' || Number.isNaN(Date.parse(body.scheduled_at))) {
      return NextResponse.json({ success: false, error: 'Valid scheduled_at is required' }, { status: 400 });
    }
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

    const supabase = db();

    const { data: lead } = await supabase.from('leads').select('id').eq('id', leadId).single();
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    const { data: appointment, error } = await supabase
      .from('lead_appointments')
      .insert({
        lead_id: leadId,
        appointment_type: appointmentType,
        scheduled_at: body.scheduled_at,
        notes,
        created_by: admin.sub,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'updated',
      content: `${appointmentType === 'adjuster' ? 'Adjuster' : 'Inspection'} appointment scheduled`,
      created_by: admin.sub,
    });

    // Best-effort: the booking is already saved, so a notification failure is
    // reported back but never rolls this call into an error.
    const notified = await notifyAppointmentBooked(supabase, {
      leadId,
      appointment,
      actorId: admin.sub,
    });

    return NextResponse.json({ success: true, appointment, notified }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
