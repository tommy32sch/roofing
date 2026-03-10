import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = db();
    const { data: sources, error } = await supabase
      .from('lead_sources')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, sources: sources || [] });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
