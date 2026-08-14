import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  db: vi.fn(),
  load: vi.fn(),
  canMutate: vi.fn(),
  view: vi.fn(),
  assignDuplicates: vi.fn(),
}));

vi.mock('@/lib/auth/jwt', () => ({ getAuthenticatedAdmin: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ db: mocks.db }));
vi.mock('@/lib/leads/dedupe', () => ({ assignImportDuplicates: mocks.assignDuplicates }));
vi.mock('@/lib/leads/import-job.server', () => ({
  loadImportJob: mocks.load,
  canMutateImportJob: mocks.canMutate,
  importJobView: mocks.view,
  downloadImportFile: vi.fn(),
  markImportJobFailed: vi.fn(),
  previewDatabaseValues: vi.fn(),
}));

import { POST as confirmImport } from '@/app/api/admin/import/[jobId]/confirm/route';

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
