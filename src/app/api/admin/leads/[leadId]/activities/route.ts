import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';

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

    // Verify lead exists
    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('id', leadId)
      .single();

    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
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
