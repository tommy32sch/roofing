import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { normalizeLeadData, NormalizedLead } from '@/lib/leads/normalize';
import { checkConfiguredRateLimit, getClientIP } from '@/lib/utils/rate-limit';
import { enrichLead } from '@/lib/integrations/regrid';

export async function POST(request: NextRequest) {
  try {
    // Extract API key from header or query param
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Missing API key. Provide x-api-key header or api_key query param.' },
        { status: 401 }
      );
    }

    const supabase = db();

    // Validate API key
    const { data: keyRecord, error: keyError } = await supabase
      .from('integration_api_keys')
      .select('*, lead_sources(id, name, display_name)')
      .eq('api_key', apiKey)
      .eq('is_active', true)
      .single();

    if (keyError || !keyRecord) {
      return NextResponse.json(
        { success: false, error: 'Invalid or inactive API key' },
        { status: 401 }
      );
    }

    // Rate limit: 100 requests per minute per API key
    const ip = getClientIP(request.headers);
    const rateLimitResult = await checkConfiguredRateLimit(
      `webhook:${keyRecord.id}:${ip}`,
      'webhook',
      100,
      '1m'
    );
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded. Try again later.' },
        { status: 429 }
      );
    }

    // Update last_used_at
    await supabase
      .from('integration_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRecord.id);

    // Parse the incoming payload
    let rawLeads: Record<string, unknown>[];
    try {
      const body = await request.json();

      if (Array.isArray(body)) {
        rawLeads = body;
      } else if (body.data && Array.isArray(body.data)) {
        rawLeads = body.data;
      } else if (typeof body === 'object' && body !== null) {
        rawLeads = [body];
      } else {
        return NextResponse.json(
          { success: false, error: 'Invalid payload. Expected JSON object, array, or { data: [...] }' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    if (rawLeads.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No leads in payload' },
        { status: 400 }
      );
    }

    if (rawLeads.length > 5000) {
      return NextResponse.json(
        { success: false, error: `Too many leads (${rawLeads.length}). Maximum is 5000 per request.` },
        { status: 400 }
      );
    }

    // Normalize all leads
    const normalizedLeads: NormalizedLead[] = [];
    const errors: string[] = [];
    let skipped = 0;

    for (let i = 0; i < rawLeads.length; i++) {
      const lead = normalizeLeadData(rawLeads[i]);
      if (lead) {
        normalizedLeads.push(lead);
      } else {
        errors.push(`Lead ${i + 1}: Missing required first_name or last_name`);
        skipped++;
      }
    }

    if (normalizedLeads.length === 0) {
      logWebhook(supabase, keyRecord, rawLeads, 0, 0, errors);
      return NextResponse.json({
        success: false,
        error: 'No valid leads found in payload',
        imported: 0,
        skipped,
        duplicates: 0,
        errors,
      }, { status: 400 });
    }

    // Deduplicate by address against existing leads
    let duplicates = 0;
    const leadsToInsert: NormalizedLead[] = [];

    // Collect addresses for batch dedup check
    const addressPairs = normalizedLeads
      .filter(l => l.address_street && l.address_zip)
      .map(l => ({ street: l.address_street!.toLowerCase(), zip: l.address_zip! }));

    let existingAddresses = new Set<string>();
    if (addressPairs.length > 0) {
      // Get unique zip codes to narrow the query
      const zips = [...new Set(addressPairs.map(a => a.zip))];
      const { data: existing } = await supabase
        .from('leads')
        .select('address_street, address_zip')
        .in('address_zip', zips);

      if (existing) {
        existingAddresses = new Set(
          existing.map(e => `${(e.address_street || '').toLowerCase()}|${e.address_zip || ''}`)
        );
      }
    }

    for (const lead of normalizedLeads) {
      if (lead.address_street && lead.address_zip) {
        const key = `${lead.address_street.toLowerCase()}|${lead.address_zip}`;
        if (existingAddresses.has(key)) {
          duplicates++;
          continue;
        }
        // Also prevent in-batch duplicates
        existingAddresses.add(key);
      }
      leadsToInsert.push(lead);
    }

    // Insert leads in batches of 100
    let imported = 0;
    const batchSize = 100;
    const sourceName = keyRecord.lead_sources?.display_name || keyRecord.name;

    for (let i = 0; i < leadsToInsert.length; i += batchSize) {
      const batch = leadsToInsert.slice(i, i + batchSize).map(lead => ({
        ...lead,
        source_id: keyRecord.source_id,
      }));

      const { data: insertedLeads, error: insertError } = await supabase
        .from('leads')
        .insert(batch)
        .select('id');

      if (insertError) {
        errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${insertError.message}`);
      } else if (insertedLeads) {
        imported += insertedLeads.length;

        // Create activity logs
        const activities = insertedLeads.map(lead => ({
          lead_id: lead.id,
          activity_type: 'created' as const,
          content: `Imported via webhook (${sourceName})`,
        }));
        await supabase.from('lead_activities').insert(activities);

        // Auto-enrich with Regrid in the background (non-blocking)
        const batchLeadData = leadsToInsert.slice(i, i + batchSize);
        for (let j = 0; j < insertedLeads.length; j++) {
          const lead = batchLeadData[j];
          if (lead) {
            enrichLead(insertedLeads[j].id, {
              address_street: lead.address_street,
              address_city: lead.address_city,
              address_state: lead.address_state,
              address_zip: lead.address_zip,
            }).catch(() => {});
          }
        }
      }
    }

    // Log the webhook call
    logWebhook(supabase, keyRecord, rawLeads, imported, duplicates, errors);

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      duplicates,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logWebhook(supabase: any, keyRecord: any, rawLeads: unknown[], imported: number, duplicates: number, errors: string[]) {
  const summary = JSON.stringify(rawLeads).substring(0, 500);
  supabase.from('webhook_logs').insert({
    api_key_id: keyRecord.id,
    source_name: keyRecord.lead_sources?.display_name || keyRecord.name,
    payload_summary: summary,
    leads_imported: imported,
    duplicates_skipped: duplicates,
    errors: errors.length > 0 ? errors : null,
  }).then(() => {});
}
