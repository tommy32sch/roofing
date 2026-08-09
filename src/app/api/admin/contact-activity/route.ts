import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import {
  isContactActivityPeriod,
  isValidContactActivityWindow,
  resolveContactActivityUser,
} from '@/lib/leads/contact-activity';
import type { ContactActivityEvent } from '@/types';

interface EmbeddedLead {
  id: string;
  first_name: string;
  last_name: string;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
}

interface EmbeddedAccount {
  name: string;
}

interface ContactRow {
  id: string;
  lead_id: string;
  disposition: string;
  created_by: string | null;
  knocked_at?: string;
  called_at?: string;
  leads: EmbeddedLead | EmbeddedLead[] | null;
  admin_users: EmbeddedAccount | EmbeddedAccount[] | null;
}

function embeddedOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function applyRelatedMarketFilter<T>(query: T, marketId: number | null): T {
  if (marketId == null) return query;
  return (query as { eq(column: string, value: number): T }).eq('leads.market_id', marketId);
}

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const periodParam = params.get('period');
    if (!isContactActivityPeriod(periodParam)) {
      return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });
    }

    const start = params.get('start');
    const end = params.get('end');
    if (!isValidContactActivityWindow(periodParam, start, end)) {
      return NextResponse.json(
        { success: false, error: 'Invalid reporting window' },
        { status: 400 }
      );
    }

    const user = resolveContactActivityUser(admin.role, admin.sub, params.get('user_id'));
    if (!user.ok) {
      return NextResponse.json(
        { success: false, error: user.error },
        { status: user.status }
      );
    }

    const marketId = await marketFilterFor(admin.marketId, params.get('market_id'));
    const supabase = db();
    const select =
      'id, lead_id, disposition, created_by, leads!inner(id, first_name, last_name, address_street, address_city, address_state), admin_users(name)';

    let knockQuery = applyRelatedMarketFilter(
      supabase
        .from('lead_knocks')
        .select(`${select}, knocked_at`, { count: 'exact' })
        .gte('knocked_at', start!)
        .lt('knocked_at', end!)
        .order('knocked_at', { ascending: false })
        .limit(20),
      marketId
    );
    let callQuery = applyRelatedMarketFilter(
      supabase
        .from('lead_calls')
        .select(`${select}, called_at`, { count: 'exact' })
        .gte('called_at', start!)
        .lt('called_at', end!)
        .order('called_at', { ascending: false })
        .limit(20),
      marketId
    );

    if (user.userId) {
      knockQuery = knockQuery.eq('created_by', user.userId);
      callQuery = callQuery.eq('created_by', user.userId);
    }

    const [knocks, calls] = await Promise.all([knockQuery, callQuery]);
    if (knocks.error || calls.error) {
      return NextResponse.json(
        { success: false, error: (knocks.error || calls.error)?.message },
        { status: 500 }
      );
    }

    const knockEvents: ContactActivityEvent[] = ((knocks.data ?? []) as ContactRow[]).map(
      (row) => ({
        id: row.id,
        channel: 'knock',
        leadId: row.lead_id,
        disposition: row.disposition,
        occurredAt: row.knocked_at!,
        accountId: row.created_by,
        accountName: embeddedOne(row.admin_users)?.name ?? null,
        lead: embeddedOne(row.leads),
      })
    );
    const callEvents: ContactActivityEvent[] = ((calls.data ?? []) as ContactRow[]).map(
      (row) => ({
        id: row.id,
        channel: 'cold_call',
        leadId: row.lead_id,
        disposition: row.disposition,
        occurredAt: row.called_at!,
        accountId: row.created_by,
        accountName: embeddedOne(row.admin_users)?.name ?? null,
        lead: embeddedOne(row.leads),
      })
    );

    return NextResponse.json({
      success: true,
      activity: {
        knockCount: knocks.count ?? 0,
        callCount: calls.count ?? 0,
        events: [...knockEvents, ...callEvents]
          .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
          .slice(0, 20),
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
