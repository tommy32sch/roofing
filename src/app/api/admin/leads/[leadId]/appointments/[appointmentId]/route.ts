import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';

async function getOwnedAppointment(leadId: string, appointmentId: string) {
  const supabase = db();
  const { data } = await supabase
    .from('lead_appointments')
    .select('*')
    .eq('id', appointmentId)
    .eq('lead_id', leadId)
    .single();
  return data;
}

function typeLabel(type: string) {
  return type === 'adjuster' ? 'Adjuster' : 'Inspection';
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string; appointmentId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { leadId, appointmentId } = await params;
    if (!isValidUUID(leadId) || !isValidUUID(appointmentId)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const existing = await getOwnedAppointment(leadId, appointmentId);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.scheduled_at !== undefined) {
      if (typeof body.scheduled_at !== 'string' || Number.isNaN(Date.parse(body.scheduled_at))) {
        return NextResponse.json({ success: false, error: 'Invalid scheduled_at' }, { status: 400 });
      }
      updates.scheduled_at = body.scheduled_at;
    }
    if (body.notes !== undefined) {
      updates.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    }

    const supabase = db();
    const { data: appointment, error } = await supabase
      .from('lead_appointments')
      .update(updates)
      .eq('id', appointmentId)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    if (updates.scheduled_at) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'updated',
        content: `${typeLabel(existing.appointment_type)} appointment rescheduled`,
        created_by: admin.sub,
      });
    }

    return NextResponse.json({ success: true, appointment });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string; appointmentId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { leadId, appointmentId } = await params;
    if (!isValidUUID(leadId) || !isValidUUID(appointmentId)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const existing = await getOwnedAppointment(leadId, appointmentId);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }

    const supabase = db();
    const { error } = await supabase.from('lead_appointments').delete().eq('id', appointmentId);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'updated',
      content: `${typeLabel(existing.appointment_type)} appointment canceled`,
      created_by: admin.sub,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
