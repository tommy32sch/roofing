import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { publicSettingsFromRow, settingsPatchFromBody } from '@/lib/settings/public-settings';
import { db } from '@/lib/supabase/server';

export async function GET() {
  try {
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

    if (error || !settings) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Settings were not found' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      settings: publicSettingsFromRow(settings as Record<string, unknown>),
    });
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

    const body = await request.json().catch(() => null);
    const decision = settingsPatchFromBody(body);
    if (!decision.ok) {
      return NextResponse.json({ success: false, error: decision.error }, { status: decision.status });
    }

    const supabase = db();
    const { data: settings, error } = await supabase
      .from('app_settings')
      .update(decision.updates)
      .eq('id', 'default')
      .select('*')
      .single();

    if (error || !settings) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Settings were not updated' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      settings: publicSettingsFromRow(settings as Record<string, unknown>),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
