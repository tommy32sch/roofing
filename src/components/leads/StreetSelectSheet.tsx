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
import { buildLeadQueueSearchParams, type LeadQueueParams } from '@/lib/leads/work-queue';

interface StreetGroup {
  street: string;
  city: string | null;
  count: number;
  total_value: number;
}

interface StreetSelectSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: LeadQueueParams;
  /** Street names currently in the active filter */
  selectedStreets: string[];
  onToggleStreet: (streetName: string, selected: boolean) => void;
  onClear: () => void;
}

function StreetSelectContent({
  filterQuery,
  selectedStreets,
  onToggleStreet,
  onClear,
}: {
  filterQuery: string;
  selectedStreets: string[];
  onToggleStreet: (streetName: string, selected: boolean) => void;
  onClear: () => void;
}) {
  const [streets, setStreets] = useState<StreetGroup[]>([]);
  const [noStreetCount, setNoStreetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/leads/streets?${filterQuery}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStreets(data.streets);
          setNoStreetCount(data.no_street_count);
        } else {
          toast.error(data.error || 'Failed to load streets');
        }
      })
      .catch((cause) => {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
          toast.error('Failed to load streets');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filterQuery]);

  const selected = new Set(selectedStreets);
  const visibleStreets = filter
    ? streets.filter((street) => `${street.street} ${street.city ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
    : streets;

  return (
    <>
      <Input placeholder="Find a street…" value={filter} onChange={(event) => setFilter(event.target.value)} />

      <div className="flex-1 divide-y overflow-y-auto rounded-md border" aria-busy={loading}>
        {loading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
        {!loading && visibleStreets.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            {streets.length === 0 ? 'No streets found for the current filters.' : 'No streets match.'}
          </p>
        )}
        {!loading && visibleStreets.map((street) => (
          <label
            key={`${street.street}|${street.city ?? ''}`}
            className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
          >
            <Checkbox
              checked={selected.has(street.street)}
              onCheckedChange={(checked) => onToggleStreet(street.street, checked === true)}
            />
            <span className="min-w-0 flex-1 truncate">
              {street.street}{street.city ? `, ${street.city}` : ''}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {street.count} lead{street.count !== 1 ? 's' : ''}
              {street.total_value > 0 ? ` · $${street.total_value.toLocaleString()}` : ''}
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {selectedStreets.length > 0
            ? `${selectedStreets.length} street${selectedStreets.length !== 1 ? 's' : ''} filtered`
            : 'No street filter active'}
          {noStreetCount > 0 ? ` · ${noStreetCount} lead${noStreetCount !== 1 ? 's' : ''} without a street` : ''}
        </span>
        {selectedStreets.length > 0 && (
          <button type="button" onClick={onClear} className="underline hover:text-foreground">
            Clear
          </button>
        )}
      </div>
    </>
  );
}

export function StreetSelectSheet({
  open,
  onOpenChange,
  filters,
  selectedStreets,
  onToggleStreet,
  onClear,
}: StreetSelectSheetProps) {
  // The endpoint intentionally excludes the selected-street clause. Remove it
  // from the request too, so checking a street does not reload the same list.
  const filterQuery = buildLeadQueueSearchParams({ ...filters, streets: undefined }).toString();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-4">
        <SheetHeader className="p-0">
          <SheetTitle>Filter by street</SheetTitle>
          <SheetDescription>
            Check streets to show only their leads. Combines with your other filters.
          </SheetDescription>
        </SheetHeader>

        {open && (
          <StreetSelectContent
            filterQuery={filterQuery}
            selectedStreets={selectedStreets}
            onToggleStreet={onToggleStreet}
            onClear={onClear}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
