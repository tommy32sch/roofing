import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/integrations/email';
import { buildReminderEmail } from '@/lib/notifications/appointment-reminder-email';
import {
  planReminders,
  reminderWindow,
  DEFAULT_TIME_ZONE,
  type ReminderKind,
} from './reminders';

/**
 * The scheduled half of appointment reminders.
 *
 * Two phases on purpose, mirroring the storm-alert job: decide what is owed and
 * record it, then attempt delivery. A crash between them loses no reminder,
 * because the ledger row already exists and the next run picks it up — and a
 * duplicate run sends nothing twice, because the dedupe key is unique in the
 * database rather than merely checked in application code.
 */

export interface ReminderRunResult {
  scanned: number;
  planned: number;
  queued: number;
  skipped_duplicate: number;
}

export interface ReminderDeliveryResult {
  attempted: number;
  sent: number;
  failed: number;
  not_configured: number;
}

interface MarketSetting {
  market_id: number;
  enabled: boolean;
  notify_reps: boolean;
  notify_homeowners: boolean;
}

type AppointmentRow = {
  id: string;
  scheduled_at: string;
  outcome: string;
  appointment_type: string | null;
  notes: string | null;
  created_by: string | null;
  leads: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    market_id: number | null;
    assigned_to: string | null;
  } | null;
};

/** Queue the reminders owed at `nowIso`, without sending anything. */
export async function planAppointmentReminders(
  supabase: SupabaseClient,
  nowIso: string = new Date().toISOString()
): Promise<ReminderRunResult> {
  const empty: ReminderRunResult = { scanned: 0, planned: 0, queued: 0, skipped_duplicate: 0 };
  const window = reminderWindow(nowIso);
  if (!window) return empty;

  const [{ data: markets }, { data: settings }, { data: users }] = await Promise.all([
    supabase.from('markets').select('id, timezone'),
    supabase
      .from('appointment_reminder_settings')
      .select('market_id, enabled, notify_reps, notify_homeowners'),
    supabase.from('admin_users').select('id, email'),
  ]);

  const zoneFor = new Map<number, string>(
    (markets ?? []).map((m: { id: number; timezone: string | null }) => [
      m.id,
      m.timezone || DEFAULT_TIME_ZONE,
    ])
  );
  const settingFor = new Map<number, MarketSetting>(
    ((settings ?? []) as MarketSetting[]).map((s) => [s.market_id, s])
  );
  const emailFor = new Map<string, string>(
    ((users ?? []) as { id: string; email: string | null }[])
      .filter((u) => u.email)
      .map((u) => [u.id, u.email as string])
  );

  // Inner join: filtering the embedded lead without it would null the embed and
  // keep the parent row, so appointments with no lead would look reminder-worthy.
  const { data, error } = await supabase
    .from('lead_appointments')
    .select(
      'id, scheduled_at, outcome, appointment_type, notes, created_by, leads!lead_id!inner(id, first_name, last_name, email, address_street, address_city, address_state, market_id, assigned_to)'
    )
    .eq('outcome', 'scheduled')
    .gte('scheduled_at', window.start)
    .lte('scheduled_at', window.end);

  if (error || !data) return empty;
  const appointments = data as unknown as AppointmentRow[];
  empty.scanned = appointments.length;

  const rows: Record<string, unknown>[] = [];
  for (const appointment of appointments) {
    const lead = appointment.leads;
    if (!lead) continue;

    // A lead with no market falls back to the default zone rather than being
    // skipped — an unassigned booking still deserves its reminder.
    const marketId = lead.market_id;
    const setting = marketId != null ? settingFor.get(marketId) : undefined;
    if (setting && !setting.enabled) continue;
    const notifyReps = setting?.notify_reps ?? true;
    const notifyHomeowners = setting?.notify_homeowners ?? false;
    const timeZone = (marketId != null ? zoneFor.get(marketId) : null) || DEFAULT_TIME_ZONE;

    const recipients: { email: string; type: 'rep' | 'homeowner' }[] = [];
    if (notifyReps) {
      // Whoever owns the lead, else whoever booked it. Both, when they differ —
      // the setter who booked it still wants to know it held.
      for (const userId of [lead.assigned_to, appointment.created_by]) {
        const email = userId ? emailFor.get(userId) : null;
        if (email && !recipients.some((r) => r.email === email)) {
          recipients.push({ email, type: 'rep' });
        }
      }
    }
    if (notifyHomeowners && lead.email?.trim()) {
      recipients.push({ email: lead.email.trim(), type: 'homeowner' });
    }
    if (recipients.length === 0) continue;

    const planned = planReminders(
      [{ id: appointment.id, scheduled_at: appointment.scheduled_at, timeZone }],
      nowIso,
      () => recipients.map((r) => r.email)
    );

    for (const plan of planned) {
      const recipient = recipients.find(
        (r) => plan.dedupeKey.endsWith(r.email.toLowerCase())
      );
      if (!recipient) continue;
      rows.push({
        appointment_id: plan.appointmentId,
        recipient_type: recipient.type,
        recipient_email: recipient.email,
        kind: plan.kind satisfies ReminderKind,
        appointment_at: plan.scheduledAt,
        dedupe_key: plan.dedupeKey,
        status: 'pending',
      });
    }
  }

  empty.planned = rows.length;
  if (rows.length === 0) return empty;

  // ignoreDuplicates leans on the unique dedupe_key: already-queued reminders
  // are silently left alone, which is what makes re-running the job safe.
  const { data: inserted, error: insertError } = await supabase
    .from('appointment_reminder_deliveries')
    .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    .select('id');

  if (insertError) return empty;
  empty.queued = inserted?.length ?? 0;
  empty.skipped_duplicate = rows.length - empty.queued;
  return empty;
}

