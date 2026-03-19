import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { testRegridConnection } from '@/lib/integrations/regrid';

export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { api_key } = await request.json();
    if (!api_key?.trim()) {
      return NextResponse.json({ success: false, error: 'API key is required' }, { status: 400 });
    }

    const result = await testRegridConnection(api_key.trim());
    return NextResponse.json({ success: result.success, message: result.message });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
