import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { db } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export async function GET() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated' },
      { status: 401 }
    );
  }

  const supabase = db();
  const cookieStore = await cookies();
  const isImpersonating = !!cookieStore.get('admin_original_token')?.value;

  const [{ data: settings }, { data: user }] = await Promise.all([
    supabase.from('app_settings').select('company_name').eq('id', 'default').single(),
    supabase.from('admin_users').select('role').eq('id', admin.sub).single(),
  ]);

  return NextResponse.json({
    success: true,
    admin: {
      id: admin.sub,
      email: admin.email,
      name: admin.name,
      role: user?.role ?? admin.role,
    },
    companyName: settings?.company_name || 'Roof Leads',
    isImpersonating,
  });
}
