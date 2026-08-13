import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyMarketFilter } from '@/lib/leads/markets';
import { isValidDayWindow, isValidDateString } from '@/lib/leads/today';
import { canRecordAppointmentOutcome } from '@/lib/leads/appointment-outcomes';
import type { TodayAppointment, TodayLead } from '@/lib/leads/today';

/**
 * Everything a rep needs for the current day, in one request.
 *
 * A single route rather than three client fetches so the day boundary, the role
 * restrictions and the market scoping are implemented once. Split across
 * endpoints, the three lists could each disagree about what "today" means.
 *
 * The CLIENT supplies the day window, because "today" genuinely differs between
 * the Arizona office (MST, no DST) and the Minnesota one (CST/CDT) — see
 * localDayBounds. The values are validated here rather than trusted.
 */

// Closers work from the appointment onward; the earlier pipeline is a setter's.
// Mirrors the same list in /api/admin/leads and /api/admin/leads/geo — a closer
// must never be shown a 'new' lead by any route.
const CLOSER_STATUSES = ['appointment_set', 'inspected', 'proposal_sent', 'sold', 'lost'];

/** Finished leads are nobody's follow-up. */
const CLOSED_STATUSES = '("sold","lost")';

/** Per-section cap. A day's work is not 500 rows; the count tells the true total. */
const LIMIT = 50;
const APPOINTMENT_PAGE_SIZE = 500;

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const date = searchParams.get('date');

    if (!isValidDayWindow(start, end) || !isValidDateString(date)) {
      return NextResponse.json(
        { success: false, error: 'Valid start, end and date params are required' },
        { status: 400 }
      );
    }

    const mine = searchParams.get('scope') !== 'all';
    const supabase = db();
    const marketId = await marketFilterFor(admin.marketId, searchParams.get('market_id'));
    const isCloser = admin.role === 'closer';
    const actor = { id: admin.sub, role: admin.role };
    // One clock for querying and classifying this response. A visit must not be
    // upcoming in one section and awaiting a result in another.
    const generatedAt = new Date().toISOString();

    // Assignment scoping. Both columns matter: a lead can be worked by a setter
    // and a closer at different stages, and either makes it "mine".
    const assignedToMe = `assigned_setter_id.eq.${admin.sub},assigned_closer_id.eq.${admin.sub}`;

    const LEAD_FIELDS =
      'id, first_name, last_name, phone, phone2, phone3, email, status, priority, ' +
      'address_street, address_city, address_state, address_zip, latitude, longitude, ' +
      'follow_up_date, last_knock_at, last_disposition, knock_count, is_dnc, do_not_knock, ' +
      'estimated_roof_value, market_id, assigned_setter_id, assigned_closer_id, ' +
      'is_flagged_duplicate';

    const APPOINTMENT_FIELDS =
      'id, appointment_type, scheduled_at, notes, outcome, outcome_at, outcome_by, created_by, ' +
      `leads!lead_id!inner(${LEAD_FIELDS})`;

    /** Apply the same visibility boundary to today's list and the old backlog. */
    function appointmentQuery(kind: 'today' | 'prior', offset = 0) {
      let query = supabase
        .from('lead_appointments')
        .select(APPOINTMENT_FIELDS, { count: 'exact' })
        .order('scheduled_at', { ascending: true });

      query = kind === 'today'
        ? query.gte('scheduled_at', start!).lt('scheduled_at', end!)
        : query.lt('scheduled_at', start!).eq('outcome', 'scheduled');

      if (marketId != null) query = query.eq('leads.market_id', marketId);
      if (isCloser) query = query.in('leads.status', CLOSER_STATUSES);
      if (mine) query = query.or(assignedToMe, { foreignTable: 'leads' });
      query = query.eq('leads.is_flagged_duplicate', false);

      const size = kind === 'today' ? APPOINTMENT_PAGE_SIZE : LIMIT;
      return query.range(offset, offset + size - 1);
    }

    // Today drives progress, not only a preview, so silently cutting it at the
    // visible-section limit would make the numerator wrong for a large team.
    // Page until the exact day is loaded; the prior backlog stays capped and
    // carries its exact count so the UI can say how much remains.
    async function loadTodayAppointments() {
      const rows: unknown[] = [];
      let exactCount = 0;
      let offset = 0;

      while (true) {
        const page = await appointmentQuery('today', offset);
        if (page.error) return { data: rows, count: exactCount, error: page.error };
        const pageRows = page.data ?? [];
        rows.push(...pageRows);
        exactCount = page.count ?? rows.length;
        if (rows.length >= exactCount || pageRows.length < APPOINTMENT_PAGE_SIZE) {
          return { data: rows, count: exactCount, error: null };
        }
        offset += APPOINTMENT_PAGE_SIZE;
      }
    }

    function withOutcomePermission(row: unknown): TodayAppointment {
      const appointment = row as Omit<TodayAppointment, 'can_record_outcome'>;
      const lead = appointment.leads as TodayLead | null;
      return {
        ...appointment,
        outcome: appointment.outcome ?? 'scheduled',
        outcome_at: appointment.outcome_at ?? null,
        outcome_by: appointment.outcome_by ?? null,
        created_by: appointment.created_by ?? null,
        can_record_outcome: !!lead && canRecordAppointmentOutcome({
          role: actor.role,
          userId: actor.id,
          appointmentCreatedBy: appointment.created_by ?? null,
          leadAssignedSetterId: lead.assigned_setter_id ?? null,
          leadAssignedCloserId: lead.assigned_closer_id ?? null,
          existingOutcomeBy: appointment.outcome_by ?? null,
        }),
      };
    }

    // Appointments today plus unresolved visits left behind on an earlier day.
    //
    // The embed is ALWAYS inner. Filtering an embedded resource without !inner
    // nulls the embed but keeps the parent row, so a scope/role/market filter
    // would return phantom appointments with `leads: null` — measured: scope=mine
    // returned an appointment for a lead assigned to nobody. Inner is also safe
    // here because lead_appointments.lead_id is NOT NULL with an ON DELETE
    // CASCADE foreign key, so an appointment without a lead cannot exist.
    const apptQuery = loadTodayAppointments();
    const priorUnresolvedQuery = appointmentQuery('prior');

    // Follow-ups promised on or before today, still open.
    let followUpQuery = applyMarketFilter(
      supabase
        .from('leads')
        .select(LEAD_FIELDS, { count: 'exact' })
        .lte('follow_up_date', date)
        .not('follow_up_date', 'is', null)
        .not('status', 'in', CLOSED_STATUSES)
        .eq('is_flagged_duplicate', false)
        .order('follow_up_date', { ascending: true })
        .limit(LIMIT),
      marketId
    );
    if (isCloser) followUpQuery = followUpQuery.in('status', CLOSER_STATUSES);
    if (mine) followUpQuery = followUpQuery.or(assignedToMe);

    // Doors that asked us to come back. Without this screen a callback logged at
    // the door goes nowhere — nothing else in the app surfaces last_disposition.
    // Leads that already booked are excluded: they've moved on.
    let callbackQuery = applyMarketFilter(
      supabase
        .from('leads')
        .select(LEAD_FIELDS, { count: 'exact' })
        .eq('last_disposition', 'callback')
        .not('status', 'in', '("sold","lost","appointment_set")')
        .eq('is_flagged_duplicate', false)
        .order('last_knock_at', { ascending: true })
        .limit(LIMIT),
      marketId
    );
    if (isCloser) callbackQuery = callbackQuery.in('status', CLOSER_STATUSES);
    if (mine) callbackQuery = callbackQuery.or(assignedToMe);

    // Is anything assigned to this user at all? Drives an honest empty state:
    // "nothing assigned to you" is a different message from "nothing due today",
    // and right now no lead in this database has an owner.
    const assignedQuery = supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .or(assignedToMe)
      .eq('is_flagged_duplicate', false);

    const [appts, priorUnresolved, followUps, callbacks, assigned] = await Promise.all([
      apptQuery,
      priorUnresolvedQuery,
      followUpQuery,
      callbackQuery,
      assignedQuery,
    ]);

    const firstError =
      appts.error || priorUnresolved.error || followUps.error || callbacks.error || assigned.error;
    if (firstError) {
      return NextResponse.json({ success: false, error: firstError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      generatedAt,
      appointments: (appts.data ?? []).map(withOutcomePermission),
      priorUnresolvedAppointments: (priorUnresolved.data ?? []).map(withOutcomePermission),
      followUps: followUps.data ?? [],
      callbacks: callbacks.data ?? [],
      counts: {
        appointments: appts.count ?? 0,
        priorUnresolved: priorUnresolved.count ?? 0,
        followUps: followUps.count ?? 0,
        callbacks: callbacks.count ?? 0,
        assignedToMe: assigned.count ?? 0,
      },
      limit: LIMIT,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
