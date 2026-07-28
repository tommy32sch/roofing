import { NextResponse } from 'next/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import {
  getEmailCapability,
  sendEmail,
  sendTestEmail,
} from '@/lib/integrations/email';
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

  const capability = getEmailCapability();
  if (capability.mode === 'disabled') {
    return NextResponse.json(
      { success: false, error: 'Email delivery is not configured' },
      { status: 503 }
    );
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

  const message = {
    subject: capability.mode === 'test'
      ? 'Roof Leads Resend connection test'
      : 'Roof Leads email delivery test',
    text: [
      'This is a test from Roof Leads.',
      '',
      capability.mode === 'test'
        ? 'This confirms only that Roof Leads can connect to Resend in test-only mode.'
        : 'This confirms that Roof Leads can connect to Resend using its production sender.',
      capability.mode === 'test'
        ? 'Storm and appointment emails to team members and homeowners remain disabled until an owned domain is verified.'
        : 'No storm event was created and no other team member was notified.',
    ].filter(Boolean).join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
        <h2 style="margin:0 0 12px">Roof Leads Resend connection test</h2>
        <p>This is a test from Roof Leads.</p>
        <p>
          ${capability.mode === 'test'
            ? 'This confirms only that Roof Leads can connect to Resend in test-only mode.'
            : 'This confirms that Roof Leads can connect to Resend using its production sender.'}
        </p>
        <p style="color:#6b7280;font-size:13px">
          ${capability.mode === 'test'
            ? 'Storm and appointment emails to team members and homeowners remain disabled until an owned domain is verified.'
            : 'No storm event was created and no other team member was notified.'}
        </p>
      </div>
    `,
  };
  const result = capability.mode === 'test'
    ? await sendTestEmail(message)
    : await sendEmail({
      ...message,
      to: admin.email,
    });
  const recipient = capability.mode === 'test'
    ? capability.testRecipient
    : admin.email;

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
    to: recipient,
  });
}
