'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Building2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Market } from '@/types';
import { useAppShell } from '@/components/providers/app-shell-provider';

/**
 * Manage offices from Settings.
 *
 * Each market carries its own geocoding region. That is the point of them being
 * rows rather than a hardcoded list: with one app-wide region, a street-only
 * Minnesota address resolves into Arizona.
 */
export function MarketsCard() {
  const { hasIssue, markets: shellMarkets, refresh } = useAppShell();
  const [drafts, setDrafts] = useState<Record<number, Partial<Market>>>({});
  const markets = shellMarkets.map((market) => ({ ...market, ...drafts[market.id] }));
  const marketLoadFailed = hasIssue('markets_unavailable');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newState, setNewState] = useState('');

  function edit(id: number, patch: Partial<Market>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }

  async function save(market: Market) {
    setSavingId(market.id);
    try {
      const res = await fetch(`/api/admin/markets/${market.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: market.name,
          default_geo_city: market.default_geo_city,
          default_geo_state: market.default_geo_state,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.market.name} saved`);
        setDrafts((current) => ({ ...current, [data.market.id]: data.market }));
        refresh();
      } else {
        toast.error(data.error || 'Failed to save market');
      }
    } catch {
      toast.error('Failed to save market');
    } finally {
      setSavingId(null);
    }
  }

  async function add() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/admin/markets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          default_geo_city: newCity,
          default_geo_state: newState,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${data.market.name} added`);
        setNewName(''); setNewCity(''); setNewState('');
        refresh();
      } else {
        toast.error(data.error || 'Failed to add market');
      }
    } catch {
      toast.error('Failed to add market');
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Markets
        </CardTitle>
        <CardDescription>
          Your offices. Every lead belongs to one, chosen when you import a list. Reps get a
          home market so their Leads, Map and reporting default to their own office. Each
          market&apos;s region is used to place street-only addresses on the map, so a
          Minnesota street never lands in Arizona.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {marketLoadFailed ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Offices could not be loaded. Try again from the workspace notice above.
          </div>
        ) : markets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No markets yet — add your first office below.
          </p>
        ) : (
          markets.map((m) => (
            <div key={m.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_80px_auto] gap-2 sm:items-end">
              <div className="space-y-1">
                <Label htmlFor={`market_${m.id}_name`} className="text-xs">Office</Label>
                <Input
                  id={`market_${m.id}_name`}
                  value={m.name}
                  onChange={(e) => edit(m.id, { name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`market_${m.id}_city`} className="text-xs">Map city</Label>
                <Input
                  id={`market_${m.id}_city`}
                  value={m.default_geo_city ?? ''}
                  placeholder="Phoenix"
                  onChange={(e) => edit(m.id, { default_geo_city: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`market_${m.id}_state`} className="text-xs">State</Label>
                <Input
                  id={`market_${m.id}_state`}
                  value={m.default_geo_state ?? ''}
                  placeholder="AZ"
                  onChange={(e) => edit(m.id, { default_geo_state: e.target.value })}
                />
              </div>
              <Button
                variant="outline"
                onClick={() => save(m)}
                disabled={savingId === m.id || !m.name.trim()}
              >
                {savingId === m.id ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ))
        )}

        <div className="border-t pt-4 grid grid-cols-1 sm:grid-cols-[1fr_1fr_80px_auto] gap-2 sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="new_market_name" className="text-xs">Add an office</Label>
            <Input
              id="new_market_name"
              value={newName}
              placeholder="Colorado"
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new_market_city" className="text-xs">Map city</Label>
            <Input
              id="new_market_city"
              value={newCity}
              placeholder="Denver"
              onChange={(e) => setNewCity(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new_market_state" className="text-xs">State</Label>
            <Input
              id="new_market_state"
              value={newState}
              placeholder="CO"
              onChange={(e) => setNewState(e.target.value)}
            />
          </div>
          <Button onClick={add} disabled={marketLoadFailed || adding || !newName.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            {adding ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
