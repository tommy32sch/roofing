import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { checkConfiguredRateLimit, rateLimitBackendStatus } from '@/lib/utils/rate-limit';

/**
 * Is durable rate limiting actually working?
 *
 * Admin-only. Exists because the previous answer to that question was "the env
 * vars are set", which stayed true for weeks after the Upstash database had
 * been deleted — brute-force protection had silently become a per-instance
 * counter and nothing reported it.
 *
 * Performs a real limiter call rather than reading configuration, because a
 * live round trip is the only thing that distinguishes a working backend from a
 * plausible-looking one.
 */
export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (admin.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // A generous throwaway bucket: this probe must never consume budget that a
    // real endpoint depends on.
    await checkConfiguredRateLimit('health-probe', 'health', 1000, '1 m');
    const status = rateLimitBackendStatus();

    return NextResponse.json({
      success: true,
      rateLimit: {
        ...status,
        summary: !status.configured
          ? 'Not configured — rate limiting is per-instance and resets on cold start.'
          : status.healthy
            ? 'Durable rate limiting is working.'
            : 'Configured but UNREACHABLE — rate limiting has degraded to per-instance counters.',
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
