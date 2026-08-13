'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { KNOCK_DISPOSITIONS, type KnockDisposition } from '@/lib/leads/knocks';
import type { NearbyHit } from '@/lib/leads/walk-up';
import { walkUpDisplayName } from '@/lib/leads/walk-up';

interface ResolvedAddress {
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  source: string;
  precise: boolean;
}

interface AddHouseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  point: { latitude: number; longitude: number } | null;
  marketId: number | null;
  onCreated: (lead: unknown) => void;
}

const EMPTY = { street: '', city: '', state: '', zip: '', first: '', last: '', phone: '', notes: '' };

/**
 * Add a house the rep is standing at.
 *
 * The address is a guess and is presented as one. Reverse geocoding gets the
 * street right far more often than the house number, so the field is editable
 * and says where the value came from — a rep who can see the door number should
 * trust their eyes over the provider.
 *
 * The name is optional on purpose. Nobody answered, or they would not say, and
 * the house still has to exist so the next rep does not knock it again.
 */
export function AddHouseSheet({ open, onOpenChange, point, marketId, onCreated }: AddHouseSheetProps) {
  const [form, setForm] = useState(EMPTY);
  const [disposition, setDisposition] = useState<KnockDisposition | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedAddress | null>(null);
  const [nearby, setNearby] = useState<NearbyHit[]>([]);
  const [hiddenNearbyCount, setHiddenNearbyCount] = useState(0);

  const set = (k: keyof typeof EMPTY, v: string) => setForm(f => ({ ...f, [k]: v }));

  const resolve = useCallback(async (lat: number, lng: number) => {
    setResolving(true);
    setResolved(null);
    setNearby([]);
    setHiddenNearbyCount(0);
    try {
      const res = await fetch(`/api/admin/leads/walk-up/resolve?lat=${lat}&lng=${lng}`);
      const d = await res.json();
      if (d.success) {
        setNearby(d.nearby ?? []);
        setHiddenNearbyCount(d.hiddenNearbyCount ?? 0);
        if (d.address) {
          setResolved(d.address);
          setForm(f => ({
            ...f,
            street: d.address.address_street ?? '',
            city: d.address.address_city ?? '',
            state: d.address.address_state ?? '',
            zip: d.address.address_zip ?? '',
          }));
        }
      }
    } catch {
      // Leaving the fields blank is a working fallback — the rep can type it.
    } finally {
      setResolving(false);
    }
  }, []);

  useEffect(() => {
    if (open && point) {
      setForm(EMPTY);
      setDisposition(null);
      resolve(point.latitude, point.longitude);
    }
  }, [open, point, resolve]);

  async function save() {
    if (!point) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/leads/walk-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: point.latitude,
          longitude: point.longitude,
          first_name: form.first || null,
          last_name: form.last || null,
          phone: form.phone || null,
          address_street: form.street || null,
          address_city: form.city || null,
          address_state: form.state || null,
          address_zip: form.zip || null,
          notes: form.notes || null,
          disposition,
          market_id: marketId,
        }),
      });
      const d = await res.json();
      if (!d.success) {
        toast.error(d.error ?? 'Could not add the house');
        return;
      }
      toast.success(
        disposition && !d.knockRecorded
          ? 'House added, but the knock did not save — record it from the lead'
          : `Added ${walkUpDisplayName({ first_name: form.first, last_name: form.last, address_street: form.street })}`
      );
      onCreated(d.lead);
      onOpenChange(false);
    } catch {
      toast.error('Could not add the house');
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!(form.street.trim() || form.first.trim() || form.last.trim());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Add this house
          </SheetTitle>
          <SheetDescription>
            {resolving
              ? 'Looking up the address…'
              : resolved
                ? resolved.precise
                  ? 'Address found — check it matches the door.'
                  : 'Only the street was found — add the house number.'
                : 'No address found for this point. Type it in.'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {/* A house already at this point is almost always the same house, but
              a duplex is two doors metres apart — so this warns, never blocks. */}
          {nearby.length > 0 && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {nearby.length === 1 ? 'A lead already exists here' : `${nearby.length} leads already exist here`}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {nearby.slice(0, 4).map(n => (
                    <li key={n.id}>
                      {walkUpDisplayName(n)} · {Math.round(n.distanceM)}m away
                      {n.status ? ` · ${n.status}` : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add anyway if this is a different door.
                </p>
              </div>
            </div>
          )}

          {hiddenNearbyCount > 0 && (
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>
                {hiddenNearbyCount === 1
                  ? 'A lead assigned to another account is near this point.'
                  : `${hiddenNearbyCount} leads assigned to other accounts are near this point.`}
                {' '}Check that this is a different door before you add it.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="wu-street">Street address</Label>
            <Input
              id="wu-street"
              value={form.street}
              onChange={e => set('street', e.target.value)}
              placeholder="1421 E Palm Ln"
              disabled={resolving}
            />
            <div className="grid grid-cols-3 gap-2">
              <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="City" disabled={resolving} />
              <Input value={form.state} onChange={e => set('state', e.target.value)} placeholder="State" disabled={resolving} />
              <Input value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="ZIP" disabled={resolving} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Homeowner <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <div className="grid grid-cols-2 gap-2">
              <Input value={form.first} onChange={e => set('first', e.target.value)} placeholder="First name" />
              <Input value={form.last} onChange={e => set('last', e.target.value)} placeholder="Last name" />
            </div>
            <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="Phone" />
          </div>

          <div className="space-y-2">
            <Label>What happened? <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <div className="flex flex-wrap gap-2">
              {KNOCK_DISPOSITIONS.map(d => (
                <Button
                  key={d.value}
                  type="button"
                  variant={disposition === d.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDisposition(disposition === d.value ? null : d.value)}
                >
                  {d.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wu-notes">Notes</Label>
            <Textarea
              id="wu-notes"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Roof looks hail damaged, come back evening"
              rows={2}
            />
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" onClick={save} disabled={!canSave || saving || resolving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Add house
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
          {!canSave && (
            <p className="text-xs text-muted-foreground">
              Add a street address or a name so the next rep knows which door this is.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
