'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Trash2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
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
  activities_destroyed: number;
  knocks_destroyed: number;
  calls_destroyed: number;
  photos_destroyed: number;
  appointments_destroyed: number;
}

/**
 * Recently deleted leads.
 *
 * Deleting a lead cascades through its whole history, so without this there is
 * no evidence a lead ever existed. Renders nothing at all when nothing has been
 * deleted — an empty "Deleted leads" card on every visit is noise, and the point
 * is to be noticeable on the rare occasion it is not empty.
 */
export function DeletedLeadsPanel() {
  const [deletions, setDeletions] = useState<Deletion[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/admin/leads/deletions?limit=20')
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

  if (!loaded || total === 0) return null;

  return (
    <Card className="border-destructive/30">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <Trash2 className="h-4 w-4 shrink-0 text-destructive" />
          <span className="font-medium">
            {total.toLocaleString()} deleted lead{total === 1 ? '' : 's'}
          </span>
          <span className="text-xs text-muted-foreground">
            most recent {formatDistanceToNow(new Date(deletions[0].deleted_at), { addSuffix: true })}
          </span>
        </button>

        {open && (
          <div className="border-t">
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
                  {significant && (
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
                  </div>
                </div>
              );
            })}
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
