import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { normalizeLeadData, NormalizedLead } from '@/lib/leads/normalize';
import { checkConfiguredRateLimit, getClientIP } from '@/lib/utils/rate-limit';
import { enrichLead } from '@/lib/integrations/regrid';
import { webhookAttribution } from '@/lib/leads/attribution';
import { getWebhookApiKey } from '@/lib/integrations/webhook-auth';
import { assignImportDuplicates } from '@/lib/leads/dedupe';

export async function POST(request: NextRequest) {
  try {
    const apiKey = getWebhookApiKey(request.headers);

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Missing API key. Provide the x-api-key header.' },
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

    // Resolve duplicates through the same database-owned canonical address key
    // used by file and email imports. This also handles APNs, street-only lists,
    // common address abbreviations, and duplicates inside one webhook payload.
    let duplicates = 0;
    const leadsToInsert: NormalizedLead[] = [];
    const lookupRecords = normalizedLeads.map((lead, index) => ({
      id: `new:${index}`,
      apn: lead.apn,
      address_street: lead.address_street,
      address_city: lead.address_city,
      address_zip: lead.address_zip,
    }));
    const assigned = await assignImportDuplicates(supabase, lookupRecords);

    for (let index = 0; index < normalizedLeads.length; index++) {
      const lead = normalizedLeads[index];
      if (assigned.get(`new:${index}`)) {
        duplicates++;
        continue;
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
        // No account behind a webhook, so attribute the API key — that's what
        // an admin revokes when a feed starts sending junk.
        created_by_name: webhookAttribution(keyRecord.name),
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
