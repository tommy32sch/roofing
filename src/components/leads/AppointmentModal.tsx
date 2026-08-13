'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DateTimeFields } from '@/components/leads/DateTimeFields';
import { AppointmentConflictWarning } from '@/components/leads/AppointmentConflictWarning';
import type { AppointmentConflict } from '@/lib/leads/appointment-conflicts';
import { isAssignableCloserRole } from '@/lib/leads/closer-handoff';

interface TeamMember {
  id: string;
  name: string;
  role: string;
}

interface AppointmentModalProps {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  currentCloserId?: string | null;
}

/**
 * Captures the appointment date/time when a lead is moved to appointment_set —
 * the server rejects that transition without a scheduled time
 * (appointment_form_required), same pattern as the sold/demographics flow.
 */
export function AppointmentModal({
  leadId,
  open,
  onOpenChange,
  onSuccess,
  currentCloserId = null,
}: AppointmentModalProps) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [closerId, setCloserId] = useState(currentCloserId ?? '');
  const [closers, setClosers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<AppointmentConflict[]>([]);
  // Set after the server refuses, so the next press is an explicit override.
  const [override, setOverride] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCloserId(currentCloserId ?? '');
    fetch('/api/admin/team')
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) return;
        setClosers(
          (data.members as TeamMember[]).filter((member) => isAssignableCloserRole(member.role))
        );
      })
      .catch(() => {});
  }, [open, currentCloserId]);

  const isValid =
    scheduledAt !== '' &&
    !Number.isNaN(new Date(scheduledAt).getTime()) &&
    closerId !== '';

  async function handleSubmit() {
    if (!isValid) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'appointment_set',
          appointment_scheduled_at: new Date(scheduledAt).toISOString(),
          appointment_notes: notes.trim() || null,
          assigned_closer_id: closerId,
          allow_conflict: override,
        }),
      });

      const data = await res.json();
      // 409: the slot is taken. Surface what it clashes with and let the next
      // press through rather than blocking outright.
      if (res.status === 409 && data.error === 'appointment_conflict') {
        setConflicts(data.conflicts ?? []);
        setOverride(true);
        setError('That time is already booked — save again to book it anyway.');
        return;
      }
      if (!data.success) {
        setError(data.error || 'Failed to save');
        return;
      }

      setScheduledAt('');
      setNotes('');
      setCloserId(currentCloserId ?? '');
      onOpenChange(false);
      onSuccess();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setScheduledAt('');
    setNotes('');
    setCloserId(currentCloserId ?? '');
    setError(null);
    setConflicts([]);
    setOverride(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set Appointment</DialogTitle>
          <p className="text-sm text-muted-foreground">
            When is the inspection, and which closer will run it?
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <DateTimeFields
              idPrefix="appt"
              value={scheduledAt}
              onChange={setScheduledAt}
              disabled={loading}
            />
            <AppointmentConflictWarning value={scheduledAt} onConflictsChange={setConflicts} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="appt_closer">Closer</Label>
            <Select value={closerId || null} onValueChange={(value) => setCloserId(value ?? '')}>
              <SelectTrigger id="appt_closer">
                <SelectValue placeholder="Select a closer" />
              </SelectTrigger>
              <SelectContent>
                {closers.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="appt_notes">Notes from the call / knock</Label>
            <Textarea
              id="appt_notes"
              placeholder="Roof condition, homeowner concerns, gate codes, who will be home..."
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || loading}>
            {loading ? 'Saving...' : conflicts.length > 0 ? 'Book anyway' : 'Set Appointment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
