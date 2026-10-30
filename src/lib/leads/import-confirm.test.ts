import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  db: vi.fn(),
  load: vi.fn(),
  canMutate: vi.fn(),
  view: vi.fn(),
  assignDuplicates: vi.fn(),
  download: vi.fn(),
  locate: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({ getAuthenticatedAdmin: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ db: mocks.db }));
vi.mock('@/lib/leads/dedupe', () => ({ assignImportDuplicates: mocks.assignDuplicates }));
vi.mock('@/lib/leads/import-job.server', () => ({
  loadImportJob: mocks.load,
  canMutateImportJob: mocks.canMutate,
  importJobView: mocks.view,
  downloadImportFile: mocks.download,
  markImportJobFailed: vi.fn(),
  previewDatabaseValues: vi.fn(),
}));
vi.mock('@/lib/leads/import-locations.server', () => ({ locateImportAddresses: mocks.locate }));

import { POST as confirmImport } from '@/app/api/admin/import/[jobId]/confirm/route';
import { importLeadId } from './import-job';

const JOB_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN = {
  sub: '00000000-0000-4000-8000-000000000002',
  email: 'setter@example.com',
  name: 'Setter',
  role: 'setter' as const,
  marketId: 1,
  iat: 0,
  exp: 0,
};

function params() {
  return { params: Promise.resolve({ jobId: JOB_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(ADMIN);
  mocks.db.mockReturnValue({ from: vi.fn() });
  mocks.canMutate.mockReturnValue(true);
  mocks.view.mockImplementation((job) => ({ id: job.id, status: job.status }));
  mocks.locate.mockResolvedValue({ locations: new Map(), unmatchedIds: [], error: null });
});

describe('durable import confirmation boundary', () => {
  it('returns the completed receipt without inserting again', async () => {
    const job = { id: JOB_ID, status: 'completed', uploaded_by: ADMIN.sub };
    mocks.load.mockResolvedValue({ job, error: null });

    const response = await confirmImport(new Request('http://localhost'), params());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      idempotent: true,
      job: { id: JOB_ID, status: 'completed' },
    });
    expect(mocks.assignDuplicates).not.toHaveBeenCalled();
    expect(mocks.db.mock.results[0].value.from).not.toHaveBeenCalled();
    expect(mocks.locate).not.toHaveBeenCalled();
  });

  it('does not steal an active processing claim from the first request', async () => {
    const job = {
      id: JOB_ID,
      status: 'processing',
      uploaded_by: ADMIN.sub,
      processing_started_at: new Date().toISOString(),
    };
    mocks.load.mockResolvedValue({ job, error: null });

    const response = await confirmImport(new Request('http://localhost'), params());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      success: true,
      pending: true,
      job: { id: JOB_ID, status: 'processing' },
    });
    expect(mocks.db.mock.results[0].value.from).not.toHaveBeenCalled();
  });

  it('requires the original uploader even when the receipt is viewable', async () => {
    const job = { id: JOB_ID, status: 'review_ready', uploaded_by: 'someone-else' };
    mocks.load.mockResolvedValue({ job, error: null });
    mocks.canMutate.mockReturnValue(false);

    const response = await confirmImport(new Request('http://localhost'), params());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Only the uploader can confirm this import',
    });
    expect(mocks.db.mock.results[0].value.from).not.toHaveBeenCalled();
  });
});

type Row = Record<string, unknown>;

function successfulImport(existing: Row[] = []) {
  const leadId = importLeadId(JOB_ID, 0);
  const job = {
    id: JOB_ID, status: 'review_ready', uploaded_by: ADMIN.sub,
    uploaded_by_name: 'Setter', uploaded_by_role: 'setter', market_id: 1,
    filename: 'leads.csv', confirmed_at: null,
    confirmation_plan: { [leadId]: null },
  };
  mocks.load.mockResolvedValueOnce({ job, error: null })
    .mockResolvedValueOnce({ job: { ...job, status: 'processing' }, error: null })
    .mockResolvedValueOnce({ job: { ...job, status: 'completed' }, error: null });
  mocks.download.mockResolvedValue(new TextEncoder().encode(
    'First Name,Last Name,Property Address,City,State,Zip\nAda,Lovelace,1 Main St,Phoenix,AZ,85001'
  ));
  const rows = [...existing];
  const receiptUpdates: Row[] = [];
  const database = {
    from(table: string) {
      let operation = 'select';
      let values: Row[] = [];
      let count = false;
      const query: Record<string, unknown> = {};
      query.select = (_columns: string, options?: { count?: string }) => {
        count = !!options?.count;
        return query;
      };
      for (const method of ['eq', 'or', 'limit', 'in']) query[method] = () => query;
      query.update = (patch: Row) => {
        operation = 'update';
        values = [patch];
        return query;
      };
      query.upsert = (batch: Row[], options: { ignoreDuplicates: boolean }) => {
        expect(options.ignoreDuplicates).toBe(true);
        operation = 'upsert';
        values = batch;
        return query;
      };
      const execute = () => {
        if (table === 'leads' && operation === 'upsert') {
          for (const row of values) if (!rows.some((saved) => saved.id === row.id)) rows.push(row);
        }
        if (table === 'lead_import_batches' && operation === 'update') receiptUpdates.push(values[0]);
        return {
          data: table === 'lead_import_batches' ? { id: JOB_ID } : rows,
          error: null,
          count: count ? rows.filter((row) => row.latitude == null || row.longitude == null).length : null,
        };
      };
      query.maybeSingle = async () => execute();
      query.then = (resolve: (result: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve);
      return query;
    },
  };
  mocks.db.mockReturnValue(database);
  return { leadId, rows, receiptUpdates };
}

describe('automatic locations during confirmation', () => {
  it('saves the matched coordinates with newly imported leads', async () => {
    const { leadId, rows, receiptUpdates } = successfulImport();
    mocks.locate.mockResolvedValue({
      locations: new Map([[leadId, { latitude: 33.4, longitude: -112.1 }]]),
      unmatchedIds: [], error: null,
    });

    const response = await confirmImport(new Request('http://localhost'), params());

    expect(response.status).toBe(200);
    expect(mocks.locate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: leadId, address_street: '1 Main St', is_flagged_duplicate: false }),
    ]), 1);
    expect(rows[0]).toMatchObject({ id: leadId, latitude: 33.4, longitude: -112.1 });
    expect(receiptUpdates.at(-1)).toMatchObject({ status: 'completed', preview_errors: [] });
  });

  it('completes the import and records a location warning when the service fails', async () => {
    const { rows, receiptUpdates } = successfulImport();
    mocks.locate.mockRejectedValue(new Error('Service unavailable'));

    const response = await confirmImport(new Request('http://localhost'), params());

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(receiptUpdates.at(-1)).toMatchObject({
      status: 'completed',
      preview_errors: [expect.stringContaining('1 lead still needs a map location')],
    });
  });

  it('keeps a saved location and edited address when confirmation is resumed', async () => {
    const leadId = importLeadId(JOB_ID, 0);
    const saved = { id: leadId, import_batch_id: JOB_ID, address_street: 'Edited address', latitude: 34, longitude: -113 };
    const { rows } = successfulImport([saved]);
    mocks.locate.mockResolvedValue({
      locations: new Map([[leadId, { latitude: 33.4, longitude: -112.1 }]]),
      unmatchedIds: [], error: null,
    });

    const response = await confirmImport(new Request('http://localhost'), params());

    expect(response.status).toBe(200);
    expect(rows).toEqual([saved]);
  });
});
