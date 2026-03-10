import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { db } from '@/lib/supabase/server';

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated' },
      { status: 401 }
    );
  }

  const supabase = db();
  const { data: settings } = await supabase
    .from('app_settings')
    .select('company_name')
    .eq('id', 'default')
    .single();

  return NextResponse.json({
    success: true,
    admin: {
      id: admin.sub,
      email: admin.email,
      name: admin.name,
    },
    companyName: settings?.company_name || 'Roof Leads',
  });
}
