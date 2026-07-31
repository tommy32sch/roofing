import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { parsePhoneNumber } from 'libphonenumber-js';
import { estimateRoofValue } from '@/lib/leads/roof-value';
import { findAppointmentConflicts, conflictResponseBody } from '@/lib/leads/appointment-guard';
import { getRoofPricePerSquare } from '@/lib/leads/roof-value.server';
import { notifyAppointmentBooked } from '@/lib/notifications/notify-appointment';
import { pickWritableLeadFields, statusDenialReason } from '@/lib/leads/lead-fields';
import { buildLeadDeletionRecord, type DeletedLeadSnapshot } from '@/lib/leads/lead-deletion';

// The mass-assignment whitelist and the setter status rules are shared with the
// create route — see src/lib/leads/lead-fields.ts for why they live there.
const DEMOGRAPHIC_REQUIRED_FIELDS = [
  'career', 'family_size', 'marital_status', 'age_range', 'household_income_range',
  'education_level', 'years_in_home', 'insurance_carrier', 'decision_maker', 'referral_source',
] as const;

export async function GET(
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

    const supabase = db();

    const { data: lead, error } = await supabase
      .from('leads')
      // The import batch comes along so the Source card can name the file a
      // lead arrived in, not just who uploaded it.
      .select('*, lead_sources!source_id(id, name, display_name), lead_import_batches!import_batch_id(id, filename, uploaded_by_name, created_at)')
      .eq('id', leadId)
      .single();

    if (error || !lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    // Closers can only view sold leads
    if (admin.role === 'closer' && lead.status !== 'sold') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Bring structured contact history into the detail response. The generic
    // activity feed is useful context, but it cannot show exact result totals
    // or distinguish a manual "visit" note from a recorded door knock.
    const [
      { data: activities },
      { data: appointments },
      { data: knocks },
      { data: calls },
    ] = await Promise.all([
      supabase
        .from('lead_activities')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false }),
      supabase
        .from('lead_appointments')
        .select('*')
        .eq('lead_id', leadId)
        .order('scheduled_at', { ascending: true }),
      supabase
        .from('lead_knocks')
        .select('*, admin_users(name)')
        .eq('lead_id', leadId)
        .order('knocked_at', { ascending: false }),
      supabase
        .from('lead_calls')
        .select('*, admin_users(name)')
        .eq('lead_id', leadId)
        .order('called_at', { ascending: false }),
    ]);

    return NextResponse.json({
      success: true,
      lead: {
        ...lead,
        lead_activities: activities || [],
        lead_appointments: appointments || [],
        lead_knocks: knocks || [],
        lead_calls: calls || [],
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
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

    const supabase = db();
    const body = await request.json();

    // Get current lead for status change tracking + roof-value recompute inputs
    const { data: currentLead } = await supabase
      .from('leads')
      .select('status, sqft, stories, roof_type')
      .eq('id', leadId)
      .single();

    if (!currentLead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    // Enforce role-based status transition rules
    if (body.status && body.status !== currentLead.status) {
      const denial = statusDenialReason(body.status, admin.role);
      if (denial) {
        return NextResponse.json({ success: false, error: denial }, { status: 403 });
      }
    }

    // Transitioning to appointment_set requires a scheduled time — the
    // appointment row is created after the lead update succeeds.
    let appointmentScheduledAt: string | null = null;
    let appointmentNotes: string | null = null;
    if (body.status === 'appointment_set' && body.status !== currentLead.status) {
      if (
        typeof body.appointment_scheduled_at !== 'string' ||
        Number.isNaN(Date.parse(body.appointment_scheduled_at))
      ) {
        return NextResponse.json(
          { success: false, error: 'appointment_form_required' },
          { status: 400 }
        );
      }
      const scheduledAt: string = body.appointment_scheduled_at;
      appointmentScheduledAt = scheduledAt;

      // Booking a slot from the status change is still a booking, so it takes
      // the same conflict check as the Appointments card.
      if (!body.allow_conflict) {
        const conflicts = await findAppointmentConflicts(supabase, {
          leadId,
          scheduledAt,
        });
        if (conflicts.length > 0) {
          return NextResponse.json(conflictResponseBody(conflicts), { status: 409 });
        }
      }
      appointmentNotes =
        typeof body.appointment_notes === 'string' && body.appointment_notes.trim()
          ? body.appointment_notes.trim()
          : null;
    }
    // Not lead columns — strip before the update
    delete body.appointment_scheduled_at;
    delete body.appointment_notes;

    // When marking as sold, demographic form must be complete
    let demographicCapturedAt: string | null = null;
    if (body.status === 'sold' && (admin.role === 'closer' || admin.role === 'admin')) {
      const missing = DEMOGRAPHIC_REQUIRED_FIELDS.filter(
        f => body[f] === undefined || body[f] === null || body[f] === ''
      );
      if (missing.length > 0) {
        return NextResponse.json(
          { success: false, error: 'demographic_form_required', missing },
          { status: 400 }
        );
      }
      demographicCapturedAt = new Date().toISOString();
    }

    // Whitelist editable fields — anything else in the payload is ignored, and
    // admin-only fields (deal value, assignments) are dropped for non-admins.
    const update: Record<string, unknown> = pickWritableLeadFields(body, admin.role);

    // Normalize phone if being updated
    if (update.phone !== undefined) {
      update.phone_normalized = null;
      const phone = typeof update.phone === 'string' ? update.phone.trim() : '';
      if (phone) {
        try {
          const parsed = parsePhoneNumber(phone, 'US');
          if (parsed?.isValid()) {
            update.phone_normalized = parsed.format('E.164');
          }
        } catch {
          // Keep raw phone
        }
      }
    }

    // Normalize email
    if (update.email !== undefined) {
      update.email = typeof update.email === 'string' ? update.email.trim().toLowerCase() || null : null;
    }

    // Recompute the estimated roof value when any input field changes.
    if (update.sqft !== undefined || update.stories !== undefined || update.roof_type !== undefined) {
      // Use the incoming value when the field is present (including an explicit
      // clear to null), otherwise fall back to the lead's current value.
      const estimate = estimateRoofValue(
        {
          sqft: update.sqft !== undefined ? (update.sqft as number | null) : currentLead.sqft,
          stories: update.stories !== undefined ? (update.stories as number | null) : currentLead.stories,
          roof_type: update.roof_type !== undefined ? (update.roof_type as string | null) : currentLead.roof_type,
        },
        { basePricePerSquare: await getRoofPricePerSquare() }
      );
      update.estimated_roof_value = estimate?.value ?? null;
    }

    // Server-controlled timestamp, never taken from the client payload
    if (demographicCapturedAt) update.demographic_captured_at = demographicCapturedAt;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ success: false, error: 'No editable fields provided' }, { status: 400 });
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .update(update)
      .eq('id', leadId)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Log status change if status was updated
    if (body.status && body.status !== currentLead.status) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'status_change',
        content: `Status changed from ${currentLead.status} to ${body.status}`,
        old_status: currentLead.status,
        new_status: body.status,
        created_by: admin.sub,
      });
    }

    // Create the inspection appointment captured with the status change
    if (appointmentScheduledAt) {
      const { data: appointment, error: apptError } = await supabase
        .from('lead_appointments')
        .insert({
          lead_id: leadId,
          appointment_type: 'inspection',
          scheduled_at: appointmentScheduledAt,
          notes: appointmentNotes,
          created_by: admin.sub,
        })
        .select('*')
        .single();
      if (apptError) {
        console.error('Failed to create appointment:', apptError.message);
      } else {
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'updated',
          content: 'Inspection appointment scheduled',
          created_by: admin.sub,
        });
        // Best-effort homeowner confirmation; never fails the status change
        await notifyAppointmentBooked(supabase, { leadId, appointment, actorId: admin.sub });
      }
    }

    return NextResponse.json({ success: true, lead });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { leadId } = await params;
    if (!isValidUUID(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
    }

    const supabase = db();

    /**
     * Record what is about to be destroyed, BEFORE destroying it.
     *
     * Every child table is ON DELETE CASCADE, so the lead and its whole history
     * vanish together and afterwards there is nothing left to join to or read.
     * The snapshot has to be taken while the rows still exist.
     *
     * The counts are the part worth having: deleting a duplicate nobody worked
     * is routine, deleting a lead with fourteen knocks against it destroyed real
     * fieldwork, and only the counts tell those apart after the fact.
     */
    const { data: doomed } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone, email, address_street, address_city, ' +
              'address_state, address_zip, status, deal_value, market_id, ' +
              'assigned_setter_id, assigned_closer_id, created_at, created_by')
      .eq('id', leadId)
      .single();

    if (!doomed) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    const countFor = async (table: string) => {
      const { count } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', leadId);
      return count ?? 0;
    };
    const [activities, knocks, calls, photos, appointments] = await Promise.all([
      countFor('lead_activities'),
      countFor('lead_knocks'),
      countFor('lead_calls'),
      countFor('lead_photos'),
      countFor('lead_appointments'),
    ]);

    // Written before the delete so a failure here aborts rather than losing the
    // lead silently. An untracked deletion is the thing this exists to prevent.
    const { error: auditError } = await supabase
      .from('lead_deletions')
      .insert(buildLeadDeletionRecord(
        doomed as unknown as DeletedLeadSnapshot,
        admin,
        { activities, knocks, calls, photos, appointments }
      ));

    if (auditError) {
      return NextResponse.json(
        { success: false, error: `Could not record the deletion, so the lead was kept: ${auditError.message}` },
        { status: 500 }
      );
    }

    const { error } = await supabase.from('leads').delete().eq('id', leadId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
