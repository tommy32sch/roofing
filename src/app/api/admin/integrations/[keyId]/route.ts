import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { keyId } = await params;
    const supabase = db();

    const { error } = await supabase
      .from('integration_api_keys')
      .update({ is_active: false })
      .eq('id', keyId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ keyId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { keyId } = await params;
    const body = await request.json();
    const { is_active } = body;

    if (typeof is_active !== 'boolean') {
      return NextResponse.json({ success: false, error: 'is_active must be a boolean' }, { status: 400 });
    }

    const supabase = db();

    const { data: key, error } = await supabase
      .from('integration_api_keys')
      .update({ is_active })
      .eq('id', keyId)
      .select('*, lead_sources(id, name, display_name)')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, key });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
