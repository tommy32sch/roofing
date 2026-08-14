import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { saveSingletonConnection } from '@/lib/integrations/health.server';
import { allowedEmailSenders, integrationCadence } from '@/lib/integrations/health';

async function requireAdmin() {
  const admin = await getAuthenticatedAdmin();
  if (!admin) return { response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }) };
  if (admin.role !== 'admin') {
    return { response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { admin };
}

/** Check local receiver readiness without fabricating an inbound run. */
export async function POST() {
  try {
    const access = await requireAdmin();
    if ('response' in access) return access.response;

    const supabase = db();
    const result = await supabase
      .from('app_settings')
      .select('email_import_enabled, allowed_sender_emails')
      .eq('id', 'default')
      .single();
    if (result.error) {
      return NextResponse.json({ success: false, error: result.error.message }, { status: 500 });
    }
    if (!result.data?.email_import_enabled) {
      return NextResponse.json(
        { success: false, error: 'Email import is paused. Resume it before testing.' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.data.allowed_sender_emails?.length
        ? `Receiver is ready with ${result.data.allowed_sender_emails.length} sender rule${result.data.allowed_sender_emails.length === 1 ? '' : 's'}.`
        : 'Receiver is ready. Any authenticated sender is allowed.',
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = await requireAdmin();
    if ('response' in access) return access.response;

    const body = await request.json().catch(() => null);
    if (!body || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ success: false, error: 'enabled must be a boolean' }, { status: 400 });
    }
    const senderDecision = allowedEmailSenders(body.allowed_sender_emails ?? []);
    if (!senderDecision.ok) {
      return NextResponse.json({ success: false, error: senderDecision.error }, { status: 400 });
    }
    const cadenceDecision = integrationCadence(body.expected_cadence_minutes);
    if (!cadenceDecision.ok) {
      return NextResponse.json({ success: false, error: cadenceDecision.error }, { status: 400 });
    }

    const supabase = db();
    const settings = await supabase
      .from('app_settings')
      .update({
        email_import_enabled: body.enabled,
        allowed_sender_emails: senderDecision.value,
      })
      .eq('id', 'default')
      .select('email_import_enabled, allowed_sender_emails')
      .single();
    if (settings.error || !settings.data) {
      return NextResponse.json(
        { success: false, error: settings.error?.message || 'Email import was not updated' },
        { status: 500 }
      );
    }

    await saveSingletonConnection(supabase, {
      provider: 'email_import',
      name: 'Email import',
      paused: !body.enabled,
      expectedCadenceMinutes: cadenceDecision.value,
    });

    return NextResponse.json({
      success: true,
      configuration: {
        enabled: settings.data.email_import_enabled,
        allowedSenderEmails: settings.data.allowed_sender_emails ?? [],
        expectedCadenceMinutes: cadenceDecision.value,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
