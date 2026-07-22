import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, isEmailConfigured } from '@/lib/integrations/email';
import { buildAppointmentEmail } from './appointment-email';

/**
 * Emails the homeowner their appointment confirmation with a calendar invite,
 * and records the outcome on the lead's timeline.
 *
 * Best-effort by design: the appointment is already committed before this runs,
 * so every failure path resolves rather than throws. A rep must never lose a
 * booking because Resend was down or a key was missing.
 *
 * The team side needs nothing here — appointments already appear on
 * /admin/calendar the moment the row exists.
 */

/** Timezone used for the human-readable time in the email body. */
const DEFAULT_TIME_ZONE = 'America/Phoenix';

export interface NotifyResult {
  sent: boolean;
  reason?: 'not_configured' | 'no_email' | 'error';
  detail?: string;
}

export async function notifyAppointmentBooked(
  supabase: SupabaseClient,
  args: {
    leadId: string;
    appointment: { id: string; scheduled_at: string; appointment_type: 'inspection' | 'adjuster'; notes?: string | null };
    actorId?: string | null;
  }
): Promise<NotifyResult> {
  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('first_name, last_name, email, email2, address_street, address_city, address_state, address_zip')
      .eq('id', args.leadId)
      .single();

    if (!lead) return { sent: false, reason: 'error', detail: 'lead not found' };

    const recipient = (lead.email || lead.email2 || '').trim();

    // Tell the rep the homeowner wasn't reached — they may need to call instead.
    if (!recipient) {
      await logActivity(supabase, args, 'Appointment set — homeowner not emailed (no email on file)');
      return { sent: false, reason: 'no_email' };
    }

    if (!isEmailConfigured()) {
      // Don't write an activity for this: it would repeat on every booking until
      // the key is added, burying the real timeline.
      console.info('[notify] appointment email skipped — RESEND_API_KEY/RESEND_FROM_EMAIL not set');
      return { sent: false, reason: 'not_configured' };
    }

    const { data: settings } = await supabase
      .from('app_settings')
      .select('company_name')
      .limit(1)
      .single();

    const built = buildAppointmentEmail({
      lead,
      appointment: args.appointment,
      companyName: settings?.company_name?.trim() || 'our team',
      timeZone: process.env.APP_TIME_ZONE || DEFAULT_TIME_ZONE,
      replyTo: process.env.RESEND_REPLY_TO || null,
    });

    const result = await sendEmail({
      to: recipient,
      subject: built.subject,
      html: built.html,
      text: built.text,
      replyTo: process.env.RESEND_REPLY_TO || undefined,
      attachments: [{ filename: built.icsFilename, content: built.ics }],
    });

    if (result.sent) {
      await logActivity(supabase, args, `Appointment confirmation emailed to ${recipient}`);
      return { sent: true };
    }

    await logActivity(
      supabase,
      args,
      `Appointment confirmation to ${recipient} failed (${'detail' in result ? result.detail ?? result.reason : result.reason})`
    );
    return { sent: false, reason: 'error', detail: 'detail' in result ? result.detail : undefined };
  } catch (err) {
    console.error('[notify] appointment email threw:', err);
    return { sent: false, reason: 'error', detail: err instanceof Error ? err.message : 'unknown' };
  }
}

async function logActivity(
  supabase: SupabaseClient,
  args: { leadId: string; actorId?: string | null },
  content: string
) {
  await supabase
    .from('lead_activities')
    .insert({
      lead_id: args.leadId,
      activity_type: 'email',
      content,
      created_by: args.actorId ?? null,
    })
    .then(undefined, () => {}); // logging must not break the caller either
}
