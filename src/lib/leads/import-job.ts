import { createHash } from 'crypto';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseLeadCSV } from '@/lib/csv/parser';
import { FIELD_MAP, type NormalizedLead } from '@/lib/leads/normalize';
import { LIMITS } from '@/lib/utils/validation';

export const IMPORT_STORAGE_BUCKET = 'lead-imports';
export const IMPORT_FILE_RETENTION_DAYS = 30;
export const IMPORT_PREVIEW_SAMPLE_SIZE = 10;
export const IMPORT_PREVIEW_ERROR_LIMIT = 25;
export const IMPORT_PROCESSING_STALE_MS = 10 * 60 * 1000;

export const IMPORT_JOB_STATUSES = [
  'uploaded',
  'review_ready',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;

export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export interface ImportColumnMapping {
  source: string;
  target: string;
  recognized: boolean;
}

export interface ImportPreviewSummary {
  totalRows: number;
  validRows: number;
  missingRequired: number;
  duplicateCandidates: number;
  dncOnlyRows: number;
  willImport: number;
}

export interface ImportPreviewSample {
  row: number;
  firstName: string;
  lastName: string;
  address: string | null;
  isDuplicateCandidate: boolean;
  isDncOnly: boolean;
}

export interface ParsedImportFile {
  leads: NormalizedLead[];
  leadRows: number[];
  errors: string[];
  skipped: number;
  sourceColumns: string[];
  fieldMappings: ImportColumnMapping[];
}

export interface ImportJobView {
  id: string;
  status: ImportJobStatus;
  filename: string;
  uploadedBy: string | null;
  uploadedByName: string;
  marketId: number | null;
  marketName: string | null;
  fileSizeBytes: number | null;
  sourceColumns: string[];
  fieldMappings: ImportColumnMapping[];
  preview: ImportPreviewSummary | null;
  sample: ImportPreviewSample[];
  errors: string[];
  imported: number;
  skipped: number;
  duplicates: number;
  dnc: number;
  failureCode: string | null;
  failureDetail: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  processingStartedAt: string | null;
  canRetryConfirmation: boolean;
  retentionExpiresAt: string | null;
  fileDeletedAt: string | null;
}

export class ImportJobError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = 'ImportJobError';
  }
}

function normalizedHeader(header: string): string {
  return header
    .replace(/[^\x20-\x7E]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Describe the exact production mapping without parsing data in the browser. */
export function mapImportColumn(header: string): ImportColumnMapping {
  const normalized = normalizedHeader(header);
  const direct = FIELD_MAP[normalized] || FIELD_MAP[header.toLowerCase().trim()];
  if (direct) return { source: header, target: direct, recognized: true };

  const phone = normalized.match(/^phone\s*(\d+)$/);
  if (phone) {
    return { source: header, target: `phone${phone[1]}`, recognized: true };
  }

  const phoneDnc = normalized.match(/^phone\s*(\d+)\s*dnc$/);
  if (phoneDnc) {
    return { source: header, target: `phone${phoneDnc[1]}_dnc`, recognized: true };
  }

  return {
    source: header,
    target: normalized.replace(/\s+/g, '_') || 'ignored',
    recognized: false,
  };
}

export function validateImportFilename(filename: string): 'csv' | 'xlsx' | 'xls' {
  const extension = filename.toLowerCase().split('.').pop();
  if (extension === 'csv' || extension === 'xlsx' || extension === 'xls') return extension;
  throw new ImportJobError('unsupported_file', 'Select a CSV, XLS, or XLSX file.');
}

function workbookToCsv(bytes: Uint8Array): string {
  const workbook = XLSX.read(bytes, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new ImportJobError('empty_workbook', 'The workbook does not contain a sheet.');
  }
  return XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
}

function detectedColumns(csvText: string): string[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    preview: 1,
    skipEmptyLines: true,
  });
  return (result.meta.fields || []).map((field) => field.trim()).filter(Boolean);
}

/**
 * The only file-to-leads parser used by both review and confirmation.
 * Confirmation downloads the stored original and calls this function again.
 */
