'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMarkets } from '@/components/markets/use-markets';

export default function ImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const { markets, homeMarketId, loading: marketsLoading } = useMarkets();
  const [market, setMarket] = useState('');
  // Default to the importer's own office; they can switch before uploading.
  const marketValue = market || (homeMarketId != null ? String(homeMarketId) : '');
  const multiMarket = markets.length > 1;
  // With more than one office the list MUST be attributed, since a street-only
  // storm list carries nothing that could identify it later.
  const marketMissing = multiMarket && !marketValue;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) {
      const name = selected.name.toLowerCase();
      if (!name.endsWith('.csv') && !name.endsWith('.xlsx') && !name.endsWith('.xls')) {
        toast.error('Please select a CSV or Excel file');
        return;
      }
      setFile(selected);
      setResult(null);
    }
  }

  async function handleImport() {
    if (!file) return;

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (marketValue) formData.append('market_id', marketValue);

      const res = await fetch('/api/admin/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      setResult({
        imported: data.imported || 0,
        skipped: data.skipped || 0,
        errors: data.errors || [],
      });

      if (data.success && data.imported > 0) {
        toast.success(`Imported ${data.imported} leads`);
      } else if (!data.success) {
        toast.error(data.error || 'Import failed');
      }
    } catch {
      toast.error('Import failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/leads">
          <Button variant="ghost" size="icon" aria-label="Back to leads">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <PageHeader
          title="Import Leads"
          description="Upload a CSV or Excel file. Duplicates and Do Not Call numbers are handled automatically."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload CSV or Excel File</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                <span className="font-medium">{file.name}</span>
                <span className="text-sm text-muted-foreground">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
            ) : (
              <div>
                <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Click to select a CSV or Excel file, or drag and drop
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="space-y-1">
              <p className="font-medium text-foreground">Columns we read</p>
              <p>
                Name, address (street/city/state/zip), email, phone, plus property data —
                home value, year built, sq ft, roof age, roof type, last sale, APN, notes.
              </p>
              <p>
                Headers are flexible: common variations from PropStream, BatchLeads and
                similar skip-trace exports are auto-detected. CSV, XLS and XLSX all work.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Multiple phones &amp; Do Not Call</p>
              <p>
                <span className="font-medium">Phone 1</span> through{' '}
                <span className="font-medium">Phone 5</span> are read, each with its own{' '}
                <span className="font-medium">Phone N DNC</span> column. Any number flagged
                DNC is <span className="font-medium">never stored</span> — the rest of the
                lead still imports so you can door-knock it. Up to three callable numbers
                are kept per lead.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Duplicates</p>
              <p>
                Matched on the property address (or parcel number), not the phone number.
                Duplicates are flagged for review — never deleted, and nothing is
                overwritten.
              </p>
            </div>
          </div>

          {/* Which office this list belongs to. Not derivable from the file —
              street-only storm lists have no city or state at all — so it is
              asked for up front rather than guessed. */}
          {!marketsLoading && multiMarket && (
            <div className="space-y-1">
              <label htmlFor="import_market" className="text-sm font-medium">
                Market<span className="ml-0.5 text-destructive">*</span>
              </label>
              <Select value={marketValue} onValueChange={(v) => v && setMarket(v)}>
                <SelectTrigger id="import_market" className="w-full">
                  <SelectValue placeholder="Choose the office this list is for" />
                </SelectTrigger>
                <SelectContent>
                  {markets.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Every lead in this file is assigned to this office.
              </p>
            </div>
          )}

          {/* Reads as a live CTA otherwise, even though it's disabled until a file is chosen */}
          <Button onClick={handleImport} disabled={!file || loading || marketMissing} className="w-full">
            {loading
              ? 'Importing…'
              : marketMissing
                ? 'Choose a market first'
                : file
                  ? `Import ${file.name}`
                  : 'Choose a file to import'}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">{result.imported} imported</span>
              </div>
              {result.skipped > 0 && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm">{result.skipped} skipped</span>
                </div>
              )}
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-md bg-muted p-3 max-h-40 overflow-y-auto">
                {result.errors.map((err, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{err}</p>
                ))}
              </div>
            )}
            {result.imported > 0 && (
              <Link href="/admin/leads">
                <Button variant="outline" size="sm">View Leads</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
