import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { canViewLead } from '@/lib/leads/lead-visibility';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    /**
     * This GET previously ran with no authentication of its own, relying on the
     * edge middleware. That was not enough: middleware verifies the JWT
     * signature and expiry but NOT token_version, and token_version is what
     * revokes a session. So a rep who had been removed, demoted, or logged out
     * everywhere kept reading lead history here until their token expired on its
     * own. getAuthenticatedAdmin is what performs that check.
     */
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { leadId } = await params;
    if (!isValidUUID(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
    }

    const supabase = db();

    // A lead's activity is as sensitive as the lead, so it takes the same
    // visibility rule the detail route applies rather than inventing its own.
    const { data: lead } = await supabase
      .from('leads')
      .select('status')
      .eq('id', leadId)
      .single();

    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }
    if (!canViewLead(admin.role, lead.status)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { data: activities, error } = await supabase
      .from('lead_activities')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, activities: activities || [] });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

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
    const { activity_type, content } = body;

    if (!activity_type || !content?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Activity type and content are required' },
        { status: 400 }
      );
    }

    const supabase = db();

    // Verify the lead exists and that this role may touch it. Writing a note
    // onto a lead you are not allowed to read is the same breach as reading it:
    // the note lands in a history the author cannot see, and the act of writing
    // confirms the lead exists.
    const { data: lead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('id', leadId)
      .single();

    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }
    if (!canViewLead(admin.role, lead.status)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { data: activity, error } = await supabase
      .from('lead_activities')
      .insert({
        lead_id: leadId,
        activity_type,
        content: content.trim(),
        created_by: admin.sub,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, activity }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
