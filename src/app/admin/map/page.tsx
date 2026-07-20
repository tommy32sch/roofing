'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { BoxSelect, UserCheck, LocateFixed } from 'lucide-react';
import { toast } from 'sonner';
import type { Map as LeafletMap } from 'leaflet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BulkAssignDialog } from '@/components/leads/BulkAssignDialog';
import { STATUS_COLORS, DNC_RING_COLOR, type GeoLead } from '@/components/leads/map-constants';
import { LEAD_STATUS_OPTIONS, LEAD_PRIORITY_OPTIONS } from '@/types';
import type { UserRole } from '@/types';
import { LIMITS } from '@/lib/utils/validation';

// Leaflet touches `window` at import time — client-only
const LeadMap = dynamic(() => import('@/components/leads/LeadMap'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-md" />,
});

export default function MapPage() {
  const [leads, setLeads] = useState<GeoLead[]>([]);
  const [missingCoords, setMissingCoords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [userRole, setUserRole] = useState<UserRole>('setter');
  const [selection, setSelection] = useState<Map<string, number>>(new Map());
  const [assignOpen, setAssignOpen] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeStatus, setGeocodeStatus] = useState('');
  const mapRef = useRef<LeafletMap | null>(null);
  const isAdmin = userRole === 'admin';

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (priority) params.set('priority', priority);
    try {
      const res = await fetch(`/api/admin/leads/geo?${params}`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads);
        setMissingCoords(data.missing_coords);
      }
    } catch {
      // Failed to fetch
    } finally {
      setLoading(false);
    }
  }, [status, priority]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetch('/api/admin/auth/me')
      .then((r) => r.json())
      .then((d) => { if (d.success) setUserRole(d.admin.role); })
      .catch(() => {});
  }, []);

  const toggleSelect = useCallback((lead: GeoLead) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.set(lead.id, Number(lead.estimated_roof_value) || 0);
      return next;
    });
  }, []);

  function selectVisible() {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    setSelection((prev) => {
      const next = new Map(prev);
      for (const lead of leads) {
        if (bounds.contains([lead.latitude, lead.longitude])) {
          next.set(lead.id, Number(lead.estimated_roof_value) || 0);
        }
      }
      return next;
    });
  }

  async function geocodeMissing() {
    setGeocoding(true);
    let cursor: string | null = null;
    let totalGeocoded = 0;
    try {
      // Loop batches until the endpoint reports it reached the end
      for (;;) {
        const res = await fetch('/api/admin/leads/geocode-missing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ after: cursor }),
        });
        const data: {
          success: boolean;
          geocoded: number;
          nextCursor: string | null;
          remaining: number;
          done: boolean;
          error?: string;
        } = await res.json();
        if (!data.success) {
          toast.error(data.error || 'Geocoding failed');
          break;
        }
        totalGeocoded += data.geocoded;
        cursor = data.nextCursor;
        setMissingCoords(data.remaining);
        setGeocodeStatus(`Geocoded ${totalGeocoded}... ${data.remaining} left`);
        if (data.done) break;
      }
      if (totalGeocoded > 0) {
        toast.success(`Placed ${totalGeocoded} lead${totalGeocoded !== 1 ? 's' : ''} on the map`);
        await fetchLeads();
      } else {
        toast.info('No new leads could be geocoded (check their addresses)');
      }
    } catch {
      toast.error('Geocoding stopped unexpectedly');
    } finally {
      setGeocoding(false);
      setGeocodeStatus('');
    }
  }

  const selectionTotal = [...selection.values()].reduce((sum, v) => sum + v, 0);

  return (
    <div className="flex flex-col gap-3 h-[calc(100dvh-160px)] min-h-[400px]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">Map</h1>
        <div className="flex gap-2 items-center flex-wrap">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={selectVisible} disabled={loading || leads.length === 0}>
              <BoxSelect className="h-4 w-4 mr-1" />
              Select visible
            </Button>
          )}
          <Select value={status} onValueChange={(v) => setStatus(v === 'all' ? '' : v ?? '')}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {LEAD_STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={(v) => setPriority(v === 'all' ? '' : v ?? '')}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              {LEAD_PRIORITY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {(missingCoords > 0 || geocoding) && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-xs flex-wrap">
          <span className="text-muted-foreground">
            {geocoding
              ? geocodeStatus || 'Geocoding leads...'
              : `${missingCoords} lead${missingCoords !== 1 ? 's' : ''} not on the map yet (no coordinates).`}
          </span>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={geocodeMissing} disabled={geocoding}>
              <LocateFixed className={`h-4 w-4 mr-1 ${geocoding ? 'animate-pulse' : ''}`} />
              {geocoding ? 'Geocoding...' : 'Geocode missing'}
            </Button>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-3 flex-wrap text-xs text-muted-foreground">
        {LEAD_STATUS_OPTIONS.map((opt) => (
          <span key={opt.value} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[opt.value] }}
            />
            {opt.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border-2 bg-transparent"
            style={{ borderColor: DNC_RING_COLOR }}
          />
          Do Not Call (knock only)
        </span>
      </div>

      <div className="flex-1 min-h-0 isolate">
        {loading && leads.length === 0 ? (
          <Skeleton className="h-full w-full rounded-md" />
        ) : (
          <LeadMap
            leads={leads}
            selectedIds={new Set(selection.keys())}
            onToggleSelect={isAdmin ? toggleSelect : undefined}
            onMapReady={(map) => { mapRef.current = map; }}
          />
        )}
      </div>

      {/* Bulk selection action bar */}
      {isAdmin && selection.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-lg border bg-background px-4 py-2.5 shadow-lg">
          <p className="text-sm whitespace-nowrap">
            <span className="font-medium">{selection.size}</span> selected
            {selectionTotal > 0 && (
              <span className="text-muted-foreground"> · ${selectionTotal.toLocaleString()} est.</span>
            )}
          </p>
          {selection.size > LIMITS.BULK_ASSIGN_MAX && (
            <p className="text-xs text-destructive whitespace-nowrap">
              Max {LIMITS.BULK_ASSIGN_MAX} per assignment
            </p>
          )}
          <Button
            size="sm"
            onClick={() => setAssignOpen(true)}
            disabled={selection.size > LIMITS.BULK_ASSIGN_MAX}
          >
            <UserCheck className="h-4 w-4 mr-1" />
            Assign
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelection(new Map())}>
            Clear
          </Button>
        </div>
      )}

      {isAdmin && (
        <BulkAssignDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          leadIds={[...selection.keys()]}
          onAssigned={() => {
            setSelection(new Map());
            setAssignOpen(false);
            fetchLeads();
          }}
        />
      )}
    </div>
  );
}
