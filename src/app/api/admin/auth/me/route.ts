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
  const isImpersonating = !!admin.impersonatedBy;

  const [{ data: settings }, { data: user }] = await Promise.all([
    supabase.from('app_settings').select('company_name').eq('id', 'default').single(),
    supabase.from('admin_users').select('role, market_id').eq('id', admin.sub).single(),
  ]);

  return NextResponse.json({
    success: true,
    admin: {
      id: admin.sub,
      email: admin.email,
      name: admin.name,
      role: user?.role ?? admin.role,
      // Home office. Drives the default market filter across the app; null
      // until an admin assigns one (and before the markets migration runs),
      // which means "all markets".
      market_id: (user as { market_id?: number | null } | null)?.market_id ?? null,
    },
    companyName: settings?.company_name || 'Roof Leads',
    isImpersonating,
  });
}
