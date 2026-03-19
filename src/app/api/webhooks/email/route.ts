import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { parseLeadCSV } from '@/lib/csv/parser';
import { detectSource } from '@/lib/leads/source-detect';
import { enrichLead } from '@/lib/integrations/regrid';
import { checkConfiguredRateLimit, getClientIP } from '@/lib/utils/rate-limit';
import type { NormalizedLead } from '@/lib/leads/normalize';

const MAX_LEADS_PER_IMPORT = 5000;

interface EmailAttachment {
  name: string;
  content: string; // base64 encoded CSV
}

interface EmailImportPayload {
  sender: string;
  subject?: string;
  attachments: EmailAttachment[];
}

export async function POST(request: NextRequest) {
  try {
    const supabase = db();

    // Authenticate with API key (same as webhook inbound)
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Missing API key. Provide x-api-key header or api_key query param.' },
        { status: 401 }
      );
    }

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

    // Check email import is enabled
    const { data: settings } = await supabase
      .from('app_settings')
      .select('email_import_enabled, allowed_sender_emails')
      .eq('id', 'default')
      .single();

    if (!settings?.email_import_enabled) {
      return NextResponse.json(
        { success: false, error: 'Email import is not enabled' },
        { status: 403 }
      );
    }

    // Rate limit
    const ip = getClientIP(request.headers);
    const rateLimitResult = await checkConfiguredRateLimit(
      `email-import:${keyRecord.id}:${ip}`,
      'email-import',
      30,
      '1m'
    );
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    // Update last_used_at
    await supabase
      .from('integration_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRecord.id);

    const body: EmailImportPayload = await request.json();
    const senderEmail = body.sender || 'unknown';

    // Verify sender is allowed (if allowlist is configured)
    const allowedSenders = settings.allowed_sender_emails || [];
    if (allowedSenders.length > 0) {
      const senderLower = senderEmail.toLowerCase();
      const isAllowed = allowedSenders.some((allowed: string) => {
        const a = allowed.toLowerCase().trim();
        if (a.startsWith('@')) return senderLower.endsWith(a);
        return senderLower === a;
      });

      if (!isAllowed) {
        return NextResponse.json(
          { success: false, error: 'Sender not authorized' },
          { status: 403 }
        );
      }
    }

    if (!body.attachments || body.attachments.length === 0) {
      logEmailImport(supabase, senderEmail, body.subject, null, null, 0, 0, ['No attachments']);
      return NextResponse.json({ success: true, message: 'No attachments found.' });
    }

    // Process each CSV attachment
    const results = [];

    for (const attachment of body.attachments) {
      if (!attachment.name?.toLowerCase().endsWith('.csv')) continue;

      // Decode base64 to string
      let csvText: string;
      try {
        csvText = Buffer.from(attachment.content, 'base64').toString('utf-8');
      } catch {
        logEmailImport(supabase, senderEmail, body.subject, attachment.name, null, 0, 0, ['Failed to decode attachment']);
        results.push({ file: attachment.name, error: 'Failed to decode' });
        continue;
      }

      // Parse CSV
      const parsed = parseLeadCSV(csvText);

      if (parsed.leads.length === 0) {
        logEmailImport(supabase, senderEmail, body.subject, attachment.name, null, 0, parsed.skipped, parsed.errors);
        results.push({ file: attachment.name, imported: 0, skipped: parsed.skipped, errors: parsed.errors });
        continue;
      }

      if (parsed.leads.length > MAX_LEADS_PER_IMPORT) {
        logEmailImport(supabase, senderEmail, body.subject, attachment.name, null, 0, 0, [`Too many leads (${parsed.leads.length})`]);
        results.push({ file: attachment.name, error: `Too many leads (${parsed.leads.length})` });
        continue;
      }

      // Auto-detect source from email metadata + CSV headers
      const csvHeaders = csvText.split('\n')[0]?.split(',').map(h => h.trim()) || [];
      const sourceId = keyRecord.source_id || await detectSource({
        senderEmail,
        subject: body.subject,
        csvHeaders,
      });

      // Deduplicate against existing leads
      const leadsToInsert: NormalizedLead[] = [];
      let duplicates = 0;

      const addressPairs = parsed.leads
        .filter(l => l.address_street && l.address_zip)
        .map(l => ({ street: l.address_street!.toLowerCase(), zip: l.address_zip! }));

      let existingAddresses = new Set<string>();
      if (addressPairs.length > 0) {
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

      for (const lead of parsed.leads) {
        if (lead.address_street && lead.address_zip) {
          const key = `${lead.address_street.toLowerCase()}|${lead.address_zip}`;
          if (existingAddresses.has(key)) {
            duplicates++;
            continue;
          }
          existingAddresses.add(key);
        }
        leadsToInsert.push(lead);
      }

      // Batch insert
      let imported = 0;
      const insertErrors: string[] = [...parsed.errors];
      const batchSize = 100;

      for (let i = 0; i < leadsToInsert.length; i += batchSize) {
        const batch = leadsToInsert.slice(i, i + batchSize).map(lead => ({
          ...lead,
          source_id: sourceId,
        }));

        const { data: insertedLeads, error: insertError } = await supabase
          .from('leads')
          .insert(batch)
          .select('id');

        if (insertError) {
          insertErrors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${insertError.message}`);
        } else if (insertedLeads) {
          imported += insertedLeads.length;

          const activities = insertedLeads.map(lead => ({
            lead_id: lead.id,
            activity_type: 'created' as const,
            content: `Imported via email from ${senderEmail}`,
          }));
          await supabase.from('lead_activities').insert(activities);

          // Auto-enrich (non-blocking)
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

      logEmailImport(supabase, senderEmail, body.subject, attachment.name, sourceId, imported, duplicates, insertErrors);
      results.push({ file: attachment.name, imported, skipped: parsed.skipped, duplicates, errors: insertErrors.length > 0 ? insertErrors : undefined });
    }

    return NextResponse.json({ success: true, results });
  } catch (err) {
    console.error('Email import error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function logEmailImport(
  supabase: any,
  senderEmail: string,
  subject: string | undefined,
  attachmentName: string | null,
  sourceId: number | null,
  imported: number,
  duplicates: number,
  errors: string[]
) {
  supabase.from('email_import_logs').insert({
    sender_email: senderEmail,
    subject: subject || null,
    attachment_name: attachmentName,
    source_id: sourceId,
    leads_imported: imported,
    duplicates_skipped: duplicates,
    errors: errors.length > 0 ? errors : null,
  }).then(() => {});
}
