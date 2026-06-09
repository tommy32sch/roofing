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

    // Get activities
    const { data: activities } = await supabase
      .from('lead_activities')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      success: true,
      lead: { ...lead, lead_activities: activities || [] },
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
      body.demographic_captured_at = new Date().toISOString();
    }

    // Normalize phone if being updated
    if (body.phone !== undefined) {
      body.phone_normalized = null;
      if (body.phone?.trim()) {
        try {
          const parsed = parsePhoneNumber(body.phone.trim(), 'US');
          if (parsed?.isValid()) {
            body.phone_normalized = parsed.format('E.164');
          }
        } catch {
          // Keep raw phone
        }
      }
    }

    // Normalize email
    if (body.email !== undefined) {
      body.email = body.email?.trim()?.toLowerCase() || null;
    }

    // Recompute the estimated roof value when any input field changes.
    if (body.sqft !== undefined || body.stories !== undefined || body.roof_type !== undefined) {
      // Use the incoming value when the field is present (including an explicit
      // clear to null), otherwise fall back to the lead's current value.
      const estimate = estimateRoofValue(
        {
          sqft: body.sqft !== undefined ? body.sqft : currentLead.sqft,
          stories: body.stories !== undefined ? body.stories : currentLead.stories,
          roof_type: body.roof_type !== undefined ? body.roof_type : currentLead.roof_type,
        },
        { basePricePerSquare: await getRoofPricePerSquare() }
      );
      body.estimated_roof_value = estimate?.value ?? null;
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .update(body)
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
