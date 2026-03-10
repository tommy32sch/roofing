import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = db();
    const { data: settings, error } = await supabase
      .from('app_settings')
      .select('*')
      .eq('id', 'default')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, settings });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { company_name, default_lead_status, default_lead_priority } = body;

    const supabase = db();
    const updates: Record<string, string> = {};
    if (company_name !== undefined) updates.company_name = company_name;
    if (default_lead_status !== undefined) updates.default_lead_status = default_lead_status;
    if (default_lead_priority !== undefined) updates.default_lead_priority = default_lead_priority;

    const { data: settings, error } = await supabase
      .from('app_settings')
      .update(updates)
      .eq('id', 'default')
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, settings });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
