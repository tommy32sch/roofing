import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { findAppointmentConflicts, conflictResponseBody } from '@/lib/leads/appointment-guard';
import {
  isAppointmentOutcome,
  canRecordAppointmentOutcome,
  canModifyAppointment,
} from '@/lib/leads/appointment-outcomes';
import type { AppointmentOutcome } from '@/types';

/**
 * Load the appointment, scoped to its lead.
 *
 * Named for the lead relationship only — it establishes that this appointment
 * belongs to this lead, NOT that the caller owns it. Callers must apply
 * canModifyAppointment separately; the two were conflated once and cancelling
 * ended up with no ownership test at all.
 */
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

/** Who the lead is assigned to — the other half of the ownership question. */
async function getLeadAssignment(leadId: string) {
  const supabase = db();
  const { data } = await supabase
    .from('leads')
    .select('assigned_setter_id, assigned_closer_id')
    .eq('id', leadId)
    .single();
  return (data as { assigned_setter_id: string | null; assigned_closer_id: string | null } | null);
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

    // Each write has one meaning. Outcome capture is transactional through the
    // database function below; mixing it with a reschedule would split one
    // request across two transactions and recreate partial-success states.
    if (
      body.outcome !== undefined &&
      (body.scheduled_at !== undefined || body.notes !== undefined)
    ) {
      return NextResponse.json(
        { success: false, error: 'Record an outcome separately from appointment changes' },
        { status: 400 }
      );
    }

    // Moving or annotating someone else's booking is the same breach as
    // deleting it, so it takes the same ownership test. The outcome branch
    // below keeps its own stricter rule.
    if (body.scheduled_at !== undefined || body.notes !== undefined) {
      const assignedFor = await getLeadAssignment(leadId);
      if (!canModifyAppointment({
        role: admin.role,
        userId: admin.sub,
        appointmentCreatedBy: existing.created_by ?? null,
        leadAssignedSetterId: assignedFor?.assigned_setter_id ?? null,
        leadAssignedCloserId: assignedFor?.assigned_closer_id ?? null,
      })) {
        return NextResponse.json(
          { success: false, error: 'You cannot change this appointment' },
          { status: 403 }
        );
      }
    }

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
    let requestedOutcome: AppointmentOutcome | null = null;
    if (body.outcome !== undefined) {
      if (!isAppointmentOutcome(body.outcome)) {
        return NextResponse.json({ success: false, error: 'Invalid outcome' }, { status: 400 });
      }

      const assigned = await getLeadAssignment(leadId);
      const allowed = canRecordAppointmentOutcome({
        role: admin.role,
        userId: admin.sub,
        appointmentCreatedBy: existing.created_by ?? null,
        leadAssignedSetterId: assigned?.assigned_setter_id ?? null,
        leadAssignedCloserId: assigned?.assigned_closer_id ?? null,
        existingOutcomeBy: existing.outcome_by ?? null,
      });

      if (!allowed) {
        return NextResponse.json(
          { success: false, error: 'You cannot change this outcome' },
          { status: 403 }
        );
      }

      requestedOutcome = body.outcome;
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

    let appointment: unknown;
    if (requestedOutcome) {
      const { data: result, error } = await supabase.rpc('record_appointment_outcome', {
        p_lead_id: leadId,
        p_appointment_id: appointmentId,
        p_outcome: requestedOutcome,
        p_recorded_by: admin.sub,
        p_expected_outcome: existing.outcome ?? 'scheduled',
        p_expected_outcome_by: existing.outcome_by ?? null,
        p_allow_overwrite: admin.role === 'admin',
      });
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      const outcomeResult = result as {
        success?: boolean;
        error?: string;
        appointment?: unknown;
      } | null;
      if (!outcomeResult?.success || !outcomeResult.appointment) {
        const changed = outcomeResult?.error === 'appointment_changed';
        return NextResponse.json(
          {
            success: false,
            error: changed
              ? 'This appointment result changed. Refresh and try again.'
              : outcomeResult?.error || 'Appointment not found',
          },
          { status: changed ? 409 : 404 }
        );
      }
      appointment = outcomeResult.appointment;
    } else {
      const { data, error } = await supabase
        .from('lead_appointments')
        .update(updates)
        .eq('id', appointmentId)
        .select('*')
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      appointment = data;
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

    // This is permanent deletion, not cancellation. Normal cancellation records
    // outcome='cancelled' through PATCH so reporting and history stay intact.
    // Only admins may erase that record; ownership is not enough.
    if (admin.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Only an admin can permanently delete an appointment' },
        { status: 403 }
      );
    }

    const supabase = db();
    const { error } = await supabase.from('lead_appointments').delete().eq('id', appointmentId);
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'updated',
      content: `${typeLabel(existing.appointment_type)} appointment deleted permanently`,
      created_by: admin.sub,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
