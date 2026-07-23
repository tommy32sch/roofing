import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

export async function GET() {
  try {
    // Settings include the Regrid API key — admin only, not just any session.
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

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
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      company_name, default_lead_status, default_lead_priority,
      regrid_api_key, auto_enrich_enabled, roof_price_per_square,
      default_geo_city, default_geo_state,
      email_import_enabled, allowed_sender_emails,
    } = body;

    const supabase = db();
    const updates: Record<string, unknown> = {};
    if (company_name !== undefined) updates.company_name = company_name;
    if (default_lead_status !== undefined) updates.default_lead_status = default_lead_status;
    if (default_lead_priority !== undefined) updates.default_lead_priority = default_lead_priority;
    if (regrid_api_key !== undefined) updates.regrid_api_key = regrid_api_key || null;
    if (auto_enrich_enabled !== undefined) updates.auto_enrich_enabled = auto_enrich_enabled;
    if (roof_price_per_square !== undefined) {
      updates.roof_price_per_square =
        roof_price_per_square === '' || roof_price_per_square === null ? null : Number(roof_price_per_square);
    }
    if (default_geo_city !== undefined) updates.default_geo_city = default_geo_city?.trim() || null;
    if (default_geo_state !== undefined) updates.default_geo_state = default_geo_state?.trim() || null;
    if (email_import_enabled !== undefined) updates.email_import_enabled = email_import_enabled;
    if (allowed_sender_emails !== undefined) updates.allowed_sender_emails = allowed_sender_emails || [];

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
