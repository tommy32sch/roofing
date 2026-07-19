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

interface StreetGroup {
  street: string;
  city: string | null;
  count: number;
  total_value: number;
}

interface StreetSelectSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: { status: string; priority: string; search: string };
  /** Street names currently in the active filter */
  selectedStreets: string[];
  onToggleStreet: (streetName: string, selected: boolean) => void;
  onClear: () => void;
}

export function StreetSelectSheet({
  open,
  onOpenChange,
  filters,
  selectedStreets,
  onToggleStreet,
  onClear,
}: StreetSelectSheetProps) {
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

  const selected = new Set(selectedStreets);
  const visibleStreets = filter
    ? streets.filter((s) => `${s.street} ${s.city ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
    : streets;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="p-4">
        <SheetHeader className="p-0">
          <SheetTitle>Filter by street</SheetTitle>
          <SheetDescription>
            Check streets to show only their leads. Combines with your other filters.
          </SheetDescription>
        </SheetHeader>

        <Input placeholder="Find a street..." value={filter} onChange={(e) => setFilter(e.target.value)} />

        <div className="flex-1 overflow-y-auto rounded-md border divide-y">
          {loading && <p className="p-3 text-sm text-muted-foreground">Loading...</p>}
          {!loading && visibleStreets.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              {streets.length === 0 ? 'No streets found for the current filters.' : 'No streets match.'}
            </p>
          )}
          {!loading &&
            visibleStreets.map((s) => (
              <label
                key={`${s.street}|${s.city ?? ''}`}
                className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
              >
                <Checkbox
                  checked={selected.has(s.street)}
                  onCheckedChange={(checked) => onToggleStreet(s.street, checked === true)}
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
            <button onClick={onClear} className="underline hover:text-foreground">
              Clear
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
