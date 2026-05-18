import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { parseLeadCSV } from '@/lib/csv/parser';
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
    // Collect identifiers from parsed leads for bulk DB lookup
    const phones = leads.map(l => l.phone_normalized).filter(Boolean) as string[];
    const apns = leads.map(l => l.apn).filter(Boolean) as string[];
    const addrPairs = leads
      .filter(l => l.address_street && l.address_zip)
      .map(l => `${l.address_street?.toLowerCase().trim()}|${l.address_zip?.trim()}`);

    const [phoneMatches, apnMatches, addrMatches] = await Promise.all([
      phones.length > 0
        ? supabase.from('leads').select('id, phone_normalized').in('phone_normalized', phones)
        : Promise.resolve({ data: [] }),
      apns.length > 0
        ? supabase.from('leads').select('id, apn').in('apn', apns)
        : Promise.resolve({ data: [] }),
      addrPairs.length > 0
        ? supabase.from('leads').select('id, address_street, address_zip').or(
            addrPairs.map(p => {
              const [street, zip] = p.split('|');
              return `and(address_street.ilike.${street},address_zip.eq.${zip})`;
            }).join(',')
          )
        : Promise.resolve({ data: [] }),
    ]);

    // Build lookup maps: identifier → existing lead id
    const phoneToId = new Map<string, string>();
    for (const row of phoneMatches.data || []) {
      if (row.phone_normalized) phoneToId.set(row.phone_normalized, row.id);
    }
    const apnToId = new Map<string, string>();
    for (const row of apnMatches.data || []) {
      if (row.apn) apnToId.set(row.apn, row.id);
    }
    const addrToId = new Map<string, string>();
    for (const row of addrMatches.data || []) {
      if (row.address_street && row.address_zip) {
        addrToId.set(`${row.address_street.toLowerCase().trim()}|${row.address_zip.trim()}`, row.id);
      }
    }

    // Also track intra-batch identifiers to catch duplicates within the same CSV
    const seenPhones = new Map<string, string>(); // phone → first-row index as string
    const seenApns = new Map<string, string>();
    const seenAddrs = new Map<string, string>();

    // Annotate each lead with duplicate info
    const annotatedLeads = leads.map((lead, idx) => {
      let duplicateOfId: string | null = null;

      const phone = lead.phone_normalized;
      const apn = lead.apn;
      const addr = lead.address_street && lead.address_zip
        ? `${lead.address_street.toLowerCase().trim()}|${lead.address_zip.trim()}`
        : null;

      // Check DB matches
      if (!duplicateOfId && phone && phoneToId.has(phone)) duplicateOfId = phoneToId.get(phone)!;
      if (!duplicateOfId && apn && apnToId.has(apn)) duplicateOfId = apnToId.get(apn)!;
      if (!duplicateOfId && addr && addrToId.has(addr)) duplicateOfId = addrToId.get(addr)!;

      // Check intra-batch duplicates (mark later occurrence as duplicate)
      if (!duplicateOfId && phone && seenPhones.has(phone)) duplicateOfId = `batch:${seenPhones.get(phone)}`;
      if (!duplicateOfId && apn && seenApns.has(apn)) duplicateOfId = `batch:${seenApns.get(apn)}`;
      if (!duplicateOfId && addr && seenAddrs.has(addr)) duplicateOfId = `batch:${seenAddrs.get(addr)}`;

      // Track this lead's identifiers for subsequent rows
      if (phone && !seenPhones.has(phone)) seenPhones.set(phone, String(idx));
      if (apn && !seenApns.has(apn)) seenApns.set(apn, String(idx));
      if (addr && !seenAddrs.has(addr)) seenAddrs.set(addr, String(idx));

      const isBatchDuplicate = duplicateOfId?.startsWith('batch:');
      return {
        ...lead,
        is_flagged_duplicate: duplicateOfId !== null,
        // Intra-batch duplicates don't have a real UUID yet; set to null and flag only
        duplicate_of_id: isBatchDuplicate ? null : duplicateOfId,
      };
    });

    // Insert leads in batches of 100
    let imported = 0;
    let flagged = 0;
    const batchSize = 100;
    const importErrors: string[] = [...errors];

    for (let i = 0; i < annotatedLeads.length; i += batchSize) {
      const batch = annotatedLeads.slice(i, i + batchSize);

      const { data: insertedLeads, error } = await supabase
        .from('leads')
        .insert(batch)
        .select('id, is_flagged_duplicate');

      if (error) {
        importErrors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else if (insertedLeads) {
        imported += insertedLeads.length;
        flagged += insertedLeads.filter(l => l.is_flagged_duplicate).length;

        // Create "created" activities for imported leads
        const activities = insertedLeads.map((lead) => ({
          lead_id: lead.id,
          activity_type: 'created' as const,
          content: lead.is_flagged_duplicate ? 'Imported from CSV (flagged as duplicate)' : 'Imported from CSV',
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
      errors: importErrors,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
