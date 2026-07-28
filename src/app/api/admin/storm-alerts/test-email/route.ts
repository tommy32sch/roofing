import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { sendEmail } from '@/lib/integrations/email';
import { checkConfiguredRateLimit } from '@/lib/utils/rate-limit';

const TEST_EMAIL_LIMIT = {
  prefix: 'storm-test-email',
  maxRequests: 3,
  window: '1 h',
} as const;

export async function POST() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
  }
  if (admin.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const rateLimit = await checkConfiguredRateLimit(
    admin.sub,
    TEST_EMAIL_LIMIT.prefix,
    TEST_EMAIL_LIMIT.maxRequests,
    TEST_EMAIL_LIMIT.window
  );
  if (!rateLimit.success) {
    return NextResponse.json(
      { success: false, error: 'Test email limit reached. Try again later.' },
      { status: 429 }
    );
  }

  const result = await sendEmail({
    to: admin.email,
    subject: 'Roof Leads storm alerts are ready',
    text: [
      'This is a test from Roof Leads.',
      '',
      'Resend accepted this message, so production storm-alert email delivery is configured correctly.',
      'No storm event was created and no other team member was notified.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <h2 style="margin:0 0 12px">Roof Leads storm alerts are ready</h2>
        <p>This is a test from Roof Leads.</p>
        <p>Resend accepted this message, so production storm-alert email delivery is configured correctly.</p>
        <p style="color:#6b7280;font-size:13px">
          No storm event was created and no other team member was notified.
        </p>
      </div>
    `,
  });

  if (!result.sent) {
    const error = result.reason === 'not_configured'
      ? 'Email delivery is not configured'
      : result.detail || 'Resend rejected the test email';
    return NextResponse.json(
      { success: false, error },
      { status: result.reason === 'not_configured' ? 503 : 502 }
    );
  }

  return NextResponse.json({
    success: true,
    to: admin.email,
  });
}
