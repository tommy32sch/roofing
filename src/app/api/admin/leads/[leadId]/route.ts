import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { parsePhoneNumber } from 'libphonenumber-js';
import { estimateRoofValue } from '@/lib/leads/roof-value';
import { getRoofPricePerSquare } from '@/lib/leads/roof-value.server';

const STATUS_ORDER: string[] = ['new', 'contacted', 'appointment_set', 'inspected', 'proposal_sent', 'sold', 'lost'];
const SETTER_ALLOWED_STATUSES = new Set(['new', 'contacted', 'appointment_set', 'lost']);
const DEMOGRAPHIC_REQUIRED_FIELDS = [
  'career', 'family_size', 'marital_status', 'age_range', 'household_income_range',
  'education_level', 'years_in_home', 'insurance_carrier', 'decision_maker', 'referral_source',
] as const;

// Fields only an admin may set. Everything financial/assignment-related lives here
// so a setter/closer can't award themselves leads or edit deal value via the API.
const LEAD_ADMIN_ONLY_FIELDS = new Set(['deal_value', 'assigned_setter_id', 'assigned_closer_id']);

// The complete set of lead columns a client may write. Anything not listed
// (id, coordinates, enrichment/estimate/normalized fields, timestamps, duplicate
// flags) is server-controlled and silently ignored on update — this is the guard
// against mass assignment, since the route uses the service-role key (no RLS).
const LEAD_EDITABLE_FIELDS = new Set<string>([
  'first_name', 'last_name', 'phone', 'phone2', 'phone3', 'email', 'email2',
  'address_street', 'address_city', 'address_state', 'address_zip',
  'mailing_street', 'mailing_city', 'mailing_state', 'mailing_zip',
  'home_value', 'year_built', 'sqft', 'lot_size', 'bedrooms', 'bathrooms', 'stories',
  'assessed_value', 'last_sale_date', 'last_sale_price', 'owner_type', 'apn',
  'roof_age', 'roof_type', 'roof_score', 'roof_material_notes',
  'hail_date', 'hail_size_inches', 'storm_id',
  'status', 'priority', 'source_id', 'source_notes', 'follow_up_date',
  'career', 'family_size', 'marital_status', 'age_range', 'household_income_range',
  'education_level', 'years_in_home', 'insurance_carrier', 'decision_maker', 'referral_source',
  ...LEAD_ADMIN_ONLY_FIELDS,
]);

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
      .select('*, lead_sources!source_id(id, name, display_name)')
      .eq('id', leadId)
      .single();

    if (error || !lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    // Closers can only view sold leads
    if (admin.role === 'closer' && lead.status !== 'sold') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Get activities and appointments
    const [{ data: activities }, { data: appointments }] = await Promise.all([
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
    ]);

    return NextResponse.json({
      success: true,
      lead: { ...lead, lead_activities: activities || [], lead_appointments: appointments || [] },
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
      if (admin.role === 'setter' && !SETTER_ALLOWED_STATUSES.has(body.status)) {
        return NextResponse.json(
          { success: false, error: 'Setters cannot set this status' },
          { status: 403 }
        );
      }
      if (admin.role === 'setter' && body.status === 'sold') {
        return NextResponse.json(
          { success: false, error: 'Setters cannot mark a lead as sold' },
          { status: 403 }
        );
      }
    }

    // Transitioning to appointment_set requires a scheduled time — the
    // appointment row is created after the lead update succeeds.
    let appointmentScheduledAt: string | null = null;
    let appointmentNotes: string | null = null;
    let demographicCapturedAt: string | null = null;
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
      appointmentScheduledAt = body.appointment_scheduled_at;
      appointmentNotes =
        typeof body.appointment_notes === 'string' && body.appointment_notes.trim()
          ? body.appointment_notes.trim()
          : null;
    }
    // Not lead columns — strip before the update
    delete body.appointment_scheduled_at;
    delete body.appointment_notes;

    // When marking as sold, demographic form must be complete
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
    const update: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (!LEAD_EDITABLE_FIELDS.has(key)) continue;
      if (LEAD_ADMIN_ONLY_FIELDS.has(key) && admin.role !== 'admin') continue;
      update[key] = body[key];
    }

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
      const { error: apptError } = await supabase.from('lead_appointments').insert({
        lead_id: leadId,
        appointment_type: 'inspection',
        scheduled_at: appointmentScheduledAt,
        notes: appointmentNotes,
        created_by: admin.sub,
      });
      if (apptError) {
        console.error('Failed to create appointment:', apptError.message);
      } else {
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'updated',
          content: 'Inspection appointment scheduled',
          created_by: admin.sub,
        });
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
    const { error } = await supabase.from('leads').delete().eq('id', leadId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
