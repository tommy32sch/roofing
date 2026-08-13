import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { parseLeadCSV } from '@/lib/csv/parser';
import { assignImportDuplicates } from '@/lib/leads/dedupe';
import { checkConfiguredRateLimit } from '@/lib/utils/rate-limit';
import { LIMITS } from '@/lib/utils/validation';
import * as XLSX from 'xlsx';
import { assignmentForNewLead } from '@/lib/leads/lead-visibility';

function excelToCSV(buffer: ArrayBuffer): string {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(firstSheet);
}

export async function POST(request: NextRequest) {
  try {
    const admin = await getAuthenticatedAdmin();
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    // Parsing spreadsheets and normalizing up to 5,000 rows is intentionally
    // available to every signed-in role, so bound that work per account before
    // reading the multipart body. The existing limiter uses the application's
    // shared Upstash budget and retains conservative protection if Redis fails.
    const rateLimit = await checkConfiguredRateLimit(admin.sub, 'lead-import', 5, '10 m');
    if (!rateLimit.success) {
      const retryAfter = Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000));
      return NextResponse.json(
        { success: false, error: 'Import limit reached. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    // Which office this list belongs to. Chosen on the import screen because it
    // cannot be derived — street-only storm lists carry no city or state at all.
    const rawMarket = formData.get('market_id');
    const parsedMarket = rawMarket == null ? NaN : Number(rawMarket);
    const marketId = Number.isInteger(parsedMarket) && parsedMarket > 0 ? parsedMarket : null;

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    if (file.size > LIMITS.CSV_FILE_SIZE) {
      return NextResponse.json({ success: false, error: 'File too large (max 5MB)' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    let csvText: string;

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      const buffer = await file.arrayBuffer();
      csvText = excelToCSV(buffer);
    } else {
      csvText = await file.text();
    }

    const { leads, errors, skipped } = parseLeadCSV(csvText);

    if (leads.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No valid leads found',
        errors,
        imported: 0,
        skipped,
      }, { status: 400 });
    }

    if (leads.length > LIMITS.BULK_IMPORT_MAX) {
      return NextResponse.json({
        success: false,
        error: `Too many rows (${leads.length}). Maximum is ${LIMITS.BULK_IMPORT_MAX}.`,
      }, { status: 400 });
    }

    const supabase = db();

    // --- Duplicate detection ---
    // A duplicate is the same PROPERTY, matched on a canonical street address
    // (plus APN when the source provides one) by the shared assignDuplicates rule.
    // Phone numbers are deliberately not a signal: skip-trace lists share numbers
    // across relatives, and DNC-scrubbed leads have no phone at all.
    //
    // IDs are assigned before duplicate resolution so two copies inside the same
    // file can point to one real parent instead of leaving duplicate_of_id null.
    // The database RPC reads only indexed address/APN candidates, then the shared
    // rule handles APN precedence and city/ZIP conflicts in input order.
    const leadsWithIds = leads.map((lead) => ({ ...lead, id: randomUUID() }));
    const assigned = await assignImportDuplicates(supabase, leadsWithIds);

    // Record the upload itself before the leads, so every inserted row can point
    // at it. The uploader's name is snapshotted onto the batch and each lead —
    // this is an attribution trail, and it has to survive the account being
    // renamed or removed.
    const uploaderName = admin.name?.trim() || admin.email;
    const { data: importBatch } = await supabase
      .from('lead_import_batches')
      .insert({
        filename: file.name,
        uploaded_by: admin.sub,
        uploaded_by_name: uploaderName,
        market_id: marketId,
        row_count: leads.length + skipped,
      })
      .select('id')
      .single();
    const batchId = (importBatch as { id?: string } | null)?.id ?? null;

    const annotatedLeads = leadsWithIds.map((lead) => {
      const duplicateOfId = assigned.get(lead.id) ?? null;
      return {
        ...lead,
        market_id: marketId,
        ...assignmentForNewLead({ id: admin.sub, role: admin.role }),
        created_by: admin.sub,
        created_by_name: uploaderName,
        import_batch_id: batchId,
        is_flagged_duplicate: duplicateOfId !== null,
        duplicate_of_id: duplicateOfId,
      };
    });

    // Insert leads in batches of 100
    let imported = 0;
    let flagged = 0;
    let dnc = 0;
    const batchSize = 100;
    const importErrors: string[] = [...errors];

    for (let i = 0; i < annotatedLeads.length; i += batchSize) {
      const batch = annotatedLeads.slice(i, i + batchSize);

      const { data: insertedLeads, error } = await supabase
        .from('leads')
        .insert(batch)
        .select('id, is_flagged_duplicate, is_dnc');

      if (error) {
        importErrors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else if (insertedLeads) {
        imported += insertedLeads.length;
        flagged += insertedLeads.filter(l => l.is_flagged_duplicate).length;
        dnc += insertedLeads.filter(l => l.is_dnc).length;

        // Create "created" activities for imported leads
        const activities = insertedLeads.map((lead) => ({
          lead_id: lead.id,
          activity_type: 'created' as const,
          content: lead.is_dnc
            ? 'Imported from CSV (flagged Do Not Call)'
            : lead.is_flagged_duplicate
              ? 'Imported from CSV (flagged as duplicate)'
              : 'Imported from CSV',
          created_by: admin.sub,
        }));

        await supabase.from('lead_activities').insert(activities);
      }
    }

    // Backfill the batch with what actually landed, so the record matches the
    // numbers the uploader was shown.
    if (batchId) {
      await supabase
        .from('lead_import_batches')
        .update({ imported_count: imported, duplicate_count: flagged, dnc_count: dnc })
        .eq('id', batchId);
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      flagged,
      dnc,
      uploadedBy: uploaderName,
      errors: importErrors,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
