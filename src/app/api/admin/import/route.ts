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
        error: 'No valid leads found in CSV',
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

    // Insert leads in batches of 100
    let imported = 0;
    const batchSize = 100;
    const importErrors: string[] = [...errors];

    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);

      const { data: insertedLeads, error } = await supabase
        .from('leads')
        .insert(batch)
        .select('id');

      if (error) {
        importErrors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else if (insertedLeads) {
        imported += insertedLeads.length;

        // Create "created" activities for imported leads
        const activities = insertedLeads.map((lead) => ({
          lead_id: lead.id,
          activity_type: 'created' as const,
          content: 'Imported from CSV',
          created_by: admin.sub,
        }));

        await supabase.from('lead_activities').insert(activities);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      errors: importErrors,
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
