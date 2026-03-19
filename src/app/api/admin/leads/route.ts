import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { parsePhoneNumber } from 'libphonenumber-js';
import { enrichLead } from '@/lib/integrations/regrid';

export async function GET(request: NextRequest) {
  try {
    const supabase = db();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const sourceId = searchParams.get('source_id');
    const search = searchParams.get('search');
    const sort = searchParams.get('sort') || 'created_at';
    const order = searchParams.get('order') || 'desc';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10), 100);
    const offset = (page - 1) * limit;

    let query = supabase
      .from('leads')
      .select('*, lead_sources(id, display_name)', { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (sourceId) query = query.eq('source_id', parseInt(sourceId, 10));

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,address_street.ilike.%${search}%,address_city.ilike.%${search}%`
      );
    }

    const ascending = order === 'asc';
    query = query.order(sort, { ascending }).range(offset, offset + limit - 1);

    const { data: leads, error, count } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      leads: leads || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = db();
    const body = await request.json();

    const { first_name, last_name, phone, email, ...rest } = body;

    if (!first_name?.trim() || !last_name?.trim()) {
      return NextResponse.json(
        { success: false, error: 'First name and last name are required' },
        { status: 400 }
      );
    }

    // Normalize phone
    let phone_normalized: string | null = null;
    if (phone?.trim()) {
      try {
        const parsed = parsePhoneNumber(phone.trim(), 'US');
        if (parsed?.isValid()) {
          phone_normalized = parsed.format('E.164');
        }
      } catch {
        // Keep raw phone, no normalized version
      }
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        phone: phone?.trim() || null,
        phone_normalized,
        email: email?.trim()?.toLowerCase() || null,
        ...rest,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Create "created" activity
    await supabase.from('lead_activities').insert({
      lead_id: lead.id,
      activity_type: 'created',
      content: 'Lead created',
      created_by: admin.sub,
    });

    // Auto-enrich with Regrid in the background (non-blocking)
    enrichLead(lead.id, {
      address_street: lead.address_street,
      address_city: lead.address_city,
      address_state: lead.address_state,
      address_zip: lead.address_zip,
    }).catch(() => {});

    return NextResponse.json({ success: true, lead }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
