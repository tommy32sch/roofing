import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, isEmailConfigured } from '@/lib/integrations/email';
import { buildAppointmentEmail } from './appointment-email';
import { buildCloserEmail } from './closer-email';

/**
 * Notifies both sides when an appointment is booked:
 *   - the homeowner gets a confirmation with a calendar invite
 *   - the assigned closer gets an operational heads-up with the same invite
 *
 * Best-effort by design: the appointment is already committed before this runs,
 * so every failure path resolves rather than throws. A rep must never lose a
 * booking because Resend was down or a key was missing. The two sends are
 * independent — one failing does not suppress the other.
 *
 * Nothing is needed for the team calendar; appointments appear on
 * /admin/calendar as soon as the row exists.
 */

/** Timezone used for the human-readable time in email bodies. */
const DEFAULT_TIME_ZONE = 'America/Phoenix';

export type ChannelResult =
  | { sent: true }
  | { sent: false; reason: 'not_configured' | 'no_email' | 'no_closer' | 'error'; detail?: string };

export interface NotifyResult {
  homeowner: ChannelResult;
  closer: ChannelResult;
}

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email2: string | null;
  phone: string | null;
  is_dnc: boolean | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  assigned_closer_id: string | null;
}

export async function notifyAppointmentBooked(
  supabase: SupabaseClient,
  args: {
    leadId: string;
    appointment: { id: string; scheduled_at: string; appointment_type: 'inspection' | 'adjuster'; notes?: string | null };
    actorId?: string | null;
  }
): Promise<NotifyResult> {
  const failed = (detail: string): NotifyResult => ({
    homeowner: { sent: false, reason: 'error', detail },
    closer: { sent: false, reason: 'error', detail },
  });

  try {
    const { data: lead } = await supabase
      .from('leads')
      .select(
        'id, first_name, last_name, email, email2, phone, is_dnc, address_street, address_city, address_state, address_zip, assigned_closer_id'
      )
      .eq('id', args.leadId)
      .single<LeadRow>();

    if (!lead) return failed('lead not found');

    if (!isEmailConfigured()) {
      // No activity row: this would repeat on every booking until a key is
      // added, burying the real timeline.
      console.info('[notify] appointment emails skipped — RESEND_API_KEY/RESEND_FROM_EMAIL not set');
      return {
        homeowner: { sent: false, reason: 'not_configured' },
        closer: { sent: false, reason: 'not_configured' },
      };
    }

    const [{ data: settings }, { data: closer }, { data: actor }] = await Promise.all([
      supabase.from('app_settings').select('company_name').limit(1).single(),
      lead.assigned_closer_id
        ? supabase.from('admin_users').select('email, name').eq('id', lead.assigned_closer_id).single()
        : Promise.resolve({ data: null }),
      args.actorId
        ? supabase.from('admin_users').select('name').eq('id', args.actorId).single()
        : Promise.resolve({ data: null }),
    ]);

    const companyName = settings?.company_name?.trim() || 'our team';
    const timeZone = process.env.APP_TIME_ZONE || DEFAULT_TIME_ZONE;
    const replyTo = process.env.RESEND_REPLY_TO || null;

    const [homeowner, closerResult] = await Promise.all([
      sendHomeowner(),
      sendCloser(),
    ]);
    return { homeowner, closer: closerResult };

    async function sendHomeowner(): Promise<ChannelResult> {
      const recipient = (lead!.email || lead!.email2 || '').trim();
      if (!recipient) {
        // Worth telling the rep — they may need to phone instead.
        await logActivity(supabase, args, 'Appointment set — homeowner not emailed (no email on file)');
        return { sent: false, reason: 'no_email' };
      }
      const built = buildAppointmentEmail({
        lead: lead!,
        appointment: args.appointment,
        companyName,
        timeZone,
        replyTo,
      });
      const res = await sendEmail({
        to: recipient,
        subject: built.subject,
        html: built.html,
        text: built.text,
        replyTo: replyTo || undefined,
        attachments: [{ filename: built.icsFilename, content: built.ics }],
      });
      if (res.sent) {
        await logActivity(supabase, args, `Appointment confirmation emailed to ${recipient}`);
        return { sent: true };
      }
      const detail = 'detail' in res ? res.detail ?? res.reason : res.reason;
      await logActivity(supabase, args, `Appointment confirmation to ${recipient} failed (${detail})`);
      return { sent: false, reason: 'error', detail };
    }

    async function sendCloser(): Promise<ChannelResult> {
      // Most leads are unassigned; staying silent keeps the timeline clean.
      if (!lead!.assigned_closer_id) return { sent: false, reason: 'no_closer' };
      const recipient = (closer as { email?: string | null } | null)?.email?.trim();
      if (!recipient) return { sent: false, reason: 'no_email' };

      const built = buildCloserEmail({
        lead: lead!,
        appointment: args.appointment,
        companyName,
        timeZone,
        bookedBy: (actor as { name?: string | null } | null)?.name ?? null,
        appUrl: process.env.NEXT_PUBLIC_APP_URL || null,
      });
      const res = await sendEmail({
        to: recipient,
        subject: built.subject,
        html: built.html,
        text: built.text,
        attachments: [{ filename: built.icsFilename, content: built.ics }],
      });
      if (res.sent) {
        await logActivity(supabase, args, `Appointment details emailed to closer ${recipient}`);
        return { sent: true };
      }
      const detail = 'detail' in res ? res.detail ?? res.reason : res.reason;
      await logActivity(supabase, args, `Appointment details to closer ${recipient} failed (${detail})`);
      return { sent: false, reason: 'error', detail };
    }
  } catch (err) {
    console.error('[notify] appointment notification threw:', err);
    return failed(err instanceof Error ? err.message : 'unknown');
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