/** Attempt every pending reminder. */
export async function deliverAppointmentReminders(
  supabase: SupabaseClient,
  options: { limit?: number; companyName?: string } = {}
): Promise<ReminderDeliveryResult> {
  const result: ReminderDeliveryResult = {
    attempted: 0,
    sent: 0,
    failed: 0,
    not_configured: 0,
  };

  const { data: pending } = await supabase
    .from('appointment_reminder_deliveries')
    .select(
      'id, appointment_id, recipient_type, recipient_email, kind, appointment_at, attempt_count'
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(options.limit ?? 100);

  if (!pending?.length) return result;

  const { data: settings } = await supabase
    .from('app_settings')
    .select('company_name')
    .eq('id', 'default')
    .single();
  const companyName =
    options.companyName || (settings as { company_name?: string } | null)?.company_name || 'Roof Leads';

  const { data: markets } = await supabase.from('markets').select('id, timezone');
  const zoneFor = new Map<number, string>(
    (markets ?? []).map((m: { id: number; timezone: string | null }) => [
      m.id,
      m.timezone || DEFAULT_TIME_ZONE,
    ])
  );

  for (const row of pending as {
    id: string;
    appointment_id: string;
    recipient_type: 'rep' | 'homeowner';
    recipient_email: string;
    kind: ReminderKind;
    appointment_at: string;
    attempt_count: number;
  }[]) {
    result.attempted += 1;

    const { data: appointment } = await supabase
      .from('lead_appointments')
      .select(
        'id, scheduled_at, outcome, appointment_type, notes, leads!lead_id!inner(first_name, last_name, address_street, address_city, address_state, market_id)'
      )
      .eq('id', row.appointment_id)
      .single();

    const appt = appointment as unknown as AppointmentRow | null;

    // Rescheduled or cancelled since queueing: the reminder is now wrong, and a
    // wrong time is worse than no reminder. Retire it; the next planning pass
    // queues a fresh one under a new dedupe key.
    if (
      !appt ||
      !appt.leads ||
      appt.outcome !== 'scheduled' ||
      appt.scheduled_at !== row.appointment_at
    ) {
      await supabase
        .from('appointment_reminder_deliveries')
        .update({ status: 'skipped', last_error: 'appointment changed', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      continue;
    }

    const timeZone =
      (appt.leads.market_id != null ? zoneFor.get(appt.leads.market_id) : null) || DEFAULT_TIME_ZONE;

    const email = buildReminderEmail({
      recipientType: row.recipient_type,
      kind: row.kind,
      lead: appt.leads,
      appointment: {
        scheduled_at: appt.scheduled_at,
        appointment_type: appt.appointment_type,
        notes: appt.notes,
      },
      companyName,
      timeZone,
    });

    const sent = await sendEmail({
      to: row.recipient_email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    if (sent.sent) {
      result.sent += 1;
      await supabase
        .from('appointment_reminder_deliveries')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: sent.id,
          attempt_count: row.attempt_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      continue;
    }

    // Email being switched off is not a failure to retry — it is the configured
    // state. Leave the row pending so it goes out when production mode is on.
    if (sent.reason === 'not_configured') {
      result.not_configured += 1;
      continue;
    }

    result.failed += 1;
    await supabase
      .from('appointment_reminder_deliveries')
      .update({
        status: 'failed',
        last_error: sent.detail ?? sent.reason,
        attempt_count: row.attempt_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
  }

  return result;
}
