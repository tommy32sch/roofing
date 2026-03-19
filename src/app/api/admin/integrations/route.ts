import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { randomBytes } from 'crypto';

export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = db();

    const { data: keys, error } = await supabase
      .from('integration_api_keys')
      .select('*, lead_sources(id, name, display_name)')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Mask API keys — only show last 8 chars
    const maskedKeys = (keys || []).map(key => ({
      ...key,
      api_key: `${'•'.repeat(24)}${key.api_key.slice(-8)}`,
    }));

    return NextResponse.json({ success: true, keys: maskedKeys });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, source_id } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
    }

    if (name.trim().length > 100) {
      return NextResponse.json({ success: false, error: 'Name must be 100 characters or less' }, { status: 400 });
    }

    // Generate a secure API key
    const apiKey = `rl_${randomBytes(32).toString('hex')}`;

    const supabase = db();

    const { data: key, error } = await supabase
      .from('integration_api_keys')
      .insert({
        name: name.trim(),
        api_key: apiKey,
        source_id: source_id || null,
      })
      .select('*, lead_sources(id, name, display_name)')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Return the full API key only once — it won't be shown again
    return NextResponse.json({
      success: true,
      key,
      message: 'Save this API key — it will not be shown again.',
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
