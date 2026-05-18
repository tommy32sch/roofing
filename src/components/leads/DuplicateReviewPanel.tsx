'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Lead } from '@/types';

interface FlaggedLead extends Lead {
  original?: Lead | null;
}

export function DuplicateReviewPanel() {
  const [flaggedLeads, setFlaggedLeads] = useState<FlaggedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<FlaggedLead | null>(null);

  async function fetchDuplicates() {
    try {
      const res = await fetch('/api/admin/leads?show_duplicates=true&is_flagged_duplicate=true&limit=50');
      const data = await res.json();
      if (!data.success) return;

      const leads: Lead[] = data.leads || [];

      // Fetch originals for leads that have a duplicate_of_id
      const ids = [...new Set(leads.map(l => l.duplicate_of_id).filter(Boolean))] as string[];
      const originals: Record<string, Lead> = {};

      await Promise.all(
        ids.map(async id => {
          const r = await fetch(`/api/admin/leads/${id}`);
          const d = await r.json();
          if (d.success) originals[id] = d.lead;
        })
      );

      setFlaggedLeads(leads.map(l => ({
        ...l,
        original: l.duplicate_of_id ? originals[l.duplicate_of_id] ?? null : null,
      })));
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDuplicates();
  }, []);

  async function handleUnflag(lead: FlaggedLead) {
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_flagged_duplicate: false, duplicate_of_id: null }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Lead unflagged');
        setFlaggedLeads(prev => prev.filter(l => l.id !== lead.id));
      } else {
        toast.error(data.error || 'Failed to unflag');
      }
    } catch {
      toast.error('Network error');
    }
  }

  async function handleDelete(lead: FlaggedLead) {
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success('Duplicate lead deleted');
        setFlaggedLeads(prev => prev.filter(l => l.id !== lead.id));
        setDeleteTarget(null);
      } else {
        toast.error(data.error || 'Failed to delete');
      }
    } catch {
      toast.error('Network error');
    }
  }

  if (loading || flaggedLeads.length === 0) return null;

  return (
    <>
      <Card className="border-amber-200 dark:border-amber-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Duplicate Review
            <Badge variant="outline" className="ml-1 text-amber-600 border-amber-400">
              {flaggedLeads.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {flaggedLeads.map(lead => (
            <div key={lead.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/leads/${lead.id}`} className="font-medium text-sm hover:underline flex items-center gap-1">
                      {lead.first_name} {lead.last_name}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                    <Badge variant="outline" className="text-amber-600 border-amber-400 text-xs">Flagged</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[lead.address_street, lead.address_city, lead.address_state].filter(Boolean).join(', ')}
                    {lead.phone && ` · ${lead.phone}`}
                  </p>
                  {lead.original && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Matches:{' '}
                      <Link href={`/admin/leads/${lead.original.id}`} className="hover:underline">
                        {lead.original.first_name} {lead.original.last_name}
                      </Link>
                      {' '}({[lead.original.address_street, lead.original.address_city].filter(Boolean).join(', ')})
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => handleUnflag(lead)}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    Keep
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(lead)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Duplicate Lead</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete {deleteTarget?.first_name} {deleteTarget?.last_name}? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && handleDelete(deleteTarget)}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
