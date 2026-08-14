import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  assignmentsFromConfirmationPlan,
  confirmationPlan,
  createImportPreview,
  importFileHash,
  importLeadId,
  importPreviewMatches,
  importRetentionExpiry,
  importStoragePath,
  mapImportColumn,
  parseImportFile,
  processingCanResume,
} from '@/lib/leads/import-job';
import { isValidUUID } from '@/lib/utils/validation';

const bytes = (text: string) => new TextEncoder().encode(text);
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('durable import parsing and preview', () => {
  it('uses production normalization for review, DNC handling, and source row numbers', () => {
    const parsed = parseImportFile(bytes([
      'First Name,Last Name,Property Address,Phone 1,Phone 1 DNC,Phone 2,Phone 2 DNC',
      ',,9 Missing Way,6025550000,no,,',
      'Ada,Lovelace,1 Main St,6025550001,yes,6025550002,no',
      'Grace,Hopper,2 Main St,6025550003,yes,,',
    ].join('\n')), 'leads.csv');

    expect(parsed.leads).toHaveLength(2);
    expect(parsed.leadRows).toEqual([3, 4]);
    expect(parsed.skipped).toBe(1);
    expect(parsed.leads[0]).toMatchObject({
      first_name: 'Ada',
      phone: '6025550002',
      is_dnc: false,
    });
    expect(parsed.leads[1]).toMatchObject({ phone: null, is_dnc: true });
    expect(parsed.fieldMappings).toContainEqual({
      source: 'Property Address',
      target: 'address_street',
      recognized: true,
    });
  });

  it('uses the same parser for Excel files', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['First Name', 'Last Name', 'Address'],
        ['Katherine', 'Johnson', '3 Main St'],
      ]),
      'Leads'
    );
    const file = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = parseImportFile(new Uint8Array(file), 'leads.xlsx');

    expect(parsed.leads).toHaveLength(1);
    expect(parsed.leads[0]).toMatchObject({
      first_name: 'Katherine',
      last_name: 'Johnson',
      address_street: '3 Main St',
    });
  });

  it('shows flexible phone columns and unknown columns honestly', () => {
    expect(mapImportColumn('Phone 4')).toEqual({
      source: 'Phone 4',
      target: 'phone4',
      recognized: true,
    });
    expect(mapImportColumn('Phone 4 DNC')).toEqual({
      source: 'Phone 4 DNC',
      target: 'phone4_dnc',
      recognized: true,
    });
    expect(mapImportColumn('Vendor Score')).toEqual({
      source: 'Vendor Score',
      target: 'vendor_score',
      recognized: false,
    });
  });

  it('builds the reviewed counts and bounded sample from deterministic lead IDs', () => {
    const jobId = '00000000-0000-4000-8000-000000000001';
    const parsed = parseImportFile(bytes([
      'First Name,Last Name,Address,DNC',
      'Ada,Lovelace,1 Main St,no',
      'Grace,Hopper,2 Main St,yes',
    ].join('\n')), 'leads.csv');
    const firstId = importLeadId(jobId, 0);
    const secondId = importLeadId(jobId, 1);
    const assignments = new Map([[firstId, null], [secondId, firstId]]);
    const preview = createImportPreview(jobId, parsed, assignments);

    expect(preview.summary).toEqual({
      totalRows: 2,
      validRows: 2,
      missingRequired: 0,
      duplicateCandidates: 1,
      dncOnlyRows: 1,
      willImport: 2,
    });
    expect(preview.sample[1]).toMatchObject({
      row: 3,
      isDuplicateCandidate: true,
      isDncOnly: true,
    });
    expect(importPreviewMatches(preview.summary, { ...preview.summary })).toBe(true);
    expect(importPreviewMatches(preview.summary, { ...preview.summary, duplicateCandidates: 2 })).toBe(false);
  });
});

describe('durable import retry and retention primitives', () => {
  it('generates stable IDs, hashes, and private object paths', () => {
    const jobId = '00000000-0000-4000-8000-000000000001';
    const id = importLeadId(jobId, 12);
    expect(id).toBe(importLeadId(jobId, 12));
    expect(id).not.toBe(importLeadId(jobId, 13));
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(isValidUUID(id)).toBe(true);
    expect(importFileHash(bytes('same'))).toHaveLength(64);
    expect(importStoragePath('uploader', jobId, 'List.XLSX')).toBe(
      `uploader/${jobId}/source.xlsx`
    );
  });

  it('round-trips a complete duplicate plan and rejects incomplete plans', () => {
    const assignments = new Map<string, string | null>([['a', null], ['b', 'a']]);
    const saved = confirmationPlan(assignments);
    expect(assignmentsFromConfirmationPlan(saved, ['a', 'b'])).toEqual(assignments);
    expect(assignmentsFromConfirmationPlan({ a: null }, ['a', 'b'])).toBeNull();
  });

  it('expires private files after 30 days and only resumes stale processing', () => {
    const now = new Date('2026-08-14T12:00:00.000Z');
    expect(importRetentionExpiry(now)).toBe('2026-09-13T12:00:00.000Z');
    expect(processingCanResume('2026-08-14T11:55:00.000Z', now)).toBe(false);
    expect(processingCanResume('2026-08-14T11:49:59.000Z', now)).toBe(true);
  });
});

describe('durable import route and schema contracts', () => {
  it('keeps files private, receipts durable, and every state explicit', () => {
    const migration = read('supabase/migrations/032_durable_import_jobs.sql');
    for (const status of ['uploaded', 'review_ready', 'processing', 'completed', 'failed', 'cancelled']) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toContain("VALUES ('lead-imports', 'lead-imports', false, 5242880)");
    expect(migration).toContain('retention_expires_at');
    expect(migration).toContain('confirmation_plan JSONB');
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]{0,120}storage\.objects/i);
  });

  it('reparses the stored file, claims one confirmation, and makes writes retry-safe', () => {
    const upload = read('src/app/api/admin/import/route.ts');
    const confirm = read('src/app/api/admin/import/[jobId]/confirm/route.ts');
    expect(upload).not.toContain(".from('leads')");
    expect(confirm).toContain('downloadImportFile(supabase, job)');
    expect(confirm).toContain('parseImportFile(bytes, job.filename)');
    expect(confirm).toContain(".eq('status', claimFrom)");
    expect(confirm).toContain("job.status === 'completed'");
    expect(confirm).toContain("onConflict: 'id', ignoreDuplicates: true");
    expect(confirm).toContain('assignmentForNewLead({ id: job.uploaded_by, role: uploaderRole })');
  });

  it('keeps receipt links scoped by a validated URL-backed batch filter', () => {
    const receipt = read('src/app/admin/(app)/leads/import/page.tsx');
    const listPage = read('src/app/admin/(app)/leads/page.tsx');
    const listApi = read('src/app/api/admin/leads/route.ts');
    const exportApi = read('src/app/api/admin/leads/export/route.ts');
    expect(receipt).toContain('/admin/leads?import_batch_id=${job.id}');
    expect(listPage).toContain("searchParams.get('import_batch_id')");
    expect(listPage).toContain("params.set('import_batch_id', importBatchId)");
    expect(listApi).toContain("query.eq('import_batch_id', importBatchId)");
    expect(listApi).toContain('isValidUUID(importBatchId)');
    expect(exportApi).toContain("query.eq('import_batch_id', importBatchId)");
    expect(exportApi).toContain('isValidUUID(importBatchId)');
  });
});
