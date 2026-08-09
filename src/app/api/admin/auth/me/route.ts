import { NextResponse } from 'next/server';
import { loadAppShell } from '@/lib/app-shell/server';

export async function GET() {
  const result = await loadAppShell();
  if (result.status === 'unauthenticated') {
    return NextResponse.json(
      { success: false, error: 'Not authenticated' },
      { status: 401 }
    );
  }
  if (result.status === 'unavailable') {
    return NextResponse.json(
      { success: false, error: 'Workspace is temporarily unavailable' },
      { status: 503 }
    );
  }

  const shell = result.data;

  return NextResponse.json({
    success: true,
    admin: {
      id: shell.user.id,
      email: shell.user.email,
      name: shell.user.name,
      role: shell.user.role,
      market_id: shell.user.homeMarketId,
    },
    companyName: shell.company.name,
    markets: shell.markets,
    permissions: shell.permissions,
    isImpersonating: shell.session.isImpersonating,
    issues: shell.issues,
  });
}
