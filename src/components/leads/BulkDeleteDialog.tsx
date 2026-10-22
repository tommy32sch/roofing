'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { bulkDeleteConfirmed, describeFieldwork, type DeletionCounts } from '@/lib/leads/lead-deletion';

interface DeletionPreview {
  found: number;
  worked: number;
  destroyed: Required<DeletionCounts>;
}

interface BulkDeleteDialogProps {
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onDeleted: () => void;
}

const leadsLabel = (n: number) => `${n} lead${n === 1 ? '' : 's'}`;

/**
 * Confirm a bulk lead deletion.
 *
 * Mount it only while it is open: the selection is frozen on mount, so the
 * preview, the typed confirmation and the delete all refer to the same leads
 * even if the queue behind the dialog changes.
 *
 * The operator types the number of selected leads. A bulk delete has no undo,
 * and the realistic mistake is not "clicked Delete by accident" but "had far
 * more selected than I thought" — typing the count catches exactly that.
 */
export function BulkDeleteDialog({ onOpenChange, leadIds, onDeleted }: BulkDeleteDialogProps) {
  const [ids] = useState(() => leadIds);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Dry run: what goes with these leads, computed by the same database
  // function that writes the audit records.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/leads/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_ids: ids, dry_run: true }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          setPreview({ found: data.found, worked: data.worked, destroyed: data.destroyed });
        } else {
          setPreviewError(data.error || 'Could not check these leads');
        }
      })
      .catch(() => {
        if (!cancelled) setPreviewError('Could not check these leads');
      });
    return () => {
      cancelled = true;
    };
  }, [ids]);

  const count = ids.length;
  const missing = preview ? count - preview.found : 0;
  const fieldwork = preview ? describeFieldwork(preview.destroyed) : '';
  const canDelete =
    !!preview && preview.found > 0 && bulkDeleteConfirmed(typed, count) && !deleting;

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch('/api/admin/leads/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_ids: ids }),
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(data.error || 'Delete failed');
        setDeleting(false);
        return;
      }
      toast.success(`${leadsLabel(data.deleted)} deleted`);
      if (data.photo_cleanup_failed) {
        toast.warning('Some photo files could not be removed from storage.');
      }
      onDeleted();
    } catch {
      toast.error('Delete failed');
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!deleting) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {leadsLabel(count)} permanently?</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            This removes the selected leads and everything recorded against them. It can&apos;t be
            undone. Each lead keeps a record in Activity → Deleted leads.
          </p>

          <div aria-live="polite" className="space-y-2">
            {!preview && !previewError && (
              <p className="text-muted-foreground">Checking what will be removed…</p>
            )}
            {previewError && <p className="text-destructive">{previewError}</p>}
            {preview && preview.found === 0 && (
              <p>All of the selected leads were already deleted.</p>
            )}
            {preview && preview.found > 0 && (
              <div className="flex gap-2">
                {preview.worked > 0 && (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                )}
                <p>
                  {preview.worked > 0
                    ? `${preview.worked} of these ${preview.worked === 1 ? 'has' : 'have'} been worked.`
                    : 'None of these leads has been worked.'}
                  {fieldwork && ` Deleted with them: ${fieldwork}.`}
                </p>
              </div>
            )}
            {preview && missing > 0 && preview.found > 0 && (
              <p className="text-muted-foreground">
                {missing} of the selected leads {missing === 1 ? 'was' : 'were'} already deleted.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-delete-confirm">Type {count} to confirm</Label>
            <Input
              id="bulk-delete-confirm"
              inputMode="numeric"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={!preview || preview.found === 0 || deleting}
              className="h-11"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" className="h-11" onClick={handleDelete} disabled={!canDelete}>
            {deleting ? 'Deleting…' : `Delete ${leadsLabel(count)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
