'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { useMarkets } from '@/components/markets/use-markets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ImportJobStatus, ImportJobView } from '@/lib/leads/import-job';
import { cn } from '@/lib/utils';

const FILE_LIMIT_BYTES = 5 * 1024 * 1024;
const IMPORT_STEPS = ['Upload', 'Review', 'Confirm', 'Receipt'] as const;

type ReviewStage = 'review' | 'confirm';

interface ApiResult {
  success?: boolean;
  error?: string;
  code?: string;
  pending?: boolean;
  job?: ImportJobView;
  jobs?: ImportJobView[];
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusLabel(status: ImportJobStatus): string {
  switch (status) {
    case 'review_ready': return 'Ready for review';
    case 'processing': return 'Processing';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return 'Uploaded';
  }
}

function statusVariant(status: ImportJobStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'completed') return 'default';
  if (status === 'failed') return 'destructive';
  if (status === 'processing' || status === 'review_ready') return 'secondary';
  return 'outline';
}

async function readApi(response: Response): Promise<ApiResult> {
  const data = await response.json().catch(() => null) as ApiResult | null;
  if (!data) throw new Error('The server returned an invalid response.');
  return data;
}

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [job, setJob] = useState<ImportJobView | null>(null);
  const [recent, setRecent] = useState<ImportJobView[]>([]);
  const [stage, setStage] = useState<ReviewStage>('review');
  const { markets, homeMarketId, loading: marketsLoading, error: marketsError } = useMarkets();
  const [market, setMarket] = useState('');
  const marketValue = market || (homeMarketId != null ? String(homeMarketId) : '');
  const multiMarket = markets.length > 1;
  const marketMissing = Boolean(marketsError) || (multiMarket && !marketValue);

  const setJobInUrl = useCallback((jobId: string | null) => {
    const url = new URL(window.location.href);
    if (jobId) url.searchParams.set('job', jobId);
    else url.searchParams.delete('job');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, []);

  const refreshJob = useCallback(async (jobId: string, quiet = false) => {
    try {
      const response = await fetch(`/api/admin/import/${jobId}`);
      const data = await readApi(response);
      if (!response.ok || !data.success || !data.job) {
        throw new Error(data.error || 'Could not load the import');
      }
      setJob(data.job);
      setRecent((current) => [data.job!, ...current.filter((item) => item.id !== data.job!.id)]);
      return data.job;
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : 'Could not load the import');
      return null;
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoadingLedger(true);
    try {
      const response = await fetch('/api/admin/import');
      const data = await readApi(response);
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load recent imports');
      const jobs = data.jobs || [];
      setRecent(jobs);
      const requestedId = new URLSearchParams(window.location.search).get('job');
      if (requestedId) {
        await refreshJob(requestedId);
      } else {
        const open = jobs.find((item) => item.status === 'review_ready' || item.status === 'processing');
        if (open) {
          setJob(open);
          setJobInUrl(open.id);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load recent imports');
    } finally {
      setLoadingLedger(false);
    }
  }, [refreshJob, setJobInUrl]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (job?.status !== 'processing') return;
    const timer = window.setInterval(() => {
      void refreshJob(job.id, true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, refreshJob]);

  function chooseFile(selected: File | null) {
    if (!selected) return;
    const name = selected.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      toast.error('Select a CSV, XLS, or XLSX file.');
      return;
    }
    if (selected.size > FILE_LIMIT_BYTES) {
      toast.error('The file is larger than the 5 MB limit.');
      return;
    }
    setFile(selected);
  }

  async function uploadForReview() {
    if (!file || marketMissing) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (marketValue) formData.append('market_id', marketValue);
      const response = await fetch('/api/admin/import', { method: 'POST', body: formData });
      const data = await readApi(response);
      if (data.job) {
        setJob(data.job);
        setRecent((current) => [data.job!, ...current.filter((item) => item.id !== data.job!.id)]);
        setJobInUrl(data.job.id);
      }
      if (!response.ok || !data.success || !data.job) {
        throw new Error(data.error || 'The file could not be prepared for review.');
      }
      setStage('review');
      toast.success('The review is ready. No leads were created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelAndReplace() {
    if (!job) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/import/${job.id}/cancel`, { method: 'POST' });
      const data = await readApi(response);
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not cancel the import');
      if (data.job) {
        setRecent((current) => [data.job!, ...current.filter((item) => item.id !== data.job!.id)]);
      }
      setJob(null);
      setFile(null);
      setStage('review');
      setJobInUrl(null);
      fileRef.current?.focus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not cancel the import');
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!job) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/import/${job.id}/confirm`, { method: 'POST' });
      const data = await readApi(response);
      if (data.job) {
        setJob(data.job);
        setRecent((current) => [data.job!, ...current.filter((item) => item.id !== data.job!.id)]);
      }
      if (!response.ok || !data.success) {
        if (data.code === 'review_changed' && data.job) {
          setStage('review');
        }
        throw new Error(data.error || 'The import could not be confirmed.');
      }
      if (data.job?.status === 'completed') {
        toast.success(`Imported ${data.job.imported} leads.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The import could not be confirmed.');
      if (job) void refreshJob(job.id, true);
    } finally {
      setBusy(false);
    }
  }

  function openRecent(item: ImportJobView) {
    setJob(item);
    setStage('review');
    setJobInUrl(item.id);
  }

  function startAnotherImport() {
    setJob(null);
    setFile(null);
    setStage('review');
    setJobInUrl(null);
  }

  const currentStep = !job
    ? 1
    : job.status === 'completed'
      ? 4
      : job.status === 'review_ready' && stage === 'review'
        ? 2
        : job.status === 'review_ready' || job.status === 'processing'
          ? 3
          : job.status === 'failed' && job.preview
            ? 3
            : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link href="/admin/leads">
          <Button variant="ghost" size="icon" aria-label="Back to leads">
            <ArrowLeft />
          </Button>
        </Link>
        <PageHeader
          title="Import Leads"
          description="Review every file before it creates leads. You can leave and return to an import."
        />
      </div>

      <ol aria-label="Import progress" className="grid grid-cols-4 border-y text-xs sm:text-sm">
        {IMPORT_STEPS.map((label, index) => {
          const step = index + 1;
          const complete = step < currentStep;
          const active = step === currentStep;
          return (
            <li
              key={label}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 border-r px-2 py-3 last:border-r-0 sm:px-4',
                active && 'bg-muted font-medium text-foreground',
                !active && !complete && 'text-muted-foreground'
              )}
            >
              <span className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                (complete || active) && 'border-primary bg-primary text-primary-foreground'
              )}>
                {complete ? <Check className="size-3" /> : step}
              </span>
              <span className="truncate">{label}</span>
            </li>
          );
        })}
      </ol>

      {!job && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Upload a source file</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div
              role="button"
              tabIndex={0}
              aria-label={file ? `Replace ${file.name}` : 'Choose a lead file'}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={(event) => {
                event.preventDefault();
                if (event.currentTarget === event.target) setDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                chooseFile(event.dataTransfer.files?.[0] || null);
              }}
              className={cn(
                'cursor-pointer border-2 border-dashed p-8 text-center outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/50',
                dragActive ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
              )}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(event) => chooseFile(event.target.files?.[0] || null)}
                className="sr-only"
              />
              {file ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <FileSpreadsheet className="size-5 text-primary" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                  <span className="text-xs text-primary">Select or drop another file to replace it</span>
                </div>
              ) : (
                <div>
                  <Upload className="mx-auto mb-2 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop a file here, or select a file</p>
                  <p className="mt-1 text-xs text-muted-foreground">CSV, XLS, or XLSX · 5 MB · up to 5,000 data rows</p>
                </div>
              )}
            </div>

            {!marketsLoading && multiMarket && (
              <div className="space-y-1">
                <label htmlFor="import_market" className="text-sm font-medium">
                  Market<span className="ml-0.5 text-destructive">*</span>
                </label>
                <Select value={marketValue} onValueChange={(value) => value && setMarket(value)}>
                  <SelectTrigger id="import_market" className="w-full">
                    <SelectValue placeholder="Choose the office for this file" />
                  </SelectTrigger>
                  <SelectContent>
                    {markets.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Every lead in this file will use this market.</p>
              </div>
            )}

            {marketsError && (
              <div role="alert" className="border border-destructive/30 bg-destructive/5 p-3 text-sm">
                Office data did not load. Retry from the workspace notice before you upload.
              </div>
            )}

            <div className="grid gap-3 border-y py-4 text-xs text-muted-foreground md:grid-cols-3">
              <div>
                <p className="font-medium text-foreground">A usable name is required</p>
                <p>Rows without any usable owner name are shown and skipped.</p>
              </div>
              <div>
                <p className="font-medium text-foreground">DNC numbers are removed</p>
                <p>The lead stays available for door work when every phone is marked DNC.</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Duplicates are flagged</p>
                <p>Address or parcel matches are imported for review. Existing data is not overwritten.</p>
              </div>
            </div>

            <Button onClick={uploadForReview} disabled={!file || busy || marketMissing} className="w-full">
              {busy ? <><Loader2 className="animate-spin" /> Preparing review…</> : 'Upload and review'}
            </Button>
          </CardContent>
        </Card>
      )}

      {job?.status === 'review_ready' && stage === 'review' && job.preview && (
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">2. Review detected data</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{job.filename} · {job.marketName || 'No market'}</p>
              </div>
              <Badge variant="secondary">No leads created</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 pt-5">
            <div className="grid grid-cols-2 divide-x divide-y border sm:grid-cols-5 sm:divide-y-0">
              {[
                ['Rows', job.preview.totalRows],
                ['Valid', job.preview.validRows],
                ['Missing names', job.preview.missingRequired],
                ['Duplicate matches', job.preview.duplicateCandidates],
                ['DNC-only', job.preview.dncOnlyRows],
              ].map(([label, value]) => (
                <div key={label} className="px-3 py-3">
                  <p className="text-xl font-semibold tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            <section className="space-y-2">
              <h2 className="text-sm font-medium">Column mapping</h2>
              <div className="max-h-56 overflow-auto border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted text-muted-foreground">
                    <tr><th className="px-3 py-2 font-medium">Source column</th><th className="px-3 py-2 font-medium">Imported as</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {job.fieldMappings.map((mapping, index) => (
                      <tr key={`${mapping.source}-${index}`}>
                        <td className="px-3 py-2">{mapping.source}</td>
                        <td className={cn('px-3 py-2', !mapping.recognized && 'text-muted-foreground')}>
                          {mapping.recognized ? mapping.target.replaceAll('_', ' ') : 'Not used'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-medium">Row sample</h2>
              <div className="overflow-x-auto border">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Property</th>
                      <th className="px-3 py-2 font-medium">Handling</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {job.sample.map((sample) => (
                      <tr key={sample.row}>
                        <td className="px-3 py-2 tabular-nums">{sample.row}</td>
                        <td className="px-3 py-2 font-medium">{sample.firstName} {sample.lastName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{sample.address || 'No property address'}</td>
                        <td className="px-3 py-2">
                          {[sample.isDuplicateCandidate && 'Flag duplicate', sample.isDncOnly && 'Door work only']
                            .filter(Boolean).join(' · ') || 'Import'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {job.errors.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-sm font-medium">Rows that will be skipped</h2>
                <div className="max-h-40 overflow-y-auto border bg-muted/30 p-3">
                  {job.errors.map((error, index) => <p key={index} className="text-xs text-muted-foreground">{error}</p>)}
                </div>
              </section>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="outline" onClick={cancelAndReplace} disabled={busy}>
                <X /> Cancel and replace file
              </Button>
              <Button onClick={() => setStage('confirm')}>Continue to confirmation</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {job?.status === 'review_ready' && stage === 'confirm' && job.preview && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">3. Confirm this import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between border-b pb-3"><span>Leads to create</span><strong>{job.preview.willImport}</strong></div>
              <div className="flex items-center justify-between border-b pb-3"><span>Rows to skip for missing names</span><strong>{job.preview.missingRequired}</strong></div>
              <div className="flex items-center justify-between border-b pb-3"><span>Leads flagged as duplicate candidates</span><strong>{job.preview.duplicateCandidates}</strong></div>
              <div className="flex items-center justify-between border-b pb-3"><span>Leads kept for door work only</span><strong>{job.preview.dncOnlyRows}</strong></div>
            </div>
            <div className="border-l-2 border-primary bg-muted/40 p-3 text-sm">
              <p className="font-medium">This action creates leads.</p>
              <p className="mt-1 text-muted-foreground">
                DNC numbers stay removed. Duplicate candidates are created with a review flag. A retry uses this same receipt and cannot create a second batch.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button variant="outline" onClick={() => setStage('review')} disabled={busy}>Back to review</Button>
              <Button onClick={confirmImport} disabled={busy}>
                {busy ? <><Loader2 className="animate-spin" /> Confirming…</> : `Confirm ${job.preview.willImport} leads`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {job?.status === 'processing' && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="size-7 animate-spin text-primary" />
            <div>
              <p className="font-medium">Confirmation is in progress</p>
              <p className="text-sm text-muted-foreground">You can leave this page. This receipt will stay in Recent imports.</p>
            </div>
            {job.canRetryConfirmation && (
              <Button variant="outline" onClick={confirmImport} disabled={busy}>
                <RotateCcw /> Resume confirmation
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {job?.status === 'completed' && (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-green-600" />
              <CardTitle className="text-base">4. Import receipt</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">File</dt><dd className="font-medium">{job.filename}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Uploader</dt><dd className="font-medium">{job.uploadedByName}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Market</dt><dd>{job.marketName || 'No market'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Uploaded</dt><dd>{formatDate(job.createdAt)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Confirmed</dt><dd>{formatDate(job.confirmedAt)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Completed</dt><dd>{formatDate(job.completedAt)}</dd></div>
            </dl>
            <div className="grid grid-cols-2 divide-x divide-y border sm:grid-cols-4 sm:divide-y-0">
              {[
                ['Imported', job.imported],
                ['Skipped', job.skipped],
                ['Flagged duplicates', job.duplicates],
                ['DNC-only', job.dnc],
              ].map(([label, value]) => (
                <div key={label} className="px-3 py-3">
                  <p className="text-xl font-semibold tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            {job.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto border bg-muted/30 p-3">
                {job.errors.map((error, index) => <p key={index} className="text-xs text-muted-foreground">{error}</p>)}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href={`/admin/leads?import_batch_id=${job.id}`}>
                <Button>View imported leads</Button>
              </Link>
              <Button variant="outline" onClick={startAnotherImport}>Import another file</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The private source file is kept for 30 days. This receipt stays after the file is removed.
            </p>
          </CardContent>
        </Card>
      )}

      {job?.status === 'failed' && (
        <Card className="border-destructive/30">
          <CardContent className="space-y-4 py-6">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">This import failed</p>
                <p className="mt-1 text-sm text-muted-foreground">{job.failureDetail || 'The import could not be processed.'}</p>
                {job.imported > 0 && (
                  <p className="mt-2 text-sm font-medium">
                    {job.imported} lead{job.imported === 1 ? '' : 's'} already use this receipt. Retry confirmation to finish safely.
                  </p>
                )}
                <p className="mt-2 text-xs text-muted-foreground">Receipt {job.id}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {job.canRetryConfirmation && (
                <Button onClick={confirmImport} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry confirmation
                </Button>
              )}
              {!job.canRetryConfirmation && (
                <Button variant="outline" onClick={startAnotherImport}>Start a new import</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {job?.status === 'cancelled' && (
        <Card>
          <CardContent className="space-y-3 py-6">
            <p className="font-medium">This import was cancelled</p>
            <p className="text-sm text-muted-foreground">No leads were created from {job.filename}.</p>
            <Button variant="outline" onClick={startAnotherImport}>Start a new import</Button>
          </CardContent>
        </Card>
      )}

      {job?.status === 'uploaded' && (
        <Card>
          <CardContent className="space-y-3 py-6">
            <p className="font-medium">Review preparation was interrupted</p>
            <p className="text-sm text-muted-foreground">
              The private file was stored, but its review did not finish. Cancel this job and upload the file again.
            </p>
            <Button variant="outline" onClick={cancelAndReplace} disabled={busy}>
              <X /> Cancel and replace file
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">Recent imports</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingLedger ? (
            <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 className="animate-spin" /> Loading imports…</div>
          ) : recent.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No import receipts yet.</p>
          ) : (
            <div className="divide-y">
              {recent.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openRecent(item)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.marketName || 'No market'} · {formatDate(item.createdAt)}
                      {item.status === 'completed' ? ` · ${item.imported} imported` : ''}
                    </p>
                  </div>
                  <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
