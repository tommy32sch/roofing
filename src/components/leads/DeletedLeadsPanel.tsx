'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Trash2, ChevronDown, ChevronRight, AlertTriangle, Check, Undo2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { deletedLeadLabel, isSignificantDeletion, totalDestroyed } from '@/lib/leads/lead-deletion';
import { formatAddressShort } from '@/lib/utils/format';

interface Deletion {
  id: string;
  lead_id: string;
  first_name: string | null;
  last_name: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  status: string | null;
  deleted_by_name: string | null;
  deleted_by_role: string | null;
  deleted_at: string;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  activities_destroyed: number;
  knocks_destroyed: number;
  calls_destroyed: number;
  photos_destroyed: number;
  appointments_destroyed: number;
}

/**
 * Deleted leads awaiting review.
 *
 * Deleting a lead cascades through its whole history, so without this there is
 * no evidence a lead ever existed. It is a queue rather than a log: approving a
 * deletion stamps who signed it off and drops it out of the list, so the panel
 * keeps meaning "these need a look" instead of growing forever and being
 * ignored.
 *
 * Approving never deletes the audit row. Clearing the panel by destroying the
 * record would undo the entire reason the record exists.
 */
export function DeletedLeadsPanel() {
  const [deletions, setDeletions] = useState<Deletion[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showReviewed, setShowReviewed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback((reviewed: boolean) => {
    const q = reviewed ? 'reviewed=1&limit=20' : 'limit=20';
    return fetch(`/api/admin/leads/deletions?${q}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setDeletions(d.deletions);
          setTotal(d.total);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => { load(showReviewed); }, [load, showReviewed]);

  async function review(id: string, undo: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/leads/deletions/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo }),
      });
      if (res.ok) await load(showReviewed);
    } finally {
      setBusy(null);
    }
  }

  async function approveAll() {
    setBusy('all');
    try {
      // Sequential rather than parallel: this is a handful of rows at most, and
      // a partial failure should leave the rest untouched and visible.
      for (const d of deletions) {
        await fetch(`/api/admin/leads/deletions/${d.id}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ undo: false }),
        });
      }
      await load(showReviewed);
    } finally {
      setBusy(null);
    }
  }

  // Nothing pending and not deliberately browsing history: stay out of the way.
  if (!loaded) return null;
  if (total === 0 && !showReviewed) return null;

  return (
    <Card className={showReviewed ? undefined : 'border-destructive/30'}>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <Trash2 className={`h-4 w-4 shrink-0 ${showReviewed ? 'text-muted-foreground' : 'text-destructive'}`} />
            <span className="truncate font-medium">
              {showReviewed
                ? `${total.toLocaleString()} approved deletion${total === 1 ? '' : 's'}`
                : `${total.toLocaleString()} deleted lead${total === 1 ? '' : 's'} to review`}
            </span>
            {deletions.length > 0 && (
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                most recent {formatDistanceToNow(new Date(deletions[0].deleted_at), { addSuffix: true })}
              </span>
            )}
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs"
            onClick={() => { setShowReviewed(s => !s); setOpen(true); }}
          >
            {showReviewed ? 'Show pending' : 'Show approved'}
          </Button>
        </div>

        {open && (
          <div className="border-t">
            {deletions.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                {showReviewed ? 'Nothing approved yet.' : 'Nothing waiting for review.'}
              </div>
            )}

            {deletions.map(d => {
              const counts = {
                activities: d.activities_destroyed,
                knocks: d.knocks_destroyed,
                calls: d.calls_destroyed,
                photos: d.photos_destroyed,
                appointments: d.appointments_destroyed,
              };
              const significant = isSignificantDeletion(counts);
              const lost = totalDestroyed(counts);
              const label = deletedLeadLabel(d);
              const addressRaw = formatAddressShort({
                address_street: d.address_street,
                address_city: d.address_city,
                address_state: d.address_state,
              });
              // deletedLeadLabel falls back to the street when a lead has no
              // name, so without this the same string renders twice.
              const address = addressRaw === label ? '' : addressRaw;
              return (
                <div key={d.id} className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0">
                  {/* Fieldwork lost is the part worth flagging: removing a
                      never-worked duplicate is routine, removing a lead with
                      knocks against it is not. */}
                  {significant && !d.reviewed_at && (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{label}</span>
                      {address && <span className="text-xs text-muted-foreground">{address}</span>}
                      {d.status && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                          {d.status}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      deleted by {d.deleted_by_name ?? 'unknown'}
                      {d.deleted_by_role && ` (${d.deleted_by_role})`}
                      {' · '}
                      {formatDistanceToNow(new Date(d.deleted_at), { addSuffix: true })}
                      {lost > 0 && (
                        <>
                          {' · '}
                          {[
                            d.knocks_destroyed && `${d.knocks_destroyed} knock${d.knocks_destroyed === 1 ? '' : 's'}`,
                            d.calls_destroyed && `${d.calls_destroyed} call${d.calls_destroyed === 1 ? '' : 's'}`,
                            d.appointments_destroyed && `${d.appointments_destroyed} appt${d.appointments_destroyed === 1 ? '' : 's'}`,
                            d.photos_destroyed && `${d.photos_destroyed} photo${d.photos_destroyed === 1 ? '' : 's'}`,
                          ].filter(Boolean).join(', ') || `${lost} record${lost === 1 ? '' : 's'}`}
                          {' lost'}
                        </>
                      )}
                    </div>
                    {d.reviewed_at && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        approved by {d.reviewed_by_name ?? 'unknown'}
                        {' · '}
                        {formatDistanceToNow(new Date(d.reviewed_at), { addSuffix: true })}
                      </div>
                    )}
                  </div>

                  <Button
                    variant={d.reviewed_at ? 'ghost' : 'outline'}
                    size="sm"
                    className="shrink-0"
                    disabled={busy !== null}
                    onClick={() => review(d.id, !!d.reviewed_at)}
                  >
                    {d.reviewed_at ? (
                      <><Undo2 className="mr-1 h-3.5 w-3.5" />Undo</>
                    ) : (
                      <><Check className="mr-1 h-3.5 w-3.5" />Approve</>
                    )}
                  </Button>
                </div>
              );
            })}

            {!showReviewed && deletions.length > 1 && (
              <div className="px-4 py-2">
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={approveAll}>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Approve all {deletions.length}
                </Button>
              </div>
            )}

            {total > deletions.length && (
              <div className="px-4 py-2 text-xs text-muted-foreground">
                showing the {deletions.length} most recent of {total.toLocaleString()}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
