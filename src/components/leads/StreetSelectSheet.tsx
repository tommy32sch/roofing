'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

interface StreetLead {
  id: string;
  value: number | null;
}

interface StreetGroup {
  street: string;
  city: string | null;
  count: number;
  total_value: number;
  leads: StreetLead[];
}

interface StreetSelectSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: { status: string; priority: string; search: string };
  selection: Map<string, number>;
  onToggleStreet: (leads: StreetLead[], selected: boolean) => void;
}

export function StreetSelectSheet({ open, onOpenChange, filters, selection, onToggleStreet }: StreetSelectSheetProps) {
  const [streets, setStreets] = useState<StreetGroup[]>([]);
  const [noStreetCount, setNoStreetCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.priority) params.set('priority', filters.priority);
    if (filters.search) params.set('search', filters.search);
    fetch(`/api/admin/leads/streets?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStreets(data.streets);
          setNoStreetCount(data.no_street_count);
        } else {
          toast.error(data.error || 'Failed to load streets');
        }
      })
      .catch(() => toast.error('Failed to load streets'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visibleStreets = filter
    ? streets.filter((s) =>
        `${s.street} ${s.city ?? ''}`.toLowerCase().includes(filter.toLowerCase())
      )
    : streets;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-4">
        <SheetHeader className="p-0">
          <SheetTitle>Select by street</SheetTitle>
          <SheetDescription>
            Streets matching your current filters. Check a street to select all its leads.
          </SheetDescription>
        </SheetHeader>

        <Input
          placeholder="Filter streets..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className="flex-1 overflow-y-auto rounded-md border divide-y">
          {loading && <p className="p-3 text-sm text-muted-foreground">Loading...</p>}
          {!loading && visibleStreets.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              {streets.length === 0 ? 'No streets found for the current filters.' : 'No streets match.'}
            </p>
          )}
          {!loading &&
            visibleStreets.map((s) => {
              const selectedCount = s.leads.filter((l) => selection.has(l.id)).length;
              const allSelected = selectedCount === s.count;
              const someSelected = selectedCount > 0 && !allSelected;
              return (
                <label
                  key={`${s.street}|${s.city ?? ''}`}
                  className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={(checked) => onToggleStreet(s.leads, checked === true)}
                    className="data-indeterminate:border-primary data-indeterminate:bg-primary/30"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {s.street}
                    {s.city ? `, ${s.city}` : ''}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {s.count} lead{s.count !== 1 ? 's' : ''}
                    {s.total_value > 0 ? ` · $${s.total_value.toLocaleString()}` : ''}
                  </span>
                </label>
              );
            })}
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>{selection.size} lead{selection.size !== 1 ? 's' : ''} selected total</p>
          {noStreetCount > 0 && (
            <p>
              {noStreetCount} lead{noStreetCount !== 1 ? 's' : ''} without a street address — select them
              individually from the list.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