export function parseImportFile(bytes: Uint8Array, filename: string): ParsedImportFile {
  const extension = validateImportFilename(filename);
  const csvText = extension === 'csv'
    ? new TextDecoder('utf-8').decode(bytes)
    : workbookToCsv(bytes);
  const parsed = parseLeadCSV(csvText);
  const sourceColumns = detectedColumns(csvText);

  if (sourceColumns.length === 0) {
    throw new ImportJobError('missing_header', 'The file does not contain a header row.');
  }

  const totalRows = parsed.leads.length + parsed.skipped;
  if (totalRows > LIMITS.BULK_IMPORT_MAX) {
    throw new ImportJobError(
      'too_many_rows',
      `The file has ${totalRows} rows. The maximum is ${LIMITS.BULK_IMPORT_MAX}.`
    );
  }

  if (parsed.leads.length === 0) {
    throw new ImportJobError('no_valid_leads', 'No valid leads were found in the file.');
  }

  return {
    ...parsed,
    sourceColumns,
    fieldMappings: sourceColumns.map(mapImportColumn),
  };
}

/** Stable IDs make a retried confirmation an upsert of the same rows. */
export function importLeadId(jobId: string, rowIndex: number): string {
  const bytes = createHash('sha256').update(`${jobId}:lead:${rowIndex}`).digest().subarray(0, 16);
  // Keep the app's UUID-v4 route contract while deriving the payload from the
  // job and row. The deterministic payload, not the version nibble, gives the
  // retry guarantee.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function importActivityId(jobId: string, rowIndex: number): string {
  const bytes = createHash('sha256').update(`${jobId}:activity:${rowIndex}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function importFileHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function importStoragePath(uploaderId: string, jobId: string, filename: string): string {
  const extension = validateImportFilename(filename);
  return `${uploaderId}/${jobId}/source.${extension}`;
}

export function importRetentionExpiry(now = new Date()): string {
  return new Date(now.getTime() + IMPORT_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function createImportPreview(
  jobId: string,
  parsed: ParsedImportFile,
  duplicateAssignments: Map<string, string | null>
): {
  summary: ImportPreviewSummary;
  sample: ImportPreviewSample[];
  errors: string[];
} {
  const duplicateCandidates = [...duplicateAssignments.values()].filter(Boolean).length;
  const dncOnlyRows = parsed.leads.filter((lead) => lead.is_dnc).length;
  const summary: ImportPreviewSummary = {
    totalRows: parsed.leads.length + parsed.skipped,
    validRows: parsed.leads.length,
    missingRequired: parsed.skipped,
    duplicateCandidates,
    dncOnlyRows,
    willImport: parsed.leads.length,
  };
  const sample = parsed.leads.slice(0, IMPORT_PREVIEW_SAMPLE_SIZE).map((lead, index) => {
    const id = importLeadId(jobId, index);
    const address = [lead.address_street, lead.address_city, lead.address_state]
      .filter(Boolean)
      .join(', ') || null;
    return {
      row: parsed.leadRows[index] ?? index + 2,
      firstName: lead.first_name,
      lastName: lead.last_name,
      address,
      isDuplicateCandidate: duplicateAssignments.get(id) != null,
      isDncOnly: lead.is_dnc,
    };
  });

  return {
    summary,
    sample,
    errors: parsed.errors.slice(0, IMPORT_PREVIEW_ERROR_LIMIT),
  };
}

export function importPreviewMatches(
  stored: ImportPreviewSummary | null,
  current: ImportPreviewSummary
): boolean {
  if (!stored) return false;
  return (
    stored.totalRows === current.totalRows
    && stored.validRows === current.validRows
    && stored.missingRequired === current.missingRequired
    && stored.duplicateCandidates === current.duplicateCandidates
    && stored.dncOnlyRows === current.dncOnlyRows
    && stored.willImport === current.willImport
  );
}

export function confirmationPlan(assignments: Map<string, string | null>): Record<string, string | null> {
  return Object.fromEntries(assignments.entries());
}

export function assignmentsFromConfirmationPlan(
  value: unknown,
  expectedIds: string[]
): Map<string, string | null> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  const result = new Map<string, string | null>();
  for (const id of expectedIds) {
    const duplicateId = plan[id];
    if (duplicateId !== null && typeof duplicateId !== 'string') return null;
    result.set(id, duplicateId);
  }
  return result;
}

export function processingCanResume(startedAt: string | null, now = new Date()): boolean {
  if (!startedAt) return true;
  const started = Date.parse(startedAt);
  return !Number.isFinite(started) || now.getTime() - started >= IMPORT_PROCESSING_STALE_MS;
}
