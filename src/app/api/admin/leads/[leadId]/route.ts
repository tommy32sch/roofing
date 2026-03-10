import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { parsePhoneNumber } from 'libphonenumber-js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const { leadId } = await params;
    if (!isValidUUID(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
    }

    const supabase = db();

    const { data: lead, error } = await supabase
      .from('leads')
      .select('*, lead_sources(id, name, display_name)')
      .eq('id', leadId)
      .single();

    if (error || !lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
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

    // Get current lead for status change tracking
    const { data: currentLead } = await supabase
      .from('leads')
      .select('status')
      .eq('id', leadId)
      .single();

    if (!currentLead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
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
