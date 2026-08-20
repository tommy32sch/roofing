import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { marketFilterFor } from '@/lib/leads/market-context';
import { applyMarketFilter } from '@/lib/leads/markets';
import { parsePhoneNumber } from 'libphonenumber-js';
import { enrichLead } from '@/lib/integrations/regrid';
import { geocodeLeadIfNeeded } from '@/lib/integrations/geocode';
import { safeSortColumn } from '@/lib/utils/lead-query';
import { estimateRoofValue } from '@/lib/leads/roof-value';
import { pickWritableLeadFields, statusDenialReason } from '@/lib/leads/lead-fields';
import { getRoofPricePerSquare } from '@/lib/leads/roof-value.server';
import {
  applyLeadQueueFilters,
  leadQueueRequestParamsFromSearchParams,
} from '@/lib/leads/work-queue.server';
import { leadListRequestLimit, leadQueueSort } from '@/lib/leads/work-queue';
import {
  applyLeadAccessFilter,
  assignmentForNewLead,
} from '@/lib/leads/lead-visibility';
import { isValidUUID } from '@/lib/utils/validation';

export async function GET(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = db();
    const { searchParams } = new URL(request.url);

    const sourceId = searchParams.get('source_id');
    const importBatchId = searchParams.get('import_batch_id');
    if (importBatchId && !isValidUUID(importBatchId)) {
      return NextResponse.json({ success: false, error: 'Invalid import batch ID' }, { status: 400 });
    }
    const queueParams = leadQueueRequestParamsFromSearchParams(searchParams);
    const { sort, order } = leadQueueSort(queueParams);
    const parsedPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit = leadListRequestLimit(searchParams.get('limit'));
    const offset = (page - 1) * limit;
    const showDuplicates = searchParams.get('show_duplicates') === 'true';
    const isFlaggedDuplicate = searchParams.get('is_flagged_duplicate');
    const followUpBefore = searchParams.get('follow_up_before'); // ISO date string, e.g. today

    let query = supabase
      .from('leads')
      // Two embeds of admin_users, so each MUST name its foreign key explicitly
      // — without the !fk hint PostgREST cannot tell which column a join means
      // and rejects the request as ambiguous.
      .select(
        '*, lead_sources!source_id(id, display_name), assigned_setter:admin_users!assigned_setter_id(id, name), assigned_closer:admin_users!assigned_closer_id(id, name)',
        { count: 'exact' }
      );

    // Office scoping: explicit ?market_id, else the caller's home market.
    query = applyMarketFilter(query, await marketFilterFor(admin.marketId, searchParams.get('market_id')));

    query = applyLeadAccessFilter(query, { id: admin.sub, role: admin.role });

    query = applyLeadQueueFilters(query, queueParams);

    // The durable import receipt links here. Assignment filtering still runs
    // first, so the batch filter cannot expose a lead the caller cannot access.
    if (importBatchId) query = query.eq('import_batch_id', importBatchId);

    // Exclude flagged duplicates from main list unless explicitly requested
    if (!showDuplicates) {
      query = query.eq('is_flagged_duplicate', false);
    } else if (isFlaggedDuplicate !== null) {
      query = query.eq('is_flagged_duplicate', isFlaggedDuplicate === 'true');
    }

    if (sourceId) query = query.eq('source_id', parseInt(sourceId, 10));

    if (followUpBefore) {
      query = query
        .lte('follow_up_date', followUpBefore)
        .not('follow_up_date', 'is', null)
        .not('status', 'in', '("sold","lost")');
    }

    const ascending = order === 'asc';
    const sortColumn = safeSortColumn(sort);
    query = query.order(sortColumn, { ascending, nullsFirst: false });
    if (sortColumn === 'last_name') query = query.order('first_name', { ascending, nullsFirst: false });
    if (sortColumn === 'first_name') query = query.order('last_name', { ascending, nullsFirst: false });
    if (sortColumn !== 'created_at') query = query.order('created_at', { ascending: false, nullsFirst: false });
    query = query.order('id', { ascending: true }).range(offset, offset + limit - 1);

    const { data: leads, error, count } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      leads: leads || [],
      total: count || 0,
      page,
      limit,
      sort: sortColumn,
      order,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const supabase = db();
    const body = await request.json();

    const { first_name, last_name, phone, email } = body;

    if (!first_name?.trim() || !last_name?.trim()) {
      return NextResponse.json(
        { success: false, error: 'First name and last name are required' },
        { status: 400 }
      );
    }

    /**
     * Whitelist what the caller may write. This used to be `...rest` — the raw
     * request body spread into a service-role insert — so a setter could create
     * a lead with deal_value, assigned_setter_id and status 'sold' set, and the
     * performance leaderboard counted it. Same rule as the update path, which is
     * why it lives in a shared module now.
     */
    const denial = statusDenialReason(body.status, admin.role);
    if (denial) {
      return NextResponse.json({ success: false, error: denial }, { status: 403 });
    }
    const writable = pickWritableLeadFields(body, admin.role);

    // Normalize phone
    let phone_normalized: string | null = null;
    if (phone?.trim()) {
      try {
        const parsed = parsePhoneNumber(phone.trim(), 'US');
        if (parsed?.isValid()) {
          phone_normalized = parsed.format('E.164');
        }
      } catch {
        // Keep raw phone, no normalized version
      }
    }

    // Estimate roof value from any property data supplied at creation. If the
    // lead is later auto-enriched, enrichLead recomputes this from richer data.
    // Coerced rather than passed through: the whitelist returns unknown values,
    // and the old `...rest` was implicitly any — a string "2000" for sqft would
    // have reached the estimator and produced a garbage roof value.
    const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const estimate = estimateRoofValue(
      {
        sqft: asNumber(writable.sqft),
        stories: asNumber(writable.stories),
        roof_type: asString(writable.roof_type),
      },
      { basePricePerSquare: await getRoofPricePerSquare() }
    );

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        ...writable,
        // After the spread, so the name/contact validation and normalization
        // above win over the same keys arriving in the body.
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        phone: phone?.trim() || null,
        phone_normalized,
        email: email?.trim()?.toLowerCase() || null,
        estimated_roof_value: estimate?.value ?? null,
        ...assignmentForNewLead({ id: admin.sub, role: admin.role }),
        created_by: admin.sub,
        created_by_name: admin.name?.trim() || admin.email,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Create "created" activity
    await supabase.from('lead_activities').insert({
      lead_id: lead.id,
      activity_type: 'created',
      content: 'Lead created',
      created_by: admin.sub,
    });

    // Auto-enrich with Regrid in the background (non-blocking)
    enrichLead(lead.id, {
      address_street: lead.address_street,
      address_city: lead.address_city,
      address_state: lead.address_state,
      address_zip: lead.address_zip,
    }).catch(() => {});

    // Geocode for the map in the background (only fills if coords still null)
    geocodeLeadIfNeeded(lead.id, {
      address_street: lead.address_street,
      address_city: lead.address_city,
      address_state: lead.address_state,
      address_zip: lead.address_zip,
    }).catch(() => {});

    return NextResponse.json({ success: true, lead }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
