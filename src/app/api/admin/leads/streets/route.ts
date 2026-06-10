import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

interface StreetGroup {
  street: string;
  city: string | null;
  count: number;
  total_value: number;
  leads: { id: string; value: number | null }[];
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const sourceId = searchParams.get('source_id');
    const search = searchParams.get('search');

    const supabase = db();

    // Unpaginated fetch matching the export route's proven pattern
    let query = supabase
      .from('leads')
      .select('id, address_street, address_city, estimated_roof_value')
      .eq('is_flagged_duplicate', false)
      .limit(10000);

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (sourceId) query = query.eq('source_id', parseInt(sourceId, 10));
    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%,address_street.ilike.%${search}%,address_city.ilike.%${search}%`
      );
    }

    const { data: leads, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const groups = new Map<string, StreetGroup>();
    let noStreetCount = 0;

    for (const lead of leads || []) {
      const street = lead.address_street?.trim();
      if (!street) {
        noStreetCount++;
        continue;
      }
      const city = lead.address_city?.trim() || null;
      const key = `${street.toLowerCase()}|${city?.toLowerCase() ?? ''}`;
      let group = groups.get(key);
      if (!group) {
        group = { street, city, count: 0, total_value: 0, leads: [] };
        groups.set(key, group);
      }
      group.count++;
      group.total_value += Number(lead.estimated_roof_value) || 0;
      group.leads.push({ id: lead.id, value: lead.estimated_roof_value });
    }

    const streets = [...groups.values()].sort(
      (a, b) => a.street.localeCompare(b.street) || (a.city ?? '').localeCompare(b.city ?? '')
    );

    return NextResponse.json({ success: true, streets, no_street_count: noStreetCount });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
