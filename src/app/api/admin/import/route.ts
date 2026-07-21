import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getAuthenticatedAdmin } from '@/lib/auth/jwt';
import { parseLeadCSV } from '@/lib/csv/parser';
import { normalizeStreet, addressConflicts } from '@/lib/leads/dedupe';
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
    // (plus APN when the source provides one). Phone numbers are deliberately
    // not a duplicate signal: skip-trace lists share numbers across relatives,
    // and DNC-scrubbed leads have no phone at all.
    const apns = leads.map(l => l.apn).filter(Boolean) as string[];

    // Existing addresses have to be normalized in JS (the column stores raw text),
    // so pull the address columns for every lead, paging past the 1000-row cap —
    // a truncated read would silently miss duplicates.
    async function fetchExistingAddresses() {
      const rows: { id: string; address_street: string | null; address_city: string | null; address_zip: string | null }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('leads')
          .select('id, address_street, address_city, address_zip')
          .not('address_street', 'is', null)
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    }

    const [existingAddrRows, apnMatches] = await Promise.all([
      fetchExistingAddresses(),
      apns.length > 0
        ? supabase.from('leads').select('id, apn').in('apn', apns)
        : Promise.resolve({ data: [] as { id: string; apn: string | null }[] }),
    ]);

    // Build lookup maps: identifier → existing lead
    const apnToId = new Map<string, string>();
    for (const row of apnMatches.data || []) {
      if (row.apn) apnToId.set(row.apn, row.id);
    }
    const addrToLeads = new Map<string, { id: string; city: string | null; zip: string | null }[]>();
    for (const row of existingAddrRows) {
      const key = normalizeStreet(row.address_street);
      if (!key) continue;
      const bucket = addrToLeads.get(key) || [];
      bucket.push({ id: row.id, city: row.address_city, zip: row.address_zip });
      addrToLeads.set(key, bucket);
    }

    // Also track intra-batch identifiers to catch duplicates within the same CSV
    const seenApns = new Map<string, string>();
    const seenAddrs = new Map<string, { idx: string; city: string | null; zip: string | null }[]>();

    // Annotate each lead with duplicate info
    const annotatedLeads = leads.map((lead, idx) => {
      let duplicateOfId: string | null = null;

      const apn = lead.apn;
      const addr = normalizeStreet(lead.address_street);
      const scope = { city: lead.address_city, zip: lead.address_zip };

      // Check DB matches — APN is an exact parcel id, so it wins over street text
      if (!duplicateOfId && apn && apnToId.has(apn)) duplicateOfId = apnToId.get(apn)!;
      if (!duplicateOfId && addr) {
        const match = (addrToLeads.get(addr) || []).find(c => !addressConflicts(scope, c));
        if (match) duplicateOfId = match.id;
      }

      // Check intra-batch duplicates (mark later occurrence as duplicate)
      if (!duplicateOfId && apn && seenApns.has(apn)) duplicateOfId = `batch:${seenApns.get(apn)}`;
      if (!duplicateOfId && addr) {
        const match = (seenAddrs.get(addr) || []).find(c => !addressConflicts(scope, c));
        if (match) duplicateOfId = `batch:${match.idx}`;
      }

      // Track this lead's identifiers for subsequent rows
      if (apn && !seenApns.has(apn)) seenApns.set(apn, String(idx));
      if (addr) {
        const bucket = seenAddrs.get(addr) || [];
        bucket.push({ idx: String(idx), city: lead.address_city, zip: lead.address_zip });
        seenAddrs.set(addr, bucket);
      }

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
