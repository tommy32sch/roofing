import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyLeadAccessFilter } from '@/lib/leads/lead-visibility';
import { canRecordAppointmentOutcome } from '@/lib/leads/appointment-outcomes';
import { APPOINTMENT_SLOT_MINUTES } from '@/lib/leads/appointment-conflicts';
import {
  calendarScopeAssignment,
  resolveCalendarScope,
  scheduleExceptions,
  type ScheduleAppointmentFacts,
} from '@/lib/leads/calendar';
import type { AppointmentOutcome, AppointmentType, LeadStatus } from '@/types';

const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

interface EmbeddedAccount {
  id: string;
  name: string;
}

interface AppointmentLeadRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  phone2: string | null;
  phone3: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  latitude: number | null;
  longitude: number | null;
  status: LeadStatus;
  is_dnc: boolean;
  market_id: number | null;
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
  assigned_setter: EmbeddedAccount | EmbeddedAccount[] | null;
  assigned_closer: EmbeddedAccount | EmbeddedAccount[] | null;
}

interface AppointmentRow {
  id: string;
  lead_id: string;
  appointment_type: AppointmentType;
  scheduled_at: string;
  notes: string | null;
  outcome: AppointmentOutcome | null;
  outcome_at: string | null;
  outcome_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  leads: AppointmentLeadRow | AppointmentLeadRow[] | null;
}

function relationToOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      return NextResponse.json(
        { success: false, error: 'Valid start and end params are required' },
        { status: 400 }
      );
    }
    const windowMs = Date.parse(end) - Date.parse(start);
    if (windowMs <= 0) {
      return NextResponse.json({ success: false, error: 'End must be after start' }, { status: 400 });
    }
    if (windowMs > MAX_WINDOW_MS) {
      return NextResponse.json({ success: false, error: 'Window too large (max 90 days)' }, { status: 400 });
    }
    const conflictMarginMs = APPOINTMENT_SLOT_MINUTES * 60_000;
    const queryStart = new Date(Date.parse(start) - conflictMarginMs).toISOString();
    const queryEnd = new Date(Date.parse(end) + conflictMarginMs).toISOString();

    const supabase = db();
    const actor = { id: admin.sub, role: admin.role };
    const scopeDecision = resolveCalendarScope(admin.role, searchParams.get('scope'));
    if (!scopeDecision.ok) {
      return NextResponse.json(
        { success: false, error: scopeDecision.error },
        { status: scopeDecision.status }
      );
    }
    const scope = scopeDecision.scope;
    const assignment = calendarScopeAssignment(scope);

    // Office and account scoping run through the appointment's lead. The lead
    // foreign key is required with ON DELETE CASCADE, so an inner join cannot
    // remove a valid appointment.
    const marketId = await marketFilterFor(admin.marketId, searchParams.get('market_id'));
    const leadEmbed = 'leads!lead_id!inner';

    let apptQuery = supabase
      .from('lead_appointments')
      .select(
        'id, lead_id, appointment_type, scheduled_at, notes, outcome, outcome_at, outcome_by, ' +
        `created_by, created_at, updated_at, ${leadEmbed}(` +
        'id, first_name, last_name, phone, phone2, phone3, address_street, address_city, ' +
        'address_state, address_zip, latitude, longitude, status, is_dnc, market_id, ' +
        'is_flagged_duplicate, assigned_setter_id, assigned_closer_id, ' +
        'assigned_setter:admin_users!assigned_setter_id(id, name), ' +
        'assigned_closer:admin_users!assigned_closer_id(id, name))'
      )
      // Include one slot outside the visible range so an appointment on the
      // boundary still sees a conflict that starts just before or after it.
      .gte('scheduled_at', queryStart)
      .lt('scheduled_at', queryEnd)
      .order('scheduled_at', { ascending: true })
      .eq('leads.is_flagged_duplicate', false);

    if (marketId != null) apptQuery = apptQuery.eq('leads.market_id', marketId);
    if (assignment) {
      apptQuery = apptQuery.eq(`leads.${assignment.column}`, assignment.accountId);
    } else {
      const leadScope = scope === 'all' ? 'all' : 'mine';
      apptQuery = applyLeadAccessFilter(apptQuery, actor, {
        scope: leadScope,
        foreignTable: 'leads',
      });
    }

    const { data, error } = await apptQuery;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const generatedAt = new Date().toISOString();
    const appointments = ((data ?? []) as unknown as AppointmentRow[]).flatMap((row) => {
      const lead = relationToOne(row.leads);
      if (!lead) return [];
      const { assigned_setter: setterRelation, assigned_closer: closerRelation, ...leadFields } = lead;
      const outcome = row.outcome ?? 'scheduled';
      return [{
        ...row,
        outcome,
        leads: {
          ...leadFields,
          setter: relationToOne(setterRelation),
          closer: relationToOne(closerRelation),
        },
        can_record_outcome: canRecordAppointmentOutcome({
          role: actor.role,
          userId: actor.id,
          leadAssignedSetterId: lead.assigned_setter_id,
          leadAssignedCloserId: lead.assigned_closer_id,
          existingOutcomeBy: row.outcome_by,
        }),
        exceptions: [] as string[],
      }];
    });

    const exceptionMap = scheduleExceptions(
      appointments.map((appointment): ScheduleAppointmentFacts => ({
        id: appointment.id,
        appointment_type: appointment.appointment_type,
        scheduled_at: appointment.scheduled_at,
        outcome: appointment.outcome,
        market_id: appointment.leads.market_id,
        assigned_setter_id: appointment.leads.assigned_setter_id,
        assigned_closer_id: appointment.leads.assigned_closer_id,
      })),
      generatedAt
    );

    return NextResponse.json({
      success: true,
      generatedAt,
      scope,
      appointments: appointments
        .filter((appointment) => {
          const scheduledAt = Date.parse(appointment.scheduled_at);
          return scheduledAt >= Date.parse(start) && scheduledAt < Date.parse(end);
        })
        .map((appointment) => ({
          ...appointment,
          exceptions: exceptionMap[appointment.id] ?? [],
        })),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
