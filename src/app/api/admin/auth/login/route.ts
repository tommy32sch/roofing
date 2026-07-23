import { NextRequest, NextResponse } from 'next/server';
import { compare } from 'bcryptjs';
import { db } from '@/lib/supabase/server';
import { createToken, setAuthCookie } from '@/lib/auth/jwt';
import { checkConfiguredRateLimit, getClientIP } from '@/lib/utils/rate-limit';

export async function POST(request: NextRequest) {
  const clientIP = getClientIP(request.headers);
  const rateLimit = await checkConfiguredRateLimit(clientIP, 'login', 5, '15 m');
  if (!rateLimit.success) {
    return NextResponse.json(
      { success: false, error: 'Too many login attempts. Try again later.' },
      { status: 429 }
    );
  }

  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const supabase = db();
    const { data: admin, error } = await supabase
      .from('admin_users')
      .select('id, email, name, password_hash, role, token_version')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !admin) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const passwordValid = await compare(password, admin.password_hash);
    if (!passwordValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const token = await createToken({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      tokenVersion: admin.token_version,
    });

    await setAuthCookie(token);

    return NextResponse.json({
      success: true,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
