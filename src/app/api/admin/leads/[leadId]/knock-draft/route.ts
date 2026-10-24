import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { isValidUUID } from '@/lib/utils/validation';
import { authorizeLeadAccess } from '@/lib/leads/lead-visibility';
import { checkConfiguredRateLimit } from '@/lib/utils/rate-limit';
import { DEFAULT_TIME_ZONE } from '@/lib/appointments/reminders';
import { marketToday, parseKnockDraftText } from '@/lib/ai/knock-draft';
import { draftKnock, isKnockDraftConfigured } from '@/lib/ai/knock-draft.server';

// Above the model call's own 15s timeout, so the route always answers.
export const maxDuration = 30;

/**
 * Turn a rep's sentence about one door into a PROPOSED knock result.
 *
 * Returns a draft only. It never writes: the rep confirms the draft and the
 * client saves it through the ordinary knock path (offline outbox and
 * record_lead_knock), so every rule a knock already has still applies.
 *
 * Every role can use it on a lead it can access, like the knock route itself.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { leadId } = await params;
    if (!isValidUUID(leadId)) {
      return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
    }

    if (!isKnockDraftConfigured()) {
      return NextResponse.json(
        { success: false, error: 'Drafting is not set up' },
        { status: 503 }
      );
    }

    const supabase = db();
    const access = await authorizeLeadAccess(supabase, { id: admin.sub, role: admin.role }, leadId);
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    // Each draft is a paid call. Generous for a rep at the door, tight for a loop.
    const rateLimit = await checkConfiguredRateLimit(admin.sub, 'knock-draft', 30, '10 m');
    if (!rateLimit.success) {
      const retryAfter = Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000));
      return NextResponse.json(
        { success: false, error: 'Too many drafts. Try again in a few minutes' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    let body: { text?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = parseKnockDraftText(body?.text);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('address_street, do_not_knock, markets(timezone)')
      .eq('id', leadId)
      .single();
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }
    // The knock buttons are hidden for this house; a draft must not offer one.
    if (lead.do_not_knock) {
      return NextResponse.json(
        { success: false, error: 'Do not knock this house' },
        { status: 409 }
      );
    }

    const market = lead.markets as { timezone?: string | null } | { timezone?: string | null }[] | null;
    const timeZone = (Array.isArray(market) ? market[0]?.timezone : market?.timezone) || DEFAULT_TIME_ZONE;

    const result = await draftKnock(
      {
        text: parsed.text,
        today: marketToday(new Date(), timeZone),
        leadStreet: lead.address_street,
      },
      request.signal
    );
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 502 });
    }

    return NextResponse.json({ success: true, draft: result.draft });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
