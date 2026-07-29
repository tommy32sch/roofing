import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { findAppointmentConflicts, conflictResponseBody } from '@/lib/leads/appointment-guard';
import {
  isAppointmentOutcome,
  appointmentOutcomeLabel,
  canRecordOutcome,
} from '@/lib/leads/appointment-outcomes';

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

    // Did the visit happen? Reps record their own results — they are the ones at
    // the door — but only an admin may overwrite someone else's, so a
    // disappointing outcome cannot be quietly rewritten by the person it
    // reflects on.
    if (body.outcome !== undefined) {
      if (!isAppointmentOutcome(body.outcome)) {
        return NextResponse.json({ success: false, error: 'Invalid outcome' }, { status: 400 });
      }

      const { data: lead } = await supabase
        .from('leads')
        .select('assigned_setter_id, assigned_closer_id')
        .eq('id', leadId)
        .single();

      const assigned = (lead as { assigned_setter_id: string | null; assigned_closer_id: string | null } | null);
      const allowed =
        canRecordOutcome({
          role: admin.role,
          userId: admin.sub,
          appointmentCreatedBy: existing.created_by ?? null,
          appointmentAssignedTo: assigned?.assigned_closer_id ?? null,
          existingOutcomeBy: existing.outcome_by ?? null,
        }) ||
        canRecordOutcome({
          role: admin.role,
          userId: admin.sub,
          appointmentCreatedBy: existing.created_by ?? null,
          appointmentAssignedTo: assigned?.assigned_setter_id ?? null,
          existingOutcomeBy: existing.outcome_by ?? null,
        });

      if (!allowed) {
        return NextResponse.json(
          { success: false, error: 'You cannot change this outcome' },
          { status: 403 }
        );
      }

      updates.outcome = body.outcome;
      // Returning a booking to 'scheduled' is undoing a mistake, so the
      // attribution is cleared rather than left pointing at a decision that no
      // longer exists.
      updates.outcome_at = body.outcome === 'scheduled' ? null : new Date().toISOString();
      updates.outcome_by = body.outcome === 'scheduled' ? null : admin.sub;
    }

    // Same guard as creating one. excludeAppointmentId matters here: without it
    // this appointment would always clash with itself and no reschedule could
    // ever succeed.
    if (updates.scheduled_at && !body.allow_conflict) {
      const conflicts = await findAppointmentConflicts(supabase, {
        leadId,
        scheduledAt: updates.scheduled_at as string,
        excludeAppointmentId: appointmentId,
      });
      if (conflicts.length > 0) {
        return NextResponse.json(conflictResponseBody(conflicts), { status: 409 });
      }
    }

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

    // An outcome belongs in the timeline: "nobody was home for the inspection"
    // is history, and the person reading the lead later needs it without
    // opening a report.
    if (updates.outcome && updates.outcome !== existing.outcome) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'updated',
        content: `${typeLabel(existing.appointment_type)} appointment marked ${appointmentOutcomeLabel(
          updates.outcome as string
        ).toLowerCase()}`,
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
