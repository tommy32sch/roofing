import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { parseLeadCSV } from '@/lib/csv/parser';
import { assignDuplicates } from '@/lib/leads/dedupe';
import { LIMITS } from '@/lib/utils/validation';
import * as XLSX from 'xlsx';

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

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

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
    // Existing leads are normalized in JS (the column stores raw text), so pull
    // them oldest-first — that keeps the earliest lead at an address as the
    // original — paging past the 1000-row cap, since a truncated read would
    // silently miss duplicates.
    const existing: { id: string; apn: string | null; address_street: string | null; address_city: string | null; address_zip: string | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('leads')
        .select('id, apn, address_street, address_city, address_zip')
        .order('created_at', { ascending: true })
        .range(from, from + 999);
      if (error) throw error;
      existing.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    // Incoming rows have no id yet, so they get a temporary one; a match against
    // another temp id means the duplicate is inside this same file.
    const assigned = assignDuplicates([
      ...existing,
      ...leads.map((l, i) => ({
        id: `new:${i}`,
        apn: l.apn,
        address_street: l.address_street,
        address_city: l.address_city,
        address_zip: l.address_zip,
      })),
    ]);

    const annotatedLeads = leads.map((lead, idx) => {
      const duplicateOfId = assigned.get(`new:${idx}`) ?? null;
      return {
        ...lead,
        is_flagged_duplicate: duplicateOfId !== null,
        // Duplicates of another row in this same file have no real UUID yet
        duplicate_of_id: duplicateOfId?.startsWith('new:') ? null : duplicateOfId,
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

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      flagged,
      dnc,
      errors: importErrors,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
